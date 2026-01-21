const crypto = require('crypto');
const { getDb } = require('../db/db');

function hashPayload(payload) {
  const keys = Object.keys(payload || {}).sort();
  const normalized = keys.map((k) => `${k}=${String(payload[k])}`).join('&');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function tryInsertEvent({ order_id, provider, provider_txn_id, payload, verified }) {
  const db = getDb();
  const payload_hash = hashPayload(payload);

  try {
    const r = db
      .prepare(
        `INSERT INTO payment_events (order_id, provider, provider_txn_id, payload_hash, verified)
         VALUES (?,?,?,?,?)`
      )
      .run(order_id, provider, provider_txn_id || null, payload_hash, verified ? 1 : 0);

    return { inserted: true, id: r.lastInsertRowid, payload_hash };
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return { inserted: false, id: null, payload_hash };
    }
    throw e;
  }
}

function getLatestProviderTxnIdByOrder({ orderId, provider }) {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT provider_txn_id
       FROM payment_events
       WHERE order_id=? AND provider=? AND verified=1 AND provider_txn_id IS NOT NULL
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(orderId, String(provider));
  return r ? String(r.provider_txn_id || '').trim() : '';
}

module.exports = { tryInsertEvent, hashPayload, getLatestProviderTxnIdByOrder };
