const { getDb } = require('../db/db');

function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    image_url: row.image_url || '',
    visible: Boolean(row.visible),
    archived: Boolean(row.archived),
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listPublic() {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM categories
       WHERE archived=0 AND visible=1
       ORDER BY name ASC, id ASC`
    )
    .all()
    .map(mapCategory);
}

function listAdmin({ includeArchived } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (!includeArchived) where.push('archived=0');
  const sql = `SELECT * FROM categories${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY archived ASC, name ASC, id ASC`;
  return db.prepare(sql).all(params).map(mapCategory);
}

function getById(id) {
  const db = getDb();
  return mapCategory(db.prepare('SELECT * FROM categories WHERE id=?').get(id));
}

function getBySlug(slug) {
  const db = getDb();
  return mapCategory(db.prepare('SELECT * FROM categories WHERE slug=?').get(String(slug || '').trim()));
}

function create({ slug, name, visible, sort_order }) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO categories (slug, name, visible, archived, sort_order)
     VALUES (@slug, @name, @visible, 0, @sort_order)`
  );
  const result = stmt.run({
    slug: String(slug || '').trim(),
    name: String(name || '').trim(),
    visible: visible ? 1 : 0,
    sort_order: Number.isFinite(Number(sort_order)) ? Math.floor(Number(sort_order)) : 0,
  });
  return getById(result.lastInsertRowid);
}

function update(id, patch) {
  const db = getDb();
  const current = getById(id);
  if (!current) return null;

  const next = {
    ...current,
    ...patch,
  };

  db.prepare(
    `UPDATE categories
     SET slug=@slug, name=@name, image_url=@image_url, visible=@visible, archived=@archived, sort_order=@sort_order
     WHERE id=@id`
  ).run({
    id,
    slug: String(next.slug || '').trim(),
    name: String(next.name || '').trim(),
    image_url: String(next.image_url || '').trim(),
    visible: next.visible ? 1 : 0,
    archived: next.archived ? 1 : 0,
    sort_order: Number.isFinite(Number(next.sort_order)) ? Math.floor(Number(next.sort_order)) : 0,
  });

  return getById(id);
}

function setArchived(id, archived) {
  return update(id, { archived: Boolean(archived) });
}

function setVisible(id, visible) {
  return update(id, { visible: Boolean(visible) });
}

function setImageUrl(id, imageUrl) {
  return update(id, { image_url: String(imageUrl || '').trim() });
}

module.exports = {
  listPublic,
  listAdmin,
  getById,
  getBySlug,
  create,
  update,
  setArchived,
  setVisible,
  setImageUrl,
};
