const express = require('express');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');

const { requireAdmin, requireSuperAdmin, computeIsAdmin } = require('../middleware/auth');
const { getDb } = require('../db/db');
const { validate } = require('../middleware/validate');
const { upload } = require('../middleware/uploads');
const { csrfProtection } = require('../middleware/csrf');

const inventoryRepo = require('../repositories/inventoryRepo');
const categoryRepo = require('../repositories/categoryRepo');
const productImageRepo = require('../repositories/productImageRepo');
const orderRepo = require('../repositories/orderRepo');
const userRepo = require('../repositories/userRepo');
const imageService = require('../services/imageService');
const orderService = require('../services/orderService');
const emailService = require('../services/emailService');
const { computeFieldChanges, logAdminChange, previewValue } = require('../services/adminAuditService');
const { getPagination, getPageCount } = require('../utils/pagination');
const adminNotificationRepo = require('../repositories/adminNotificationRepo');
const orderRefundRepo = require('../repositories/orderRefundRepo');
const orderRefundExtraRepo = require('../repositories/orderRefundExtraRepo');
const refundService = require('../services/refundService');
const settingsRepo = require('../repositories/settingsRepo');
const reportRepo = require('../repositories/reportRepo');
const promoRepo = require('../repositories/promoRepo');
const categorySectionRepo = require('../repositories/categorySectionRepo');
const contactMessageRepo = require('../repositories/contactMessageRepo');
const adminActivityRepo = require('../repositories/adminActivityRepo');
const shippingService = require('../services/shippingService');
const offlineTransferService = require('../services/offlineTransferService');
const fiuuAccountsService = require('../services/fiuuAccountsService');
const { MALAYSIA_STATES } = require('../utils/malaysia');
const { renderMarkdown, sanitizeHtmlFragment, sanitizeHtmlFragmentNoImages } = require('../utils/markdown');
const crypto = require('crypto');

const router = express.Router();

router.get('/admin-accounts', requireSuperAdmin, (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 25) || 25));
  const q = String(req.query.q || '').trim();

  const total = userRepo.countAdminAccounts({ q });
  const pageCount = getPageCount(total, pageSize);
  const safePage = Math.min(page, Math.max(1, pageCount || 1));
  const { limit, offset } = getPagination(safePage, pageSize);

  const admins = userRepo.listAdminAccounts({ q, limit, offset });

  return res.render('admin/admin_accounts', {
    title: 'Admin – Admin accounts',
    q,
    page: safePage,
    pageSize,
    pageCount,
    total,
    admins,
  });
});

router.post('/admin-accounts/:id/disable', requireSuperAdmin, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      req.session.flash = { type: 'error', message: 'Invalid user id.' };
      return res.redirect('/admin/admin-accounts');
    }

    if (req.session?.user?.user_id === id) {
      req.session.flash = { type: 'error', message: 'You cannot disable your own account.' };
      return res.redirect('/admin/admin-accounts');
    }

    const target = userRepo.getById(id);
    if (!target || !target.is_admin) {
      req.session.flash = { type: 'error', message: 'Admin account not found.' };
      return res.redirect('/admin/admin-accounts');
    }
    if (target.is_super_admin) {
      req.session.flash = { type: 'error', message: 'Main admin account cannot be disabled here.' };
      return res.redirect('/admin/admin-accounts');
    }
    if (target.is_closed) {
      req.session.flash = { type: 'info', message: 'This sub-admin is already disabled.' };
      return res.redirect('/admin/admin-accounts');
    }

    userRepo.closeAccount(id);
    req.session.flash = { type: 'success', message: 'Sub-admin disabled.' };
    return res.redirect('/admin/admin-accounts');
  } catch (e) {
    return next(e);
  }
});

router.post('/admin-accounts/:id/enable', requireSuperAdmin, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      req.session.flash = { type: 'error', message: 'Invalid user id.' };
      return res.redirect('/admin/admin-accounts');
    }

    const target = userRepo.getById(id);
    if (!target || !target.is_admin) {
      req.session.flash = { type: 'error', message: 'Admin account not found.' };
      return res.redirect('/admin/admin-accounts');
    }
    if (target.is_super_admin) {
      req.session.flash = { type: 'error', message: 'Main admin account cannot be enabled here.' };
      return res.redirect('/admin/admin-accounts');
    }
    if (!target.is_closed) {
      req.session.flash = { type: 'info', message: 'This sub-admin is already enabled.' };
      return res.redirect('/admin/admin-accounts');
    }

    userRepo.reopenAccount(id);
    req.session.flash = { type: 'success', message: 'Sub-admin enabled.' };
    return res.redirect('/admin/admin-accounts');
  } catch (e) {
    return next(e);
  }
});

router.get('/activity', requireAdmin, (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize || 50) || 50));
  const q = String(req.query.q || '').trim();
  const actorUserId = String(req.query.actorUserId || '').trim();

  // Defaults to settings-only; can be switched to show all logs for debugging.
  const scopeRaw = String(req.query.scope || 'all').trim().toLowerCase();
  const scope = scopeRaw === 'all' ? 'all' : 'settings';

  const total = adminActivityRepo.countAdmin({
    q,
    actorUserId: actorUserId ? Number(actorUserId) : null,
    scope,
  });
  const pageCount = getPageCount(total, pageSize);
  const safePage = Math.min(page, Math.max(1, pageCount || 1));
  const { limit, offset } = getPagination(safePage, pageSize);

  const events = adminActivityRepo.listAdmin({
    q,
    actorUserId: actorUserId ? Number(actorUserId) : null,
    scope,
    limit,
    offset,
  });

  return res.render('admin/activity', {
    title: scope === 'all' ? 'Admin – Activity' : 'Admin – Settings history',
    q,
    actorUserId,
    scope,
    page: safePage,
    pageSize,
    pageCount,
    total,
    events,
  });
});

router.post(
  '/admin-accounts/create',
  requireSuperAdmin,
  validate(
    z.object({
      body: z.object({
        username: z.string().trim().min(3).max(32),
        email: z.string().trim().email().max(128),
        password: z.string().min(8).max(200),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const { username, email, password } = req.validated.body;

      // Prevent accidental collision with env allowlist identities.
      if (computeIsAdmin({ username, email })) {
        req.session.flash = { type: 'error', message: 'Username or email is reserved.' };
        return res.redirect('/admin/admin-accounts');
      }

      const existingU = userRepo.findByUsernameOrEmail(username);
      const existingE = userRepo.findByUsernameOrEmail(email);
      if (existingU || existingE) {
        req.session.flash = { type: 'error', message: 'Username or email already in use.' };
        return res.redirect('/admin/admin-accounts');
      }

      const password_hash = await bcrypt.hash(password, 12);
      userRepo.create({
        username,
        email,
        password_hash,
        is_admin: 1,
        is_super_admin: 0,
      });

      req.session.flash = { type: 'success', message: 'Admin account created.' };
      return res.redirect('/admin/admin-accounts');
    } catch (e) {
      return next(e);
    }
  }
);

function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  if (/["\r\n,]/.test(s) || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function formatMoneyRm2(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function parsePriceToCentsMinRM1(input) {
  const s = String(input || '').trim().replace(/,/g, '');
  if (!s) {
    const err = new Error('Price is required.');
    err.status = 400;
    throw err;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    const err = new Error('Invalid price format. Use for example 12.50');
    err.status = 400;
    throw err;
  }
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents)) {
    const err = new Error('Invalid price.');
    err.status = 400;
    throw err;
  }
  return cents;
}

function assertValidCategorySlug(slug) {
  const s = String(slug || '').trim();
  if (!s) {
    const err = new Error('Category slug is required.');
    err.status = 400;
    throw err;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(s)) {
    const err = new Error('Invalid category slug. Use letters/numbers and - or _ (2–80 chars).');
    err.status = 400;
    throw err;
  }
  return s;
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

router.use(requireAdmin);

router.get('/', (req, res) => res.redirect('/admin/products'));

router.get('/site/home', (req, res) => res.redirect('/admin/categories'));
router.get('/site/branding', (req, res) => res.redirect('/admin/settings#branding'));

function centsToRmFixed(cents) {
  const n = Number(cents || 0) / 100;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function parseZipCodesText(text) {
  const raw = String(text || '');
  const parts = raw
    .split(/[\n,]+/g)
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  // Keep unique while preserving order.
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

router.get('/site/shipping-zones', (req, res) => {
  const zones = (shippingService.getZones() || []).map((z) => {
    const matchBy = String(z.match_by || 'SUBREGIONS').toUpperCase();
    const methodsCount = Array.isArray(z.methods) ? z.methods.length : 0;
    const coverageText = matchBy === 'ZIP_CODES'
      ? `${Array.isArray(z.zip_codes) ? z.zip_codes.length : 0} zip code(s)`
      : `${Array.isArray(z.subregions) ? z.subregions.length : 0}/${MALAYSIA_STATES.length} sub-region(s)`;

    return {
      id: String(z.id || ''),
      name: String(z.name || ''),
      match_by: matchBy,
      coverageText,
      methodsCount: methodsCount || 0,
    };
  });

  return res.render('admin/shipping_zones', {
    title: 'Admin – Shipping Zones',
    zones,
  });
});

router.get('/site/shipping-zones/new', (req, res) => {
  return res.render('admin/shipping_zone_form', {
    title: 'New shipping zone',
    action: '/admin/site/shipping-zones',
    zone: null,
    malaysiaStates: MALAYSIA_STATES,
    base: {
      first_weight_kg: '1.00',
      first_fee_rm: '8.00',
      additional_weight_kg: '1.00',
      additional_fee_rm: '2.00',
    },
    range: { enabled: false, min_weight_kg: '10.00', step_kg: '1.00', fee_rm: '1.50' },
    zipCodesText: '',
  });
});

router.get('/site/shipping-zones/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const zones = shippingService.getZones() || [];
  const zone = zones.find((z) => String(z.id || '') === id);
  if (!zone) {
    req.session.flash = { type: 'error', message: 'Shipping zone not found.' };
    return res.redirect('/admin/site/shipping-zones');
  }

  const baseMethod = Array.isArray(zone.methods) ? zone.methods.find((m) => String(m.type || 'BASE').toUpperCase() === 'BASE') : null;
  const rangeMethod = Array.isArray(zone.methods) ? zone.methods.find((m) => String(m.type || '').toUpperCase() === 'PER_STEP') : null;

  return res.render('admin/shipping_zone_form', {
    title: 'Edit shipping zone',
    action: `/admin/site/shipping-zones/${encodeURIComponent(id)}`,
    zone,
    malaysiaStates: MALAYSIA_STATES,
    base: {
      first_weight_kg: baseMethod && baseMethod.first_weight_kg != null ? String(baseMethod.first_weight_kg) : '1.00',
      first_fee_rm: centsToRmFixed(baseMethod ? baseMethod.first_fee_cents : 0),
      additional_weight_kg: baseMethod && baseMethod.additional_weight_kg != null ? String(baseMethod.additional_weight_kg) : '1.00',
      additional_fee_rm: centsToRmFixed(baseMethod ? baseMethod.additional_fee_cents : 0),
    },
    range: {
      enabled: Boolean(rangeMethod),
      min_weight_kg: rangeMethod && rangeMethod.min_weight_kg != null ? String(rangeMethod.min_weight_kg) : '10.00',
      step_kg: rangeMethod && rangeMethod.step_kg != null ? String(rangeMethod.step_kg) : '1.00',
      fee_rm: centsToRmFixed(rangeMethod ? rangeMethod.fee_cents_per_step : 0),
    },
    zipCodesText: Array.isArray(zone.zip_codes) ? zone.zip_codes.join('\n') : '',
  });
});

router.post(
  '/site/shipping-zones/reorder',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        order: z.array(z.string().trim().min(1)).min(1),
      }),
      params: z.any().optional(),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const zones = shippingService.getZones() || [];
      const byId = new Map(zones.map((z) => [String(z && z.id != null ? z.id : ''), z]));

      // Keep unique, preserve incoming order.
      const seen = new Set();
      const requested = (req.validated.body.order || [])
        .map((id) => String(id || '').trim())
        .filter((id) => id && byId.has(id))
        .filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });

      // Append any zones not included, preserving original order.
      const nextZones = [];
      for (const id of requested) nextZones.push(byId.get(id));
      for (const z of zones) {
        const id = String(z && z.id != null ? z.id : '');
        if (!id || seen.has(id)) continue;
        nextZones.push(z);
      }

      shippingService.saveZones(nextZones);

      const accept = String(req.get('accept') || '').toLowerCase();
      if (accept.includes('application/json')) return res.json({ ok: true });
      req.session.flash = { type: 'success', message: 'Shipping zone priority updated.' };
      return res.redirect('/admin/site/shipping-zones');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/site/shipping-zones',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(80),
        match_by: z.enum(['SUBREGIONS', 'ZIP_CODES']),
        subregions: z.any().optional(),
        zip_codes_text: z.string().optional().or(z.literal('')),
        first_weight_kg: z.string().trim().min(1).max(32),
        first_fee_rm: z.string().trim().min(1).max(32),
        additional_weight_kg: z.string().trim().min(1).max(32),
        additional_fee_rm: z.string().trim().min(1).max(32),
        range_enabled: z.string().optional(),
        range_min_weight_kg: z.string().optional().or(z.literal('')),
        range_step_kg: z.string().optional().or(z.literal('')),
        range_fee_rm: z.string().optional().or(z.literal('')),
      }),
      params: z.any().optional(),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const zones = shippingService.getZones() || [];

      const matchBy = String(req.validated.body.match_by).toUpperCase();
      const subregionsRaw = req.validated.body.subregions;
      const subregions = matchBy === 'SUBREGIONS'
        ? (Array.isArray(subregionsRaw) ? subregionsRaw : subregionsRaw ? [subregionsRaw] : [])
            .map((s) => String(s || '').trim())
            .filter((s) => MALAYSIA_STATES.includes(s))
        : [];

      const zip_codes = matchBy === 'ZIP_CODES' ? parseZipCodesText(req.validated.body.zip_codes_text) : [];
      if (matchBy === 'SUBREGIONS' && subregions.length === 0) {
        const err = new Error('Select at least 1 sub-region (state).');
        err.status = 400;
        throw err;
      }
      if (matchBy === 'ZIP_CODES' && zip_codes.length === 0) {
        const err = new Error('Enter at least 1 zip code or prefix.');
        err.status = 400;
        throw err;
      }

      const firstWeightKg = parseNonNegativeNumberOrNull(req.validated.body.first_weight_kg, { label: 'First weight (kg)' });
      const addWeightKg = parseNonNegativeNumberOrNull(req.validated.body.additional_weight_kg, { label: 'Every additional weight (kg)' });
      if (!firstWeightKg || firstWeightKg <= 0) {
        const err = new Error('First weight (kg) must be greater than 0.');
        err.status = 400;
        throw err;
      }
      if (!addWeightKg || addWeightKg <= 0) {
        const err = new Error('Every additional weight (kg) must be greater than 0.');
        err.status = 400;
        throw err;
      }

      const firstFeeCents = parseMoneyToCentsAllowZero(req.validated.body.first_fee_rm);
      const addFeeCents = parseMoneyToCentsAllowZero(req.validated.body.additional_fee_rm);
      if (firstFeeCents == null || addFeeCents == null) {
        const err = new Error('Fees are required.');
        err.status = 400;
        throw err;
      }

      const methods = [
        {
          id: crypto.randomUUID(),
          type: 'BASE',
          min_weight_kg: 0,
          first_weight_kg: firstWeightKg,
          first_fee_cents: firstFeeCents,
          additional_weight_kg: addWeightKg,
          additional_fee_cents: addFeeCents,
        },
      ];

      const rangeEnabled = String(req.validated.body.range_enabled || '') === '1';
      if (rangeEnabled) {
        const minWeightKg = parseNonNegativeNumberOrNull(req.validated.body.range_min_weight_kg, { label: 'When weight ≥ (kg)' });
        const stepKg = parseNonNegativeNumberOrNull(req.validated.body.range_step_kg, { label: 'Per set (kg)' });
        const feeCents = req.validated.body.range_fee_rm ? parseMoneyToCentsAllowZero(req.validated.body.range_fee_rm) : null;
        if (minWeightKg == null || minWeightKg <= 0 || stepKg == null || stepKg <= 0 || feeCents == null) {
          const err = new Error('Range fields are required and must be > 0.');
          err.status = 400;
          throw err;
        }
        methods.push({
          id: crypto.randomUUID(),
          type: 'PER_STEP',
          min_weight_kg: minWeightKg,
          step_kg: stepKg,
          fee_cents_per_step: feeCents,
        });
      }

      zones.push({
        id: crypto.randomUUID(),
        name: String(req.validated.body.name || '').trim(),
        match_by: matchBy,
        subregions,
        zip_codes,
        methods,
      });

      shippingService.saveZones(zones);
      req.session.flash = { type: 'success', message: 'Shipping zone saved.' };
      return res.redirect('/admin/site/shipping-zones');
    } catch (e) {
      if (e && e.status === 400) {
        req.session.flash = { type: 'error', message: e.message };
        return res.redirect('/admin/site/shipping-zones/new');
      }
      return next(e);
    }
  }
);

