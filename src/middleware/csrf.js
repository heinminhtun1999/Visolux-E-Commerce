const crypto = require('crypto');

const { env } = require('../config/env');

function safeOrigin(urlLike) {
  try {
    return new URL(String(urlLike)).origin;
  } catch (_) {
    return null;
  }
}

function isHttpOrigin(origin) {
  try {
    const u = new URL(String(origin));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function getAllowedOrigins(req) {
  const allowed = new Set();

  const fromEnv = safeOrigin(env.appBaseUrl);
  if (fromEnv) allowed.add(fromEnv);

  const host = req.get('host');
  if (host) {
    const proto = (req.protocol || 'http');
    allowed.add(`${proto}://${host}`);
  }

  for (const o of env.csrfAllowedOrigins || []) {
    const parsed = safeOrigin(o);
    if (parsed) allowed.add(parsed);
  }

  // Dev convenience: treat localhost and 127.0.0.1 as equivalent when ports match.
  for (const o of Array.from(allowed)) {
    const u = safeOrigin(o);
    if (!u) continue;
    const parsed = new URL(u);
    const altHost = parsed.hostname === 'localhost' ? '127.0.0.1' : (parsed.hostname === '127.0.0.1' ? 'localhost' : null);
    if (altHost) {
      allowed.add(`${parsed.protocol}//${altHost}${parsed.port ? `:${parsed.port}` : ''}`);
    }
  }

  return allowed;
}

function ensureCsrfToken(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  return next();
}

function csrfProtection({ exemptPaths = [], ignoreMultipart = true } = {}) {
  const exempt = new Set(exemptPaths);

  return (req, res, next) => {
    if (exempt.has(req.path)) return next();

    // For multipart/form-data, the body isn't parsed until multer runs.
    // App-level CSRF should ignore multipart and rely on route-level CSRF placed after multer.
    if (ignoreMultipart && req.is && req.is('multipart/form-data')) {
      if (req.session && !req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.locals.csrfToken = req.session?.csrfToken;
      return next();
    }

    // Always ensure a token exists for pages/forms.
    if (req.session && !req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.locals.csrfToken = req.session?.csrfToken;

    const method = String(req.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    const token = String(req.body?._csrf || req.get('x-csrf-token') || '').trim();
    if (!token || !req.session?.csrfToken || token !== req.session.csrfToken) {
      const err = new Error('Invalid CSRF token');
      err.status = 403;
      return next(err);
    }

    // Extra hardening when cookies are cross-site (SameSite=None in production).
    const origin = req.get('origin');
    if (origin) {
      // Some embedded/sandboxed contexts legitimately send Origin: null.
      // CSRF token check above is the primary protection; Origin is extra defense.
      if (origin === 'null' || !isHttpOrigin(origin)) return next();

      const allowed = getAllowedOrigins(req);
      if (allowed.has(origin)) return next();

      // Fallback: some clients/proxies behave inconsistently; accept when Referer is allowed.
      const refererOrigin = safeOrigin(req.get('referer'));
      if (refererOrigin && allowed.has(refererOrigin)) return next();

      const err = new Error('Invalid request origin');
      err.status = 403;
      return next(err);
    }

    return next();
  };
}

module.exports = { ensureCsrfToken, csrfProtection };
