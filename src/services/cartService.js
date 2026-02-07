const inventoryRepo = require('../repositories/inventoryRepo');

function getCart(session) {
  if (!session.cart) session.cart = { items: {} };
  if (!session.cart.items) session.cart.items = {};
  return session.cart;
}

function normalizeCartItem(raw) {
  if (raw && typeof raw === 'object') {
    const qty = Math.floor(Number(raw.qty || 0));
    const note = String(raw.note || '').trim();
    return { qty, note };
  }
  const qty = Math.floor(Number(raw || 0));
  return { qty, note: '' };
}

function setQty(session, productId, qty) {
  const cart = getCart(session);
  const id = String(productId);
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) {
    delete cart.items[id];
  } else {
    const existing = normalizeCartItem(cart.items[id]);
    cart.items[id] = { qty: Math.floor(q), note: existing.note };
  }
  return cart;
}

function setNote(session, productId, note) {
  const cart = getCart(session);
  const id = String(productId);
  if (!cart.items[id]) return cart;
  const existing = normalizeCartItem(cart.items[id]);
  const nextNote = String(note || '').trim();
  cart.items[id] = { qty: existing.qty, note: nextNote };
  return cart;
}

function clear(session) {
  session.cart = { items: {} };
}

function sanitizeCart(session) {
  const cart = getCart(session);
  const removed = [];
  const adjusted = [];

  for (const [productIdStr, raw] of Object.entries(cart.items || {})) {
    const productId = Number(productIdStr);
    if (!Number.isFinite(productId) || productId <= 0) {
      delete cart.items[productIdStr];
      removed.push({ product_id: productIdStr, name: null, reason: 'invalid' });
      continue;
    }

    const parsed = normalizeCartItem(raw);
    const qty = Math.floor(Number(parsed.qty || 0));
    if (!Number.isFinite(qty) || qty <= 0) {
      delete cart.items[productIdStr];
      continue;
    }

    const product = inventoryRepo.getById(productId);
    if (!product || product.archived || !product.visibility) {
      delete cart.items[productIdStr];
      removed.push({ product_id: productId, name: product?.name || null, reason: 'unavailable' });
      continue;
    }

    const availableStock = inventoryRepo.getEffectiveAvailableStock(productId);
    if (availableStock <= 0) {
      delete cart.items[productIdStr];
      const physicalStock = Math.max(0, Math.floor(Number(product.stock || 0)));
      removed.push({
        product_id: productId,
        name: product.name || null,
        reason: physicalStock > 0 ? 'temporarily_out_of_stock' : 'out_of_stock',
      });
      continue;
    }

    if (qty > availableStock) {
      cart.items[productIdStr] = { qty: availableStock, note: parsed.note };
      adjusted.push({ product_id: productId, name: product.name || null, from: qty, to: availableStock });
      continue;
    }

    // Normalize old cart shape (qty only) to new shape.
    if (!raw || typeof raw !== 'object' || raw.qty == null) {
      cart.items[productIdStr] = { qty, note: parsed.note };
    }
  }

  return { cart, changed: removed.length > 0 || adjusted.length > 0, removed, adjusted };
}

async function hydrateCart(cart) {
  const items = [];
  let total = 0;

  for (const [productIdStr, raw] of Object.entries(cart.items || {})) {
    const parsed = normalizeCartItem(raw);
    const qty = parsed.qty;
    const productId = Number(productIdStr);
    if (!Number.isFinite(productId)) continue;
    const product = inventoryRepo.getById(productId);
    if (!product || product.archived) continue;

    const availableStock = inventoryRepo.getEffectiveAvailableStock(productId);
    const lineQty = Math.min(Math.min(Number(qty || 0), 999), availableStock || 0);
    if (lineQty <= 0) continue;

    const subtotal = product.price * lineQty;
    total += subtotal;
    items.push({ product, quantity: lineQty, subtotal, available_stock: availableStock, note: parsed.note });
  }

  return { items, total };
}

module.exports = { getCart, setQty, setNote, clear, sanitizeCart, hydrateCart };
