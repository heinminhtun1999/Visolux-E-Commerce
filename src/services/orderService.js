const { getDb } = require('../db/db');
const inventoryRepo = require('../repositories/inventoryRepo');
const productVariantRepo = require('../repositories/productVariantRepo');
const orderRepo = require('../repositories/orderRepo');
const adminNotificationRepo = require('../repositories/adminNotificationRepo');
const emailService = require('./emailService');
const { getMalaysiaRegionForState } = require('../utils/malaysia');
const shippingService = require('./shippingService');
const promoService = require('./promoService');
const { normalizeProductType } = require('../utils/productTypes');

class StockInsufficientError extends Error {
  constructor(message) {
    super(message || 'Insufficient stock');
    this.name = 'StockInsufficientError';
    this.status = 409;
  }
}

function buildOrderFromCart({ cartItems }) {
  const items = [];
  let subtotal = 0;

  for (const line of cartItems) {
    const p = line.product;
    const v = line.variant || null;

    if (!p || p.archived) continue;
    if (!p.visibility) {
      const err = new Error(`Product "${p.name}" is no longer available.`);
      err.status = 400;
      throw err;
    }

    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const availableStock = v ? Math.max(0, Math.floor(Number(v.stock || 0))) : inventoryRepo.getEffectiveAvailableStock(p.product_id);
    if (availableStock <= 0) {
      throw new StockInsufficientError(`"${p.name}" is out of stock.`);
    }
    if (qty > availableStock) {
      throw new StockInsufficientError(`Only ${availableStock} of "${p.name}" is available.`);
    }

    const unitPriceCents = v ? Number(v.price) : Number(p.price);
    const typeLabel = v ? String(v.label || '').trim() : normalizeProductType(line.type);

    items.push({
      product_id: p.product_id,
      variant_id: v ? v.variant_id : null,
      product_name_snapshot: p.name,
      item_type: typeLabel,
      item_note: String(line.note || '').trim(),
      price_snapshot: unitPriceCents,
      quantity: qty,
      subtotal: unitPriceCents * qty,
    });
    subtotal += unitPriceCents * qty;
  }

  if (items.length === 0) {
    const err = new Error('Your cart is empty.');
    err.status = 400;
    throw err;
  }

  return { items, subtotal };
}

function computeTotalWeightKgFromCartItems(cartItems) {
  let total = 0;
  for (const line of cartItems || []) {
    const w = Number((line?.variant && line.variant.weight_kg != null) ? line.variant.weight_kg : (line?.product?.weight_kg || 0));
    const q = Number(line?.quantity || 0);
    if (!Number.isFinite(w) || !Number.isFinite(q) || q <= 0) continue;
    total += w * q;
  }
  return Math.max(0, total);
}

function placeOrder({
  user,
  customer,
  cartItems,
  promoCode,
  payment_method,
  offline_transfer_recipient,
  online_payment_snapshot,
}) {
  if (!user || !Number.isFinite(Number(user.user_id)) || Number(user.user_id) <= 0) {
    const err = new Error('Sign in required to place an order.');
    err.status = 401;
    throw err;
  }

  const built = buildOrderFromCart({ cartItems });

  const totalWeightKg = computeTotalWeightKgFromCartItems(cartItems);

  const deliveryRegion = getMalaysiaRegionForState(customer?.state);
  if (!deliveryRegion) {
    const err = new Error('Delivery state is required.');
    err.status = 400;
    throw err;
  }
  const shippingQuote = shippingService.quoteShippingCents({
    state: customer.state,
    postcode: customer.postcode,
    weightKg: totalWeightKg,
  });
  if (shippingQuote && shippingQuote.noMatch) {
    const err = new Error('Shipping is not available for the selected delivery address.');
    err.status = 400;
    throw err;
  }
  const deliveryZoneName = shippingQuote && shippingQuote.zone && shippingQuote.zone.name
    ? String(shippingQuote.zone.name).trim()
    : '';
  const shippingFeeCents = Number(shippingQuote?.shippingCents || 0);
  const preDiscountGrandTotal = Math.max(0, built.subtotal + shippingFeeCents);

  let promo = null;
  let discount = 0;
  if (promoCode) {
    // Promo can apply to items subtotal (default) or shipping fee.
    // Still a single promo code per checkout.
    const candidate = promoService.applyPromoToTotal({ promoCodeInput: promoCode, totalCents: built.subtotal });
    const appliesToShipping = Boolean(candidate?.promo?.applies_to_shipping);
    const applied = appliesToShipping
      ? promoService.applyPromoToTotal({ promoCodeInput: promoCode, totalCents: shippingFeeCents })
      : candidate;
    promo = applied.promo;
    discount = applied.discount;
  }

  const grandTotal = Math.max(0, built.subtotal + shippingFeeCents - discount);

  const payment_status = payment_method === 'OFFLINE_TRANSFER' ? 'AWAITING_VERIFICATION' : 'PENDING';
  const fulfilment_status = 'NEW';

  const order = orderRepo.createOrder({
    user_id: Number(user.user_id),
    customer_name: customer.customer_name,
    customer_company: customer.company_name || null,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    delivery_address_line1: customer.address_line1 || null,
    delivery_address_line2: customer.address_line2 || null,
    delivery_city: customer.city || null,
    delivery_state: customer.state || null,
    delivery_postcode: customer.postcode || null,
    delivery_region: deliveryRegion,
    delivery_zone_name: deliveryZoneName || null,
    payment_method,
    payment_status,
    fulfilment_status,
    online_payment_provider: online_payment_snapshot?.provider || null,
    online_payment_account_id: online_payment_snapshot?.account_id || null,
    online_payment_merchant_id: online_payment_snapshot?.merchant_id || null,
    online_payment_verify_key: online_payment_snapshot?.verify_key || null,
    online_payment_secret_key: online_payment_snapshot?.secret_key || null,
    online_payment_gateway_url: online_payment_snapshot?.gateway_url || null,
    online_payment_currency: online_payment_snapshot?.currency || null,
    offline_transfer_bank: offline_transfer_recipient?.bank || null,
    offline_transfer_account_no: offline_transfer_recipient?.account_no || null,
    offline_transfer_account_name: offline_transfer_recipient?.account_name || null,
    items_subtotal: built.subtotal,
    discount_amount: discount,
    shipping_fee: shippingFeeCents,
    total_amount: grandTotal,
    customer_note: customer?.customer_note || '',
    items: built.items,
    promo,
  });

  // In-app admin notification (best-effort)
  try {
    const label = order.order_code || `#${order.order_id}`;
    adminNotificationRepo.create({
      type: 'ORDER_CREATED',
      title: `New order ${label}`,
      body: `${order.customer_name} • ${order.payment_method} • Payment: ${order.payment_status} • Fulfilment: ${order.fulfilment_status} • RM ${(Number(order.total_amount || 0) / 100).toFixed(2)} (Ship: RM ${(Number(order.shipping_fee || 0) / 100).toFixed(2)})`,
      link: `/admin/orders/${order.order_id}`,
    });
  } catch (_) {
    // ignore
  }

  return order;
}

