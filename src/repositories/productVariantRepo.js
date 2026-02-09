const { getDb } = require('../db/db');

function mapVariant(row) {
  if (!row) return null;
  return {
    variant_id: Number(row.variant_id),
    product_id: Number(row.product_id),
    type_key: String(row.type_key || '').trim(),
    label: String(row.label || '').trim(),
    price: Number(row.price),
    cost_price: row.cost_price == null ? null : Number(row.cost_price),
    weight_kg: row.weight_kg == null ? null : Number(row.weight_kg),
    height_cm: row.height_cm == null ? null : Number(row.height_cm),
    length_cm: row.length_cm == null ? null : Number(row.length_cm),
    width_cm: row.width_cm == null ? null : Number(row.width_cm),
    stock: Number(row.stock),
    image_url: row.image_url || null,
    active: Boolean(row.active),
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeTypeKey(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_\-]/g, '');
}

function listByProductId(productId, { includeInactive } = {}) {
  const db = getDb();
  const pid = Number(productId);
  if (!Number.isFinite(pid) || pid <= 0) return [];
  const where = includeInactive ? 'product_id=?' : 'product_id=? AND active=1';
  return db
    .prepare(`SELECT * FROM product_variants WHERE ${where} ORDER BY sort_order ASC, variant_id ASC`)
    .all(pid)
    .map(mapVariant);
}

