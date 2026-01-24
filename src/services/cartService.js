const inventoryRepo = require('../repositories/inventoryRepo');

function getCart(session) {
  if (!session.cart) session.cart = { items: {} };
  if (!session.cart.items) session.cart.items = {};
  return session.cart;
}

function setQty(session, productId, qty) {
  const cart = getCart(session);
  const id = String(productId);
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) {
    delete cart.items[id];
  } else {
    cart.items[id] = Math.floor(q);
  }
  return cart;
}

function clear(session) {
  session.cart = { items: {} };
}

async function hydrateCart(cart) {
  const items = [];
  let total = 0;

  for (const [productIdStr, qty] of Object.entries(cart.items || {})) {
    const productId = Number(productIdStr);
    if (!Number.isFinite(productId)) continue;
    const product = inventoryRepo.getById(productId);
    if (!product || product.archived) continue;

    const availableStock = Math.max(0, Math.floor(Number(product.stock || 0)));
    const lineQty = Math.min(Math.min(Number(qty || 0), 999), availableStock || 0);
    if (lineQty <= 0) continue;

    const subtotal = product.price * lineQty;
    total += subtotal;
    items.push({ product, quantity: lineQty, subtotal });
  }

  return { items, total };
}

module.exports = { getCart, setQty, clear, hydrateCart };
