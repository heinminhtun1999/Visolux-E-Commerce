const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;

const userRepo = require('../repositories/userRepo');
const { computeIsAdmin, computeIsSuperAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { env } = require('../config/env');
const emailService = require('../services/emailService');
const { MALAYSIA_STATES, buildMalaysiaFullAddress } = require('../utils/malaysia');
const { logger } = require('../utils/logger');

const router = express.Router();

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function isGoogleOAuthConfigured() {
  return Boolean(env.oauth?.google?.clientId && env.oauth?.google?.clientSecret);
}

function isFacebookOAuthConfigured() {
  return Boolean(env.oauth?.facebook?.appId && env.oauth?.facebook?.appSecret);
}

function getPublicBaseUrl() {
  return String(env.appBaseUrl || '').replace(/\/+$/, '');
}

function configurePassportStrategiesOnce() {
  if (configurePassportStrategiesOnce._configured) return;
  configurePassportStrategiesOnce._configured = true;

  const base = getPublicBaseUrl();

  if (isGoogleOAuthConfigured()) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: env.oauth.google.clientId,
          clientSecret: env.oauth.google.clientSecret,
          callbackURL: `${base}/auth/google/callback`,
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            const googleSub = String(profile?.id || '').trim();
            const email = String(profile?.emails?.[0]?.value || '').trim();
            const displayName = String(profile?.displayName || '').trim();
            return done(null, {
              provider: 'google',
              providerId: googleSub,
              email,
              displayName,
            });
          } catch (e) {
            return done(e);
          }
        }
      )
    );
  }

  if (isFacebookOAuthConfigured()) {
    passport.use(
      new FacebookStrategy(
        {
          clientID: env.oauth.facebook.appId,
          clientSecret: env.oauth.facebook.appSecret,
          callbackURL: `${base}/auth/facebook/callback`,
          profileFields: ['id', 'displayName', 'emails', 'name'],
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            const facebookId = String(profile?.id || '').trim();
            const email = String(profile?.emails?.[0]?.value || '').trim();
            const displayName = String(profile?.displayName || '').trim();
            return done(null, {
              provider: 'facebook',
              providerId: facebookId,
              email,
              displayName,
            });
          } catch (e) {
            return done(e);
          }
        }
      )
    );
  }
}

configurePassportStrategiesOnce();

function generateOAuthUsername({ email, displayName }) {
  const fromEmail = String(email || '').split('@')[0] || '';
  const fromName = String(displayName || '').trim();
  const base = (fromName || fromEmail || 'user').trim();
  const safe = base.replace(/\s+/g, ' ').trim();
  const max = 32;
  const trimmed = safe.length > max ? safe.slice(0, max) : safe;
  return trimmed.length >= 3 ? trimmed : `user_${crypto.randomBytes(4).toString('hex')}`;
}

async function ensureOAuthUser({ provider, providerId, email, displayName }) {
  if (!providerId) {
    const err = new Error('OAuth provider did not return an id');
    err.status = 400;
    throw err;
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const err = new Error('Your OAuth account did not provide an email address. Please use email/password login.');
    err.status = 400;
    throw err;
  }

  // 1) Provider id already linked
  if (provider === 'google') {
    const bySub = userRepo.findByGoogleSub(providerId);
    if (bySub) return bySub;
  }
  if (provider === 'facebook') {
    const byFb = userRepo.findByFacebookId(providerId);
    if (byFb) return byFb;
  }

  // 2) Existing local user with same email -> link provider
  const existing = userRepo.findByUsernameOrEmail(normalizedEmail);
  if (existing) {
    if (provider === 'google' && !existing.google_sub) return userRepo.setGoogleSub(existing.user_id, providerId);
    if (provider === 'facebook' && !existing.facebook_id) return userRepo.setFacebookId(existing.user_id, providerId);
    return existing;
  }

  // 3) Create new user record (no prior registration required)
  const randomPassword = crypto.randomBytes(32).toString('hex');
  const password_hash = await bcrypt.hash(randomPassword, 12);
  const usernameBase = generateOAuthUsername({ email: normalizedEmail, displayName });

  // Usernames must be unique; retry a few times.
  let created = null;
  let lastErr = null;
  for (let i = 0; i < 10; i++) {
    const suffix = i === 0 ? '' : `_${crypto.randomBytes(2).toString('hex')}`;
    const username = (usernameBase + suffix).slice(0, 32);
    try {
      created = userRepo.create({
        username,
        email: normalizedEmail,
        password_hash,
        is_admin: 0,
        is_super_admin: 0,
      });
      break;
    } catch (e) {
      lastErr = e;
      created = null;
    }
  }
  if (!created) throw lastErr || new Error('Failed to create user');

  if (provider === 'google') return userRepo.setGoogleSub(created.user_id, providerId);
  if (provider === 'facebook') return userRepo.setFacebookId(created.user_id, providerId);
  return created;
}