function getById(variantId) {
  const db = getDb();
  const id = Number(variantId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return mapVariant(db.prepare('SELECT * FROM product_variants WHERE variant_id=?').get(id));
}

function create({ product_id, type_key, label, price, cost_price, weight_kg, height_cm, length_cm, width_cm, stock, image_url, active, sort_order }) {
  const db = getDb();
  const pid = Number(product_id);
  if (!Number.isFinite(pid) || pid <= 0) throw new Error('Invalid product_id');

  const key = normalizeTypeKey(type_key);
  const lbl = String(label || '').trim() || key;

  const priceCents = Number(price);
  if (!Number.isFinite(priceCents) || priceCents < 100) throw new Error('Variant price must be at least RM 1.00');

  const costCents = cost_price == null ? null : Number(cost_price);
  if (costCents != null && (!Number.isFinite(costCents) || costCents < 0)) throw new Error('Invalid variant cost_price');

  const wKg = weight_kg == null ? null : Number(weight_kg);
  if (wKg != null && (!Number.isFinite(wKg) || wKg < 0)) throw new Error('Invalid variant weight_kg');

  const hCm = height_cm == null ? null : Number(height_cm);
  if (hCm != null && (!Number.isFinite(hCm) || hCm < 0)) throw new Error('Invalid variant height_cm');

  const lCm = length_cm == null ? null : Number(length_cm);
  if (lCm != null && (!Number.isFinite(lCm) || lCm < 0)) throw new Error('Invalid variant length_cm');

  const wiCm = width_cm == null ? null : Number(width_cm);
  if (wiCm != null && (!Number.isFinite(wiCm) || wiCm < 0)) throw new Error('Invalid variant width_cm');

  const s = Math.max(0, Math.floor(Number(stock || 0)));

  const isActive = active == null ? 1 : (active ? 1 : 0);
  const order = Number.isFinite(Number(sort_order)) ? Math.floor(Number(sort_order)) : 0;

  const info = db
    .prepare(
      `INSERT INTO product_variants (product_id, type_key, label, price, cost_price, weight_kg, height_cm, length_cm, width_cm, stock, image_url, active, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(pid, key, lbl, Math.floor(priceCents), costCents == null ? null : Math.floor(costCents), wKg, hCm, lCm, wiCm, s, image_url || null, isActive, order);

  return getById(info.lastInsertRowid);
}

function update(variantId, patch) {
  const db = getDb();
  const v = getById(variantId);
  if (!v) return null;

  const next = {
    type_key: Object.prototype.hasOwnProperty.call(patch, 'type_key') ? normalizeTypeKey(patch.type_key) : v.type_key,
    label: Object.prototype.hasOwnProperty.call(patch, 'label') ? String(patch.label || '').trim() : v.label,
    price: Object.prototype.hasOwnProperty.call(patch, 'price') ? Math.floor(Number(patch.price)) : v.price,
    cost_price: Object.prototype.hasOwnProperty.call(patch, 'cost_price')
      ? (patch.cost_price == null ? null : Math.floor(Number(patch.cost_price)))
      : v.cost_price,
    weight_kg: Object.prototype.hasOwnProperty.call(patch, 'weight_kg')
      ? (patch.weight_kg == null ? null : Number(patch.weight_kg))
      : v.weight_kg,
    height_cm: Object.prototype.hasOwnProperty.call(patch, 'height_cm')
      ? (patch.height_cm == null ? null : Number(patch.height_cm))
      : v.height_cm,
    length_cm: Object.prototype.hasOwnProperty.call(patch, 'length_cm')
      ? (patch.length_cm == null ? null : Number(patch.length_cm))
      : v.length_cm,
    width_cm: Object.prototype.hasOwnProperty.call(patch, 'width_cm')
      ? (patch.width_cm == null ? null : Number(patch.width_cm))
      : v.width_cm,
    stock: Object.prototype.hasOwnProperty.call(patch, 'stock') ? Math.max(0, Math.floor(Number(patch.stock))) : v.stock,
    image_url: Object.prototype.hasOwnProperty.call(patch, 'image_url') ? (patch.image_url || null) : v.image_url,
    active: Object.prototype.hasOwnProperty.call(patch, 'active') ? (patch.active ? 1 : 0) : (v.active ? 1 : 0),
    sort_order: Object.prototype.hasOwnProperty.call(patch, 'sort_order') ? Math.floor(Number(patch.sort_order || 0)) : v.sort_order,
  };

  if (!next.type_key) throw new Error('type_key is required');
  if (!next.label) next.label = next.type_key;
  if (!Number.isFinite(next.price) || next.price < 100) throw new Error('Variant price must be at least RM 1.00');
  if (next.cost_price != null && (!Number.isFinite(next.cost_price) || next.cost_price < 0)) throw new Error('Invalid cost_price');
  if (next.weight_kg != null && (!Number.isFinite(next.weight_kg) || next.weight_kg < 0)) throw new Error('Invalid weight_kg');
  if (next.height_cm != null && (!Number.isFinite(next.height_cm) || next.height_cm < 0)) throw new Error('Invalid height_cm');
  if (next.length_cm != null && (!Number.isFinite(next.length_cm) || next.length_cm < 0)) throw new Error('Invalid length_cm');
  if (next.width_cm != null && (!Number.isFinite(next.width_cm) || next.width_cm < 0)) throw new Error('Invalid width_cm');

  db.prepare(
    `UPDATE product_variants
     SET type_key=@type_key,
         label=@label,
         price=@price,
         cost_price=@cost_price,
         weight_kg=@weight_kg,
         height_cm=@height_cm,
         length_cm=@length_cm,
         width_cm=@width_cm,
         stock=@stock,
         image_url=@image_url,
         active=@active,
         sort_order=@sort_order
     WHERE variant_id=@variant_id`
  ).run({
    variant_id: v.variant_id,
    type_key: next.type_key,
    label: next.label,
    price: next.price,
    cost_price: next.cost_price,
    weight_kg: next.weight_kg,
    height_cm: next.height_cm,
    length_cm: next.length_cm,
    width_cm: next.width_cm,
    stock: next.stock,
    image_url: next.image_url,
    active: next.active,
    sort_order: next.sort_order,
  });

  return getById(v.variant_id);
}

function deleteById(variantId) {
  const db = getDb();
  const v = getById(variantId);
  if (!v) return null;
  db.prepare('DELETE FROM product_variants WHERE variant_id=?').run(v.variant_id);
  return v;
}

function computeAggregateForProduct(productId) {
  const db = getDb();
  const pid = Number(productId);
  if (!Number.isFinite(pid) || pid <= 0) return { hasVariants: false, stock: null, minPrice: null };

  const row = db
    .prepare(
      `SELECT
         COUNT(*) as c,
         SUM(stock) as total_stock,
         MIN(price) as min_price
       FROM product_variants
       WHERE product_id=? AND active=1`
    )
    .get(pid);

  const count = Number(row?.c || 0);
  if (count <= 0) return { hasVariants: false, stock: null, minPrice: null };
  return {
    hasVariants: true,
    stock: Math.max(0, Number(row.total_stock || 0)),
    minPrice: Number(row.min_price || 0),
  };
}

module.exports = {
  listByProductId,
  getById,
  create,
  update,
  deleteById,
  computeAggregateForProduct,
  normalizeTypeKey,
};
