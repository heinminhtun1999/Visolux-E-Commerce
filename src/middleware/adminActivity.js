const adminActivityRepo = require('../repositories/adminActivityRepo');

function safeBodyString(req, key, { max = 80 } = {}) {
  try {
    const v = req.body ? req.body[key] : null;
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch (_) {
    return '';
  }
}

function adminActionFromRequest(req) {
  const full = String(req.originalUrl || req.url || '').split('?')[0];
  const rel = full.startsWith('/admin') ? (full.slice('/admin'.length) || '/') : full;
  const method = String(req.method || '').toUpperCase();

  const p = req.params || {};

  // Only log settings changes (not page views).
  // This keeps the audit trail focused on changes (exclude page-entering views).
  const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  if (!isMutation) return null;

  // Shipping zones
  if (method === 'POST' && rel === '/site/shipping-zones') {
    const name = safeBodyString(req, 'name', { max: 120 });
    return name ? `Created shipping zone “${name}”` : 'Created shipping zone';
  }
  if (method === 'POST' && /^\/site\/shipping-zones\/.+\/delete$/.test(rel)) return 'Deleted shipping zone';
  if (method === 'POST' && rel === '/site/shipping-zones/reorder') return 'Reordered shipping zone priority';
  if (method === 'POST' && /^\/site\/shipping-zones\/[^/]+$/.test(rel)) {
    const name = safeBodyString(req, 'name', { max: 120 });
    return name ? `Updated shipping zone “${name}”` : 'Updated shipping zone';
  }

  // Branding
  if (method === 'POST' && rel === '/site/branding') {
    if (safeBodyString(req, 'clear_logo') === '1') return 'Cleared site logo';
    return 'Updated site branding';
  }

  if (method === 'POST' && rel === '/site/admin-email-notifications') return 'Updated admin notification email recipients';
  if (method === 'POST' && rel === '/site/fiuu-accounts') return 'Updated Fiuu payment gateway configuration';
  if (method === 'POST' && rel === '/site/offline-transfer-banks') return 'Updated offline transfer bank accounts';
  if (method === 'POST' && rel === '/site/inventory') return 'Updated inventory settings';
  if (method === 'POST' && rel === '/site/footer-pages') return 'Updated footer pages';
  if (method === 'POST' && rel === '/site/promo') return 'Updated promo settings';

  // Promos
  if (method === 'POST' && rel === '/promos') {
    const code = safeBodyString(req, 'code', { max: 32 }).toUpperCase();
    return code ? `Created promo code “${code}”` : 'Created promo code';
  }
  if (method === 'POST' && /^\/promos\/.+\/update$/.test(rel)) {
    const code = String(p.code || '').trim();
    const newCode = safeBodyString(req, 'new_code', { max: 32 }).toUpperCase();
    if (code && newCode) return `Updated promo code “${code}” → “${newCode}”`;
    if (code) return `Updated promo code “${code}”`;
    return 'Updated promo code';
  }

  // Fallback: only keep settings-related mutations.
  if (/^\/site\//.test(rel)) return 'Updated site settings';
  if (/^\/promos/.test(rel)) return 'Updated promo settings';

  // Generic fallback: log all other admin mutations too (categories, products, orders, etc.).
  // More detailed entries should be logged via adminAuditService (req._auditLogged).
  const resource = String(rel || '/').split('/').filter(Boolean)[0] || 'admin';
  const toSingular = (word) => {
    const w = String(word || '').trim();
    if (!w) return '';
    if (w.endsWith('ies') && w.length > 3) return `${w.slice(0, -3)}y`;
    if (w.endsWith('s') && w.length > 1) return w.slice(0, -1);
    return w;
  };
  const titleCase = (word) => {
    const w = String(word || '').trim();
    if (!w) return '';
    return `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
  };
  const resourceLabel = titleCase(toSingular(resource).replace(/-/g, ' '));

  if (/\/archive$/.test(rel)) return `Archived ${resource}`;
  if (/\/restore$/.test(rel)) return `Restored ${resource}`;
  if (/\/(delete|remove)$/.test(rel)) return `Deleted ${resource}`;
  if (/\/visibility$/.test(rel)) return `Updated ${resource} visibility`;
  if (method === 'POST' && rel === '/categories') return 'Created category';
  if (method === 'POST' && /^\/categories\/\d+$/.test(rel)) return 'Updated category';

  // Final fallback: English, no route strings.
  if (method === 'DELETE') return resourceLabel ? `Deleted ${resourceLabel}` : 'Deleted item';
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    return resourceLabel ? `Updated ${resourceLabel}` : 'Updated item';
  }
  return resourceLabel ? `Changed ${resourceLabel}` : 'Admin change';
}

function redactBody(body) {
  if (!body || typeof body !== 'object') return null;

  const redactedKeys = new Set([
    'password',
    'new_password',
    'confirm_password',
    'password_hash',
    'token',
    '_csrf',
    'smtp_pass',
    'secret',
    'key',
  ]);

  const out = {};
  Object.keys(body).slice(0, 50).forEach((k) => {
    if (redactedKeys.has(String(k))) {
      out[k] = '[REDACTED]';
      return;
    }

    const v = body[k];
    if (v == null) {
      out[k] = null;
      return;
    }

    if (typeof v === 'string') {
      const s = v.length > 200 ? `${v.slice(0, 200)}…` : v;
      out[k] = s;
      return;
    }

    if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
      return;
    }

    if (Array.isArray(v)) {
      out[k] = `[array:${v.length}]`;
      return;
    }

    out[k] = '[object]';
  });

  return out;
}

function adminActivityLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    try {
      const user = req.session?.user;
      if (!user || !user.isAdmin) return;

      // Prefer detailed per-route audit logs (diff-based) when available.
      if (req._auditLogged) return;

      const durationMs = Date.now() - start;
      const path = String(req.originalUrl || req.url || '');
      const action = adminActionFromRequest(req);

      // We only log settings changes; ignore views and operational admin actions.
      if (!action) return;

      adminActivityRepo.create({
        actor_user_id: user.user_id,
        actor_username: user.username,
        actor_is_super_admin: user.isSuperAdmin ? 1 : 0,
        action,
        method: req.method,
        path,
        status_code: res.statusCode,
        duration_ms: durationMs,
        ip: req.ip,
        user_agent: req.get('user-agent') || '',
        meta: {
          params: req.params || {},
          query: req.query || {},
          body: redactBody(req.body),
        },
      });
    } catch (_) {
      // Never break the request for audit logging failures.
    }
  });

  return next();
}

module.exports = { adminActivityLogger };
