const { getDb } = require('../db/db');
const { env } = require('../config/env');
const orderRepo = require('../repositories/orderRepo');
const orderRefundRepo = require('../repositories/orderRefundRepo');
const orderRefundExtraRepo = require('../repositories/orderRefundExtraRepo');
const paymentEventRepo = require('../repositories/paymentEventRepo');
const fiuu = require('./payments/fiuu');
const { logger } = require('../utils/logger');

function allocateDiscountAcrossItems({ items, discountAmount }) {
  const discount = Math.max(0, Number(discountAmount || 0));
  const totalSubtotal = items.reduce((sum, it) => sum + Math.max(0, Number(it.subtotal || 0)), 0);
  const effectiveDiscount = Math.min(discount, totalSubtotal);
  if (!effectiveDiscount || !totalSubtotal) {
    return items.map((it) => ({ orderItemId: it.id, allocatedDiscount: 0 }));
  }

  let allocatedSoFar = 0;
  const allocations = items.map((it, idx) => {
    const subtotal = Math.max(0, Number(it.subtotal || 0));
    let allocated = Math.floor((effectiveDiscount * subtotal) / totalSubtotal);
    if (idx === items.length - 1) allocated = Math.max(0, effectiveDiscount - allocatedSoFar);
    allocatedSoFar += allocated;
    return { orderItemId: it.id, allocatedDiscount: allocated };
  });

  return allocations;
}

function computeDefaultRefundAmountCents({ order, promo, orderItem, quantityToRefund }) {
  const qty = Number(orderItem.quantity || 0);
  const q = Number(quantityToRefund || 0);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(q) || q <= 0) return 0;

  const items = Array.isArray(order.items) ? order.items : [];
  const discountAmount = promo && !promo.applies_to_shipping ? Number(promo.discount_amount || 0) : 0;
  const allocations = allocateDiscountAcrossItems({ items, discountAmount });
  const alloc = allocations.find((a) => a.orderItemId === orderItem.id);
  const allocatedDiscount = alloc ? Number(alloc.allocatedDiscount || 0) : 0;
  const netPaidForLine = Math.max(0, Number(orderItem.subtotal || 0) - allocatedDiscount);
  return Math.round((netPaidForLine * q) / qty);
}

function refreshOrderRefundStatus({ orderId }) {
  const order = orderRepo.getWithItems(orderId);
  if (!order) return null;

  const summaryItems = orderRefundRepo.summaryConfirmedByOrder(orderId);
  const summaryExtra = orderRefundExtraRepo.summaryConfirmedByOrder(orderId);
  const refundedAmount =
    Number(summaryItems.amount_refunded || 0) + Number(summaryExtra.amount_refunded || 0);
  const paidAmount = Number(order.total_amount || 0);

  let refundStatus = 'NONE';
  if (refundedAmount > 0) refundStatus = 'PARTIAL_REFUND';
  if (paidAmount > 0 && refundedAmount >= paidAmount) refundStatus = 'FULL_REFUND';
  if (paidAmount === 0 && refundedAmount > 0) refundStatus = 'FULL_REFUND';

  const db = getDb();
  db.prepare('UPDATE orders SET refund_status=? WHERE order_id=?').run(refundStatus, orderId);

  // Align payment_status to reflect refund progress.
  if (paidAmount > 0) {
    if (refundStatus === 'FULL_REFUND') {
      if (order.payment_status !== 'REFUNDED') {
        orderRepo.updatePaymentStatus(orderId, 'REFUNDED', 'Order fully refunded');
      }
    } else if (refundStatus === 'PARTIAL_REFUND') {
      if (order.payment_status !== 'PARTIALLY_REFUNDED') {
        orderRepo.updatePaymentStatus(orderId, 'PARTIALLY_REFUNDED', 'Order partially refunded');
      }
    }
  }

  return { refund_status: refundStatus, refunded_amount: refundedAmount };
}

function isFpxOnlineOrder(order) {
  if (!order) return false;
  if (String(order.payment_method || '') !== 'ONLINE') return false;
  const ch = String(order.payment_channel || '').trim();
  return /^FPX/i.test(ch);
}

