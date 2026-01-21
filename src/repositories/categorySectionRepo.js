const { getDb } = require('../db/db');

function mapSection(row) {
  if (!row) return null;
  return {
    id: row.id,
    category_id: row.category_id,
    title: row.title || '',
    body_md: row.body_md || '',
    sort_order: Number(row.sort_order || 0),
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listByCategoryId(categoryId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT *
       FROM category_sections
       WHERE category_id=?
       ORDER BY sort_order ASC, id ASC`
    )
    .all(categoryId)
    .map(mapSection);
}

function listPublicByCategorySlug(slug) {
  const db = getDb();
  return db
    .prepare(
      `SELECT cs.*
       FROM category_sections cs
       JOIN categories c ON c.id = cs.category_id
       WHERE c.slug=? AND c.archived=0 AND c.visible=1 AND cs.active=1
       ORDER BY cs.sort_order ASC, cs.id ASC`
    )
    .all(String(slug || '').trim())
    .map(mapSection);
}

function getById(id) {
  const db = getDb();
  return mapSection(db.prepare('SELECT * FROM category_sections WHERE id=?').get(id));
}

function create({ category_id, title, body_md, sort_order, active }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO category_sections (category_id, title, body_md, sort_order, active)
       VALUES (@category_id, @title, @body_md, @sort_order, @active)`
    )
    .run({
      category_id: Number(category_id),
      title: String(title || '').trim() || null,
      body_md: String(body_md || ''),
      sort_order: Number.isFinite(Number(sort_order)) ? Math.floor(Number(sort_order)) : 0,
      active: active ? 1 : 0,
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
    `UPDATE category_sections
     SET title=@title, body_md=@body_md, sort_order=@sort_order, active=@active
     WHERE id=@id`
  ).run({
    id,
    title: String(next.title || '').trim() || null,
    body_md: String(next.body_md || ''),
    sort_order: Number.isFinite(Number(next.sort_order)) ? Math.floor(Number(next.sort_order)) : 0,
    active: next.active ? 1 : 0,
  });

  return getById(id);
}

function remove(id) {
  const db = getDb();
  db.prepare('DELETE FROM category_sections WHERE id=?').run(id);
}

module.exports = {
  listByCategoryId,
  listPublicByCategorySlug,
  getById,
  create,
  update,
  remove,
};
