const crypto = require('crypto');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTimestamp14(d) {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hour = pad2(d.getHours());
  const minute = pad2(d.getMinutes());
  const second = pad2(d.getSeconds());
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function randomSuffixHex(len) {
  const bytes = crypto.randomBytes(Math.ceil(len / 2));
  return bytes
    .toString('hex')
    .toUpperCase()
    .slice(0, len);
}

function generateOrderCode(now = new Date()) {
  // Format: YYYYMMDDHHmmss-RANDOM (random is hex, uppercase)
  return `${formatTimestamp14(now)}-${randomSuffixHex(8)}`;
}

function normalizeCreatedAtToTimestamp14(createdAt) {
  const digits = String(createdAt || '')
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  if (digits.length === 14) return digits;
  return formatTimestamp14(new Date());
}

function deriveLegacyOrderCode({ orderId, createdAt }) {
  const ts = normalizeCreatedAtToTimestamp14(createdAt);
  const suffix = Number(orderId).toString(36).toUpperCase().padStart(6, '0');
  return `${ts}-${suffix}`;
}

function backfillOrderCodes(database) {
  // Best-effort backfill for existing rows.
  const hasOrderCode = database
    .prepare("PRAGMA table_info('orders')")
    .all()
    .some((c) => c.name === 'order_code');
  if (!hasOrderCode) return;

  const rows = database
    .prepare("SELECT order_id, created_at FROM orders WHERE order_code IS NULL ORDER BY order_id ASC")
    .all();
  if (!rows.length) return;

  const update = database.prepare('UPDATE orders SET order_code=? WHERE order_id=?');
  const tx = database.transaction(() => {
    for (const r of rows) {
      const code = deriveLegacyOrderCode({ orderId: r.order_id, createdAt: r.created_at });
      update.run(code, r.order_id);
    }
  });

  try {
    tx();
  } catch (_) {
    // If anything goes wrong (e.g., unexpected schema state), keep app running.
  }
}

module.exports = {
  generateOrderCode,
  backfillOrderCodes,
};
