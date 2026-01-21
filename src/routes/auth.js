const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');

const userRepo = require('../repositories/userRepo');
const { computeIsAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { env } = require('../config/env');
const emailService = require('../services/emailService');
const { MALAYSIA_STATES, buildMalaysiaFullAddress } = require('../utils/malaysia');

const router = express.Router();

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
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

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    const preserved = {
      cart: req.session?.cart,
      lastGuestOrderId: req.session?.lastGuestOrderId,
    };

    req.session.regenerate((err) => {
      if (err) return reject(err);
      if (preserved.cart) req.session.cart = preserved.cart;
      if (preserved.lastGuestOrderId) req.session.lastGuestOrderId = preserved.lastGuestOrderId;
      return resolve();
    });
  });
}

router.get('/login', (req, res) => res.render('auth/login', { title: 'Sign in' }));
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

        const base = String(env.appBaseUrl || '').replace(/\/$/, '');
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
          // ignore
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
  validate(
    z.object({
      body: z.object({
        identifier: z.string().trim().min(1).max(128),
        password: z.string().min(1).max(200),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const { identifier, password } = req.validated.body;
      const user = userRepo.findByUsernameOrEmail(identifier);
      if (!user) {
        req.session.flash = { type: 'error', message: 'Invalid credentials.' };
        return res.redirect('/login');
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        req.session.flash = { type: 'error', message: 'Invalid credentials.' };
        return res.redirect('/login');
      }

      await regenerateSession(req);

      req.session.user = {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        isAdmin: computeIsAdmin(user),
      };

      req.session.flash = { type: 'success', message: 'Signed in.' };
      return res.redirect('/');
    } catch (e) {
      return next(e);
    }
  }
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

router.get('/account', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
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
      if (!req.session.user) return res.redirect('/login');

      const { email, phone, address_line1, address_line2, city, state, postcode } = req.validated.body;
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
      req.session.user.isAdmin = computeIsAdmin(updated);
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
      if (!req.session.user) return res.redirect('/login');
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