router.post(
  '/site/shipping-zones/:id',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(80),
        match_by: z.enum(['SUBREGIONS', 'ZIP_CODES']),
        subregions: z.any().optional(),
        zip_codes_text: z.string().optional().or(z.literal('')),
        first_weight_kg: z.string().trim().min(1).max(32),
        first_fee_rm: z.string().trim().min(1).max(32),
        additional_weight_kg: z.string().trim().min(1).max(32),
        additional_fee_rm: z.string().trim().min(1).max(32),
        range_enabled: z.string().optional(),
        range_min_weight_kg: z.string().optional().or(z.literal('')),
        range_step_kg: z.string().optional().or(z.literal('')),
        range_fee_rm: z.string().optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      const zones = shippingService.getZones() || [];
      const idx = zones.findIndex((z) => String(z.id || '') === id);
      if (idx < 0) {
        const err = new Error('Shipping zone not found.');
        err.status = 400;
        throw err;
      }

      const matchBy = String(req.validated.body.match_by).toUpperCase();
      const subregionsRaw = req.validated.body.subregions;
      const subregions = matchBy === 'SUBREGIONS'
        ? (Array.isArray(subregionsRaw) ? subregionsRaw : subregionsRaw ? [subregionsRaw] : [])
            .map((s) => String(s || '').trim())
            .filter((s) => MALAYSIA_STATES.includes(s))
        : [];

      const zip_codes = matchBy === 'ZIP_CODES' ? parseZipCodesText(req.validated.body.zip_codes_text) : [];
      if (matchBy === 'SUBREGIONS' && subregions.length === 0) {
        const err = new Error('Select at least 1 sub-region (state).');
        err.status = 400;
        throw err;
      }
      if (matchBy === 'ZIP_CODES' && zip_codes.length === 0) {
        const err = new Error('Enter at least 1 zip code or prefix.');
        err.status = 400;
        throw err;
      }

      const firstWeightKg = parseNonNegativeNumberOrNull(req.validated.body.first_weight_kg, { label: 'First weight (kg)' });
      const addWeightKg = parseNonNegativeNumberOrNull(req.validated.body.additional_weight_kg, { label: 'Every additional weight (kg)' });
      if (!firstWeightKg || firstWeightKg <= 0) {
        const err = new Error('First weight (kg) must be greater than 0.');
        err.status = 400;
        throw err;
      }
      if (!addWeightKg || addWeightKg <= 0) {
        const err = new Error('Every additional weight (kg) must be greater than 0.');
        err.status = 400;
        throw err;
      }

      const firstFeeCents = parseMoneyToCentsAllowZero(req.validated.body.first_fee_rm);
      const addFeeCents = parseMoneyToCentsAllowZero(req.validated.body.additional_fee_rm);
      if (firstFeeCents == null || addFeeCents == null) {
        const err = new Error('Fees are required.');
        err.status = 400;
        throw err;
      }

      const methods = [
        {
          id: crypto.randomUUID(),
          type: 'BASE',
          min_weight_kg: 0,
          first_weight_kg: firstWeightKg,
          first_fee_cents: firstFeeCents,
          additional_weight_kg: addWeightKg,
          additional_fee_cents: addFeeCents,
        },
      ];

      const rangeEnabled = String(req.validated.body.range_enabled || '') === '1';
      if (rangeEnabled) {
        const minWeightKg = parseNonNegativeNumberOrNull(req.validated.body.range_min_weight_kg, { label: 'When weight ≥ (kg)' });
        const stepKg = parseNonNegativeNumberOrNull(req.validated.body.range_step_kg, { label: 'Per set (kg)' });
        const feeCents = req.validated.body.range_fee_rm ? parseMoneyToCentsAllowZero(req.validated.body.range_fee_rm) : null;
        if (minWeightKg == null || minWeightKg <= 0 || stepKg == null || stepKg <= 0 || feeCents == null) {
          const err = new Error('Range fields are required and must be > 0.');
          err.status = 400;
          throw err;
        }
        methods.push({
          id: crypto.randomUUID(),
          type: 'PER_STEP',
          min_weight_kg: minWeightKg,
          step_kg: stepKg,
          fee_cents_per_step: feeCents,
        });
      }

      zones[idx] = {
        ...zones[idx],
        name: String(req.validated.body.name || '').trim(),
        match_by: matchBy,
        subregions,
        zip_codes,
        methods,
      };

      shippingService.saveZones(zones);
      req.session.flash = { type: 'success', message: 'Shipping zone updated.' };
      return res.redirect('/admin/site/shipping-zones');
    } catch (e) {
      if (e && e.status === 400) {
        req.session.flash = { type: 'error', message: e.message };
        return res.redirect(`/admin/site/shipping-zones/${encodeURIComponent(String(req.params.id || ''))}`);
      }
      return next(e);
    }
  }
);

router.post(
  '/site/shipping-zones/:id/delete',
  csrfProtection({ ignoreMultipart: true }),
  validate(z.object({ body: z.any().optional(), params: z.object({ id: z.string() }), query: z.any().optional() })),
  (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      const zones = shippingService.getZones() || [];
      const nextZones = zones.filter((z) => String(z.id || '') !== id);
      shippingService.saveZones(nextZones);
      req.session.flash = { type: 'success', message: 'Shipping zone deleted.' };
      return res.redirect('/admin/site/shipping-zones');
    } catch (e) {
      return next(e);
    }
  }
);

router.get('/promos', (req, res) => {
  // Promos are managed inside Settings now.
  const view = String(req.query.view || req.query.archived || '').trim().toUpperCase();
  const q = view ? `?promos_view=${encodeURIComponent(view)}` : '';
  return res.redirect(`/admin/settings${q}#promos`);
});

router.get('/settings', (req, res) => {
  const siteLogoUrl = settingsRepo.get('site.logo.image', '');

  const technicianSupportUrl = settingsRepo.get('site.footer.technician_support_url', '');
  const footerCopyright = settingsRepo.get('site.footer.copyright', '');

  const contactPhone = settingsRepo.get('site.contact.phone', '');
  const contactWhatsapp = settingsRepo.get('site.contact.whatsapp', '');
  const contactEmail = settingsRepo.get('site.contact.email', '');
  const contactAddress = settingsRepo.get('site.contact.address', '');
  const contactFacebookUrl = settingsRepo.get('site.contact.facebook_url', '');

  const lowStockThreshold = (() => {
    const raw = String(settingsRepo.get('inventory.low_stock_threshold', '5') || '').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
  })();

  const promosView = String(req.query.promos_view || 'ACTIVE').trim().toUpperCase();
  const allPromos = promoRepo.listAdmin({ includeArchived: true });
  const promos = allPromos.filter((p) => {
    if (promosView === 'ARCHIVED') return p.archived;
    if (promosView === 'ALL') return true;
    return !p.archived;
  });

  const adminNotifyTo = settingsRepo.get('email.admin_notify.to', '') || '';
  const adminNotifyCc = settingsRepo.get('email.admin_notify.cc', '') || '';

  return res.render('admin/settings', {
    title: 'Admin – Settings',
    siteLogoUrl,
    technicianSupportUrl,
    footerCopyright,
    contactPhone,
    contactWhatsapp,
    contactEmail,
    contactAddress,
    contactFacebookUrl,
    lowStockThreshold,
    promos,
    adminNotifyTo,
    adminNotifyCc,
    promosView: promosView === 'ALL' || promosView === 'ARCHIVED' || promosView === 'ACTIVE' ? promosView : 'ACTIVE',
  });
});

router.get('/settings/payment', (req, res) => {
  const offlineTransferBanks = offlineTransferService.getBanks();
  const fiuuSettings = fiuuAccountsService.getAdminSettingsViewModel();

  return res.render('admin/payment_settings', {
    title: 'Admin – Payment',
    offlineTransferBanks,
    fiuuAccounts: fiuuSettings.accounts,
    fiuuDefaultAccountId: fiuuSettings.defaultId,
  });
});

router.post(
  '/site/fiuu-accounts',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.any(),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const beforeFiuu = (() => {
        try {
          const vm = fiuuAccountsService.getAdminSettingsViewModel();
          return {
            defaultId: vm.defaultId || '',
            accounts: (vm.accounts || []).map((a) => ({
              id: String(a.id || '').trim(),
              label: String(a.label || '').trim(),
              merchantId: String(a.merchantId || '').trim(),
              gatewayUrl: String(a.gatewayUrl || '').trim(),
              currency: String(a.currency || '').trim(),
              paymentMethod: String(a.paymentMethod || '').trim(),
              requestMethod: String(a.requestMethod || '').trim(),
              vcodeMode: String(a.vcodeMode || '').trim(),
              // Do NOT include verify/secret keys.
              hasKeys: Boolean(String(a.verifyKey || '').trim() && String(a.secretKey || '').trim()),
            })),
          };
        } catch (_) {
          return null;
        }
      })();

      const body = req.validated.body || {};

      const toArray = (v) => {
        if (Array.isArray(v)) return v;
        if (v == null) return [];
        return [v];
      };

      const ids = toArray(body.account_id).map((x) => String(x || '').trim());
      const labels = toArray(body.account_label).map((x) => String(x || '').trim());
      const merchantIds = toArray(body.merchant_id).map((x) => String(x || '').trim());
      const verifyKeys = toArray(body.verify_key).map((x) => String(x || '').trim());
      const secretKeys = toArray(body.secret_key).map((x) => String(x || '').trim());

      const n = Math.max(
        ids.length,
        labels.length,
        merchantIds.length,
        verifyKeys.length,
        secretKeys.length
      );

      const accounts = [];
      for (let i = 0; i < n; i += 1) {
        const id = ids[i] || '';
        const label = labels[i] || '';
        const merchantId = merchantIds[i] || '';
        const verifyKey = verifyKeys[i] || '';
        const secretKey = secretKeys[i] || '';

        const allBlank = !id && !label && !merchantId && !verifyKey && !secretKey;
        if (allBlank) continue;

        if (!id) {
          req.session.flash = { type: 'error', message: 'Each FIUU account row must have an internal id. Please re-add the row.' };
          return res.redirect('/admin/settings/payment#payment-gateway');
        }

        accounts.push({
          id: id.slice(0, 128),
          label: label.slice(0, 128),
          merchantId: merchantId.slice(0, 128),
          verifyKey: verifyKey.slice(0, 256),
          secretKey: secretKey.slice(0, 256),
        });
      }

      if (accounts.length > 50) {
        req.session.flash = { type: 'error', message: 'Too many FIUU accounts (max 50).' };
        return res.redirect('/admin/settings/payment#payment-gateway');
      }

      const defaultAccountId = String(body.default_account_id || '').trim();

      fiuuAccountsService.saveAccounts({
        accounts,
        defaultId: defaultAccountId,
      });

      // Audit: FIUU settings change (sanitized; no secrets).
      try {
        const afterVm = fiuuAccountsService.getAdminSettingsViewModel();
        const afterFiuu = {
          defaultId: afterVm.defaultId || '',
          accounts: (afterVm.accounts || []).map((a) => ({
            id: String(a.id || '').trim(),
            label: String(a.label || '').trim(),
            merchantId: String(a.merchantId || '').trim(),
            gatewayUrl: String(a.gatewayUrl || '').trim(),
            currency: String(a.currency || '').trim(),
            paymentMethod: String(a.paymentMethod || '').trim(),
            requestMethod: String(a.requestMethod || '').trim(),
            vcodeMode: String(a.vcodeMode || '').trim(),
            hasKeys: Boolean(String(a.verifyKey || '').trim() && String(a.secretKey || '').trim()),
          })),
        };

        const changes = computeFieldChanges({
          before: { snapshot: beforeFiuu ? JSON.stringify(beforeFiuu) : '' },
          after: { snapshot: JSON.stringify(afterFiuu) },
          fields: [{ key: 'snapshot', label: 'FIUU accounts' }],
        });

        if (changes.length) {
          logAdminChange({
            req,
            verb: 'Updated',
            entity: 'settings',
            entityLabel: 'Payment settings',
            entityId: null,
            changes,
            meta: { area: 'fiuu_accounts' },
          });
        }
      } catch (_) {
        // ignore audit failures
      }

      req.session.flash = { type: 'success', message: 'FIUU payment accounts saved.' };
      return res.redirect('/admin/settings/payment#payment-gateway');
    } catch (e) {
      if (e && e.status === 400) {
        req.session.flash = { type: 'error', message: e.message };
        return res.redirect('/admin/settings/payment#payment-gateway');
      }
      return next(e);
    }
  }
);

router.post(
  '/site/offline-transfer-banks',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.any(),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const maskAcct = (s) => {
        const raw = String(s || '').trim();
        if (!raw) return '';
        const last4 = raw.slice(-4);
        return raw.length > 4 ? `****${last4}` : `****${last4}`;
      };

      const beforeBanks = (() => {
        try {
          return (offlineTransferService.getBanks() || []).map((b) => ({
            id: String(b.id || '').trim(),
            bank: String(b.bank || '').trim(),
            account_no: maskAcct(b.account_no),
            account_name: String(b.account_name || '').trim(),
            display_at_checkout: Boolean(b.display_at_checkout),
          }));
        } catch (_) {
          return null;
        }
      })();

      const body = req.validated.body || {};

      const toArray = (v) => {
        if (Array.isArray(v)) return v;
        if (v == null) return [];
        return [v];
      };

      const ids = toArray(body.bank_id).map((x) => String(x || '').trim());
      const banks = toArray(body.bank_name).map((x) => String(x || '').trim());
      const accountNos = toArray(body.account_no).map((x) => String(x || '').trim());
      const accountNames = toArray(body.account_name).map((x) => String(x || '').trim());
      const displayIds = new Set(toArray(body.display_ids).map((x) => String(x || '').trim()).filter(Boolean));

      const n = Math.min(ids.length, banks.length, accountNos.length, accountNames.length);
      const out = [];

      for (let i = 0; i < n; i += 1) {
        const id = ids[i];
        const bank = banks[i];
        const account_no = accountNos[i];
        const account_name = accountNames[i];

        const allBlank = !id && !bank && !account_no && !account_name;
        if (allBlank) continue;

        if (!id) {
          req.session.flash = { type: 'error', message: 'Each bank row must have an internal id. Please re-add the row.' };
          return res.redirect('/admin/settings/payment#offline-transfer');
        }

        if (!bank || !account_no || !account_name) {
          req.session.flash = { type: 'error', message: 'Bank, Account No, and Account Name are required for each row.' };
          return res.redirect('/admin/settings/payment#offline-transfer');
        }

        out.push({
          id,
          bank: bank.slice(0, 128),
          account_no: account_no.slice(0, 64),
          account_name: account_name.slice(0, 128),
          display_at_checkout: displayIds.has(id),
        });
      }

      if (out.length > 50) {
        req.session.flash = { type: 'error', message: 'Too many bank accounts (max 50).' };
        return res.redirect('/admin/settings/payment#offline-transfer');
      }

      if (out.length > 0 && out.every((b) => !b.display_at_checkout)) {
        req.session.flash = { type: 'error', message: 'Please enable “Show at checkout” for at least one bank.' };
        return res.redirect('/admin/settings/payment#offline-transfer');
      }

      offlineTransferService.saveBanks(out);

      // Audit: offline transfer bank settings change.
      try {
        const afterBanks = (offlineTransferService.getBanks() || []).map((b) => ({
          id: String(b.id || '').trim(),
          bank: String(b.bank || '').trim(),
          account_no: maskAcct(b.account_no),
          account_name: String(b.account_name || '').trim(),
          display_at_checkout: Boolean(b.display_at_checkout),
        }));

        const changes = computeFieldChanges({
          before: { snapshot: beforeBanks ? JSON.stringify(beforeBanks) : '' },
          after: { snapshot: JSON.stringify(afterBanks) },
          fields: [{ key: 'snapshot', label: 'Offline transfer banks' }],
        });

        if (changes.length) {
          logAdminChange({
            req,
            verb: 'Updated',
            entity: 'settings',
            entityLabel: 'Payment settings',
            entityId: null,
            changes,
            meta: { area: 'offline_transfer_banks' },
          });
        }
      } catch (_) {
        // ignore audit failures
      }

      req.session.flash = { type: 'success', message: 'Offline transfer bank accounts saved.' };
      return res.redirect('/admin/settings/payment#offline-transfer');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/site/admin-email-notifications',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z
        .object({
          admin_notify_to: z.string().trim().max(500).optional().or(z.literal('')),
          admin_notify_cc: z.string().trim().max(500).optional().or(z.literal('')),
        })
        .passthrough(),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const beforeTo = settingsRepo.get('email.admin_notify.to', '') || '';
      const beforeCc = settingsRepo.get('email.admin_notify.cc', '') || '';

      const to = String(req.validated.body.admin_notify_to || '').trim();
      const cc = String(req.validated.body.admin_notify_cc || '').trim();

      settingsRepo.set('email.admin_notify.to', to);
      settingsRepo.set('email.admin_notify.cc', cc);

      const changes = computeFieldChanges({
        before: { to: beforeTo, cc: beforeCc },
        after: { to, cc },
        fields: [
          { key: 'to', label: 'To' },
          { key: 'cc', label: 'CC' },
        ],
      });

      if (changes.length) {
        logAdminChange({
          req,
          verb: 'Updated',
          entity: 'settings',
          entityLabel: 'Email notifications',
          entityId: null,
          changes,
          meta: { area: 'admin_email_notifications' },
        });
      }

      req.session.flash = { type: 'success', message: 'Admin email notification settings saved.' };
      return res.redirect('/admin/settings#email-notifications');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/site/inventory',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z
        .object({
          low_stock_threshold: z.string().trim().max(10).optional().or(z.literal('')),
        })
        .passthrough(),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const before = String(settingsRepo.get('inventory.low_stock_threshold', '5') || '').trim();

      const raw = String(req.validated.body.low_stock_threshold || '').trim();
      const n = raw ? Number(raw) : 5;
      const threshold = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
      if (threshold == null) {
        req.session.flash = { type: 'error', message: 'Low stock threshold must be a non-negative integer.' };
        return res.redirect('/admin/settings#inventory');
      }
      settingsRepo.set('inventory.low_stock_threshold', String(threshold));

      const changes = computeFieldChanges({
        before: { low_stock_threshold: before },
        after: { low_stock_threshold: String(threshold) },
        fields: [{ key: 'low_stock_threshold', label: 'Low stock threshold' }],
      });
      if (changes.length) {
        logAdminChange({
          req,
          verb: 'Updated',
          entity: 'settings',
          entityLabel: 'Inventory settings',
          entityId: null,
          changes,
          meta: { area: 'inventory' },
        });
      }

      req.session.flash = { type: 'success', message: 'Inventory settings saved.' };
      return res.redirect('/admin/settings#inventory');
    } catch (e) {
      return next(e);
    }
  }
);

