const { getDb } = require('../db/db');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    phone: r.phone,
    location: r.location,
    message: r.message,
    page_url: r.page_url,
    ip: r.ip,
    user_agent: r.user_agent,
    is_read: Number(r.is_read || 0) ? 1 : 0,
    created_at: r.created_at,
  };
}

function create({ phone, location, name, subject, message, page_url, ip, user_agent }) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO contact_messages (phone, location, message, page_url, ip, user_agent)
     VALUES (@phone, @location, @message, @page_url, @ip, @user_agent)`
  );
  const result = stmt.run({
    phone: String((name != null ? name : phone) || '').trim(),
    location: String((subject != null ? subject : location) || '').trim() || null,
    message: String(message || '').trim(),
    page_url: String(page_url || '').trim() || null,
    ip: String(ip || '').trim() || null,
    user_agent: String(user_agent || '').trim() || null,
  });
  return getById(result.lastInsertRowid);
}

function getById(id) {
  const db = getDb();
  return mapRow(db.prepare('SELECT * FROM contact_messages WHERE id=?').get(id));
}

function markRead(id, isRead) {
  const db = getDb();
  db.prepare('UPDATE contact_messages SET is_read=? WHERE id=?').run(isRead ? 1 : 0, id);
  return getById(id);
}

function deleteById(id) {
  const db = getDb();
  const existing = getById(id);
  if (!existing) return null;
  db.prepare('DELETE FROM contact_messages WHERE id=?').run(id);
  return existing;
}

function countAdmin({ q, status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  const query = String(q || '').trim();
  if (query) {
    where.push('(phone LIKE @q OR location LIKE @q OR message LIKE @q)');
    params.q = `%${query}%`;
  }

  const s = String(status || '').trim().toUpperCase();
  if (s === 'NEW') where.push('is_read=0');
  if (s === 'READ') where.push('is_read=1');

  const sql = `SELECT COUNT(*) as c FROM contact_messages${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).get(params).c;
}

function listAdmin({ q, status, limit, offset } = {}) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };

  const query = String(q || '').trim();
  if (query) {
    where.push('(phone LIKE @q OR location LIKE @q OR message LIKE @q)');
    params.q = `%${query}%`;
  }

  const s = String(status || '').trim().toUpperCase();
  if (s === 'NEW') where.push('is_read=0');
  if (s === 'READ') where.push('is_read=1');

  const sql = `SELECT * FROM contact_messages
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT @limit OFFSET @offset`;

  return db.prepare(sql).all(params).map(mapRow);
}

function countUnread() {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as c FROM contact_messages WHERE is_read=0').get().c;
}

module.exports = {
  create,
  getById,
  markRead,
  deleteById,
  countAdmin,
  listAdmin,
  countUnread,
};