async function refundOrderItem({ orderId, orderItemId, quantityRefunded, amountRefunded, reason }) {
  const db = getDb();

  // Step 1: validate + compute amount inside a short DB transaction.
  const prepared = db.transaction(() => {
    const order = orderRepo.getWithItems(orderId);
    if (!order) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }

    if (order.payment_method !== 'ONLINE') {
      const err = new Error('Refunds are only supported for ONLINE payment orders.');
      err.status = 400;
      throw err;
    }

    if (isFpxOnlineOrder(order)) {
      logger.warn(
        { event: 'refund_blocked_fpx', orderId, paymentChannel: order.payment_channel || null },
        'refund blocked for FPX online order'
      );
      const err = new Error('Refund via Fiuu is disabled for FPX payments. Please refund manually using the customer bank credentials.');
      err.status = 400;
      throw err;
    }

    if (order.payment_status !== 'PAID' && order.payment_status !== 'PARTIALLY_REFUNDED' && order.payment_status !== 'REFUNDED') {
      const err = new Error('Order must be PAID before refunding.');
      err.status = 400;
      throw err;
    }

    if (!fiuu.isRefundConfigured()) {
      const err = new Error('Fiuu refund is not configured (missing FIUU_MERCHANT_ID / FIUU_SECRET_KEY).');
      err.status = 500;
      throw err;
    }

    const item = (order.items || []).find((it) => Number(it.id) === Number(orderItemId));
    if (!item) {
      const err = new Error('Order item not found');
      err.status = 404;
      throw err;
    }

    const qty = Math.floor(Number(quantityRefunded));
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error('Refund quantity must be a positive number.');
      err.status = 400;
      throw err;
    }

    const itemSummary = orderRefundRepo.summaryByOrderItem(item.id);
    const alreadyQty = Number(itemSummary.quantity_refunded || 0);
    const remainingQty = Math.max(0, Number(item.quantity || 0) - alreadyQty);
    if (qty > remainingQty) {
      const err = new Error('Refund quantity exceeds remaining refundable quantity.');
      err.status = 400;
      throw err;
    }

    const promo = orderRepo.getPromoForOrder(orderId);
    const defaultAmount = computeDefaultRefundAmountCents({ order, promo, orderItem: item, quantityToRefund: qty });

    let amount = amountRefunded == null ? null : Number(amountRefunded);
    if (amount == null || !Number.isFinite(amount) || amount < 0) amount = defaultAmount;
    amount = Math.floor(amount);

    const alreadyAmount = Number(itemSummary.amount_refunded || 0);
    const maxForThisLine = computeDefaultRefundAmountCents({ order, promo, orderItem: item, quantityToRefund: remainingQty });
    const remainingAmount = Math.max(0, maxForThisLine - alreadyAmount);
    if (amount > remainingAmount) {
      const err = new Error('Refund amount exceeds remaining refundable amount for this item.');
      err.status = 400;
      throw err;
    }

    const txnId = paymentEventRepo.getLatestProviderTxnIdByOrder({ orderId, provider: 'FIUU' });
    if (!txnId) {
      const err = new Error('Cannot refund: missing FIUU transaction id (tranID) for this order.');
      err.status = 400;
      throw err;
    }

    const refId = `refund-${order.order_code || order.order_id}-${item.id}-${Date.now()}`.slice(0, 100);
    const notifyUrl = `${String(env.appBaseUrl || '').replace(/\/$/, '')}/payment/refund/notify`;

    return {
      order,
      item,
      qty,
      amount,
      reason: String(reason || '').trim() || null,
      txnId,
      refId,
      notifyUrl,
    };
  })();

  // Step 2: call gateway (outside the DB transaction).
  let gw;
  try {
    gw = await fiuu.refundPartial({
      txnId: prepared.txnId,
      refId: prepared.refId,
      amountCents: prepared.amount,
      notifyUrl: prepared.notifyUrl,
      mdrFlag: 0,
    });
    logger.info(
      { event: 'refund_requested', orderId, orderItemId: prepared.item.id, amountCents: prepared.amount, qty: prepared.qty },
      'refund requested'
    );
  } catch (e) {
    logger.error(
      { event: 'refund_request_failed', err: e, orderId, orderItemId: prepared.item.id, amountCents: prepared.amount },
      'refund request failed'
    );
    // Record a failed attempt so admins can see it and optionally mark refund manually.
    try {
      db.transaction(() => {
        orderRefundRepo.create({
          orderId,
          orderItemId: prepared.item.id,
          productId: prepared.item.product_id,
          quantityRefunded: prepared.qty,
          amountRefunded: prepared.amount,
          reason: prepared.reason,
          provider: 'FIUU',
          providerRefId: prepared.refId,
          providerTxnId: prepared.txnId,
          providerRefundId: null,
          providerStatus: 'FAILED',
          providerReason: String(e && e.message ? e.message : 'Refund request failed'),
          providerSignatureOk: null,
          providerResponseJson: JSON.stringify({
            message: String(e && e.message ? e.message : ''),
            details: e && e.details ? e.details : null,
            status: e && e.status ? e.status : null,
          }),
        });
      })();
    } catch (_) {
      // ignore DB recording issues
    }
    throw e;
  }

  // Step 3: record refund + gateway metadata in DB.
  return db.transaction(() => {
    const resp = gw && gw.response ? gw.response : {};
    const initialStatus = resp.Status || resp.status || null;

    const created = orderRefundRepo.create({
      orderId,
      orderItemId: prepared.item.id,
      productId: prepared.item.product_id,
      quantityRefunded: prepared.qty,
      amountRefunded: prepared.amount,
      reason: prepared.reason,
      provider: 'FIUU',
      providerRefId: prepared.refId,
      providerTxnId: prepared.txnId,
      providerRefundId: resp.RefundID || resp.refundID || resp.refundId || null,
      // Only the refund notify callback should mark FIUU refunds as confirmed/successful.
      providerStatus: 'PENDING',
      providerReason:
        String(resp.reason || resp.Reason || '').trim() || (initialStatus ? `Requested (API status=${initialStatus})` : 'Requested'),
      providerSignatureOk: null,
      providerResponseJson: JSON.stringify({ ...resp, _initial_request_signature_ok: gw.signatureOk }),
    });

    const updated = refreshOrderRefundStatus({ orderId });
    return { created, updated, gateway: gw };
  })();
}

