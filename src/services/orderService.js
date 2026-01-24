const { getDb } = require('../db/db');
const inventoryRepo = require('../repositories/inventoryRepo');
const orderRepo = require('../repositories/orderRepo');
const adminNotificationRepo = require('../repositories/adminNotificationRepo');
const { getMalaysiaRegionForState } = require('../utils/malaysia');
const shippingService = require('./shippingService');
const promoService = require('./promoService');

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

    if (!p || p.archived) continue;
    if (!p.visibility) {
      const err = new Error(`Product "${p.name}" is no longer available.`);
      err.status = 400;
      throw err;
    }

    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const availableStock = Math.max(0, Math.floor(Number(p.stock || 0)));
    if (availableStock <= 0) {
      throw new StockInsufficientError(`"${p.name}" is out of stock.`);
    }
    if (qty > availableStock) {
      throw new StockInsufficientError(`Only ${availableStock} of "${p.name}" is available.`);
    }

    items.push({
      product_id: p.product_id,
      product_name_snapshot: p.name,
      price_snapshot: p.price,
      quantity: qty,
      subtotal: p.price * qty,
    });
    subtotal += p.price * qty;
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
    const w = Number(line?.product?.weight_kg || 0);
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
}) {
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
    user_id: user?.user_id || null,
    customer_name: customer.customer_name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    delivery_address_line1: customer.address_line1 || null,
    delivery_address_line2: customer.address_line2 || null,
    delivery_city: customer.city || null,
    delivery_state: customer.state || null,
    delivery_postcode: customer.postcode || null,
    delivery_region: deliveryRegion,
    payment_method,
    payment_status,
    fulfilment_status,
    items_subtotal: built.subtotal,
    discount_amount: discount,
    shipping_fee: shippingFeeCents,
    total_amount: grandTotal,
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
    for (const it of order.items) {
      const res = db
        .prepare('UPDATE inventory SET stock = stock - ? WHERE product_id=? AND stock >= ? AND archived=0')
        .run(it.quantity, it.product_id, it.quantity);

      if (res.changes !== 1) {
        const product = inventoryRepo.getById(it.product_id);
        const name = product?.name || `#${it.product_id}`;
        throw new StockInsufficientError(`Insufficient stock for ${name}`);
      }
    }
  });

  tx();
}

function markOrderPaidAndDeductStock({ orderId, note }) {
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
      orderRepo.updatePaymentStatus(orderId, 'PAID', note || 'Payment confirmed');
      orderRepo.updateFulfilmentStatus(orderId, 'PROCESSING', 'Paid; ready to fulfil');
      return { order: orderRepo.getWithItems(orderId), alreadyPaid: false, stockDeducted: true };
    } catch (e) {
      if (e instanceof StockInsufficientError) {
        orderRepo.updatePaymentStatus(orderId, 'PAID', `${note || 'Payment confirmed'} (stock insufficient)`);
        orderRepo.updateFulfilmentStatus(
          orderId,
          'CANCELLED',
          'Payment succeeded but stock insufficient. Manual refund/adjustment required.'
        );
        return { order: orderRepo.getWithItems(orderId), alreadyPaid: false, stockDeducted: false, stockError: e.message };
      }
      throw e;
    }
  });

  return tx();
}

module.exports = {
  placeOrder,
  buildOrderFromCart,
  markOrderPaidAndDeductStock,
  StockInsufficientError,
};