router.get('/reports/sales', (req, res) => {
  const date_from = String(req.query.date_from || '').trim();
  const date_to = String(req.query.date_to || '').trim();
  const report = reportRepo.getSalesReport({ dateFrom: date_from, dateTo: date_to });

  return res.render('admin/sales_report', {
    title: 'Admin – Sales report',
    date_from: report.date_from,
    date_to: report.date_to,
    summary: report.summary,
    daily: report.daily,
    topProducts: report.topProducts,
  });
});

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim() || null;
  const status = String(req.query.status || '').trim().toUpperCase() || 'ACTIVE';
  const { page, pageSize, offset, limit } = getPagination({ page: req.query.page, pageSize: 12 });

  const safeStatus = status === 'ACTIVE' || status === 'CLOSED' || status === 'ALL' ? status : 'ACTIVE';
  const total = userRepo.countAdmin({ q, status: safeStatus });
  const users = userRepo.listAdmin({ q, status: safeStatus, limit, offset });
  const pageCount = getPageCount(total, pageSize);

  return res.render('admin/users', {
    title: 'Admin – Users',
    users,
    q: q || '',
    status: safeStatus,
    page,
    pageCount,
    total,
  });
});

router.get('/users/:id', (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid user id.' });
  }

  const user = userRepo.getById(userId);
  if (!user) return res.status(404).render('shared/error', { title: 'Not Found', message: 'User not found.' });

  const q = String(req.query.q || '').trim() || null;
  const payment_status = String(req.query.payment_status || '').trim() || null;
  const payment_method = String(req.query.payment_method || '').trim() || null;
  const fulfilment_status = String(req.query.fulfilment_status || '').trim() || null;
  const date_from = String(req.query.date_from || '').trim() || null;
  const date_to = String(req.query.date_to || '').trim() || null;
  const { page, pageSize, offset, limit } = getPagination({ page: req.query.page, pageSize: 12 });

  const ordersTotal = orderRepo.countByUserFiltered(userId, { q, payment_status, payment_method, fulfilment_status, date_from, date_to });
  const orders = orderRepo.listByUserFiltered(userId, { q, payment_status, payment_method, fulfilment_status, date_from, date_to, limit, offset });
  const pageCount = getPageCount(ordersTotal, pageSize);

  return res.render('admin/user_detail', {
    title: `Admin – User ${user.username}`,
    user,
    orders,
    q: q || '',
    payment_status: payment_status || '',
    payment_method: payment_method || '',
    fulfilment_status: fulfilment_status || '',
    date_from: date_from || '',
    date_to: date_to || '',
    page,
    pageCount,
    total: ordersTotal,
  });
});

router.post(
  '/users/:id/close',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({ _csrf: z.string().optional() }).passthrough(),
      query: z.any().optional(),
      params: z.object({ id: z.string() }),
    })
  ),
  (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid user id.' });
    }
    const user = userRepo.getById(userId);
    if (!user) return res.status(404).render('shared/error', { title: 'Not Found', message: 'User not found.' });
    if (computeIsAdmin(user)) {
      req.session.flash = { type: 'error', message: 'Cannot close an admin account.' };
      return res.redirect(`/admin/users/${userId}`);
    }

    userRepo.closeAccount(userId);
    req.session.flash = { type: 'success', message: 'Account closed.' };
    return res.redirect(`/admin/users/${userId}`);
  }
);

router.post(
  '/users/:id/reopen',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({ _csrf: z.string().optional() }).passthrough(),
      query: z.any().optional(),
      params: z.object({ id: z.string() }),
    })
  ),
  (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid user id.' });
    }
    const user = userRepo.getById(userId);
    if (!user) return res.status(404).render('shared/error', { title: 'Not Found', message: 'User not found.' });
    if (computeIsAdmin(user)) {
      req.session.flash = { type: 'error', message: 'Cannot reopen an admin account.' };
      return res.redirect(`/admin/users/${userId}`);
    }

    userRepo.reopenAccount(userId);
    req.session.flash = { type: 'success', message: 'Account reopened.' };
    return res.redirect(`/admin/users/${userId}`);
  }
);

router.get('/reports/sales.csv', (req, res) => {
  const date_from = String(req.query.date_from || '').trim();
  const date_to = String(req.query.date_to || '').trim();
  const report = reportRepo.getSalesReport({ dateFrom: date_from, dateTo: date_to });

  const lines = [];
  lines.push(['Date', 'PaidOrders', 'GrossRM', 'RefundsRM', 'NetRM', 'ProfitRM'].join(','));
  for (const r of report.daily || []) {
    const grossRm = (Number(r.gross_cents || 0) / 100).toFixed(2);
    const refundRm = (Number(r.refund_cents || 0) / 100).toFixed(2);
    const netRm = (Number(r.net_cents || 0) / 100).toFixed(2);
    const profitRm = (Number(r.profit_cents || 0) / 100).toFixed(2);
    lines.push([String(r.day), String(r.orders_count || 0), grossRm, refundRm, netRm, profitRm].join(','));
  }

  const label = `sales_report_${report.date_from || 'all'}_${report.date_to || 'all'}.csv`;
  const csv = `\ufeff${lines.join('\n')}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${label}"`);
  return res.send(csv);
});

router.get('/exports/users.csv', (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim() || 'ALL';

  const label = `users_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${label}"`);
  res.write('\ufeff');

  const header = [
    'user_id',
    'username',
    'email',
    'phone',
    'address',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'postcode',
    'is_closed',
    'closed_at',
    'created_at',
    'orders_count',
    'last_order_at',
  ];
  res.write(`${header.join(',')}\n`);

  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const batch = userRepo.listAdmin({ q: q || null, status, limit, offset });
    if (!batch.length) break;
    for (const u of batch) {
      const row = [
        u.user_id,
        u.username,
        u.email,
        u.phone || '',
        u.address || '',
        u.address_line1 || '',
        u.address_line2 || '',
        u.city || '',
        u.state || '',
        u.postcode || '',
        u.is_closed ? 1 : 0,
        u.closed_at || '',
        u.created_at || '',
        Number(u.orders_count || 0),
        u.last_order_at || '',
      ].map(csvCell);
      res.write(`${row.join(',')}\n`);
    }
  }

  return res.end();
});

router.get('/exports/products.csv', (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim() || null;
  const visibility = String(req.query.visibility || '').trim() || null;
  const archived = String(req.query.archived || '').trim() || null;
  const stock = String(req.query.stock || '').trim() || null;
  const sort = String(req.query.sort || '').trim() || 'NEWEST';

  const minRaw = String(req.query.min_price || '').trim();
  const maxRaw = String(req.query.max_price || '').trim();
  const minPriceCents = minRaw ? parseMoneyToCentsAllowZero(minRaw) : null;
  const maxPriceCents = maxRaw ? parseMoneyToCentsAllowZero(maxRaw) : null;

  const label = `products_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${label}"`);
  res.write('\ufeff');

  const header = [
    'product_id',
    'name',
    'category',
    'selling_price_rm',
    'selling_price_cents',
    'cost_price_rm',
    'cost_price_cents',
    'weight_kg',
    'stock',
    'availability',
    'visibility',
    'archived',
    'created_at',
    'updated_at',
  ];
  res.write(`${header.join(',')}\n`);

  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const batch = inventoryRepo.listAdmin({
      q: q || null,
      includeArchived: true,
      archived: archived || 'ALL',
      category,
      visibility,
      stock,
      minPriceCents,
      maxPriceCents,
      sort,
      limit,
      offset,
    });
    if (!batch.length) break;

    for (const p of batch) {
      const priceCents = Number(p.price || 0);
      const costCents = p.cost_price == null ? null : Number(p.cost_price || 0);
      const row = [
        p.product_id,
        p.name,
        p.category,
        formatMoneyRm2(priceCents),
        priceCents,
        costCents == null ? '' : formatMoneyRm2(costCents),
        costCents == null ? '' : costCents,
        p.weight_kg == null ? '' : p.weight_kg,
        p.stock,
        p.availability ? 1 : 0,
        p.visibility ? 1 : 0,
        p.archived ? 1 : 0,
        p.created_at || '',
        p.updated_at || '',
      ].map(csvCell);
      res.write(`${row.join(',')}\n`);
    }
  }

  return res.end();
});

router.get('/exports/orders.csv', (req, res) => {
  const q = String(req.query.q || '').trim();
  const payment_status = String(req.query.payment_status || '').trim() || null;
  const payment_method = String(req.query.payment_method || '').trim() || null;
  const fulfilment_status = String(req.query.fulfilment_status || '').trim() || null;
  const refund_status = String(req.query.refund_status || '').trim() || null;
  const date_from = String(req.query.date_from || '').trim();
  const date_to = String(req.query.date_to || '').trim();

  const where = [];
  const params = {};
  if (q) {
    where.push('(o.order_code LIKE @q OR o.customer_name LIKE @q OR o.email LIKE @q)');
    params.q = `%${q}%`;
  }
  if (payment_status) {
    where.push('o.payment_status=@ps');
    params.ps = payment_status;
  }
  if (payment_method) {
    where.push('o.payment_method=@pm');
    params.pm = payment_method;
  }
  if (fulfilment_status) {
    where.push('o.fulfilment_status=@fs');
    params.fs = fulfilment_status;
  }
  if (refund_status) {
    where.push("COALESCE(o.refund_status,'NONE')=@rs");
    params.rs = refund_status;
  }
  if (date_from) {
    where.push('date(o.created_at) >= date(@df)');
    params.df = date_from;
  }
  if (date_to) {
    where.push('date(o.created_at) <= date(@dt)');
    params.dt = date_to;
  }

  const label = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${label}"`);
  res.write('\ufeff');

  const header = [
    'order_id',
    'order_code',
    'created_at',
    'user_id',
    'username',
    'customer_name',
    'customer_email',
    'customer_phone',
    'payment_method',
    'payment_channel',
    'payment_status',
    'refund_status',
    'fulfilment_status',
    'delivery_address_line1',
    'delivery_address_line2',
    'delivery_city',
    'delivery_state',
    'delivery_postcode',
    'delivery_region',
    'items_subtotal_rm',
    'discount_amount_rm',
    'shipping_fee_rm',
    'total_amount_rm',
    'promo_code',
    'promo_discount_type',
    'promo_discount_amount_rm',
    'promo_applies_to_shipping',
    'order_item_id',
    'product_id',
    'product_name',
    'unit_price_rm',
    'quantity',
    'line_subtotal_rm',
    'weight_kg',
    'admin_note',
  ];
  res.write(`${header.join(',')}\n`);

  const db = getDb();
  const sql = `
    SELECT
      o.order_id,
      o.order_code,
      o.created_at,
      o.user_id,
      u.username,
      o.customer_name,
      o.email as customer_email,
      o.phone as customer_phone,
      o.payment_method,
      o.payment_channel,
      o.payment_status,
      o.refund_status,
      o.fulfilment_status,
      o.delivery_address_line1,
      o.delivery_address_line2,
      o.delivery_city,
      o.delivery_state,
      o.delivery_postcode,
      o.delivery_region,
      o.items_subtotal,
      o.discount_amount,
      o.shipping_fee,
      o.total_amount,
      op.code as promo_code,
      op.discount_type as promo_discount_type,
      op.discount_amount as promo_discount_amount,
      op.applies_to_shipping as promo_applies_to_shipping,
      oi.id as order_item_id,
      oi.product_id,
      oi.product_name_snapshot as product_name,
      oi.price_snapshot as unit_price,
      oi.quantity,
      oi.subtotal as line_subtotal,
      i.weight_kg,
      o.admin_note
    FROM orders o
    LEFT JOIN users u ON u.user_id = o.user_id
    LEFT JOIN order_promos op ON op.order_id = o.order_id
    LEFT JOIN order_items oi ON oi.order_id = o.order_id
    LEFT JOIN inventory i ON i.product_id = oi.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY datetime(o.created_at) DESC, o.order_id DESC, oi.id ASC
  `;

  const stmt = db.prepare(sql);
  for (const r of stmt.iterate(params)) {
    const row = [
      r.order_id,
      r.order_code || '',
      r.created_at || '',
      r.user_id == null ? '' : r.user_id,
      r.username || '',
      r.customer_name || '',
      r.customer_email || '',
      r.customer_phone || '',
      r.payment_method || '',
      r.payment_channel || '',
      r.payment_status || '',
      r.refund_status || 'NONE',
      r.fulfilment_status || '',
      r.delivery_address_line1 || '',
      r.delivery_address_line2 || '',
      r.delivery_city || '',
      r.delivery_state || '',
      r.delivery_postcode || '',
      r.delivery_region || '',
      formatMoneyRm2(r.items_subtotal),
      formatMoneyRm2(r.discount_amount),
      formatMoneyRm2(r.shipping_fee),
      formatMoneyRm2(r.total_amount),
      r.promo_code || '',
      r.promo_discount_type || '',
      r.promo_discount_amount == null ? '' : formatMoneyRm2(r.promo_discount_amount),
      r.promo_applies_to_shipping ? 1 : 0,
      r.order_item_id == null ? '' : r.order_item_id,
      r.product_id == null ? '' : r.product_id,
      r.product_name || '',
      r.unit_price == null ? '' : formatMoneyRm2(r.unit_price),
      r.quantity == null ? '' : r.quantity,
      r.line_subtotal == null ? '' : formatMoneyRm2(r.line_subtotal),
      r.weight_kg == null ? '' : r.weight_kg,
      r.admin_note || '',
    ].map(csvCell);
    res.write(`${row.join(',')}\n`);
  }

  return res.end();
});

