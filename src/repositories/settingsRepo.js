const { getDb } = require('../db/db');

function get(key, fallback = null) {
  const k = String(key || '').trim();
  if (!k) return fallback;
  const db = getDb();
  const r = db.prepare('SELECT value FROM site_settings WHERE key=?').get(k);
  return r ? String(r.value) : fallback;
}

function set(key, value) {
  const k = String(key || '').trim();
  if (!k) throw new Error('Setting key is required');
  const v = value == null ? '' : String(value);
  const db = getDb();
  db.prepare(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES (@k, @v, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run({ k, v });
  return { key: k, value: v };
}

function getMany(keys) {
  const db = getDb();
  const out = {};
  for (const key of keys || []) {
    out[String(key)] = get(String(key), null);
  }
  return out;
}

module.exports = {
  get,
  set,
  getMany,
};
