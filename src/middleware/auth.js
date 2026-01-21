const { env } = require('../config/env');

function requireUser(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'error', message: 'Please sign in first.' };
    return res.redirect('/login');
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

module.exports = { requireUser, requireAdmin, computeIsAdmin };
