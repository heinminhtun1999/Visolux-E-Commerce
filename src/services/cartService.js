const inventoryRepo = require('../repositories/inventoryRepo');
const productVariantRepo = require('../repositories/productVariantRepo');
const { normalizeProductType } = require('../utils/productTypes');

function getCart(session) {
  if (!session.cart) session.cart = { items: {} };
  if (!session.cart.items) session.cart.items = {};
  return session.cart;
}

function normalizeCartItem(raw) {
  if (raw && typeof raw === 'object') {
    const qty = Math.floor(Number(raw.qty || 0));
    const note = String(raw.note || '').trim();
    const type = normalizeProductType(raw.type);
    const variant_id = raw.variant_id == null ? null : Number(raw.variant_id);
    const product_id = raw.product_id == null ? null : Number(raw.product_id);
    const variant_label = String(raw.variant_label || '').trim();
    return { qty, note, type, variant_id: Number.isFinite(variant_id) ? variant_id : null, product_id: Number.isFinite(product_id) ? product_id : null, variant_label };
  }
  const qty = Math.floor(Number(raw || 0));
  return { qty, note: '', type: normalizeProductType(''), variant_id: null, product_id: null, variant_label: '' };
}

function getCartKey({ productId, variantId }) {
  const pid = Number(productId);
  const vid = variantId == null ? null : Number(variantId);
  if (Number.isFinite(vid) && vid > 0) return `v:${vid}`;
  if (Number.isFinite(pid) && pid > 0) return `p:${pid}`;
  return '';
}

function parseCartKey(key) {
  const s = String(key || '').trim();
  const m = /^([pv]):(\d+)$/.exec(s);
  if (m) {
    const id = Number(m[2]);
    if (!Number.isFinite(id) || id <= 0) return { kind: null, id: null };
    return { kind: m[1], id };
  }

  // Backward compat: keys used to be the numeric product id.
  if (/^\d+$/.test(s)) {
    const id = Number(s);
    if (!Number.isFinite(id) || id <= 0) return { kind: null, id: null };
    return { kind: 'p', id };
  }
  return { kind: null, id: null };
}

function setQty(session, lineRef, qty) {
  const cart = getCart(session);
  const productId = (lineRef && typeof lineRef === 'object') ? lineRef.productId : lineRef;
  const variantId = (lineRef && typeof lineRef === 'object') ? lineRef.variantId : null;
  const variantLabel = (lineRef && typeof lineRef === 'object') ? String(lineRef.variantLabel || '').trim() : '';
  const key = getCartKey({ productId, variantId });
  if (!key) return cart;

  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) {
    delete cart.items[key];
  } else {
    const existing = normalizeCartItem(cart.items[key]);
    cart.items[key] = {
      qty: Math.floor(q),
      note: existing.note,
      type: existing.type,
      product_id: Number(productId),
      variant_id: (variantId == null ? null : Number(variantId)),
      variant_label: variantLabel || existing.variant_label || '',
    };
  }
  return cart;
}

function setNote(session, lineRef, note) {
  const cart = getCart(session);
  const productId = (lineRef && typeof lineRef === 'object') ? lineRef.productId : lineRef;
  const variantId = (lineRef && typeof lineRef === 'object') ? lineRef.variantId : null;
  const key = getCartKey({ productId, variantId });
  if (!key || !cart.items[key]) return cart;
  const existing = normalizeCartItem(cart.items[key]);
  const nextNote = String(note || '').trim();
  cart.items[key] = {
    qty: existing.qty,
    note: nextNote,
    type: existing.type,
    product_id: existing.product_id == null ? Number(productId) : existing.product_id,
    variant_id: existing.variant_id,
    variant_label: existing.variant_label || '',
  };
  return cart;
}

function setType(session, lineRef, productType) {
  const cart = getCart(session);
  const productId = (lineRef && typeof lineRef === 'object') ? lineRef.productId : lineRef;
  const variantId = (lineRef && typeof lineRef === 'object') ? lineRef.variantId : null;
  const key = getCartKey({ productId, variantId });
  if (!key || !cart.items[key]) return cart;
  const existing = normalizeCartItem(cart.items[key]);
  cart.items[key] = {
    qty: existing.qty,
    note: existing.note,
    type: normalizeProductType(productType),
    product_id: existing.product_id == null ? Number(productId) : existing.product_id,
    variant_id: existing.variant_id,
    variant_label: existing.variant_label || '',
  };
  return cart;
}

function clear(session) {
  session.cart = { items: {} };
}

