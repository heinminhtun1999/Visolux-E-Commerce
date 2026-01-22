const { getDb } = require('../db/db');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    product_id: row.product_id,
    image_url: row.image_url,
    sort_order: row.sort_order,
    created_at: row.created_at,
  };
}

function listByProductId(productId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC')
    .all(productId)
    .map(mapRow);
}

function create({ productId, imageUrl, sortOrder }) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO product_images (product_id, image_url, sort_order)
     VALUES (@product_id, @image_url, @sort_order)`
  );
  const result = stmt.run({
    product_id: productId,
    image_url: imageUrl,
    sort_order: Number.isFinite(Number(sortOrder)) ? Math.floor(Number(sortOrder)) : 0,
  });

  return mapRow(db.prepare('SELECT * FROM product_images WHERE id=?').get(result.lastInsertRowid));
}

function deleteById({ id, productId }) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM product_images WHERE id=? AND product_id=?').get(id, productId);
  if (!existing) return null;
  db.prepare('DELETE FROM product_images WHERE id=? AND product_id=?').run(id, productId);
  return mapRow(existing);
}

module.exports = {
  listByProductId,
  create,
  deleteById,
};