async function completeLoginSession(req, user) {
  await regenerateSession(req);
  req.session.user = {
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    isAdmin: computeIsAdmin(user),
    isSuperAdmin: computeIsSuperAdmin(user),
  };
}

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.flash = { type: 'error', message: 'Too many reset attempts. Please try again later.' };
    return res.redirect('/forgot-password');
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.flash = { type: 'error', message: 'Too many login attempts. Please try again later.' };
    return res.redirect('/login');
  },
});

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    const preserved = {
      cart: req.session?.cart,
    };

    req.session.regenerate((err) => {
      if (err) return reject(err);
      if (preserved.cart) req.session.cart = preserved.cart;
      return resolve();
    });
  });
}

function safeReturnTo(returnTo, fallbackPath) {
  const fallback = fallbackPath || '/';
  const raw = String(returnTo || '').trim();
  if (!raw) return fallback;

  // Only allow relative paths within this site.
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  if (raw.includes('://')) return fallback;
  return raw;
}

router.get('/login', (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo, '');
  return res.render('auth/login', {
    title: 'Sign in',
    returnTo,
    oauth: {
      google: isGoogleOAuthConfigured(),
      facebook: isFacebookOAuthConfigured(),
    },
  });
});

router.get('/auth/google', (req, res, next) => {
  if (!isGoogleOAuthConfigured()) {
    req.session.flash = { type: 'error', message: 'Google login is not configured.' };
    return res.redirect('/login');
  }
  const returnTo = safeReturnTo(req.query.returnTo, '/');
  req.session.oauthReturnTo = returnTo;
  return passport.authenticate('google', {
    session: false,
    state: true,
    scope: ['profile', 'email'],
    prompt: 'select_account',
  })(req, res, next);
});

router.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, async (err, payload) => {
    try {
      if (err) throw err;
      if (!payload) {
        req.session.flash = { type: 'error', message: 'Google login failed.' };
        return res.redirect('/login');
      }

      const returnTo = safeReturnTo(req.session.oauthReturnTo, '/');
      delete req.session.oauthReturnTo;

      const user = await ensureOAuthUser(payload);
      if (user.is_closed) {
        req.session.flash = { type: 'error', message: 'This account has been closed.' };
        return res.redirect('/login');
      }

      await completeLoginSession(req, user);
      req.session.flash = { type: 'success', message: 'Signed in.' };
      return res.redirect(returnTo || '/');
    } catch (e) {
      logger.warn({ event: 'oauth_google_failed', err: e, ip: req.ip }, 'google oauth failed');
      req.session.flash = { type: 'error', message: String(e?.message || 'Google login failed.') };
      return res.redirect('/login');
    }
  })(req, res, next);
});

router.get('/auth/facebook', (req, res, next) => {
  if (!isFacebookOAuthConfigured()) {
    req.session.flash = { type: 'error', message: 'Facebook login is not configured.' };
    return res.redirect('/login');
  }
  const returnTo = safeReturnTo(req.query.returnTo, '/');
  req.session.oauthReturnTo = returnTo;
  return passport.authenticate('facebook', {
    session: false,
    state: true,
    scope: ['email', 'public_profile'],
  })(req, res, next);
});