router.post(
  '/site/footer-pages',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        technician_support_url: z.string().trim().max(1000).optional().or(z.literal('')),
        footer_copyright: z.string().trim().max(200).optional().or(z.literal('')),
        contact_phone: z.string().trim().max(64).optional().or(z.literal('')),
        contact_whatsapp: z.string().trim().max(200).optional().or(z.literal('')),
        contact_email: z.string().trim().max(200).optional().or(z.literal('')),
        contact_address: z.string().trim().max(400).optional().or(z.literal('')),
        contact_facebook_url: z.string().trim().max(1000).optional().or(z.literal('')),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const keys = [
        'site.footer.technician_support_url',
        'site.footer.copyright',
        'site.contact.phone',
        'site.contact.whatsapp',
        'site.contact.email',
        'site.contact.address',
        'site.contact.facebook_url',
      ];
      const before = settingsRepo.getMany(keys);
      const rawUrl = String(req.validated.body.technician_support_url || '').trim();
      const technicianUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';

      const footer = String(req.validated.body.footer_copyright || '').trim();

       const contactPhone = String(req.validated.body.contact_phone || '').trim();
       const contactWhatsapp = String(req.validated.body.contact_whatsapp || '').trim();
       const contactEmail = String(req.validated.body.contact_email || '').trim();
       const contactAddress = String(req.validated.body.contact_address || '').trim();

       const rawFacebook = String(req.validated.body.contact_facebook_url || '').trim();
       const facebookUrl = /^https?:\/\//i.test(rawFacebook) ? rawFacebook : '';

      settingsRepo.set('site.footer.technician_support_url', technicianUrl);
      settingsRepo.set('site.footer.copyright', footer);

       settingsRepo.set('site.contact.phone', contactPhone);
       settingsRepo.set('site.contact.whatsapp', contactWhatsapp);
       settingsRepo.set('site.contact.email', contactEmail);
       settingsRepo.set('site.contact.address', contactAddress);
       settingsRepo.set('site.contact.facebook_url', facebookUrl);

      const after = settingsRepo.getMany(keys);
      const changes = computeFieldChanges({
        before,
        after,
        fields: [
          { key: 'site.footer.technician_support_url', label: 'Technician support URL' },
          { key: 'site.footer.copyright', label: 'Footer copyright' },
          { key: 'site.contact.phone', label: 'Contact phone' },
          { key: 'site.contact.whatsapp', label: 'Contact WhatsApp' },
          { key: 'site.contact.email', label: 'Contact email' },
          { key: 'site.contact.address', label: 'Contact address' },
          { key: 'site.contact.facebook_url', label: 'Facebook URL' },
        ],
      });
      if (changes.length) {
        logAdminChange({
          req,
          verb: 'Updated',
          entity: 'settings',
          entityLabel: 'Footer & contact',
          entityId: null,
          changes,
          meta: { area: 'footer_pages' },
        });
      }

      req.session.flash = { type: 'success', message: 'Footer & pages updated.' };
      return res.redirect('/admin/settings#footer-pages');
    } catch (e) {
      return next(e);
    }
  }
);

function getPageMeta(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (s === 'privacy') {
    return { slug: 'privacy', title: 'Privacy', keyHtml: 'page.privacy.html', keyMd: 'page.privacy.md' };
  }
  if (s === 'terms') {
    return { slug: 'terms', title: 'Terms', keyHtml: 'page.terms.html', keyMd: 'page.terms.md' };
  }
  if (s === 'how-to-order') {
    return { slug: 'how-to-order', title: 'How to Order', keyHtml: 'page.how_to_order.html', keyMd: 'page.how_to_order.md' };
  }
  return null;
}

function getDefaultPageHtml(title) {
  return renderMarkdown(`# ${String(title || '')}\n\nContent coming soon.`);
}

function extractSitePageImageNamesFromHtml(html) {
  const out = new Set();
  const s = String(html == null ? '' : html);

  // Very small/safe extraction for our own generated URLs.
  // Example: <img src="/uploads/site/site_page_<nonce>.webp">
  const re = /\bsrc\s*=\s*["']([^"']+)["']/gi;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    const src = String(m[1] || '').trim();
    if (!src.startsWith('/uploads/site/')) continue;
    const fileName = path.posix.basename(src);
    if (!/^site_page_[0-9a-f]{16}\.webp$/i.test(fileName)) continue;
    out.add(fileName);
  }

  return out;
}

function getReferencedSitePageImageNames() {
  const keys = ['page.privacy.html', 'page.terms.html', 'page.how_to_order.html'];
  const values = settingsRepo.getMany(keys);
  const referenced = new Set();
  for (const k of keys) {
    const html = values[k];
    for (const f of extractSitePageImageNamesFromHtml(html)) referenced.add(f);
  }
  return referenced;
}

function purgeOrphanedSitePageImages() {
  const siteDir = path.join(process.cwd(), 'storage', 'uploads', 'site');
  let files = [];
  try {
    files = fs.readdirSync(siteDir);
  } catch (_) {
    return;
  }

  const referenced = getReferencedSitePageImageNames();
  for (const f of files) {
    if (!/^site_page_[0-9a-f]{16}\.webp$/i.test(f)) continue;
    if (referenced.has(f)) continue;
    try {
      fs.unlinkSync(path.join(siteDir, f));
    } catch (_) {
      // ignore
    }
  }
}

router.post(
  '/pages/upload-image',
  upload.single('file'),
  csrfProtection({ ignoreMultipart: false }),
  async (req, res, next) => {
    try {
      if (!req.file) {
        const err = new Error('No file uploaded.');
        err.status = 400;
        throw err;
      }

      const url = await imageService.optimizeAndSaveSiteContentImage(req.file.path, 'page');
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        // ignore
      }

      return res.json({ location: url });
    } catch (e) {
      return next(e);
    }
  }
);

function renderPageEditor(slug) {
  return (req, res, next) => {
    try {
      const meta = getPageMeta(slug);
      if (!meta) {
        const err = new Error('Page not found.');
        err.status = 404;
        throw err;
      }

      const storedHtml = settingsRepo.get(meta.keyHtml, '');
      const fallbackMd = settingsRepo.get(meta.keyMd, '');
      const contentHtml = storedHtml
        ? sanitizeHtmlFragment(storedHtml)
        : (fallbackMd ? renderMarkdown(fallbackMd) : getDefaultPageHtml(meta.title));

      return res.render('admin/page_editor', {
        title: `Admin – ${meta.title}`,
        pageTitle: meta.title,
        action: `/admin/pages/${meta.slug}`,
        contentHtml,
      });
    } catch (e) {
      return next(e);
    }
  };
}

function savePageEditor(slug) {
  return (req, res, next) => {
    try {
      const meta = getPageMeta(slug);
      if (!meta) {
        const err = new Error('Page not found.');
        err.status = 404;
        throw err;
      }

      const beforeHtml = settingsRepo.get(meta.keyHtml, '');

      const raw = String(req.validated.body.content_html || '');
      const clean = sanitizeHtmlFragment(raw);
      settingsRepo.set(meta.keyHtml, clean);

      const changes = computeFieldChanges({
        before: {
          content: `${previewValue(beforeHtml || '', { max: 120 })} (len ${String(beforeHtml || '').length})`,
        },
        after: {
          content: `${previewValue(clean || '', { max: 120 })} (len ${String(clean || '').length})`,
        },
        fields: [{ key: 'content', label: `${meta.title} content` }],
      });
      if (changes.length) {
        logAdminChange({
          req,
          verb: 'Updated',
          entity: 'settings',
          entityLabel: `${meta.title} page`,
          entityId: null,
          changes,
          meta: { area: `page_${meta.slug}`, settingKey: meta.keyHtml },
        });
      }

      // Keep the uploads folder clean: delete any orphaned editor images.
      purgeOrphanedSitePageImages();

      req.session.flash = { type: 'success', message: `${meta.title} page updated.` };
      return res.redirect(`/admin/pages/${meta.slug}`);
    } catch (e) {
      return next(e);
    }
  };
}

router.get('/pages/privacy', renderPageEditor('privacy'));
router.get('/pages/terms', renderPageEditor('terms'));
router.get('/pages/how-to-order', renderPageEditor('how-to-order'));

router.post(
  '/pages/privacy',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        content_html: z.string().max(800000).optional().or(z.literal('')),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  savePageEditor('privacy')
);

router.post(
  '/pages/terms',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        content_html: z.string().max(800000).optional().or(z.literal('')),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  savePageEditor('terms')
);

router.post(
  '/pages/how-to-order',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        content_html: z.string().max(800000).optional().or(z.literal('')),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  savePageEditor('how-to-order')
);

/*
 * NOTE: Avoid a param-based route like `/pages/:slug` here.
 * In this codebase (Express 5 + `router`), path-to-regexp rejects inline regex params.
 * Explicit routes keep uploads working and avoid validation misroutes.
 */

// Legacy (removed): router.get('/pages/:slug', ...)

//
// Removed param routes to prevent `/pages/upload-image` from being captured.
//

/*
router.get('/pages/:slug', (req, res, next) => {
  try {
    const meta = getPageMeta(req.params.slug);
    if (!meta) {
      const err = new Error('Page not found.');
      err.status = 404;
      throw err;
    }

    const storedHtml = settingsRepo.get(meta.keyHtml, '');
    const fallbackMd = settingsRepo.get(meta.keyMd, '');
    const contentHtml = storedHtml
      ? sanitizeHtmlFragment(storedHtml)
      : (fallbackMd ? renderMarkdown(fallbackMd) : getDefaultPageHtml(meta.title));

    return res.render('admin/page_editor', {
      title: `Admin – ${meta.title}`,
      pageTitle: meta.title,
      action: `/admin/pages/${meta.slug}`,
      contentHtml,
    });
  } catch (e) {
    return next(e);
  }
});

router.post(
  '/pages/:slug',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        content_html: z.string().max(800000).optional().or(z.literal('')),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const meta = getPageMeta(req.params.slug);
      if (!meta) {
        const err = new Error('Page not found.');
        err.status = 404;
        throw err;
      }

      const raw = String(req.validated.body.content_html || '');
      const clean = sanitizeHtmlFragment(raw);
      settingsRepo.set(meta.keyHtml, clean);

      req.session.flash = { type: 'success', message: `${meta.title} page updated.` };
      return res.redirect(`/admin/pages/${meta.slug}`);
    } catch (e) {
      return next(e);
    }
  }
);
*/

router.post(
  '/site/branding',
  upload.single('logo_image'),
  csrfProtection({ ignoreMultipart: false }),
  validate(
    z.object({
      body: z.object({
        clear_logo: z.string().optional(),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const beforeLogo = settingsRepo.get('site.logo.image', '') || '';

      if (req.validated.body.clear_logo === '1') {
        settingsRepo.set('site.logo.image', '');
      }

      if (req.file) {
        const optimized = await imageService.optimizeAndSaveSiteImage(req.file.path, 'logo');
        settingsRepo.set('site.logo.image', optimized);
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {
          // ignore
        }
      }

      const afterLogo = settingsRepo.get('site.logo.image', '') || '';
      const changes = computeFieldChanges({
        before: { logo: beforeLogo },
        after: { logo: afterLogo },
        fields: [{ key: 'logo', label: 'Site logo' }],
      });
      if (changes.length) {
        logAdminChange({
          req,
          verb: 'Updated',
          entity: 'settings',
          entityLabel: 'Branding',
          entityId: null,
          changes,
          meta: { area: 'branding' },
        });
      }

      req.session.flash = { type: 'success', message: 'Branding updated.' };
      return res.redirect('/admin/site/branding');
    } catch (e) {
      return next(e);
    }
  }
);

router.get('/categories', (req, res) => {
  const archived = String(req.query.archived || '').trim().toUpperCase() || 'ACTIVE';
  const includeArchived = archived === 'ALL' || archived === 'ARCHIVED';
  const all = categoryRepo.listAdmin({ includeArchived: true });
  const categories = all.filter((c) => {
    if (archived === 'ARCHIVED') return c.archived;
    if (archived === 'ALL') return true;
    return !c.archived;
  });

  const fiuuAccounts = fiuuAccountsService.getAccounts();
  const fiuuCategoryMap = fiuuAccountsService.getCategoryAccountMap();
  const fiuuSelectableAccounts = [
    ...fiuuAccounts.map((a) => ({ id: a.id, label: a.label })),
  ];

  return res.render('admin/categories', {
    title: 'Admin – Categories',
    categories,
    total: categories.length,
    archived: archived === 'ALL' || archived === 'ARCHIVED' || archived === 'ACTIVE' ? archived : 'ACTIVE',
    includeArchived,
    fiuuSelectableAccounts,
    fiuuCategoryMap,
  });
});

router.get('/categories/:id/sections', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      const err = new Error('Invalid category id.');
      err.status = 400;
      throw err;
    }

    const category = categoryRepo.getById(id);
    if (!category) {
      const err = new Error('Category not found.');
      err.status = 404;
      throw err;
    }

    const sections = categorySectionRepo.listByCategoryId(id);
    return res.render('admin/category_sections', {
      title: `Admin – Category sections`,
      category,
      sections,
    });
  } catch (e) {
    return next(e);
  }
});

