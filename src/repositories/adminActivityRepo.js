const { getDb } = require('../db/db');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    actor_user_id: r.actor_user_id,
    actor_username: r.actor_username,
    actor_is_super_admin: Number(r.actor_is_super_admin || 0) ? 1 : 0,
    action: String(r.action || '').trim(),
    method: r.method,
    path: r.path,
    status_code: r.status_code == null ? null : Number(r.status_code),
    duration_ms: r.duration_ms == null ? null : Number(r.duration_ms),
    ip: r.ip,
    user_agent: r.user_agent,
    meta: safeParseJson(r.meta_json),
    created_at: r.created_at,
  };
}

function safeParseJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(String(s));
  } catch (_) {
    return null;
  }
}

function create({
  actor_user_id,
  actor_username,
  actor_is_super_admin,
  action,
  method,
  path,
  status_code,
  duration_ms,
  ip,
  user_agent,
  meta,
}) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO admin_activity_logs (
      actor_user_id,
      actor_username,
      actor_is_super_admin,
      action,
      method,
      path,
      status_code,
      duration_ms,
      ip,
      user_agent,
      meta_json
    ) VALUES (
      @actor_user_id,
      @actor_username,
      @actor_is_super_admin,
      @action,
      @method,
      @path,
      @status_code,
      @duration_ms,
      @ip,
      @user_agent,
      @meta_json
    )`
  );

  const metaJson = meta != null ? JSON.stringify(meta) : null;
  const result = stmt.run({
    actor_user_id,
    actor_username: String(actor_username || '').trim() || 'unknown',
    actor_is_super_admin: actor_is_super_admin ? 1 : 0,
    action: String(action || '').trim(),
    method: String(method || '').toUpperCase(),
    path: String(path || ''),
    status_code: status_code == null ? null : Number(status_code),
    duration_ms: duration_ms == null ? null : Number(duration_ms),
    ip: String(ip || '').trim() || null,
    user_agent: String(user_agent || '').trim() || null,
    meta_json: metaJson,
  });

  return getById(result.lastInsertRowid);
}

function getById(id) {
  const db = getDb();
  return mapRow(db.prepare('SELECT * FROM admin_activity_logs WHERE id=?').get(id));
}

function countAdmin({ q, actorUserId, method, scope } = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  const s = String(scope || '').trim().toLowerCase();
  if (s === 'settings') {
  if (s === 'all') {
    // Treat "all" as "all changes" (exclude page views).
    where.push("method <> 'GET'");
  }
    // Prefer meta-based filtering for newer diff-based audit logs, and keep path-based
    // filtering for backwards compatibility.
    where.push(
      "(meta_json LIKE '%\"entity\":\"settings\"%' OR path LIKE '/admin/site/%' OR path LIKE '/admin/promos%' OR path LIKE '/admin/settings%' OR path LIKE '/admin/pages/%')"
    );
  }

  const query = String(q || '').trim();
  if (query) {
    where.push('(actor_username LIKE @q OR action LIKE @q OR path LIKE @q OR ip LIKE @q)');
    params.q = `%${query}%`;
  }

  const a = Number(actorUserId || 0);
  if (Number.isFinite(a) && a > 0) {
    where.push('actor_user_id=@actor');
    params.actor = a;
  }

  const m = String(method || '').trim().toUpperCase();
  if (m) {
    where.push('method=@method');
    params.method = m;
  }

  const sql = `SELECT COUNT(*) as c FROM admin_activity_logs${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).get(params).c;
}

function listAdmin({ q, actorUserId, method, scope, limit, offset } = {}) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };

  const s = String(scope || '').trim().toLowerCase();
  if (s === 'all') {
    where.push("method <> 'GET'");
  }
  if (s === 'settings') {
    where.push(
      "(meta_json LIKE '%\"entity\":\"settings\"%' OR path LIKE '/admin/site/%' OR path LIKE '/admin/promos%' OR path LIKE '/admin/settings%' OR path LIKE '/admin/pages/%')"
    );
  }

  const query = String(q || '').trim();
  if (query) {
    where.push('(actor_username LIKE @q OR action LIKE @q OR path LIKE @q OR ip LIKE @q)');
    params.q = `%${query}%`;
  }

  const a = Number(actorUserId || 0);
  if (Number.isFinite(a) && a > 0) {
    where.push('actor_user_id=@actor');
    params.actor = a;
  }

  const m = String(method || '').trim().toUpperCase();
  if (m) {
    where.push('method=@method');
    params.method = m;
  }

  const sql = `SELECT * FROM admin_activity_logs
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT @limit OFFSET @offset`;

  return db.prepare(sql).all(params).map(mapRow);
}

module.exports = {
  create,
  getById,
  countAdmin,
  listAdmin,
};