router.get('/auth/facebook/callback', (req, res, next) => {
  passport.authenticate('facebook', { session: false }, async (err, payload) => {
    try {
      if (err) throw err;
      if (!payload) {
        req.session.flash = { type: 'error', message: 'Facebook login failed.' };
        return res.redirect('/login');
      }

      const returnTo = safeReturnTo(req.session.oauthReturnTo, '/');
      delete req.session.oauthReturnTo;

      const user = await ensureOAuthUser(payload);
      if (user.is_closed) {
        req.session.flash = { type: 'error', message: 'This account has been closed.' };
        return res.redirect('/login');
      }

      await completeLoginSession(req, user);
      req.session.flash = { type: 'success', message: 'Signed in.' };
      return res.redirect(returnTo || '/');
    } catch (e) {
      logger.warn({ event: 'oauth_facebook_failed', err: e, ip: req.ip }, 'facebook oauth failed');
      req.session.flash = { type: 'error', message: String(e?.message || 'Facebook login failed.') };
      return res.redirect('/login');
    }
  })(req, res, next);
});
router.get('/register', (req, res) =>
  res.render('auth/register', { title: 'Create account', malaysiaStates: MALAYSIA_STATES })
);

router.get('/forgot-password', (req, res) => res.render('auth/forgot_password', { title: 'Forgot password' }));

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate(
    z.object({
      body: z.object({
        identifier: z.string().trim().min(1).max(128),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const { identifier } = req.validated.body;
      const user = userRepo.findByUsernameOrEmail(identifier);

      // Always return a generic message to prevent account enumeration.
      req.session.flash = {
        type: 'success',
        message: 'If an account exists for that email/username, a reset link has been sent.',
      };

      if (user) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = sha256Hex(rawToken);
        const ttlMinutes = env.passwordResetTokenTtlMinutes;

        userRepo.setPasswordResetToken(user.user_id, { tokenHash, ttlMinutes });

        let base = String(env.appBaseUrl || '').replace(/\/$/, '');
        if (env.secureCookies && base.startsWith('http://')) base = `https://${base.slice('http://'.length)}`;
        const resetLink = `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;

        // Best-effort email send; do not leak failures to the user.
        try {
          await emailService.sendPasswordResetEmail({
            to: user.email,
            username: user.username,
            resetLink,
            ttlMinutes,
          });
        } catch (_) {
          logger.warn(
            {
              event: 'password_reset_email_failed',
              userId: user.user_id,
              ip: req.ip,
            },
            'failed to send password reset email'
          );
        }
      }

      return res.redirect('/login');
    } catch (e) {
      return next(e);
    }
  }
);

router.get(
  '/reset-password',
  validate(
    z.object({
      query: z.object({
        token: z.string().trim().min(1),
      }),
      body: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res) => {
    const { token } = req.validated.query;
    const tokenHash = sha256Hex(token);
    const user = userRepo.findByValidPasswordResetTokenHash(tokenHash);
    if (!user) {
      req.session.flash = { type: 'error', message: 'This reset link is invalid or has expired.' };
      return res.redirect('/forgot-password');
    }
    return res.render('auth/reset_password', { title: 'Reset password', token });
  }
);

router.post(
  '/reset-password',
  validate(
    z
      .object({
        body: z
          .object({
            token: z.string().trim().min(1),
            new_password: z.string().min(8).max(200),
            confirm_password: z.string().min(8).max(200),
          })
          .refine((v) => v.new_password === v.confirm_password, {
            message: 'Passwords do not match',
            path: ['confirm_password'],
          }),
        query: z.any().optional(),
        params: z.any().optional(),
      })
  ),
  async (req, res, next) => {
    try {
      const { token, new_password } = req.validated.body;
      const tokenHash = sha256Hex(token);
      const user = userRepo.findByValidPasswordResetTokenHash(tokenHash);
      if (!user) {
        req.session.flash = { type: 'error', message: 'This reset link is invalid or has expired.' };
        return res.redirect('/forgot-password');
      }

      const password_hash = await bcrypt.hash(new_password, 12);
      userRepo.updatePassword(user.user_id, password_hash);
      userRepo.clearPasswordResetToken(user.user_id);

      req.session.flash = { type: 'success', message: 'Password reset successfully. You can now sign in.' };
      return res.redirect('/login');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/register',
  validate(
    z.object({
      body: z
        .object({
          username: z.string().trim().min(3).max(32),
          email: z.string().trim().email().max(128),
          password: z.string().min(8).max(200),
          phone: z.string().trim().max(32).optional().or(z.literal('')),

          address_line1: z.string().trim().max(200).optional().or(z.literal('')),
          address_line2: z.string().trim().max(200).optional().or(z.literal('')),
          city: z.string().trim().max(100).optional().or(z.literal('')),
          state: z.enum(MALAYSIA_STATES).optional().or(z.literal('')),
          postcode: z.string().trim().regex(/^\d{5}$/).optional().or(z.literal('')),
        })
        .refine(
          (v) => {
            const any = Boolean(v.address_line1 || v.city || v.state || v.postcode);
            if (!any) return true;
            return Boolean(v.address_line1 && v.city && v.state && v.postcode);
          },
          { message: 'Please complete address (line 1, city, state, postcode).', path: ['address_line1'] }
        ),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const { username, email, password, phone, address_line1, address_line2, city, state, postcode } = req.validated.body;

      // Security: prevent users from self-assigning admin identity via allowlisted username/email.
      if (computeIsAdmin({ username, email })) {
        req.session.flash = { type: 'error', message: 'Username or email already in use.' };
        return res.redirect('/register');
      }

      const existingU = userRepo.findByUsernameOrEmail(username);
      const existingE = userRepo.findByUsernameOrEmail(email);
      if (existingU || existingE) {
        req.session.flash = { type: 'error', message: 'Username or email already in use.' };
        return res.redirect('/register');
      }

      const password_hash = await bcrypt.hash(password, 12);

      const hasFullAddress = Boolean(address_line1 && city && state && postcode);
      const address = hasFullAddress
        ? buildMalaysiaFullAddress({ line1: address_line1, line2: address_line2, city, state, postcode })
        : null;

      const user = userRepo.create({
        username,
        email,
        password_hash,
        phone,
        address,
        address_line1: address_line1 || null,
        address_line2: address_line2 || null,
        city: city || null,
        state: state || null,
        postcode: postcode || null,
      });

      await regenerateSession(req);

      req.session.user = {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        isAdmin: computeIsAdmin(user),
        isSuperAdmin: computeIsSuperAdmin(user),
      };

      req.session.flash = { type: 'success', message: 'Account created.' };
      return res.redirect('/');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/login',
  loginLimiter,
  validate(
    z.object({
      body: z.object({
        identifier: z.string().trim().min(1).max(128),
        password: z.string().min(1).max(200),
        returnTo: z.string().trim().max(2000).optional().or(z.literal('')),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const returnTo = safeReturnTo(req.validated.body.returnTo, '');
      const { identifier, password } = req.validated.body;
      const user = userRepo.findByUsernameOrEmail(identifier);
      if (!user) {
        logger.warn({ event: 'login_failed', reason: 'user_not_found', identifier, ip: req.ip }, 'login failed');
        req.session.flash = { type: 'error', message: 'Invalid credentials.' };
        return res.redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login');
      }

      if (user.is_closed) {
        logger.warn({ event: 'login_failed', reason: 'account_closed', userId: user.user_id, ip: req.ip }, 'login failed');
        req.session.flash = { type: 'error', message: 'This account has been closed.' };
        return res.redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login');
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        logger.warn(
          { event: 'login_failed', reason: 'bad_password', userId: user.user_id, identifier, ip: req.ip },
          'login failed'
        );
        req.session.flash = { type: 'error', message: 'Invalid credentials.' };
        return res.redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login');
      }

      await regenerateSession(req);

      req.session.user = {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        isAdmin: computeIsAdmin(user),
        isSuperAdmin: computeIsSuperAdmin(user),
      };

      logger.info(
        { event: 'login_success', userId: user.user_id, isAdmin: computeIsAdmin(user), ip: req.ip },
        'login success'
      );

      req.session.flash = { type: 'success', message: 'Signed in.' };
      return res.redirect(returnTo || '/');
    } catch (e) {
      return next(e);
    }
  }
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

router.get('/account', (req, res) => {
  if (!req.session.user) {
    const returnTo = safeReturnTo(req.originalUrl, '');
    return res.redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login');
  }
  const user = userRepo.getById(req.session.user.user_id);
  return res.render('auth/account', { title: 'Account', user, malaysiaStates: MALAYSIA_STATES });
});

router.post(
  '/account/profile',
  validate(
    z.object({
      body: z
        .object({
          email: z.string().trim().email().max(128),
          phone: z.string().trim().max(32).optional().or(z.literal('')),

          address_line1: z.string().trim().max(200).optional().or(z.literal('')),
          address_line2: z.string().trim().max(200).optional().or(z.literal('')),
          city: z.string().trim().max(100).optional().or(z.literal('')),
          state: z.enum(MALAYSIA_STATES).optional().or(z.literal('')),
          postcode: z.string().trim().regex(/^\d{5}$/).optional().or(z.literal('')),
        })
        .refine(
          (v) => {
            const any = Boolean(v.address_line1 || v.city || v.state || v.postcode);
            if (!any) return true;
            return Boolean(v.address_line1 && v.city && v.state && v.postcode);
          },
          { message: 'Please complete address (line 1, city, state, postcode).', path: ['address_line1'] }
        ),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      if (!req.session.user) {
        const returnTo = safeReturnTo(req.originalUrl, '');
        return res.redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login');
      }

      const { email, phone, address_line1, address_line2, city, state, postcode } = req.validated.body;

      // Security: do not allow non-admins to become admin by changing their email.
      if (!req.session.user.isAdmin && computeIsAdmin({ username: req.session.user.username, email })) {
        req.session.flash = { type: 'error', message: 'Email update is not allowed.' };
        return res.redirect('/account');
      }
      const hasFullAddress = Boolean(address_line1 && city && state && postcode);
      const address = hasFullAddress
        ? buildMalaysiaFullAddress({ line1: address_line1, line2: address_line2, city, state, postcode })
        : null;

      const updated = userRepo.updateProfile(req.session.user.user_id, {
        email,
        phone,
        address,
        address_line1: address_line1 || null,
        address_line2: address_line2 || null,
        city: city || null,
        state: state || null,
        postcode: postcode || null,
      });
      req.session.user.email = updated.email;
      // Do not allow privilege escalation via mutable fields.
      req.session.user.isAdmin = Boolean(req.session.user.isAdmin);
      req.session.user.isSuperAdmin = Boolean(req.session.user.isSuperAdmin);
      req.session.flash = { type: 'success', message: 'Profile updated.' };
      return res.redirect('/account');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/account/password',
  validate(
    z.object({
      body: z.object({
        current_password: z.string().min(1).max(200),
        new_password: z.string().min(8).max(200),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      if (!req.session.user) {
        const returnTo = safeReturnTo(req.originalUrl, '');
        return res.redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login');
      }
      const { current_password, new_password } = req.validated.body;
      const user = userRepo.getById(req.session.user.user_id);

      const ok = await bcrypt.compare(current_password, user.password_hash);
      if (!ok) {
        req.session.flash = { type: 'error', message: 'Current password is incorrect.' };
        return res.redirect('/account');
      }

      const password_hash = await bcrypt.hash(new_password, 12);
      userRepo.updatePassword(user.user_id, password_hash);
      req.session.flash = { type: 'success', message: 'Password updated.' };
      return res.redirect('/account');
    } catch (e) {
      return next(e);
    }
  }
);

module.exports = router;
