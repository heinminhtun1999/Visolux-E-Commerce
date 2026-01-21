const express = require('express');

const { env } = require('../config/env');
const orderRepo = require('../repositories/orderRepo');
const paymentEventRepo = require('../repositories/paymentEventRepo');
const adminNotificationRepo = require('../repositories/adminNotificationRepo');
const emailService = require('../services/emailService');
const fiuu = require('../services/payments/fiuu');
const orderService = require('../services/orderService');
const orderRefundRepo = require('../repositories/orderRefundRepo');
const orderRefundExtraRepo = require('../repositories/orderRefundExtraRepo');
const refundService = require('../services/refundService');

const router = express.Router();

function getField(payload, names) {
  for (const name of names) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, name)) {
      const v = payload[name];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
  }

  const lowerNames = names.map((n) => String(n).toLowerCase());
  for (const [k, v] of Object.entries(payload || {})) {
    if (v === undefined || v === null) continue;
    const lk = String(k).toLowerCase();
    if (lowerNames.includes(lk) && String(v).trim() !== '') return String(v);
  }

  return '';
}

function parseOrderRef(payload) {
  const raw = String(payload.orderid || payload.orderId || payload.order || '').trim();
  return raw ? raw : null;
}

function resolveOrderFromRef(orderRef) {
  const ref = String(orderRef || '').trim();
  if (!ref) return null;
  if (/^\d+$/.test(ref)) return orderRepo.getById(Number(ref));
  return orderRepo.getByCode(ref);
}

