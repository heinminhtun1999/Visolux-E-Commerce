const adminActivityRepo = require('../repositories/adminActivityRepo');

function previewValue(v, { max = 120 } = {}) {
  if (v == null) return '';
  const s = String(v);
  // Avoid exposing raw routes/paths in audit logs (e.g. "/uploads/.../file.webp").
  // Prefer showing just the filename for readability.
  const trimmed = s.trim();
  if (trimmed.startsWith('/uploads/') || trimmed.includes('/uploads/')) {
    const parts = trimmed.split('/').filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : trimmed;
    return last.length > max ? `${last.slice(0, max)}…` : last;
  }
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function normalizeForCompare(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}

function computeFieldChanges({ before = {}, after = {}, fields = [] }) {
  const changes = [];

  for (const f of fields) {
    const key = f.key;
    const label = f.label || key;

    const beforeRaw = before ? before[key] : undefined;
    const afterRaw = after ? after[key] : undefined;

    const beforeCmp = f.compare ? f.compare(beforeRaw) : normalizeForCompare(beforeRaw);
    const afterCmp = f.compare ? f.compare(afterRaw) : normalizeForCompare(afterRaw);

    if (beforeCmp === afterCmp) continue;

    const beforeDisp = f.format ? f.format(beforeRaw) : previewValue(beforeRaw);
    const afterDisp = f.format ? f.format(afterRaw) : previewValue(afterRaw);

    changes.push({
      field: key,
      label,
      before: beforeDisp,
      after: afterDisp,
    });
  }

  return changes;
}

function buildActionSummary({ verb = 'Updated', entityLabel, entityId, changes }) {
  const subject = entityLabel ? `${entityLabel}${entityId != null ? ` #${entityId}` : ''}` : 'settings';
  if (!changes || !changes.length) return `${verb} ${subject}`;

  const parts = changes
    .slice(0, 4)
    .map((c) => `${c.label}: ${c.before || '—'} → ${c.after || '—'}`);

  const more = changes.length > 4 ? ` (+${changes.length - 4} more)` : '';
  return `${verb} ${subject}: ${parts.join('; ')}${more}`;
}

function logAdminChange({
  req,
  verb,
  entity,
  entityLabel,
  entityId,
  changes,
  meta,
}) {
  try {
    const user = req.session?.user;
    if (!user || !user.isAdmin) return null;

    const action = buildActionSummary({ verb: verb || 'Updated', entityLabel, entityId, changes });

    const event = adminActivityRepo.create({
      actor_user_id: user.user_id,
      actor_username: user.username,
      actor_is_super_admin: user.isSuperAdmin ? 1 : 0,
      action,
      method: req.method,
      path: String(req.originalUrl || req.url || ''),
      status_code: null,
      duration_ms: null,
      ip: req.ip,
      user_agent: req.get ? req.get('user-agent') : null,
      meta: {
        entity: entity || null,
        entityLabel: entityLabel || null,
        entityId: entityId == null ? null : entityId,
        changes: Array.isArray(changes) ? changes : [],
        ...(meta && typeof meta === 'object' ? meta : {}),
      },
    });

    // Mark request so middleware doesn't double-log.
    req._auditLogged = true;

    return event;
  } catch (_) {
    return null;
  }
}

module.exports = {
  computeFieldChanges,
  logAdminChange,
  previewValue,
};
