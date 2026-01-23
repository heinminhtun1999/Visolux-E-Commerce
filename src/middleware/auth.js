const { env } = require('../config/env');
const userRepo = require('../repositories/userRepo');

function logoutClosedAccountSessions(req, _res, next) {
  if (!req.session || !req.session.user) return next();
  if (req.session.user.isAdmin) return next();

  // Throttle DB checks per-session to reduce load.
  const now = Date.now();
  const last = Number(req.session.user._activeCheckedAt || 0);
  if (Number.isFinite(last) && last > 0 && now - last < 30_000) return next();
  req.session.user._activeCheckedAt = now;

  try {
    const u = userRepo.getById(req.session.user.user_id);
    if (!u || u.is_closed) {
      req.session.user = null;
      req.session.flash = { type: 'error', message: 'This account has been closed.' };
      return next();
    }

    // Keep session identity in sync.
    req.session.user.username = u.username;
    req.session.user.email = u.email;
  } catch (_) {
    // ignore and allow request
  }

  return next();
}

function requireUser(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'error', message: 'Please sign in first.' };
    return res.redirect('/login');
  }

  // If an account was closed after the session was created, force re-auth.
  if (!req.session.user.isAdmin) {
    try {
      const u = userRepo.getById(req.session.user.user_id);
      if (!u || u.is_closed) {
        req.session.user = null;
        req.session.flash = { type: 'error', message: 'This account has been closed.' };
        return res.redirect('/login');
      }
    } catch (_) {
      // ignore and allow request
    }
  }
  return next();
}

function computeIsAdmin(user) {
  if (!user) return false;
  const username = String(user.username || '').toLowerCase();
  const email = String(user.email || '').toLowerCase();

  const allowedUsernames = env.adminUsernames.map((v) => v.toLowerCase());
  const allowedEmails = env.adminEmails.map((v) => v.toLowerCase());

  return allowedUsernames.includes(username) || allowedEmails.includes(email);
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) {
    req.session.flash = { type: 'error', message: 'Admin access required.' };
    return res.redirect('/login');
  }
  return next();
}

module.exports = { requireUser, requireAdmin, computeIsAdmin, logoutClosedAccountSessions };