function sanitizeCart(session) {
  const cart = getCart(session);
  const removed = [];
  const adjusted = [];

  const nextItems = {};

  for (const [productIdStr, raw] of Object.entries(cart.items || {})) {
    const parsedKey = parseCartKey(productIdStr);
    const parsed = normalizeCartItem(raw);

    let productId = null;
    let variantId = null;

    if (parsedKey.kind === 'v') {
      variantId = parsedKey.id;
      productId = parsed.product_id;
    } else if (parsedKey.kind === 'p') {
      productId = parsedKey.id;
      variantId = null;
    }

    // Backward compat: sometimes key is old numeric product id.
    if ((productId == null || !Number.isFinite(Number(productId))) && Number.isFinite(Number(parsed.product_id))) {
      productId = Number(parsed.product_id);
    }
    if (variantId == null && Number.isFinite(Number(parsed.variant_id))) {
      variantId = Number(parsed.variant_id);
    }

    const qty = Math.floor(Number(parsed.qty || 0));
    if (!Number.isFinite(qty) || qty <= 0) {
      continue;
    }

    let product = null;
    let availableStock = 0;
    let variantLabel = parsed.variant_label || '';

    if (variantId != null && Number.isFinite(Number(variantId)) && Number(variantId) > 0) {
      const v = productVariantRepo.getById(variantId);
      if (!v || !v.active) {
        removed.push({ product_id: productId || null, name: null, reason: 'unavailable' });
        continue;
      }
      productId = v.product_id;
      product = inventoryRepo.getById(productId);
      if (!product || product.archived || !product.visibility) {
        removed.push({ product_id: productId, name: product?.name || null, reason: 'unavailable' });
        continue;
      }
      availableStock = Math.max(0, Math.floor(Number(v.stock || 0)));
      variantLabel = v.label || variantLabel;
    } else {
      const pid = Number(productId);
      if (!Number.isFinite(pid) || pid <= 0) {
        removed.push({ product_id: productIdStr, name: null, reason: 'invalid' });
        continue;
      }
      productId = pid;
      product = inventoryRepo.getById(productId);
      if (!product || product.archived || !product.visibility) {
        removed.push({ product_id: productId, name: product?.name || null, reason: 'unavailable' });
        continue;
      }
      availableStock = inventoryRepo.getEffectiveAvailableStock(productId);
    }

    if (availableStock <= 0) {
      const physicalStock = product ? Math.max(0, Math.floor(Number(product.stock || 0))) : 0;
      removed.push({
        product_id: productId,
        name: product?.name || null,
        reason: physicalStock > 0 ? 'temporarily_out_of_stock' : 'out_of_stock',
      });
      continue;
    }

    const cappedQty = Math.min(qty, availableStock);
    if (cappedQty !== qty) {
      adjusted.push({ product_id: productId, name: product?.name || null, from: qty, to: cappedQty });
    }

    const canonicalKey = getCartKey({ productId, variantId });
    if (!canonicalKey) continue;
    const existing = normalizeCartItem(nextItems[canonicalKey]);
    const mergedQty = existing && Number.isFinite(existing.qty) ? Math.min(existing.qty + cappedQty, availableStock) : cappedQty;

    nextItems[canonicalKey] = {
      qty: mergedQty,
      note: parsed.note,
      type: parsed.type,
      product_id: productId,
      variant_id: variantId == null ? null : Number(variantId),
      variant_label: variantLabel,
    };
  }

  cart.items = nextItems;

  return { cart, changed: removed.length > 0 || adjusted.length > 0, removed, adjusted };
}

async function hydrateCart(cart) {
  const items = [];
  let total = 0;

  for (const [key, raw] of Object.entries(cart.items || {})) {
    const parsed = normalizeCartItem(raw);
    const qty = Math.floor(Number(parsed.qty || 0));
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const k = parseCartKey(key);
    let productId = parsed.product_id;
    let variant = null;

    if (k.kind === 'v') {
      const v = productVariantRepo.getById(k.id);
      if (!v || !v.active) continue;
      variant = v;
      productId = v.product_id;
    } else if (k.kind === 'p') {
      productId = k.id;
    }

    const pid = Number(productId);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const product = inventoryRepo.getById(pid);
    if (!product || product.archived) continue;

    const availableStock = variant ? Math.max(0, Math.floor(Number(variant.stock || 0))) : inventoryRepo.getEffectiveAvailableStock(pid);
    const lineQty = Math.min(Math.min(Number(qty || 0), 999), availableStock || 0);
    if (lineQty <= 0) continue;

    const unitPrice = variant ? Number(variant.price) : Number(product.price);
    const subtotal = unitPrice * lineQty;
    total += subtotal;

    items.push({
      key,
      product,
      variant,
      variant_id: variant ? variant.variant_id : null,
      quantity: lineQty,
      subtotal,
      available_stock: availableStock,
      note: parsed.note,
      type: parsed.type,
      variant_label: variant ? (variant.label || parsed.variant_label || '') : (parsed.variant_label || ''),
    });
  }

  return { items, total };
}

module.exports = { getCart, setQty, setNote, setType, clear, sanitizeCart, hydrateCart };