async function refundOrderExtraAmount({ orderId, amountRefunded, reason }) {
  const db = getDb();

  const prepared = db.transaction(() => {
    const order = orderRepo.getWithItems(orderId);
    if (!order) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }

    if (order.payment_method !== 'ONLINE') {
      const err = new Error('Refunds are only supported for ONLINE payment orders.');
      err.status = 400;
      throw err;
    }

    if (isFpxOnlineOrder(order)) {
      const err = new Error('Refund via Fiuu is disabled for FPX payments. Please refund manually using the customer bank credentials.');
      err.status = 400;
      throw err;
    }

    if (order.payment_status !== 'PAID' && order.payment_status !== 'PARTIALLY_REFUNDED' && order.payment_status !== 'REFUNDED') {
      const err = new Error('Order must be PAID before refunding.');
      err.status = 400;
      throw err;
    }

    if (!fiuu.isRefundConfigured()) {
      const err = new Error('Fiuu refund is not configured (missing FIUU_MERCHANT_ID / FIUU_SECRET_KEY).');
      err.status = 500;
      throw err;
    }

    let amount = amountRefunded == null ? null : Number(amountRefunded);
    if (amount == null || !Number.isFinite(amount) || amount < 0) {
      const err = new Error('Refund amount is required.');
      err.status = 400;
      throw err;
    }
    amount = Math.floor(amount);

    const inFlightItems = orderRefundRepo.summaryByOrder(orderId);
    const inFlightExtra = orderRefundExtraRepo.summaryByOrder(orderId);
    const inFlightAmount =
      Number(inFlightItems.amount_refunded || 0) + Number(inFlightExtra.amount_refunded || 0);
    const paidAmount = Number(order.total_amount || 0);
    const remainingAmount = Math.max(0, paidAmount - inFlightAmount);
    if (amount > remainingAmount) {
      const err = new Error('Refund amount exceeds remaining refundable amount for this order.');
      err.status = 400;
      throw err;
    }

    const txnId = paymentEventRepo.getLatestProviderTxnIdByOrder({ orderId, provider: 'FIUU' });
    if (!txnId) {
      const err = new Error('Cannot refund: missing FIUU transaction id (tranID) for this order.');
      err.status = 400;
      throw err;
    }

    const refId = `refund-extra-${order.order_code || order.order_id}-${Date.now()}`.slice(0, 100);
    const notifyUrl = `${String(env.appBaseUrl || '').replace(/\/$/, '')}/payment/refund/notify`;

    return {
      order,
      amount,
      reason: String(reason || '').trim() || null,
      txnId,
      refId,
      notifyUrl,
    };
  })();

  let gw;
  try {
    gw = await fiuu.refundPartial({
      txnId: prepared.txnId,
      refId: prepared.refId,
      amountCents: prepared.amount,
      notifyUrl: prepared.notifyUrl,
      mdrFlag: 0,
    });
  } catch (e) {
    try {
      db.transaction(() => {
        orderRefundExtraRepo.create({
          orderId,
          amountRefunded: prepared.amount,
          reason: prepared.reason,
          provider: 'FIUU',
          providerRefId: prepared.refId,
          providerTxnId: prepared.txnId,
          providerRefundId: null,
          providerStatus: 'FAILED',
          providerReason: String(e && e.message ? e.message : 'Refund request failed'),
          providerSignatureOk: null,
          providerResponseJson: JSON.stringify({
            message: String(e && e.message ? e.message : ''),
            details: e && e.details ? e.details : null,
            status: e && e.status ? e.status : null,
          }),
        });
      })();
    } catch (_) {
      // ignore
    }
    throw e;
  }

  return db.transaction(() => {
    const resp = gw && gw.response ? gw.response : {};
    const initialStatus = resp.Status || resp.status || null;

    const created = orderRefundExtraRepo.create({
      orderId,
      amountRefunded: prepared.amount,
      reason: prepared.reason,
      provider: 'FIUU',
      providerRefId: prepared.refId,
      providerTxnId: prepared.txnId,
      providerRefundId: resp.RefundID || resp.refundID || resp.refundId || null,
      // Only the refund notify callback should mark FIUU refunds as confirmed/successful.
      providerStatus: 'PENDING',
      providerReason:
        String(resp.reason || resp.Reason || '').trim() || (initialStatus ? `Requested (API status=${initialStatus})` : 'Requested'),
      providerSignatureOk: null,
      providerResponseJson: JSON.stringify({ ...resp, _initial_request_signature_ok: gw.signatureOk }),
    });

    const updated = refreshOrderRefundStatus({ orderId });
    return { created, updated, gateway: gw };
  })();
}

module.exports = {
  refundOrderItem,
  refundOrderExtraAmount,
  refreshOrderRefundStatus,
};
