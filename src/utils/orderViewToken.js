const crypto = require('crypto');

const { env } = require('../config/env');

function base64url(buf) {
  // Avoid Buffer.toString('base64url') for compatibility with older Node versions.
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function createOrderViewToken({ orderId, ttlDays = 180 } = {}) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid orderId');

  const days = Number(ttlDays);
  const ttlSeconds = Number.isFinite(days) && days > 0 ? Math.floor(days * 24 * 60 * 60) : 180 * 24 * 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;

  const payload = `${id}.${exp}`;
  const sig = base64url(crypto.createHmac('sha256', env.sessionSecret).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifyOrderViewToken({ token, orderId } = {}) {
  const raw = String(token || '').trim();
  if (!raw) return false;

  const parts = raw.split('.');
  if (parts.length !== 3) return false;

  const id = Number(parts[0]);
  const exp = Number(parts[1]);
  const sig = String(parts[2] || '').trim();

  if (!Number.isFinite(id) || id <= 0) return false;
  if (!Number.isFinite(exp) || exp <= 0) return false;

  const expectedOrderId = Number(orderId);
  if (!Number.isFinite(expectedOrderId) || expectedOrderId <= 0) return false;
  if (id !== expectedOrderId) return false;

  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return false;

  const payload = `${id}.${exp}`;
  const expectedSig = base64url(crypto.createHmac('sha256', env.sessionSecret).update(payload).digest());
  return timingSafeEqualStr(sig, expectedSig);
}

module.exports = {
  createOrderViewToken,
  verifyOrderViewToken,
};
