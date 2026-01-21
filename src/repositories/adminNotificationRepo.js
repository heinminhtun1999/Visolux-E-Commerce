const { getDb } = require('../db/db');

function create({ type, title, body, link }) {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO admin_notifications (type, title, body, link)
       VALUES (?,?,?,?)`
    )
    .run(String(type), String(title), body ? String(body) : null, link ? String(link) : null);
  return getById(res.lastInsertRowid);
}

function getById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM admin_notifications WHERE id=?').get(id) || null;
}

function list({ limit, offset }) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM admin_notifications ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
}

function countAll() {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as c FROM admin_notifications').get().c;
}

function countUnread() {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as c FROM admin_notifications WHERE read_at IS NULL').get().c;
}

function getLatestUnread() {
  const db = getDb();
  const r = db
    .prepare(
      "SELECT * FROM admin_notifications WHERE read_at IS NULL ORDER BY datetime(created_at) DESC, id DESC LIMIT 1"
    )
    .get();
  return r || null;
}

function markRead(id) {
  const db = getDb();
  db.prepare("UPDATE admin_notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id=?").run(id);
  return getById(id);
}

function markAllRead() {
  const db = getDb();
  db.prepare("UPDATE admin_notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE read_at IS NULL").run();
}

module.exports = {
  create,
  getById,
  list,
  countAll,
  countUnread,
  getLatestUnread,
  markRead,
  markAllRead,
};