function deductStockAtomicallyForOrder(order) {
  const db = getDb();

  const tx = db.transaction(() => {
    const variantProductIds = new Set();

    for (const it of order.items) {
      const useVariant = it.variant_id != null && Number.isFinite(Number(it.variant_id)) && Number(it.variant_id) > 0;

      const res = useVariant
        ? db
          .prepare(
            'UPDATE product_variants SET stock = stock - ? WHERE variant_id=? AND stock >= ? AND COALESCE(active, 1)=1 AND visibility=1 AND archived=0'
          )
          .run(it.quantity, it.variant_id, it.quantity)
        : db
          .prepare('UPDATE inventory SET stock = stock - ? WHERE product_id=? AND stock >= ? AND archived=0')
          .run(it.quantity, it.product_id, it.quantity);

      if (res.changes !== 1) {
        const product = inventoryRepo.getById(it.product_id);
        const name = product?.name || `#${it.product_id}`;
        throw new StockInsufficientError(`Insufficient stock for ${name}`);
      }

      if (useVariant) {
        variantProductIds.add(Number(it.product_id));
      }
    }

    // Keep product-level stock in sync with sum of active variants.
    // This ensures admin/product stock reflects variant deductions after payment.
    for (const productId of variantProductIds) {
      const agg = productVariantRepo.computeAggregateForProduct(productId);
      if (agg && agg.hasVariants) {
        inventoryRepo.update(productId, { stock: Math.max(0, Math.floor(Number(agg.stock || 0))) });
      }
    }
  });

  tx();
}

function markOrderPaidAndDeductStock({ orderId, note, actor }) {
  const db = getDb();

  const tx = db.transaction(() => {
    const order = orderRepo.getWithItems(orderId);
    if (!order) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }

    if (order.payment_status === 'PAID') {
      return { order, alreadyPaid: true };
    }

    // Attempt to deduct stock. If it fails, we still mark payment as PAID (gateway says so),
    // but we cancel fulfilment and record the issue for manual refund/handling.
    try {
      deductStockAtomicallyForOrder(order);
      orderRepo.updatePaymentStatus(orderId, 'PAID', note || 'Payment confirmed', actor);
      orderRepo.updateFulfilmentStatus(orderId, 'PROCESSING', 'Paid; ready to fulfil', actor);
      return { order: orderRepo.getWithItems(orderId), alreadyPaid: false, stockDeducted: true };
    } catch (e) {
      if (e instanceof StockInsufficientError) {
        orderRepo.updatePaymentStatus(orderId, 'PAID', `${note || 'Payment confirmed'} (stock insufficient)`, actor);
        orderRepo.updateFulfilmentStatus(
          orderId,
          'CANCELLED',
          'Payment succeeded but stock insufficient. Manual refund/adjustment required.',
          actor
        );
        return { order: orderRepo.getWithItems(orderId), alreadyPaid: false, stockDeducted: false, stockError: e.message };
      }
      throw e;
    }
  });

  const result = tx();

  // Staff email (best-effort) when payment becomes PAID.
  try {
    if (result && result.alreadyPaid === false && result.order) {
      Promise.resolve(
        emailService.sendAdminPaymentReceivedEmail({
          order: result.order,
          note,
          stockDeducted: result.stockDeducted,
          stockError: result.stockError,
        })
      ).catch(() => {});

    }
  } catch (_) {
    // ignore
  }

  return result;
}

module.exports = {
  placeOrder,
  buildOrderFromCart,
  markOrderPaidAndDeductStock,
  StockInsufficientError,
};