function processPaymentPayload(payload, source) {
  if (!env.fiuu.secretKey) {
    const err = new Error('Missing FIUU_SECRET_KEY');
    err.status = 500;
    throw err;
  }

  const orderRef = parseOrderRef(payload);
  if (!orderRef) {
    const err = new Error('Invalid order reference');
    err.status = 400;
    throw err;
  }

  const tranID = String(payload.tranID || '');

  const verification = fiuu.verifySkey(payload, env.fiuu.secretKey);
  if (!verification.ok) {
    if (env.fiuu.logRequests) {
      // eslint-disable-next-line no-console
      console.warn('[fiuu] signature verification failed', {
        source,
        reason: verification.reason || 'bad_skey',
        payloadKeys: Object.keys(payload || {}),
        used: verification.used || null,
        received: verification.received || null,
        expected: verification.expected || null,
      });
    }
    const err = new Error('Invalid signature');
    err.status = 400;
    err.details = { reason: verification.reason || 'bad_skey' };
    if (env.nodeEnv === 'development' || env.fiuu.logRequests) {
      err.details.verification = {
        reason: verification.reason || 'bad_skey',
        used: verification.used || null,
        expected: verification.expected || null,
        received: verification.received || null,
      };
    }
    throw err;
  }

  const order = resolveOrderFromRef(orderRef);
  if (!order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  const orderId = Number(order.order_id);
  const previousPaymentStatus = String(order.payment_status || '');

  // Persist the channel used (Fiuu sends channel in callback/return payloads).
  try {
    const channel = getField(payload, ['channel', 'Channel']);
    if (channel) orderRepo.updatePaymentChannel(orderId, channel);
  } catch (_) {
    // ignore
  }

  if (order.payment_method !== 'ONLINE') {
    const err = new Error('Invalid payment method for order');
    err.status = 400;
    throw err;
  }

  const payloadCurrency = String(payload.currency || '');
  const expectedCurrency = String(env.fiuu.currency || 'MYR');
  if (payloadCurrency && payloadCurrency !== expectedCurrency) {
    const err = new Error('Currency mismatch');
    err.status = 400;
    throw err;
  }

  const payloadAmountCents = Math.round(Number(payload.amount || '0') * 100);
  if (!Number.isFinite(payloadAmountCents) || payloadAmountCents !== Number(order.total_amount)) {
    const err = new Error('Amount mismatch');
    err.status = 400;
    throw err;
  }

  // Replay protection / idempotency: record and ignore duplicates by provider_txn_id
  const ev = paymentEventRepo.tryInsertEvent({
    order_id: orderId,
    provider: 'FIUU',
    provider_txn_id: tranID || null,
    payload,
    verified: verification.ok,
  });

  // If we've seen this provider_txn_id before, treat as duplicate callback.
  const isDuplicate = ev.inserted === false;

  const statusCode = String(payload.status || '');

  if (statusCode === '00') {
    const result = orderService.markOrderPaidAndDeductStock({
      orderId,
      note: `Fiuu ${source} confirmed tranID=${tranID}`,
    });

    // In-app admin notification + customer email (best-effort; skip duplicates)
    try {
      if (!isDuplicate && previousPaymentStatus !== 'PAID') {
        const updated = orderRepo.getById(orderId);
        const label = updated?.order_code || `#${orderId}`;

        // Customer email (no staff notification)
        try {
          if (updated) {
            const note = `Payment received${tranID ? ` • Fiuu tranID=${tranID}` : ''}`;
            Promise.resolve(
              emailService.sendOrderStatusChangedEmailToCustomer({
                order: updated,
                event: 'PAYMENT_STATUS',
                note,
              })
            ).catch(() => {});
          }
        } catch (_) {
          // ignore
        }

        adminNotificationRepo.create({
          type: 'PAYMENT_PAID',
          title: `Payment received for order ${label}`,
          body: `Payment: ${updated?.payment_status || 'PAID'} • Fulfilment: ${updated?.fulfilment_status || '-'} • Fiuu tranID=${tranID || '-'}`,
          link: `/admin/orders/${orderId}`,
        });
      }
    } catch (_) {
      // ignore
    }

    return { orderId, statusCode, isDuplicate, outcome: 'PAID', result };
  }

  if (statusCode === '22') {
    orderRepo.updatePaymentStatus(orderId, 'PENDING', `Fiuu ${source} pending tranID=${tranID}`);
    return { orderId, statusCode, isDuplicate, outcome: 'PENDING' };
  }

  // 11 or other codes treated as failed
  if (order.payment_status !== 'PAID') {
    orderRepo.updatePaymentStatus(orderId, 'FAILED', `Fiuu ${source} failed tranID=${tranID} status=${statusCode}`);
    orderRepo.updateFulfilmentStatus(orderId, 'CANCELLED', 'Payment failed/cancelled');
  }

  return { orderId, statusCode, isDuplicate, outcome: 'FAILED' };
}

router.all('/payment/return', (req, res, next) => {
  try {
    const payload = { ...req.query, ...req.body };
    const r = processPaymentPayload(payload, 'return');

    // For iframe embedding: show confirmation inside iframe; gateway itself should open in _top.
    return res.redirect(`/orders/${r.orderId}/confirmation`);
  } catch (e) {
    return next(e);
  }
});

router.post('/payment/callback', (req, res) => {
  try {
    const payload = req.body || {};
    processPaymentPayload(payload, 'callback');
    // Always 200 to prevent retries storm once processed.
    return res.status(200).send('OK');
  } catch (e) {
    // Signature failures should be 400 so gateway knows it was rejected.
    const status = Number(e.status || 400);
    return res.status(status).send('ERROR');
  }
});

router.all('/payment/refund/notify', (req, res) => {
  // Gateway callback: do not require authentication.
  // Always respond 200 to avoid retries storms.
  try {
    const payload = { ...req.query, ...req.body };

    const providerRefId = String(getField(payload, ['RefID', 'refId', 'refID', 'refid', 'RefId']) || '').trim();
    const providerRefundId = getField(payload, ['RefundID', 'refundID', 'refundId', 'RefundId']);
    if (!providerRefId && !providerRefundId) return res.status(200).send('OK');

    let signatureOk = null;
    try {
      const v = fiuu.verifyRefundSignature(payload, env.fiuu.secretKey);
      signatureOk = v.ok;
    } catch (_) {
      signatureOk = null;
    }

    const providerTxnId = getField(payload, ['TxnID', 'txnID', 'txnId', 'tranID', 'tranId', 'txnid']);
    const providerStatus = getField(payload, ['Status', 'status']);
    const providerReason = getField(payload, ['Reason', 'reason', 'error_desc', 'errorDesc']);

      let updated = null;
      if (providerRefId) {
        updated = orderRefundRepo.updateGatewayByProviderRefId({
        provider: 'FIUU',
        providerRefId,
        providerRefundId: providerRefundId || null,
        providerTxnId: providerTxnId || null,
        providerStatus: providerStatus || null,
        providerReason: providerReason || null,
        providerSignatureOk: signatureOk,
        providerResponseJson: JSON.stringify(payload || {}),
      });
        if (!updated) {
          updated = orderRefundExtraRepo.updateGatewayByProviderRefId({
            provider: 'FIUU',
            providerRefId,
            providerRefundId: providerRefundId || null,
            providerTxnId: providerTxnId || null,
            providerStatus: providerStatus || null,
            providerReason: providerReason || null,
            providerSignatureOk: signatureOk,
            providerResponseJson: JSON.stringify(payload || {}),
          });
        }
    }

    // Fallback: some gateways/relays may omit RefID but include RefundID.
    if (!updated && providerRefundId) {
      updated = orderRefundRepo.updateGatewayByProviderRefundId({
        provider: 'FIUU',
        providerRefundId,
        providerRefId: providerRefId || null,
        providerTxnId: providerTxnId || null,
        providerStatus: providerStatus || null,
        providerReason: providerReason || null,
        providerSignatureOk: signatureOk,
        providerResponseJson: JSON.stringify(payload || {}),
      });
        if (!updated) {
          updated = orderRefundExtraRepo.updateGatewayByProviderRefundId({
            provider: 'FIUU',
            providerRefundId,
            providerRefId: providerRefId || null,
            providerTxnId: providerTxnId || null,
            providerStatus: providerStatus || null,
            providerReason: providerReason || null,
            providerSignatureOk: signatureOk,
            providerResponseJson: JSON.stringify(payload || {}),
          });
        }
    }

    if (updated && updated.order_id) {
      // If refund has now completed, this will update orders.refund_status and set payment_status=REFUNDED on full refund.
      refundService.refreshOrderRefundStatus({ orderId: Number(updated.order_id) });
    }

    return res.status(200).send('OK');
  } catch (_) {
    return res.status(200).send('OK');
  }
});

router.get('/payment/cancel', (req, res) => {
  // Cancelled before transaction creation is possible at gateway,
  // but we still may have a pending order created.
  const orderRef = String(req.query.orderid || req.query.orderId || req.query.order || '').trim();
  if (orderRef) {
    const order = resolveOrderFromRef(orderRef);
    if (order && order.payment_status !== 'PAID') {
      orderRepo.updatePaymentStatus(order.order_id, 'FAILED', 'Buyer cancelled at gateway');
      orderRepo.updateFulfilmentStatus(order.order_id, 'CANCELLED', 'Buyer cancelled at gateway');
    }
  }

  req.session.flash = { type: 'error', message: 'Payment cancelled.' };
  return res.redirect('/');
});

module.exports = router;