router.post(
  '/categories/:id/sections',
  csrfProtection(),
  validate(
    z.object({
      body: z.object({
        title: z.string().trim().max(120).optional().or(z.literal('')),
        body_md: z.string().max(50000).optional().or(z.literal('')),
        sort_order: z.string().trim().max(20).optional().or(z.literal('')),
        active: z.string().optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const categoryId = Number(req.params.id);
      if (!Number.isFinite(categoryId)) {
        const err = new Error('Invalid category id.');
        err.status = 400;
        throw err;
      }
      const category = categoryRepo.getById(categoryId);
      if (!category) {
        const err = new Error('Category not found.');
        err.status = 404;
        throw err;
      }

      const sortRaw = String(req.validated.body.sort_order || '').trim();
      const sortOrder = sortRaw ? Number.parseInt(sortRaw, 10) : 0;
      if (!Number.isFinite(sortOrder)) {
        const err = new Error('Invalid sort order.');
        err.status = 400;
        throw err;
      }

      const active = String(req.validated.body.active || '1') === '1';
      const bodyMd = String(req.validated.body.body_md || '');
      if (!bodyMd.trim()) {
        const err = new Error('Content is required.');
        err.status = 400;
        throw err;
      }

      categorySectionRepo.create({
        category_id: categoryId,
        title: String(req.validated.body.title || '').trim(),
        body_md: bodyMd,
        sort_order: sortOrder,
        active,
      });

      req.session.flash = { type: 'success', message: 'Section added.' };
      return res.redirect(`/admin/categories/${categoryId}/sections`);
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/categories/:id/sections/:sectionId',
  csrfProtection(),
  validate(
    z.object({
      body: z.object({
        title: z.string().trim().max(120).optional().or(z.literal('')),
        body_md: z.string().max(50000).optional().or(z.literal('')),
        sort_order: z.string().trim().max(20).optional().or(z.literal('')),
        active: z.string().optional(),
      }),
      params: z.object({ id: z.string(), sectionId: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const categoryId = Number(req.params.id);
      const sectionId = Number(req.params.sectionId);
      if (!Number.isFinite(categoryId) || !Number.isFinite(sectionId)) {
        const err = new Error('Invalid id.');
        err.status = 400;
        throw err;
      }

      const category = categoryRepo.getById(categoryId);
      if (!category) {
        const err = new Error('Category not found.');
        err.status = 404;
        throw err;
      }

      const current = categorySectionRepo.getById(sectionId);
      if (!current || current.category_id !== categoryId) {
        const err = new Error('Section not found.');
        err.status = 404;
        throw err;
      }

      const sortRaw = String(req.validated.body.sort_order || '').trim();
      const sortOrder = sortRaw ? Number.parseInt(sortRaw, 10) : 0;
      if (!Number.isFinite(sortOrder)) {
        const err = new Error('Invalid sort order.');
        err.status = 400;
        throw err;
      }

      const bodyMd = String(req.validated.body.body_md || '');
      if (!bodyMd.trim()) {
        const err = new Error('Content is required.');
        err.status = 400;
        throw err;
      }

      categorySectionRepo.update(sectionId, {
        title: String(req.validated.body.title || '').trim(),
        body_md: bodyMd,
        sort_order: sortOrder,
        active: String(req.validated.body.active || '1') === '1',
      });

      req.session.flash = { type: 'success', message: 'Section saved.' };
      return res.redirect(`/admin/categories/${categoryId}/sections`);
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/categories/:id/sections/:sectionId/delete',
  csrfProtection(),
  validate(z.object({ body: z.any().optional(), params: z.object({ id: z.string(), sectionId: z.string() }), query: z.any().optional() })),
  (req, res, next) => {
    try {
      const categoryId = Number(req.params.id);
      const sectionId = Number(req.params.sectionId);
      if (!Number.isFinite(categoryId) || !Number.isFinite(sectionId)) {
        const err = new Error('Invalid id.');
        err.status = 400;
        throw err;
      }

      const current = categorySectionRepo.getById(sectionId);
      if (!current || current.category_id !== categoryId) {
        const err = new Error('Section not found.');
        err.status = 404;
        throw err;
      }

      categorySectionRepo.remove(sectionId);
      req.session.flash = { type: 'success', message: 'Section deleted.' };
      return res.redirect(`/admin/categories/${categoryId}/sections`);
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/promos',
  csrfProtection(),
  validate(
    z.object({
      body: z
        .object({
          code: z.string().trim().min(2).max(32),
          discount_type: z.enum(['PERCENT', 'FIXED']),
          percent_off: z.string().trim().max(8).optional().or(z.literal('')),
          amount_off_rm: z.string().trim().max(32).optional().or(z.literal('')),
          applies_to_shipping: z.string().optional(),
          active: z.string().optional(),
          max_redemptions: z.string().trim().max(20).optional().or(z.literal('')),
          start_date: z.string().trim().max(32).optional().or(z.literal('')),
          end_date: z.string().trim().max(32).optional().or(z.literal('')),
        })
        .superRefine((b, ctx) => {
          const percent = String(b.percent_off || '').trim();
          const amount = String(b.amount_off_rm || '').trim();
          if (b.discount_type === 'PERCENT') {
            if (!percent) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Percent off is required for PERCENT promos.', path: ['percent_off'] });
            }
          }
          if (b.discount_type === 'FIXED') {
            if (!amount) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount off (RM) is required for FIXED promos.', path: ['amount_off_rm'] });
            }
          }
        }),
      params: z.any().optional(),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const code = String(req.validated.body.code || '').trim().toUpperCase();
      if (promoRepo.getByCode(code)) {
        const err = new Error('Promo code already exists.');
        err.status = 400;
        throw err;
      }
      const type = req.validated.body.discount_type;
      const active = String(req.validated.body.active || '1') === '1';
      const appliesToShipping = String(req.validated.body.applies_to_shipping || '') === '1';

      const pctRaw = String(req.validated.body.percent_off || '').trim();
      const amtRaw = String(req.validated.body.amount_off_rm || '').trim();

      const percentOff = pctRaw ? Number.parseInt(pctRaw, 10) : null;
      const amountOffCents = amtRaw ? parseMoneyToCentsAllowZero(amtRaw) : null;

      if (type === 'FIXED' && (!Number.isFinite(amountOffCents) || amountOffCents <= 0)) {
        const err = new Error('Fixed amount must be greater than 0.');
        err.status = 400;
        throw err;
      }

      if (type === 'PERCENT' && (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 100)) {
        const err = new Error('Percent off must be between 1 and 100.');
        err.status = 400;
        throw err;
      }

      const maxRaw = String(req.validated.body.max_redemptions || '').trim();
      const max = maxRaw ? Number.parseInt(maxRaw, 10) : null;
      if (max != null && (!Number.isFinite(max) || max <= 0)) {
        const err = new Error('Invalid max redemptions.');
        err.status = 400;
        throw err;
      }

      const startDate = String(req.validated.body.start_date || '').trim() || null;
      const endDate = String(req.validated.body.end_date || '').trim() || null;

      promoRepo.create({
        code,
        discount_type: type,
        percent_off: type === 'PERCENT' ? percentOff : null,
        amount_off_cents: type === 'FIXED' ? amountOffCents : null,
        applies_to_shipping: appliesToShipping,
        active,
        archived: false,
        max_redemptions: max,
        start_date: startDate,
        end_date: endDate,
      });

      req.session.flash = { type: 'success', message: 'Promo created.' };
      return res.redirect('/admin/settings?promos_view=ACTIVE#promos');
    } catch (e) {
      if (e && e.status === 400) {
        req.session.flash = { type: 'error', message: e.message };
        return res.redirect('/admin/settings?promos_view=ALL#promos');
      }
      return next(e);
    }
  }
);

router.post(
  '/promos/:code/update',
  csrfProtection(),
  validate(
    z.object({
      body: z
        .object({
          new_code: z.string().trim().min(2).max(32).optional().or(z.literal('')),
          discount_type: z.enum(['PERCENT', 'FIXED']),
          percent_off: z.string().trim().max(8).optional().or(z.literal('')),
          amount_off_rm: z.string().trim().max(32).optional().or(z.literal('')),
          applies_to_shipping: z.string().optional(),
          active: z.string().optional(),
          max_redemptions: z.string().trim().max(20).optional().or(z.literal('')),
          start_date: z.string().trim().max(32).optional().or(z.literal('')),
          end_date: z.string().trim().max(32).optional().or(z.literal('')),
        })
        .superRefine((b, ctx) => {
          const percent = String(b.percent_off || '').trim();
          const amount = String(b.amount_off_rm || '').trim();
          if (b.discount_type === 'PERCENT') {
            if (!percent) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Percent off is required.', path: ['percent_off'] });
          }
          if (b.discount_type === 'FIXED') {
            if (!amount) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount off (RM) is required.', path: ['amount_off_rm'] });
          }
        }),
      params: z.object({ code: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const currentCode = String(req.params.code || '').trim().toUpperCase();
      const newCode = String(req.validated.body.new_code || '').trim().toUpperCase();
      const type = req.validated.body.discount_type;
      const active = String(req.validated.body.active || '1') === '1';
      const appliesToShipping = String(req.validated.body.applies_to_shipping || '') === '1';

      const pctRaw = String(req.validated.body.percent_off || '').trim();
      const amtRaw = String(req.validated.body.amount_off_rm || '').trim();
      const percentOff = pctRaw ? Number.parseInt(pctRaw, 10) : null;
      const amountOffCents = amtRaw ? parseMoneyToCentsAllowZero(amtRaw) : null;

      if (type === 'FIXED' && (!Number.isFinite(amountOffCents) || amountOffCents <= 0)) {
        const err = new Error('Fixed amount must be greater than 0.');
        err.status = 400;
        throw err;
      }

      if (type === 'PERCENT' && (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 100)) {
        const err = new Error('Percent off must be between 1 and 100.');
        err.status = 400;
        throw err;
      }

      const maxRaw = String(req.validated.body.max_redemptions || '').trim();
      const max = maxRaw ? Number.parseInt(maxRaw, 10) : null;
      if (max != null && (!Number.isFinite(max) || max <= 0)) {
        const err = new Error('Invalid max redemptions.');
        err.status = 400;
        throw err;
      }

      const startDate = String(req.validated.body.start_date || '').trim() || null;
      const endDate = String(req.validated.body.end_date || '').trim() || null;

      let targetCode = currentCode;
      if (newCode && newCode !== currentCode) {
        promoRepo.renameCode(currentCode, newCode);
        targetCode = newCode;
      }

      promoRepo.update(targetCode, {
        discount_type: type,
        percent_off: type === 'PERCENT' ? percentOff : null,
        amount_off_cents: type === 'FIXED' ? amountOffCents : null,
        applies_to_shipping: appliesToShipping,
        active,
        max_redemptions: max,
        start_date: startDate,
        end_date: endDate,
      });

      req.session.flash = { type: 'success', message: 'Promo updated.' };
      return res.redirect('/admin/settings?promos_view=ALL#promos');
    } catch (e) {
      const msg = String(e?.message || '');
      const isSqliteUnique = /SQLITE_CONSTRAINT.*UNIQUE/i.test(msg);
      if (isSqliteUnique) {
        req.session.flash = { type: 'error', message: 'Promo code already exists.' };
        return res.redirect('/admin/settings?promos_view=ALL#promos');
      }
      if (e && (e.status === 400 || e.status === 404)) {
        req.session.flash = { type: 'error', message: e.message };
        return res.redirect('/admin/settings?promos_view=ALL#promos');
      }
      return next(e);
    }
  }
);

router.post(
  '/promos/:code/toggle',
  csrfProtection(),
  validate(
    z.object({
      body: z.object({ active: z.string() }),
      params: z.object({ code: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      promoRepo.setActive(req.params.code, String(req.validated.body.active) === '1');
      req.session.flash = { type: 'success', message: 'Promo updated.' };
      return res.redirect('/admin/settings?promos_view=ALL#promos');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/promos/:code/archive',
  csrfProtection(),
  validate(z.object({ body: z.any().optional(), params: z.object({ code: z.string() }), query: z.any().optional() })),
  (req, res, next) => {
    try {
      promoRepo.setArchived(req.params.code, true);
      req.session.flash = { type: 'success', message: 'Promo archived.' };
      return res.redirect('/admin/settings?promos_view=ALL#promos');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/promos/:code/restore',
  csrfProtection(),
  validate(z.object({ body: z.any().optional(), params: z.object({ code: z.string() }), query: z.any().optional() })),
  (req, res, next) => {
    try {
      promoRepo.setArchived(req.params.code, false);
      req.session.flash = { type: 'success', message: 'Promo restored.' };
      return res.redirect('/admin/settings?promos_view=ACTIVE#promos');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/categories',
  csrfProtection(),
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(80),
        visible: z.string().optional(),
        fiuu_account_id: z.string().trim().max(128).optional().or(z.literal('')),
      }),
      params: z.any().optional(),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const name = req.validated.body.name;
      let slug = slugifyCategory(name);
      slug = assertValidCategorySlug(slug);

      // Ensure uniqueness; auto-suffix if needed.
      let unique = slug;
      for (let i = 2; i < 50; i++) {
        const exists = categoryRepo.getBySlug(unique);
        if (!exists) break;
        unique = `${slug}-${i}`;
      }
      if (categoryRepo.getBySlug(unique)) {
        const err = new Error('Category slug already exists.');
        err.status = 400;
        throw err;
      }

      const visible = String(req.validated.body.visible || '1') === '1';
      categoryRepo.create({ slug: unique, name, visible });

      const selectedAccountId = String(req.validated.body.fiuu_account_id || '').trim();
      if (selectedAccountId) {
        fiuuAccountsService.setCategoryAccountForSlug({ slug: unique, accountId: selectedAccountId });
      } else {
        fiuuAccountsService.clearCategoryMappingForSlug(unique);
      }

      req.session.flash = { type: 'success', message: 'Category created.' };
      return res.redirect('/admin/categories');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/categories/:id',
  csrfProtection(),
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(80),
        fiuu_account_id: z.string().trim().max(128).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        const err = new Error('Invalid category id.');
        err.status = 400;
        throw err;
      }
      const current = categoryRepo.getById(id);
      if (!current) {
        const err = new Error('Category not found.');
        err.status = 404;
        throw err;
      }

      // Slugs are immutable after creation; update name only.
      categoryRepo.update(id, { name: req.validated.body.name });

      const selectedAccountId = String(req.validated.body.fiuu_account_id || '').trim();
      if (selectedAccountId) {
        fiuuAccountsService.setCategoryAccountForSlug({ slug: current.slug, accountId: selectedAccountId });
      } else {
        fiuuAccountsService.clearCategoryMappingForSlug(current.slug);
      }

      req.session.flash = { type: 'success', message: 'Category updated.' };
      return res.redirect('/admin/categories');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/categories/:id/image',
  upload.single('category_image'),
  csrfProtection({ ignoreMultipart: false }),
  validate(
    z.object({
      body: z.any().optional(),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        const err = new Error('Invalid category id.');
        err.status = 400;
        throw err;
      }
      const current = categoryRepo.getById(id);
      if (!current) {
        const err = new Error('Category not found.');
        err.status = 404;
        throw err;
      }

      const previousImageUrl = String(current.image_url || '').trim();

      if (!req.file) {
        const err = new Error('Please choose an image to upload.');
        err.status = 400;
        throw err;
      }

      // Use versioned filenames for categories so updates don't get stuck behind
      // long-lived immutable caching in production.
      const optimized = await imageService.optimizeAndSaveSiteContentImage(req.file.path, `category_${id}`);
      categoryRepo.setImageUrl(id, optimized);

      // Clean up the previous category image file (best-effort).
      if (previousImageUrl.startsWith('/uploads/site/')) {
        const file = previousImageUrl.slice('/uploads/site/'.length);
        const safe = file && !file.includes('/') && !file.includes('\\') && !file.includes('..');
        if (safe && file.startsWith(`site_category_${id}`) && file.endsWith('.webp')) {
          try {
            fs.unlinkSync(path.join(process.cwd(), 'storage', 'uploads', 'site', file));
          } catch (_) {
            // ignore
          }
        }
      }
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        // ignore
      }

      req.session.flash = { type: 'success', message: 'Category image updated.' };
      return res.redirect('/admin/categories');
    } catch (e) {
      // Clean up temp file on failure.
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {
          // ignore
        }
      }
      return next(e);
    }
  }
);

router.post(
  '/categories/:id/image/remove',
  csrfProtection(),
  validate(z.object({ body: z.any().optional(), params: z.object({ id: z.string() }), query: z.any().optional() })),
  (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        const err = new Error('Invalid category id.');
        err.status = 400;
        throw err;
      }

      const current = categoryRepo.getById(id);
      if (!current) {
        const err = new Error('Category not found.');
        err.status = 404;
        throw err;
      }

      const previousImageUrl = String(current.image_url || '').trim();
      categoryRepo.setImageUrl(id, '');

      // Remove the on-disk image file (best-effort).
      if (previousImageUrl.startsWith('/uploads/site/')) {
        const file = previousImageUrl.slice('/uploads/site/'.length);
        const safe = file && !file.includes('/') && !file.includes('\\') && !file.includes('..');
        if (safe && file.startsWith(`site_category_${id}`) && file.endsWith('.webp')) {
          try {
            fs.unlinkSync(path.join(process.cwd(), 'storage', 'uploads', 'site', file));
          } catch (_) {
            // ignore
          }
        }
      }

      req.session.flash = { type: 'success', message: 'Category image removed.' };
      return res.redirect('/admin/categories');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/categories/:id/visibility',
  csrfProtection(),
  validate(
    z.object({
      body: z.object({ visible: z.string() }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        const err = new Error('Invalid category id.');
        err.status = 400;
        throw err;
      }
      categoryRepo.setVisible(id, String(req.validated.body.visible) === '1');
      req.session.flash = { type: 'success', message: 'Category visibility updated.' };
      return res.redirect('/admin/categories');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/categories/:id/archive',
  csrfProtection(),
  validate(z.object({ body: z.any().optional(), params: z.object({ id: z.string() }), query: z.any().optional() })),
  (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        const err = new Error('Invalid category id.');
        err.status = 400;
        throw err;
      }
      categoryRepo.setArchived(id, true);
      req.session.flash = { type: 'success', message: 'Category archived.' };
      return res.redirect('/admin/categories?archived=ALL');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/categories/:id/restore',
  csrfProtection(),
  validate(z.object({ body: z.any().optional(), params: z.object({ id: z.string() }), query: z.any().optional() })),
  (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        const err = new Error('Invalid category id.');
        err.status = 400;
        throw err;
      }
      categoryRepo.setArchived(id, false);
      req.session.flash = { type: 'success', message: 'Category restored.' };
      return res.redirect('/admin/categories');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/site/home',
  upload.fields([
    { name: 'tcn_image', maxCount: 1 },
    { name: 'postmix_image', maxCount: 1 },
  ]),
  csrfProtection({ ignoreMultipart: false }),
  validate(z.object({ body: z.any().optional(), query: z.any().optional(), params: z.any().optional() })),
  async (req, res, next) => {
    try {
      const files = req.files || {};
      const tcnFile = (files.tcn_image && files.tcn_image[0]) ? files.tcn_image[0] : null;
      const postFile = (files.postmix_image && files.postmix_image[0]) ? files.postmix_image[0] : null;

      // Clean up any uploaded temp files from older UI.
      for (const f of [tcnFile, postFile]) {
        if (!f?.path) continue;
        try {
          fs.unlinkSync(f.path);
        } catch (_) {
          // ignore
        }
      }

      req.session.flash = { type: 'success', message: 'Home page cards now come from Categories. Manage them in Categories.' };
      return res.redirect('/admin/categories');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/site/promo',
  csrfProtection({ ignoreMultipart: true }),
  validate(z.object({ body: z.any().optional(), query: z.any().optional(), params: z.any().optional() })),
  (req, res) => {
    req.session.flash = { type: 'info', message: 'Promo management has moved to Admin → Settings → Promos.' };
    return res.redirect('/admin/settings#promos');
  }
);

router.get('/products', (req, res) => {
  function parseMoneyToCents(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    const n = Number(s.replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    if (n < 0) return null;
    return Math.round(n * 100);
  }

  const q = String(req.query.q || '').trim() || null;
  const includeArchived = String(req.query.includeArchived || '') === '1';

  const view = (String(req.query.view || '').trim().toLowerCase() === 'grid') ? 'grid' : 'list';

  const category = String(req.query.category || '').trim() || null;
  const visibility = String(req.query.visibility || '').trim().toUpperCase() || 'ALL';
  const archived = String(req.query.archived || '').trim().toUpperCase() || (includeArchived ? 'ALL' : 'ACTIVE');
  const stock = String(req.query.stock || '').trim().toUpperCase() || 'ALL';
  const minPriceCents = parseMoneyToCents(req.query.min_price);
  const maxPriceCents = parseMoneyToCents(req.query.max_price);
  const sort = String(req.query.sort || '').trim().toUpperCase() || 'NEWEST';

  const lowStockThreshold = (() => {
    const raw = String(settingsRepo.get('inventory.low_stock_threshold', '5') || '').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
  })();

  const { page, pageSize, offset, limit } = getPagination({
    page: req.query.page,
    pageSize: req.query.pageSize || 12,
  });

  const total = inventoryRepo.countAdmin({
    q,
    includeArchived,
    archived,
    category,
    visibility,
    stock,
    minPriceCents,
    maxPriceCents,
    lowStockThreshold,
  });

  const products = inventoryRepo.listAdmin({
    q,
    includeArchived,
    archived,
    category,
    visibility,
    stock,
    minPriceCents,
    maxPriceCents,
    sort,
    limit,
    offset,
    lowStockThreshold,
  });

  const pageCount = getPageCount(total, pageSize);

  const categories = categoryRepo.listAdmin({ includeArchived: true });

  const lowStockCount = inventoryRepo.countLowStockAdmin({ includeArchived: false, lowStockThreshold });

  res.render('admin/products', {
    title: 'Admin – Products',
    products,
    categories,
    q: q || '',
    includeArchived,
    view,
    category: category || '',
    visibility,
    archived,
    stock,
    min_price: String(req.query.min_price || '').trim(),
    max_price: String(req.query.max_price || '').trim(),
    sort,
    pageSize,
    page,
    pageCount,
    total,
    lowStockThreshold,
    lowStockCount,
  });
});

router.get('/products/new', (req, res) => {
  const categories = categoryRepo.listAdmin({ includeArchived: false });
  res.render('admin/product_form', { title: 'New Product', product: null, categories, images: [] });
});

router.post(
  '/products/new',
  upload.fields([
    { name: 'product_images', maxCount: 12 },
  ]),
  csrfProtection({ ignoreMultipart: false }),
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(200),
        description: z.string().trim().max(20000).optional().or(z.literal('')),
        description_html: z.string().trim().max(200000).optional().or(z.literal('')),
        category: z.string().trim().min(2).max(80),
        price: z.string(),
        cost_price: z.string().optional().or(z.literal('')),
        weight_kg: z.string().optional().or(z.literal('')),
        height_cm: z.string().optional().or(z.literal('')),
        length_cm: z.string().optional().or(z.literal('')),
        width_cm: z.string().optional().or(z.literal('')),
        stock: z.string(),
        visibility: z.string().optional(),
        archived: z.string().optional(),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const priceCents = parsePriceToCentsMinRM1(req.validated.body.price);
      const costPriceCents = req.validated.body.cost_price ? parseMoneyToCentsAllowZero(req.validated.body.cost_price) : null;
      const weightKg = parseNonNegativeNumberOrNull(req.validated.body.weight_kg, { label: 'Weight (kg)' });
      const heightCm = parseNonNegativeNumberOrNull(req.validated.body.height_cm, { label: 'Height (cm)' });
      const lengthCm = parseNonNegativeNumberOrNull(req.validated.body.length_cm, { label: 'Length (cm)' });
      const widthCm = parseNonNegativeNumberOrNull(req.validated.body.width_cm, { label: 'Width (cm)' });
      const stock = Math.max(0, Math.floor(Number(req.validated.body.stock)));

      const cat = categoryRepo.getBySlug(req.validated.body.category);
      if (!cat || cat.archived) {
        const err = new Error('Invalid category.');
        err.status = 400;
        throw err;
      }

      const created = inventoryRepo.create({
        name: req.validated.body.name,
        description: '',
        description_html: '',
        category: cat.slug,
        price: priceCents,
        cost_price: costPriceCents,
        weight_kg: weightKg,
        height_cm: heightCm,
        length_cm: lengthCm,
        width_cm: widthCm,
        stock,
        visibility: req.validated.body.visibility === '1',
        archived: req.validated.body.archived === '1',
        product_image: null,
      });

      const rawHtml = String(req.validated.body.description_html || '').trim();
      const cleanHtml = rawHtml ? sanitizeHtmlFragmentNoImages(rawHtml) : '';
      const descText = cleanHtml ? htmlToPlainText(cleanHtml) : String(req.validated.body.description || '').trim();
      inventoryRepo.update(created.product_id, { description: descText, description_html: cleanHtml });

      const files = req.files || {};
      const galleryFiles = Array.isArray(files.product_images) ? files.product_images : [];

      if (galleryFiles.length) {
        const primary = galleryFiles[0];
        const primaryUrl = await imageService.optimizeAndSaveProductImage(primary.path, created.product_id);
        inventoryRepo.update(created.product_id, { product_image: primaryUrl });
        try {
          fs.unlinkSync(primary.path);
        } catch (_) {
          // ignore
        }

        for (let i = 1; i < galleryFiles.length; i++) {
          const f = galleryFiles[i];
          const url = await imageService.optimizeAndSaveProductGalleryImage(f.path, created.product_id);
          productImageRepo.create({ productId: created.product_id, imageUrl: url, sortOrder: (i - 1) * 10 });
          try {
            fs.unlinkSync(f.path);
          } catch (_) {
            // ignore
          }
        }
      }

      // Audit: creation snapshot (treat as from "" to value).
      try {
        const after = inventoryRepo.getById(created.product_id);
        if (after) {
          const changes = computeFieldChanges({
            before: {},
            after,
            fields: [
              { key: 'name', label: 'Name' },
              { key: 'category', label: 'Category' },
              { key: 'price', label: 'Price (RM)', format: (v) => formatMoneyRm2(v) },
              { key: 'stock', label: 'Stock' },
              { key: 'visibility', label: 'Visible' },
              { key: 'archived', label: 'Archived' },
            ],
          });
          logAdminChange({
            req,
            verb: 'Created',
            entity: 'product',
            entityLabel: 'Product',
            entityId: created.product_id,
            changes,
            meta: { productName: after.name || null },
          });
        }
      } catch (_) {
        // ignore audit failures
      }

      req.session.flash = { type: 'success', message: 'Product created.' };
      return res.redirect('/admin/products');
    } catch (e) {
      return next(e);
    }
  }
);

router.get('/products/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  const product = inventoryRepo.getById(id);
  if (!product) return res.status(404).render('shared/error', { title: 'Not Found', message: 'Product not found.' });
  const categories = categoryRepo.listAdmin({ includeArchived: false });
  const images = productImageRepo.listByProductId(id);
  return res.render('admin/product_form', { title: 'Edit Product', product, categories, images });
});

// Convenience alias for breadcrumb navigation: /admin/products/:id -> /admin/products/:id/edit
router.get('/products/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!/^\d+$/.test(id)) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Product not found.' });
  }
  return res.redirect(`/admin/products/${id}/edit`);
});

router.post(
  '/products/:id/edit',
  upload.fields([
    { name: 'product_images', maxCount: 12 },
  ]),
  csrfProtection({ ignoreMultipart: false }),
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(200),
        description: z.string().trim().max(20000).optional().or(z.literal('')),
        description_html: z.string().trim().max(200000).optional().or(z.literal('')),
        category: z.string().trim().min(2).max(80),
        price: z.string(),
        cost_price: z.string().optional().or(z.literal('')),
        weight_kg: z.string().optional().or(z.literal('')),
        height_cm: z.string().optional().or(z.literal('')),
        length_cm: z.string().optional().or(z.literal('')),
        width_cm: z.string().optional().or(z.literal('')),
        stock: z.string(),
        visibility: z.string().optional(),
        archived: z.string().optional(),
      }),
      query: z.any().optional(),
      params: z.object({ id: z.string() }),
    })
  ),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = inventoryRepo.getById(id);
      if (!product) {
        return res.status(404).render('shared/error', { title: 'Not Found', message: 'Product not found.' });
      }

      const priceCents = parsePriceToCentsMinRM1(req.validated.body.price);
      const costPriceCents = req.validated.body.cost_price ? parseMoneyToCentsAllowZero(req.validated.body.cost_price) : null;
      const weightKg = parseNonNegativeNumberOrNull(req.validated.body.weight_kg, { label: 'Weight (kg)' });
      const heightCm = parseNonNegativeNumberOrNull(req.validated.body.height_cm, { label: 'Height (cm)' });
      const lengthCm = parseNonNegativeNumberOrNull(req.validated.body.length_cm, { label: 'Length (cm)' });
      const widthCm = parseNonNegativeNumberOrNull(req.validated.body.width_cm, { label: 'Width (cm)' });
      const stock = Math.max(0, Math.floor(Number(req.validated.body.stock)));

      const cat = categoryRepo.getBySlug(req.validated.body.category);
      if (!cat || cat.archived) {
        const err = new Error('Invalid category.');
        err.status = 400;
        throw err;
      }

      const rawHtml = String(req.validated.body.description_html || '').trim();
      const cleanHtml = rawHtml ? sanitizeHtmlFragmentNoImages(rawHtml) : '';
      const descText = cleanHtml ? htmlToPlainText(cleanHtml) : String(req.validated.body.description || '').trim();

      let imagePath = product.product_image;
      const files = req.files || {};
      const galleryFiles = Array.isArray(files.product_images) ? files.product_images : [];

      if (galleryFiles.length) {
        const primary = galleryFiles[0];
        imagePath = await imageService.optimizeAndSaveProductImage(primary.path, id);
        try {
          fs.unlinkSync(primary.path);
        } catch (_) {
          // ignore
        }

        for (let i = 1; i < galleryFiles.length; i++) {
          const f = galleryFiles[i];
          const url = await imageService.optimizeAndSaveProductGalleryImage(f.path, id);
          productImageRepo.create({ productId: id, imageUrl: url, sortOrder: (i - 1) * 10 });
          try {
            fs.unlinkSync(f.path);
          } catch (_) {
            // ignore
          }
        }
      }

      inventoryRepo.update(id, {
        name: req.validated.body.name,
        description: descText,
        description_html: cleanHtml,
        category: cat.slug,
        price: priceCents,
        cost_price: costPriceCents,
        weight_kg: weightKg,
        height_cm: heightCm,
        length_cm: lengthCm,
        width_cm: widthCm,
        stock,
        visibility: req.validated.body.visibility === '1',
        archived: req.validated.body.archived === '1',
        product_image: imagePath,
      });

      // Audit: field-level changes.
      try {
        const after = inventoryRepo.getById(id);
        if (after) {
          const changes = computeFieldChanges({
            before: {
              ...product,
              description_preview: previewValue(product.description || '', { max: 120 }),
            },
            after: {
              ...after,
              description_preview: previewValue(after.description || '', { max: 120 }),
            },
            fields: [
              { key: 'name', label: 'Name' },
              { key: 'category', label: 'Category' },
              { key: 'price', label: 'Price (RM)', format: (v) => formatMoneyRm2(v) },
              { key: 'cost_price', label: 'Cost (RM)', format: (v) => (v == null ? '' : formatMoneyRm2(v)) },
              { key: 'stock', label: 'Stock' },
              { key: 'visibility', label: 'Visible' },
              { key: 'archived', label: 'Archived' },
              { key: 'weight_kg', label: 'Weight (kg)' },
              { key: 'height_cm', label: 'Height (cm)' },
              { key: 'length_cm', label: 'Length (cm)' },
              { key: 'width_cm', label: 'Width (cm)' },
              { key: 'product_image', label: 'Main image' },
              { key: 'description_preview', label: 'Description' },
            ],
          });

          if (changes.length) {
            logAdminChange({
              req,
              verb: 'Updated',
              entity: 'product',
              entityLabel: 'Product',
              entityId: id,
              changes,
              meta: { productName: after.name || null },
            });
          }
        }
      } catch (_) {
        // ignore audit failures
      }

      req.session.flash = { type: 'success', message: 'Product updated.' };
      return res.redirect('/admin/products');
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/products/:id/images/:imageId/delete',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({ _csrf: z.string().optional() }).passthrough(),
      query: z.any().optional(),
      params: z.object({ id: z.string(), imageId: z.string() }),
    })
  ),
  (req, res, next) => {
    try {
      const productId = Number(req.params.id);
      const imageId = Number(req.params.imageId);
      if (!Number.isFinite(productId) || !Number.isFinite(imageId)) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid request.' });
      }

      const removed = productImageRepo.deleteById({ id: imageId, productId });

      // Audit: image removal.
      try {
        logAdminChange({
          req,
          verb: 'Deleted',
          entity: 'product_image',
          entityLabel: 'Product image',
          entityId: imageId,
          changes: [
            { field: 'product_id', label: 'Product', before: '', after: String(productId) },
            {
              field: 'image_url',
              label: 'Image URL',
              before: removed && removed.image_url ? String(removed.image_url) : '',
              after: '',
            },
          ],
          meta: { productId },
        });
      } catch (_) {
        // ignore audit failures
      }
      if (removed && removed.image_url) {
        const url = String(removed.image_url || '');
        if (url.startsWith('/uploads/products/')) {
          const fileName = path.posix.basename(url);
          if (/^product_\d+_[0-9a-f]{16}\.webp$/i.test(fileName)) {
            const fullPath = path.join(process.cwd(), 'storage', 'uploads', 'products', fileName);
            try {
              fs.unlinkSync(fullPath);
            } catch (_) {
              // ignore
            }
          }
        }
      }

      req.session.flash = { type: 'success', message: 'Image deleted.' };
      return res.redirect(`/admin/products/${productId}/edit`);
    } catch (e) {
      return next(e);
    }
  }
);

router.get('/orders', (req, res) => {
  const q = String(req.query.q || '').trim() || null;
  const payment_status = String(req.query.payment_status || '').trim() || null;
  const payment_method = String(req.query.payment_method || '').trim() || null;
  const fulfilment_status = String(req.query.fulfilment_status || '').trim() || null;
  const refund_status = String(req.query.refund_status || '').trim() || null;
  const date_from = String(req.query.date_from || '').trim() || null;
  const date_to = String(req.query.date_to || '').trim() || null;
  const { page, pageSize, offset, limit } = getPagination({ page: req.query.page, pageSize: 12 });

  const total = orderRepo.countAdminFiltered({ q, payment_status, payment_method, fulfilment_status, refund_status, date_from, date_to });
  const orders = orderRepo.listAdminFiltered({ q, payment_status, payment_method, fulfilment_status, refund_status, date_from, date_to, limit, offset });
  const pageCount = getPageCount(total, pageSize);

  return res.render('admin/orders', {
    title: 'Admin – Orders',
    orders,
    q: q || '',
    payment_status: payment_status || '',
    payment_method: payment_method || '',
    fulfilment_status: fulfilment_status || '',
    refund_status: refund_status || '',
    date_from: date_from || '',
    date_to: date_to || '',
    page,
    pageCount,
    total,
  });
});

router.get('/orders/:id', (req, res) => {
  const raw = String(req.params.id || '').trim();
  const numeric = Number(raw);
  const resolvedId = Number.isFinite(numeric) && numeric > 0 ? numeric : (orderRepo.getByCode(raw)?.order_id || null);
  const id = resolvedId;
  const order = id ? orderRepo.getWithItems(id) : null;
  if (!order) return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });

  const promo = orderRepo.getPromoForOrder(id);
  const refunds = orderRefundRepo.listByOrder(id);
  const extraRefunds = orderRefundExtraRepo.listByOrder(id);
  const statusHistory = orderRepo.listStatusHistory(id);
  const refundSummary = orderRefundRepo.summaryByOrder(id);
  const refundSummaryConfirmed = orderRefundRepo.summaryConfirmedByOrder(id);
  const extraRefundSummary = orderRefundExtraRepo.summaryByOrder(id);
  const extraRefundSummaryConfirmed = orderRefundExtraRepo.summaryConfirmedByOrder(id);
  const combinedRefundSummary = {
    amount_refunded: Number(refundSummary.amount_refunded || 0) + Number(extraRefundSummary.amount_refunded || 0),
  };
  const combinedRefundSummaryConfirmed = {
    amount_refunded:
      Number(refundSummaryConfirmed.amount_refunded || 0) + Number(extraRefundSummaryConfirmed.amount_refunded || 0),
  };
  const refundableRemainingCents = Math.max(
    0,
    Number(order.total_amount || 0) - Number(combinedRefundSummaryConfirmed.amount_refunded || 0)
  );
  const refundByItem = orderRefundRepo.summariesByOrder(id);
  const refundByItemConfirmed = orderRefundRepo.summariesConfirmedByOrder(id);

  return res.render('admin/order_detail', {
    title: `Admin – Order ${order.order_code || `#${order.order_id}`}`,
    order,
    promo,
    offline: orderRepo.getOfflineTransfer(id),
    refunds,
    extraRefunds,
    statusHistory,
    refundSummary,
    refundSummaryConfirmed,
    extraRefundSummary,
    extraRefundSummaryConfirmed,
    combinedRefundSummary,
    combinedRefundSummaryConfirmed,
    refundableRemainingCents,
    refundByItem,
    refundByItemConfirmed,
  });
});

router.post(
  '/orders/:id/admin-note',
  csrfProtection(),
  validate(
    z.object({
      body: z.object({
        admin_note: z.string().trim().max(4000).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const orderId = Number(req.params.id);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order id.' });
      }
      const order = orderRepo.getById(orderId);
      if (!order) return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });

      orderRepo.updateAdminNote(orderId, req.validated.body.admin_note || '');
      req.session.flash = { type: 'success', message: 'Internal note updated.' };
      return res.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/orders/:id/items/:itemId/refund',
  validate(
    z.object({
      body: z.object({
        quantity: z.string().trim().min(1).max(10),
        amount: z.string().trim().max(32).optional().or(z.literal('')),
        reason: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string(), itemId: z.string() }),
      query: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    let qty;
    let amountCents;
    let reason;
    try {
      const actor = req.session?.user?.isAdmin
        ? { user_id: req.session.user.user_id, username: req.session.user.username }
        : null;

      const orderId = Number(req.params.id);
      const orderItemId = Number(req.params.itemId);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order id.' });
      }
      if (!Number.isFinite(orderItemId) || orderItemId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order item id.' });
      }

      const order = orderRepo.getById(orderId);
      if (order && order.payment_method === 'ONLINE' && /^FPX/i.test(String(order.payment_channel || ''))) {
        req.session.flash = { type: 'error', message: 'Refund via Fiuu is disabled for FPX payments. Refund must be processed manually.' };
        return res.redirect(`/admin/orders/${orderId}`);
      }

      qty = Math.floor(Number(req.validated.body.quantity));
      amountCents = req.validated.body.amount ? parseMoneyToCentsAllowZero(req.validated.body.amount) : null;
      reason = req.validated.body.reason ? String(req.validated.body.reason).trim() : '';

      const refundResult = await refundService.refundOrderItem({
        orderId,
        orderItemId,
        quantityRefunded: qty,
        amountRefunded: amountCents,
        reason,
        actor,
      });

      // Best-effort customer email (do not notify staff).
      try {
        const updatedOrder = orderRepo.getWithItems(orderId);
        const item = (updatedOrder?.items || []).find((it) => Number(it.id) === Number(orderItemId));
        const actualRefundCents = Number(refundResult?.created?.amount_refunded || 0);
        const rm = (actualRefundCents / 100).toFixed(2);
        const statusEvent = (updatedOrder?.refund_status || 'NONE') === 'FULL_REFUND' ? 'FULL_REFUND' : 'PARTIAL_REFUND';
        const noteParts = [];
        noteParts.push(`Refunded ${item ? item.product_name_snapshot : `item #${orderItemId}`} x${qty}`);
        noteParts.push(`Amount: RM ${rm}`);
        if (reason) noteParts.push(`Reason: ${reason}`);
        emailService.sendOrderStatusChangedEmailToCustomer({
          order: updatedOrder,
          event: statusEvent,
          note: noteParts.join(' • '),
        });
      } catch (_) {
        // ignore
      }

      req.session.flash = { type: 'success', message: 'Refund request sent to Fiuu.' };
      return res.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      // Notify both customer service + customer on refund request failure.
      try {
        const order = orderRepo.getWithItems(Number(req.params.id));
        const item = (order?.items || []).find((it) => Number(it.id) === Number(req.params.itemId));

        // Amount to report: use user input if provided; else fall back to the last failed attempt row (if any).
        let reportAmountCents = amountCents == null ? null : Number(amountCents);
        let reportQty = qty;
        let reportReason = reason;

        const refunds = orderRefundRepo.listByOrder(Number(req.params.id));
        const latestForItem = (refunds || []).find((r) => Number(r.order_item_id) === Number(req.params.itemId) && String(r.provider || '') === 'FIUU');
        if (latestForItem && String(latestForItem.provider_status || '') === 'FAILED') {
          if (reportAmountCents == null) reportAmountCents = Number(latestForItem.amount_refunded || 0);
          if (!Number.isFinite(reportQty) || reportQty <= 0) reportQty = Number(latestForItem.quantity_refunded || 0);
          if (!reportReason) reportReason = String(latestForItem.reason || '').trim();
        }
        if (reportAmountCents == null) reportAmountCents = 0;

        await emailService.sendRefundRequestFailedEmail({
          order,
          toCustomerEmail: order?.email,
          itemLabel: item ? item.product_name_snapshot : `Item #${req.params.itemId}`,
          qty: reportQty,
          amountCents: reportAmountCents,
          reason: reportReason,
          errorMessage: String(e && e.message ? e.message : 'Refund request failed'),
        });
      } catch (_) {
        // ignore
      }

      const errMsg = String(e && e.message ? e.message : 'Refund request failed');
      req.session.flash = {
        type: 'error',
        message: `Refund request to Fiuu failed: ${errMsg}. An email notification has been sent.`,
      };
      return res.redirect(`/admin/orders/${Number(req.params.id)}`);
    }
  }
);

router.post(
  '/orders/:id/refund',
  validate(
    z.object({
      body: z.object({
        amount: z.string().trim().min(1).max(32),
        reason: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const actor = req.session?.user?.isAdmin
        ? { user_id: req.session.user.user_id, username: req.session.user.username }
        : null;

      const orderId = Number(req.params.id);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order id.' });
      }

      const order = orderRepo.getById(orderId);
      if (order && order.payment_method === 'ONLINE' && /^FPX/i.test(String(order.payment_channel || ''))) {
        req.session.flash = { type: 'error', message: 'Refund via Fiuu is disabled for FPX payments. Refund must be processed manually.' };
        return res.redirect(`/admin/orders/${orderId}`);
      }

      const amountCents = parseMoneyToCentsAllowZero(req.validated.body.amount);
      if (amountCents == null) {
        const err = new Error('Refund amount is required.');
        err.status = 400;
        throw err;
      }
      const reason = req.validated.body.reason ? String(req.validated.body.reason).trim() : '';

      await refundService.refundOrderExtraAmount({
        orderId,
        amountRefunded: amountCents,
        reason,
        actor,
      });

      req.session.flash = { type: 'success', message: 'Refund request sent to Fiuu.' };
      return res.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      const errMsg = String(e && e.message ? e.message : 'Refund request failed');
      req.session.flash = { type: 'error', message: `Refund request to Fiuu failed: ${errMsg}.` };
      return res.redirect(`/admin/orders/${Number(req.params.id)}`);
    }
  }
);

router.post(
  '/orders/:id/refund/manual',
  validate(
    z.object({
      body: z.object({
        amount: z.string().trim().min(1).max(32),
        reason: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const actor = req.session?.user?.isAdmin
        ? { user_id: req.session.user.user_id, username: req.session.user.username }
        : null;

      const orderId = Number(req.params.id);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order id.' });
      }

      const order = orderRepo.getWithItems(orderId);
      if (!order) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }

      if (order.payment_method !== 'OFFLINE_TRANSFER') {
        const err = new Error('Manual refund is only available for OFFLINE_TRANSFER orders.');
        err.status = 400;
        throw err;
      }

      if (order.payment_status !== 'PAID' && order.payment_status !== 'PARTIALLY_REFUNDED' && order.payment_status !== 'REFUNDED') {
        const err = new Error('Order must be PAID before recording a refund.');
        err.status = 400;
        throw err;
      }

      const amountCents = parseMoneyToCentsAllowZero(req.validated.body.amount);
      if (amountCents == null) {
        const err = new Error('Refund amount is required.');
        err.status = 400;
        throw err;
      }

      const confirmedItems = orderRefundRepo.summaryConfirmedByOrder(orderId);
      const confirmedExtra = orderRefundExtraRepo.summaryConfirmedByOrder(orderId);
      const confirmedAmount =
        Number(confirmedItems.amount_refunded || 0) + Number(confirmedExtra.amount_refunded || 0);
      const paidAmount = Number(order.total_amount || 0);
      const remainingAmount = Math.max(0, paidAmount - confirmedAmount);
      if (amountCents > remainingAmount) {
        const err = new Error('Refund amount exceeds remaining refundable amount for this order.');
        err.status = 400;
        throw err;
      }

      const reason = req.validated.body.reason ? String(req.validated.body.reason).trim() : '';

      orderRefundExtraRepo.create({
        orderId,
        amountRefunded: amountCents,
        reason: reason || 'Manual refund (offline transfer)',
        provider: 'MANUAL',
        providerRefId: null,
        providerTxnId: null,
        providerRefundId: null,
        providerStatus: 'MARKED',
        providerReason: null,
        providerSignatureOk: null,
        providerResponseJson: null,
      });

      refundService.refreshOrderRefundStatus({ orderId, actor });
      req.session.flash = { type: 'success', message: 'Refund recorded (manual).' };
      return res.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      // For expected validation failures (e.g. exceeding refundable amount), don't send admins
      // to the generic error page; show a flash message and return to the order view.
      if (e && (e.status === 400 || e.status === 422)) {
        req.session.flash = {
          type: 'error',
          message: String(e && e.message ? e.message : 'Failed to record refund.'),
        };
        return res.redirect(`/admin/orders/${Number(req.params.id)}`);
      }

      return next(e);
    }
  }
);

router.post(
  '/orders/:id/items/:itemId/refund/mark',
  validate(
    z.object({
      body: z.object({
        quantity: z.string().trim().min(1).max(10),
        amount: z.string().trim().min(1).max(32),
        note: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string(), itemId: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const actor = req.session?.user?.isAdmin
        ? { user_id: req.session.user.user_id, username: req.session.user.username }
        : null;

      const orderId = Number(req.params.id);
      const orderItemId = Number(req.params.itemId);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order id.' });
      }
      if (!Number.isFinite(orderItemId) || orderItemId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order item id.' });
      }

      const order = orderRepo.getWithItems(orderId);
      if (!order) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }

      if (order.payment_method !== 'ONLINE' || (order.payment_status !== 'PAID' && order.payment_status !== 'REFUNDED')) {
        const err = new Error('Order must be an ONLINE order and PAID to mark a refund.');
        err.status = 400;
        throw err;
      }

      const refunds = orderRefundRepo.listByOrder(orderId);
      const latestFiuuForItem = (refunds || []).find(
        (r) => Number(r.order_item_id) === orderItemId && String(r.provider || '') === 'FIUU'
      );

      if (!latestFiuuForItem || String(latestFiuuForItem.provider_status || '') !== 'FAILED') {
        const err = new Error('Manual mark is only allowed when the latest FIUU refund request failed for this item.');
        err.status = 400;
        throw err;
      }

      const item = (order.items || []).find((it) => Number(it.id) === orderItemId);
      if (!item) {
        const err = new Error('Order item not found');
        err.status = 404;
        throw err;
      }

      const qty = Math.floor(Number(req.validated.body.quantity));
      if (!Number.isFinite(qty) || qty <= 0) {
        const err = new Error('Refund quantity must be a positive number.');
        err.status = 400;
        throw err;
      }

      const amountCents = parseMoneyToCentsAllowZero(req.validated.body.amount);
      const note = req.validated.body.note ? String(req.validated.body.note).trim() : '';

      // Ensure we don't exceed remaining refundable quantity (based on requested/excluding failures).
      const itemSummary = orderRefundRepo.summaryByOrderItem(orderItemId);
      const alreadyQty = Number(itemSummary.quantity_refunded || 0);
      const remainingQty = Math.max(0, Number(item.quantity || 0) - alreadyQty);
      if (qty > remainingQty) {
        const err = new Error('Refund quantity exceeds remaining refundable quantity.');
        err.status = 400;
        throw err;
      }

      orderRefundRepo.create({
        orderId,
        orderItemId,
        productId: item.product_id,
        quantityRefunded: qty,
        amountRefunded: amountCents,
        reason: note || 'Manually marked as refunded after FIUU failure',
        provider: 'MANUAL',
        providerRefId: null,
        providerTxnId: null,
        providerRefundId: null,
        providerStatus: 'MARKED',
        providerReason: null,
        providerSignatureOk: null,
        providerResponseJson: null,
      });

      refundService.refreshOrderRefundStatus({ orderId, actor });
      req.session.flash = { type: 'success', message: 'Refund marked as completed (manual).' };
      return res.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/orders/:id/items/:itemId/refund/manual',
  validate(
    z.object({
      body: z.object({
        quantity: z.string().trim().min(1).max(10),
        amount: z.string().trim().max(32).optional().or(z.literal('')),
        note: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string(), itemId: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    function allocateDiscountAcrossItems({ items, discountAmount }) {
      const discount = Math.max(0, Number(discountAmount || 0));
      const totalSubtotal = items.reduce((sum, it) => sum + Math.max(0, Number(it.subtotal || 0)), 0);
      const effectiveDiscount = Math.min(discount, totalSubtotal);
      if (!effectiveDiscount || !totalSubtotal) {
        return items.map((it) => ({ orderItemId: it.id, allocatedDiscount: 0 }));
      }

      let allocatedSoFar = 0;
      const allocations = items.map((it, idx) => {
        const subtotal = Math.max(0, Number(it.subtotal || 0));
        let allocated = Math.floor((effectiveDiscount * subtotal) / totalSubtotal);
        if (idx === items.length - 1) allocated = Math.max(0, effectiveDiscount - allocatedSoFar);
        allocatedSoFar += allocated;
        return { orderItemId: it.id, allocatedDiscount: allocated };
      });

      return allocations;
    }

    function computeDefaultRefundAmountCents({ order, promo, orderItem, quantityToRefund }) {
      const qty = Number(orderItem.quantity || 0);
      const q = Number(quantityToRefund || 0);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(q) || q <= 0) return 0;

      const items = Array.isArray(order.items) ? order.items : [];
      const discountAmount = promo && !promo.applies_to_shipping ? Number(promo.discount_amount || 0) : 0;
      const allocations = allocateDiscountAcrossItems({ items, discountAmount });
      const alloc = allocations.find((a) => a.orderItemId === orderItem.id);
      const allocatedDiscount = alloc ? Number(alloc.allocatedDiscount || 0) : 0;
      const unitPrice = Math.max(0, Number(orderItem.price_snapshot || 0));
      const lineSubtotal = unitPrice * qty;
      const netPaidForLine = Math.max(0, lineSubtotal - allocatedDiscount);
      return Math.round((netPaidForLine * q) / qty);
    }

    try {
      const actor = req.session?.user?.isAdmin
        ? { user_id: req.session.user.user_id, username: req.session.user.username }
        : null;

      const orderId = Number(req.params.id);
      const orderItemId = Number(req.params.itemId);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order id.' });
      }
      if (!Number.isFinite(orderItemId) || orderItemId <= 0) {
        return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid order item id.' });
      }

      const order = orderRepo.getWithItems(orderId);
      if (!order) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }

      if (order.payment_method !== 'OFFLINE_TRANSFER') {
        const err = new Error('Manual refund is only available for OFFLINE_TRANSFER orders.');
        err.status = 400;
        throw err;
      }

      if (order.payment_status !== 'PAID' && order.payment_status !== 'PARTIALLY_REFUNDED' && order.payment_status !== 'REFUNDED') {
        const err = new Error('Order must be PAID before recording a refund.');
        err.status = 400;
        throw err;
      }

      const item = (order.items || []).find((it) => Number(it.id) === orderItemId);
      if (!item) {
        const err = new Error('Order item not found');
        err.status = 404;
        throw err;
      }

      const qty = Math.floor(Number(req.validated.body.quantity));
      if (!Number.isFinite(qty) || qty <= 0) {
        const err = new Error('Refund quantity must be a positive number.');
        err.status = 400;
        throw err;
      }

      const itemSummary = orderRefundRepo.summaryByOrderItem(orderItemId);
      const alreadyQty = Number(itemSummary.quantity_refunded || 0);
      const alreadyAmount = Number(itemSummary.amount_refunded || 0);
      const remainingQty = Math.max(0, Number(item.quantity || 0) - alreadyQty);
      if (qty > remainingQty) {
        const err = new Error('Refund quantity exceeds remaining refundable quantity.');
        err.status = 400;
        throw err;
      }

      const promo = orderRepo.getPromoForOrder(orderId);
      const defaultAmount = computeDefaultRefundAmountCents({ order, promo, orderItem: item, quantityToRefund: qty });

      let amountCents = req.validated.body.amount ? parseMoneyToCentsAllowZero(req.validated.body.amount) : null;
      const isAutoAmount = amountCents == null;
      if (isAutoAmount) amountCents = defaultAmount;

      // Remaining refundable for this item is based on the *full* line max refundable,
      // minus any already-recorded refunded amount. Using remainingQty here is incorrect
      // and can break sequential refunds due to rounding.
      const maxForLineTotal = computeDefaultRefundAmountCents({
        order,
        promo,
        orderItem: item,
        quantityToRefund: Number(item.quantity || 0),
      });
      const remainingAmount = Math.max(0, maxForLineTotal - alreadyAmount);

      // If refunding the last remaining quantity and amount is left blank,
      // refund the exact remaining cents to avoid rounding drift.
      if (isAutoAmount && qty === remainingQty) {
        amountCents = remainingAmount;
      }

      if (amountCents > remainingAmount) {
        const err = new Error('Refund amount exceeds remaining refundable amount for this item.');
        err.status = 400;
        throw err;
      }

      const note = req.validated.body.note ? String(req.validated.body.note).trim() : '';

      orderRefundRepo.create({
        orderId,
        orderItemId,
        productId: item.product_id,
        quantityRefunded: qty,
        amountRefunded: amountCents,
        reason: note || 'Manual refund (offline transfer)',
        provider: 'MANUAL',
        providerRefId: null,
        providerTxnId: null,
        providerRefundId: null,
        providerStatus: 'MARKED',
        providerReason: null,
        providerSignatureOk: null,
        providerResponseJson: null,
      });

      refundService.refreshOrderRefundStatus({ orderId, actor });
      req.session.flash = { type: 'success', message: 'Refund recorded (manual).' };
      return res.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      // For expected validation failures (e.g. exceeding refundable amount), don't send admins
      // to the generic error page; show a flash message and return to the order view.
      if (e && (e.status === 400 || e.status === 422)) {
        req.session.flash = {
          type: 'error',
          message: String(e && e.message ? e.message : 'Failed to record refund.'),
        };
        return res.redirect(`/admin/orders/${Number(req.params.id)}`);
      }
      return next(e);
    }
  }
);

router.post(
  '/orders/:id/fulfilment-status',
  validate(
    z.object({
      body: z.object({
        fulfilment_status: z.enum(['NEW', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED']),
        note: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const actor = req.session?.user?.isAdmin
        ? { user_id: req.session.user.user_id, username: req.session.user.username }
        : null;

      const orderId = Number(req.params.id);
      const order = orderRepo.getById(orderId);
      if (!order) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }

      const newStatus = req.validated.body.fulfilment_status;
      const note = req.validated.body.note ? String(req.validated.body.note).trim() : '';
      const oldStatus = order.fulfilment_status;
      orderRepo.updateFulfilmentStatus(orderId, newStatus, note || `Admin updated fulfilment to ${newStatus}`, actor);

      // Best-effort customer email
      try {
        const updated = orderRepo.getById(orderId);
        if (updated) {
          emailService.sendOrderStatusChangedEmailToCustomer({
            order: updated,
            event: 'FULFILMENT_STATUS',
            note: note || `Fulfilment updated to ${newStatus}`,
          });
        }
      } catch (_) {
        // ignore
      }

      req.session.flash = { type: 'success', message: 'Fulfilment status updated.' };
      return res.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      return next(e);
    }
  }
);

router.post(
  '/orders/:id/payment-status',
  validate(
    z.object({
      body: z.object({
        payment_status: z.enum(['PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'AWAITING_VERIFICATION']),
        note: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const actor = req.session?.user?.isAdmin
        ? { user_id: req.session.user.user_id, username: req.session.user.username }
        : null;

      const orderId = Number(req.params.id);
      const order = orderRepo.getById(orderId);
      if (!order) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }

      const newStatus = req.validated.body.payment_status;
      const note = req.validated.body.note ? String(req.validated.body.note).trim() : '';

      const oldStatus = order.payment_status;

      if (newStatus === 'PAID') {
        orderService.markOrderPaidAndDeductStock({ orderId, note: note || 'Payment marked as PAID by admin', actor });
      } else {
        orderRepo.updatePaymentStatus(orderId, newStatus, note || `Admin updated payment to ${newStatus}`, actor);
      }

      // Best-effort customer email
      try {
        const updated = orderRepo.getById(orderId);
        if (updated) {
          emailService.sendOrderStatusChangedEmailToCustomer({
            order: updated,
            event: 'PAYMENT_STATUS',
            note: note || `Payment updated to ${newStatus}`,
          });
        }
      } catch (_) {
        // ignore
      }

      req.session.flash = { type: 'success', message: 'Payment status updated.' };
      return res.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      return next(e);
    }
  }
);

router.post('/orders/:id/offline/verify', (req, res, next) => {
  try {
    const actor = req.session?.user?.isAdmin
      ? { user_id: req.session.user.user_id, username: req.session.user.username }
      : null;

    const orderId = Number(req.params.id);
    const order = orderRepo.getById(orderId);
    if (!order) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }
    if (order.payment_method !== 'OFFLINE_TRANSFER') {
      const err = new Error('This order is not an offline bank transfer order');
      err.status = 400;
      throw err;
    }

    if (order.payment_status === 'PAID') {
      req.session.flash = { type: 'info', message: 'Order is already marked as PAID.' };
      return res.redirect(`/admin/orders/${orderId}`);
    }

    const offline = orderRepo.getOfflineTransfer(orderId);
    if (!offline) {
      const err = new Error('Slip not found');
      err.status = 404;
      throw err;
    }

    if (offline.verified) {
      req.session.flash = { type: 'info', message: 'Slip is already verified.' };
      return res.redirect(`/admin/orders/${orderId}`);
    }

    orderRepo.setOfflineTransferVerified(orderId, true);
  orderService.markOrderPaidAndDeductStock({ orderId, note: 'Offline transfer verified by admin', actor });

    // Best-effort customer email
    try {
      const updated = orderRepo.getById(orderId);
      if (updated) {
        emailService.sendOrderStatusChangedEmailToCustomer({
          order: updated,
          event: 'OFFLINE_VERIFIED',
          note: 'Your offline bank transfer has been verified. Payment is marked as PAID.',
        });
      }
    } catch (_) {
      // ignore
    }

    req.session.flash = { type: 'success', message: 'Offline payment verified; payment marked as paid.' };
    return res.redirect(`/admin/orders/${orderId}`);
  } catch (e) {
    return next(e);
  }
});

router.post('/orders/:id/offline/reject', (req, res, next) => {
  try {
    const actor = req.session?.user?.isAdmin
      ? { user_id: req.session.user.user_id, username: req.session.user.username }
      : null;

    const orderId = Number(req.params.id);
    const order = orderRepo.getById(orderId);
    if (!order) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }
    if (order.payment_method !== 'OFFLINE_TRANSFER') {
      const err = new Error('This order is not an offline bank transfer order');
      err.status = 400;
      throw err;
    }

    if (order.payment_status === 'PAID') {
      const err = new Error('Cannot reject slip for a PAID order. Set payment status first if needed.');
      err.status = 400;
      throw err;
    }

    const offline = orderRepo.getOfflineTransfer(orderId);
    if (!offline) {
      const err = new Error('Slip not found');
      err.status = 404;
      throw err;
    }

    if (offline.verified) {
      req.session.flash = { type: 'info', message: 'Slip is already verified.' };
      return res.redirect(`/admin/orders/${orderId}`);
    }

    const rejectionReason = String(req.body?.rejection_reason || '').trim();
    orderRepo.rejectOfflineTransfer({ orderId, reason: rejectionReason });

    const note = rejectionReason ? `Slip rejected by admin: ${rejectionReason}` : 'Slip rejected by admin';
  orderRepo.insertStatusHistory(orderId, 'PAYMENT', 'AWAITING_VERIFICATION', 'AWAITING_VERIFICATION', note, actor);

    // Best-effort customer email
    try {
      const updated = orderRepo.getById(orderId);
      if (updated) {
        const customerNote = rejectionReason
          ? `Your bank transfer slip was rejected: ${rejectionReason}`
          : 'Your bank transfer slip was rejected. Please re-upload a clear slip with the correct reference.';
        emailService.sendOrderStatusChangedEmailToCustomer({
          order: updated,
          event: 'OFFLINE_REJECTED',
          note: customerNote,
        });
      }
    } catch (_) {
      // ignore
    }

    req.session.flash = { type: 'success', message: 'Slip rejected (customer may re-upload).' };
    return res.redirect(`/admin/orders/${orderId}`);
  } catch (e) {
    return next(e);
  }
});

router.get('/slips', (req, res) => {
  req.session.flash = { type: 'success', message: 'Bank slips page removed. Review slips inside each order.' };
  return res.redirect('/admin/orders');
});

router.get('/notifications', (req, res) => {
  // Avoid stale read/unread state when navigating back from an opened notification.
  res.setHeader('Cache-Control', 'private, no-store');

  const { page, pageSize, offset, limit } = getPagination({ page: req.query.page, pageSize: 20 });
  const total = adminNotificationRepo.countAll();
  const rows = adminNotificationRepo.list({ limit, offset });
  const pageCount = getPageCount(total, pageSize);
  const unreadCount = adminNotificationRepo.countUnread();
  return res.render('admin/notifications', {
    title: 'Admin – Notifications',
    rows,
    page,
    pageCount,
    total,
    unreadCount,
  });
});

router.get('/contact-messages', (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  const q = String(req.query.q || '').trim() || '';
  const statusRaw = String(req.query.status || 'ALL').trim().toUpperCase();
  const status = statusRaw === 'NEW' || statusRaw === 'READ' || statusRaw === 'ALL' ? statusRaw : 'ALL';

  const { page, pageSize, offset, limit } = getPagination({ page: req.query.page, pageSize: 20 });
  const total = contactMessageRepo.countAdmin({ q: q || null, status });
  const rows = contactMessageRepo.listAdmin({ q: q || null, status, limit, offset });
  const pageCount = getPageCount(total, pageSize);

  return res.render('admin/contact_messages', {
    title: 'Admin – Contact messages',
    q,
    status,
    total,
    rows,
    page,
    pageCount,
  });
});

router.get('/contact-messages/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid message id.' });
  }

  const message = contactMessageRepo.getById(id);
  if (!message) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Message not found.' });
  }

  if (!message.is_read) contactMessageRepo.markRead(id, true);
  const refreshed = contactMessageRepo.getById(id) || message;

  return res.render('admin/contact_message_detail', {
    title: `Admin – Contact message #${id}`,
    message: refreshed,
  });
});

router.post(
  '/contact-messages/:id/read',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({ _csrf: z.string().optional() }).passthrough(),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid message id.' });
    }
    contactMessageRepo.markRead(id, true);
    return res.redirect(`/admin/contact-messages/${id}`);
  }
);

router.post(
  '/contact-messages/:id/unread',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({ _csrf: z.string().optional() }).passthrough(),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid message id.' });
    }
    contactMessageRepo.markRead(id, false);
    return res.redirect(`/admin/contact-messages/${id}`);
  }
);

router.post(
  '/contact-messages/:id/delete',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({ _csrf: z.string().optional() }).passthrough(),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid message id.' });
    }
    contactMessageRepo.deleteById(id);
    req.session.flash = { type: 'success', message: 'Message deleted.' };
    return res.redirect('/admin/contact-messages');
  }
);

router.get('/notifications/:id/open', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid notification id.' });
  }

  const n = adminNotificationRepo.getById(id);
  if (!n) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Notification not found.' });
  }

  adminNotificationRepo.markRead(id);

  const link = String(n.link || '').trim();
  if (link) return res.redirect(link);
  return res.redirect('/admin/notifications');
});

router.get('/notifications/unread-count.json', (req, res) => {
  const unreadCount = adminNotificationRepo.countUnread();
  return res.json({ unreadCount });
});

router.get('/notifications/poll.json', (req, res) => {
  const unreadCount = adminNotificationRepo.countUnread();
  const latest = adminNotificationRepo.getLatestUnread();
  return res.json({
    unreadCount,
    latest: latest
      ? {
          id: latest.id,
          type: latest.type,
          title: latest.title,
          body: latest.body,
          link: latest.link,
          openUrl: `/admin/notifications/${latest.id}/open`,
          created_at: latest.created_at,
        }
      : null,
  });
});

router.get('/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  function buildPayload() {
    const unreadCount = adminNotificationRepo.countUnread();
    const latest = adminNotificationRepo.getLatestUnread();
    return {
      unreadCount,
      latest: latest
        ? {
            id: latest.id,
            type: latest.type,
            title: latest.title,
            body: latest.body,
            link: latest.link,
            openUrl: `/admin/notifications/${latest.id}/open`,
            created_at: latest.created_at,
          }
        : null,
    };
  }

  function send(payload) {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (_) {
      // ignore
    }
  }

  // Initial state.
  send(buildPayload());

  const onChanged = () => send(buildPayload());
  adminNotificationRepo.events.on('changed', onChanged);

  // Keep-alive to prevent idle timeouts.
  const keepAlive = setInterval(() => {
    try {
      res.write(`event: ping\ndata: {}\n\n`);
    } catch (_) {
      // ignore
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    adminNotificationRepo.events.off('changed', onChanged);
  });
});

router.post('/notifications/read-all', (req, res) => {
  adminNotificationRepo.markAllRead();
  req.session.flash = { type: 'success', message: 'All notifications marked as read.' };
  return res.redirect('/admin/notifications');
});

router.post(
  '/notifications/:id/read',
  validate(
    z.object({
      body: z.any().optional(),
      params: z.object({ id: z.string() }),
      query: z.any().optional(),
    })
  ),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).render('shared/error', { title: 'Bad Request', message: 'Invalid notification id.' });
    }
    adminNotificationRepo.markRead(id);
    return res.redirect('/admin/notifications');
  }
);

router.post('/slips/:orderId/approve', (req, res, next) => {
  try {
    const actor = req.session?.user?.isAdmin
      ? { user_id: req.session.user.user_id, username: req.session.user.username }
      : null;

    const orderId = Number(req.params.orderId);
    const offline = orderRepo.getOfflineTransfer(orderId);
    if (!offline) {
      const err = new Error('Slip not found');
      err.status = 404;
      throw err;
    }

    orderRepo.setOfflineTransferVerified(orderId, true);
  orderService.markOrderPaidAndDeductStock({ orderId, note: 'Offline transfer approved by admin', actor });

    req.session.flash = { type: 'success', message: 'Slip approved; payment marked as paid.' };
    return res.redirect(`/admin/orders/${orderId}`);
  } catch (e) {
    return next(e);
  }
});

router.post('/slips/:orderId/reject', (req, res, next) => {
  try {
    const actor = req.session?.user?.isAdmin
      ? { user_id: req.session.user.user_id, username: req.session.user.username }
      : null;

    const orderId = Number(req.params.orderId);
    const offline = orderRepo.getOfflineTransfer(orderId);
    if (!offline) {
      const err = new Error('Slip not found');
      err.status = 404;
      throw err;
    }

    const rejectionReason = String(req.body?.rejection_reason || '').trim();
    orderRepo.rejectOfflineTransfer({ orderId, reason: rejectionReason });

    const note = rejectionReason ? `Slip rejected by admin: ${rejectionReason}` : 'Slip rejected by admin';
  orderRepo.insertStatusHistory(orderId, 'PAYMENT', 'AWAITING_VERIFICATION', 'AWAITING_VERIFICATION', note, actor);

    req.session.flash = { type: 'success', message: 'Slip rejected (customer may re-upload).' };
    return res.redirect(`/admin/orders/${orderId}`);
  } catch (e) {
    return next(e);
  }
});

router.post(
  '/account/password',
  validate(
    z.object({
      body: z
        .object({
          current_password: z.string().min(1).max(200),
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
      const adminUserId = req.session?.user?.user_id;
      if (!adminUserId || !req.session?.user?.isAdmin) return res.redirect('/login');

      const user = userRepo.getById(adminUserId);
      if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
      }

      const ok = await bcrypt.compare(req.validated.body.current_password, user.password_hash);
      if (!ok) {
        req.session.flash = { type: 'error', message: 'Current password is incorrect.' };
        return res.redirect('/admin/settings#security');
      }

      const password_hash = await bcrypt.hash(req.validated.body.new_password, 12);
      userRepo.updatePassword(user.user_id, password_hash);
      req.session.flash = { type: 'success', message: 'Admin password updated.' };
      return res.redirect('/admin/settings#security');
    } catch (e) {
      return next(e);
    }
  }
);

module.exports = router;
