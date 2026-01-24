const express = require('express');
const fs = require('fs');
const path = require('path');

const { z } = require('zod');

const { validate } = require('../middleware/validate');
const { upload } = require('../middleware/uploads');
const { requireUser } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');

const cartService = require('../services/cartService');
const orderService = require('../services/orderService');
const imageService = require('../services/imageService');
const orderRepo = require('../repositories/orderRepo');
const orderRefundRepo = require('../repositories/orderRefundRepo');
const orderRefundExtraRepo = require('../repositories/orderRefundExtraRepo');
const userRepo = require('../repositories/userRepo');
const { getPagination, getPageCount } = require('../utils/pagination');
const fiuu = require('../services/payments/fiuu');
const { env } = require('../config/env');
const emailService = require('../services/emailService');
const adminNotificationRepo = require('../repositories/adminNotificationRepo');
const { MALAYSIA_STATES, buildMalaysiaFullAddress } = require('../utils/malaysia');
const shippingService = require('../services/shippingService');
const promoService = require('../services/promoService');
const { logger } = require('../utils/logger');
const { verifyOrderViewToken } = require('../utils/orderViewToken');

const router = express.Router();

function resolveOrderParamToId(param) {
  const raw = String(param || '').trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const byCode = raw ? orderRepo.getByCode(raw) : null;
  return byCode?.order_id || null;
}

function canAccessOrder(req, order) {
  if (!order) return false;
  if (req.session.user?.isAdmin) return true;
  if (req.session.user && order.user_id && req.session.user.user_id === order.user_id) return true;
  if (!order.user_id && req.session.lastGuestOrderId && Number(req.session.lastGuestOrderId) === order.order_id) return true;
  return false;
}

function canAccessOrderViaEmailToken(req, order) {
  if (!order || order.user_id) return false;
  const token = String(req.query.t || '').trim();
  if (!token) return false;

  try {
    if (!verifyOrderViewToken({ token, orderId: order.order_id })) return false;
    // Promote token-based access into the session for subsequent navigation.
    req.session.lastGuestOrderId = order.order_id;
    return true;
  } catch (e) {
    logger.warn({ event: 'order_email_token_verify_failed', err: e, orderId: order.order_id }, 'failed to verify order email token');
    return false;
  }
}

function requireOrderAccess(req, res, order) {
  if (!order) return false;

  // Admins can view any order.
  if (req.session.user?.isAdmin) return true;

  // Orders made with an account must be viewed by that same logged-in account.
  if (order.user_id) {
    if (!req.session.user) {
      return res.status(401).render('orders/login_required', {
        title: 'Sign in required',
        returnTo: req.originalUrl || '/',
      });
    }

    if (req.session.user.user_id !== order.user_id) {
      return res.status(403).render('shared/error', {
        title: 'Access Denied',
        message: 'You do not have access to this order. Please sign in with the account used to place the order.',
      });
    }

    return true;
  }

  // Guest orders can be viewed via session access (checkout flow) or email token.
  if (canAccessOrder(req, order) || canAccessOrderViaEmailToken(req, order)) return true;

  return false;
}

router.get('/checkout', async (req, res) => {
  if (req.session.user?.isAdmin) {
    req.session.flash = { type: 'error', message: 'Admin accounts are not allowed to place orders.' };
    return res.redirect('/admin/orders');
  }

  const cart = cartService.getCart(req.session);
  const hydrated = await cartService.hydrateCart(cart);
  if (hydrated.items.length === 0) {
    req.session.flash = { type: 'error', message: 'Your cart is empty.' };
    return res.redirect('/');
  }

  let prefill = null;
  if (req.session.user && !req.session.user.isAdmin) {
    try {
      const u = userRepo.getById(req.session.user.user_id);
      prefill = {
        customer_name: u?.username || req.session.user.username || '',
        phone: u?.phone || '',
        email: u?.email || req.session.user.email || '',
        address_line1: u?.address_line1 || u?.address || '',
        address_line2: u?.address_line2 || '',
        city: u?.city || '',
        state: u?.state || '',
        postcode: u?.postcode || '',
      };
    } catch (_) {
      prefill = {
        customer_name: req.session.user.username || '',
        phone: '',
        email: req.session.user.email || '',
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        postcode: '',
      };
    }
  }

  const totalWeightKg = hydrated.items.reduce((acc, line) => {
    const w = Number(line?.product?.weight_kg || 0);
    const q = Number(line?.quantity || 0);
    if (!Number.isFinite(w) || !Number.isFinite(q) || q <= 0) return acc;
    return acc + w * q;
  }, 0);

  const prefillQuote = prefill?.state && prefill?.postcode
    ? shippingService.quoteShippingCents({ state: prefill.state, postcode: prefill.postcode, weightKg: totalWeightKg })
    : null;
  const prefillShippingFee = prefillQuote ? Number(prefillQuote.shippingCents || 0) : 0;
  const prefillShippingLabel = prefillQuote && prefillQuote.zone && prefillQuote.zone.name
    ? String(prefillQuote.zone.name)
    : '-';

  return res.render('orders/checkout', {
    title: 'Checkout',
    cart: hydrated,
    canOnlinePay: fiuu.isConfigured(),
    prefill,
    malaysiaStates: MALAYSIA_STATES,
    prefillShippingFee,
    prefillShippingLabel,
    totalWeightKg,
  });
});

router.post(
  '/checkout/quote',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        promo_code: z.string().trim().max(32).optional().or(z.literal('')),
        state: z.enum(MALAYSIA_STATES),
        postcode: z.string().trim().regex(/^\d{5}$/),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res) => {
    if (req.session.user?.isAdmin) {
      return res.status(403).json({ ok: false, message: 'Admins cannot place orders.' });
    }

    const cart = cartService.getCart(req.session);
    const hydrated = await cartService.hydrateCart(cart);
    const itemsTotal = Math.max(0, Number(hydrated.total || 0));

    const totalWeightKg = hydrated.items.reduce((acc, line) => {
      const w = Number(line?.product?.weight_kg || 0);
      const q = Number(line?.quantity || 0);
      if (!Number.isFinite(w) || !Number.isFinite(q) || q <= 0) return acc;
      return acc + w * q;
    }, 0);

    const quote = shippingService.quoteShippingCents({
      state: req.validated.body.state,
      postcode: req.validated.body.postcode,
      weightKg: totalWeightKg,
    });

    const shippingOk = !quote || !quote.noMatch;
    const shippingCents = shippingOk ? Math.max(0, Number(quote.shippingCents || 0)) : 0;
    const preDiscountGrandTotal = itemsTotal + shippingCents;

    const promoCodeInput = req.validated.body.promo_code;
    let applied = promoService.applyPromoToTotal({
      promoCodeInput,
      totalCents: itemsTotal,
    });

    if (applied?.promo?.applies_to_shipping) {
      applied = promoService.applyPromoToTotal({
        promoCodeInput,
        totalCents: shippingCents,
      });
    }

    const ok = Boolean(applied && applied.promo);
    const discountCents = ok ? Number(applied.discount || 0) : 0;
    const grandTotalCents = Math.max(0, preDiscountGrandTotal - discountCents);

    const label = quote && quote.zone && quote.zone.name
      ? String(quote.zone.name)
      : '-';

    if (!shippingOk) {
      return res.json({
        ok: false,
        message: 'Shipping is not available for the selected address. Please select a different delivery area or contact us.',
        promo: null,
        discountCents: 0,
        shippingCents: 0,
        preDiscountGrandTotalCents: itemsTotal,
        grandTotalCents: itemsTotal,
        shippingLabel: '-',
        shippingOk: false,
        totalWeightKg,
      });
    }

    return res.json({
      ok,
      message: ok ? 'Promo applied.' : (promoCodeInput ? 'Promo code is not valid.' : ''),
      promo: ok ? applied.promo : null,
      discountCents,
      shippingCents,
      preDiscountGrandTotalCents: preDiscountGrandTotal,
      grandTotalCents,
      shippingLabel: label,
      shippingOk: true,
      totalWeightKg,
    });
  }
);

router.post(
  '/checkout/promo-check',
  csrfProtection({ ignoreMultipart: true }),
  validate(
    z.object({
      body: z.object({
        promo_code: z.string().trim().max(32).optional().or(z.literal('')),
        state: z.enum(MALAYSIA_STATES),
        postcode: z.string().trim().regex(/^\d{5}$/).optional().or(z.literal('')),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res) => {
    if (req.session.user?.isAdmin) {
      return res.status(403).json({ ok: false, message: 'Admins cannot place orders.' });
    }

    const cart = cartService.getCart(req.session);
    const hydrated = await cartService.hydrateCart(cart);
    const itemsTotal = Math.max(0, Number(hydrated.total || 0));

    const totalWeightKg = hydrated.items.reduce((acc, line) => {
      const w = Number(line?.product?.weight_kg || 0);
      const q = Number(line?.quantity || 0);
      if (!Number.isFinite(w) || !Number.isFinite(q) || q <= 0) return acc;
      return acc + w * q;
    }, 0);

    const quote = shippingService.quoteShippingCents({
      state: req.validated.body.state,
      postcode: req.validated.body.postcode || null,
      weightKg: totalWeightKg,
    });
    const shippingOk = !quote || !quote.noMatch;
    const shippingCents = shippingOk ? Math.max(0, Number(quote.shippingCents || 0)) : 0;
    const preDiscountGrandTotal = itemsTotal + shippingCents;

    if (!shippingOk) {
      return res.json({
        ok: false,
        message: 'Shipping is not available for the selected address. Please select a different delivery area or contact us.',
        discountCents: 0,
        shippingCents: 0,
        preDiscountGrandTotalCents: itemsTotal,
        grandTotalCents: itemsTotal,
        shippingOk: false,
      });
    }

    let applied = promoService.applyPromoToTotal({
      promoCodeInput: req.validated.body.promo_code,
      totalCents: itemsTotal,
    });
    if (applied?.promo?.applies_to_shipping) {
      applied = promoService.applyPromoToTotal({
        promoCodeInput: req.validated.body.promo_code,
        totalCents: shippingCents,
      });
    }

    if (!applied.promo) {
      return res.json({
        ok: false,
        message: 'Promo code is not valid.',
        discountCents: 0,
        shippingCents,
        preDiscountGrandTotalCents: preDiscountGrandTotal,
        grandTotalCents: preDiscountGrandTotal,
        shippingOk: true,
      });
    }

    return res.json({
      ok: true,
      message: 'Promo applied.',
      promo: applied.promo,
      discountCents: applied.discount,
      shippingCents,
      preDiscountGrandTotalCents: preDiscountGrandTotal,
      grandTotalCents: Math.max(0, preDiscountGrandTotal - applied.discount),
      shippingOk: true,
    });
  }
);

router.post(
  '/checkout',
  validate(
    z.object({
      body: z.object({
        customer_name: z.string().trim().min(2).max(128),
        phone: z.string().trim().min(6).max(32),
        email: z.string().trim().email().max(128),
        address_line1: z.string().trim().min(3).max(200),
        address_line2: z.string().trim().max(200).optional().or(z.literal('')),
        city: z.string().trim().min(2).max(100),
        state: z.enum(MALAYSIA_STATES),
        postcode: z.string().trim().regex(/^\d{5}$/),
        promo_code: z.string().trim().max(32).optional().or(z.literal('')),
        payment_method: z.enum(['ONLINE', 'OFFLINE_TRANSFER']),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      if (req.session.user?.isAdmin) {
        req.session.flash = { type: 'error', message: 'Admin accounts are not allowed to place orders.' };
        return res.redirect('/admin/orders');
      }

      const cart = cartService.getCart(req.session);
      const hydrated = await cartService.hydrateCart(cart);

      const customer = {
        customer_name: req.validated.body.customer_name,
        phone: req.validated.body.phone,
        email: req.validated.body.email,
        address_line1: req.validated.body.address_line1,
        address_line2: req.validated.body.address_line2,
        city: req.validated.body.city,
        state: req.validated.body.state,
        postcode: req.validated.body.postcode,
      };

      customer.address = buildMalaysiaFullAddress({
        line1: customer.address_line1,
        line2: customer.address_line2,
        city: customer.city,
        state: customer.state,
        postcode: customer.postcode,
      });

      const order = orderService.placeOrder({
        user: req.session.user ? { user_id: req.session.user.user_id } : null,
        customer,
        cartItems: hydrated.items,
        promoCode: req.validated.body.promo_code,
        payment_method: req.validated.body.payment_method,
      });

      // Notify staff about new orders (best-effort; do not block checkout).
      try {
        const promo = orderRepo.getPromoForOrder(order.order_id);
        await emailService.sendOrderReceivedEmail({ order, promo });
        await emailService.sendOrderPlacedEmailToCustomer({ order, promo });

      } catch (e) {
        logger.warn({ event: 'order_email_failed', err: e, orderId: order.order_id }, 'failed to send order notification emails');
      }

      cartService.clear(req.session);

      if (!order.user_id) req.session.lastGuestOrderId = order.order_id;

      if (order.payment_method === 'OFFLINE_TRANSFER') {
        req.session.flash = { type: 'success', message: 'Order placed. Upload your bank slip to proceed.' };
        return res.redirect(`/orders/${order.order_id}/offline-transfer`);
      }

      if (!fiuu.isConfigured()) {
        req.session.flash = { type: 'error', message: 'Online payment is not configured yet. Please use offline bank transfer.' };
        logger.error(
          { event: 'checkout_online_payment_not_configured', orderId: order.order_id },
          'online payment attempted but FIUU is not configured'
        );
        orderRepo.updatePaymentStatus(order.order_id, 'FAILED', 'Online payment attempted but Fiuu not configured');
        orderRepo.updateFulfilmentStatus(order.order_id, 'CANCELLED', 'Online payment not configured');
        return res.redirect(`/orders/${order.order_id}`);
      }

      const reqInfo = fiuu.buildHostedPaymentRequest({ order, customer });

      if (env.fiuu.logRequests) {
        const encoded = new URLSearchParams(
          Object.entries(reqInfo.fields).map(([k, v]) => [k, String(v)])
        ).toString();
        // eslint-disable-next-line no-console
        console.log('[fiuu] hosted payment request', {
          method: reqInfo.method || 'POST',
          url: reqInfo.url,
          fullUrl: reqInfo.fullUrl || null,
          meta: reqInfo.meta || null,
          fields: reqInfo.fields,
          urlencoded: encoded,
        });
      }

      // When using GET-mode integration, we can redirect directly to the gateway URL.
      // This preserves the user's "Place order" flow without requiring a JS auto-submit page.
      if ((reqInfo.method || 'POST') === 'GET' && reqInfo.fullUrl) {
        return res.redirect(303, reqInfo.fullUrl);
      }

      return res.render('orders/redirect_to_gateway', {
        title: 'Redirecting…',
        gatewayUrl: reqInfo.url,
        gatewayFullUrl: reqInfo.fullUrl || null,
        gatewayMethod: reqInfo.method || 'POST',
        fields: reqInfo.fields,
        debugFiuu: Boolean(env.fiuu.logRequests),
      });
    } catch (e) {
      if (e && (e.status === 409 || e.name === 'StockInsufficientError')) {
        req.session.flash = {
          type: 'error',
          message: String(e && e.message ? e.message : 'Insufficient stock for one or more items.'),
        };
        return res.redirect('/cart');
      }

      if (e && e.status === 400 && String(e.message || '').toLowerCase().includes('shipping')) {
        req.session.flash = { type: 'error', message: String(e.message || 'Shipping is not available for the selected address.') };
        return res.redirect('/checkout');
      }

      return next(e);
    }
  }
);

router.get('/orders/:id/confirmation', (req, res) => {
  const id = resolveOrderParamToId(req.params.id);
  const order = id ? orderRepo.getWithItems(id) : null;
  if (!order) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
  }
  const ok = requireOrderAccess(req, res, order);
  if (ok !== true) {
    // requireOrderAccess already handled redirect OR access was denied.
    if (ok) return ok;
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
  }
  return res.render('orders/confirmation', { title: 'Order Confirmation', order, promo: orderRepo.getPromoForOrder(id) });
});

router.get('/orders/history', requireUser, (req, res) => {
  if (req.session.user?.isAdmin) {
    req.session.flash = { type: 'error', message: 'Admin accounts do not have customer order history.' };
    return res.redirect('/admin/orders');
  }

  const { page, pageSize, offset, limit } = getPagination({ page: req.query.page, pageSize: 10 });
  const q = String(req.query.q || '').trim();
  const payment_status = String(req.query.payment_status || '').trim() || null;
  const payment_method = String(req.query.payment_method || '').trim() || null;
  const fulfilment_status = String(req.query.fulfilment_status || '').trim() || null;
  const date_from = String(req.query.date_from || '').trim() || null;
  const date_to = String(req.query.date_to || '').trim() || null;

  const total = orderRepo.countByUserFiltered(req.session.user.user_id, {
    q,
    payment_status,
    payment_method,
    fulfilment_status,
    date_from,
    date_to,
  });
  const orders = orderRepo.listByUserFiltered(req.session.user.user_id, {
    q,
    payment_status,
    payment_method,
    fulfilment_status,
    date_from,
    date_to,
    limit,
    offset,
  });
  const pageCount = getPageCount(total, pageSize);
  return res.render('orders/history', {
    title: 'Order History',
    orders,
    page,
    pageCount,
    total,
    q,
    payment_status: payment_status || '',
    payment_method: payment_method || '',
    fulfilment_status: fulfilment_status || '',
    date_from: date_from || '',
    date_to: date_to || '',
  });
});

router.get('/orders/slips', requireUser, (req, res) => {
  if (req.session.user?.isAdmin) {
    req.session.flash = { type: 'error', message: 'Bank slips page removed. Review slips inside each order.' };
    return res.redirect('/admin/orders');
  }

  req.session.flash = { type: 'success', message: 'Bank slips page removed. View slips inside your order details.' };
  return res.redirect('/orders/history');
});

router.get('/orders/:id', (req, res) => {
  const id = resolveOrderParamToId(req.params.id);
  const order = id ? orderRepo.getWithItems(id) : null;
  if (!order) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
  }
  const ok = requireOrderAccess(req, res, order);
  if (ok !== true) {
    if (ok) return ok;
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
  }
  return res.render('orders/detail', {
    title: `Order ${order.order_code || `#${order.order_id}`}`,
    order,
    token: String(req.query.t || '').trim(),
    promo: orderRepo.getPromoForOrder(id),
    offline: orderRepo.getOfflineTransfer(id),
    statusHistory: orderRepo.listStatusHistory(id),
    itemRefunds: orderRefundRepo.listByOrder(id),
    extraRefunds: orderRefundExtraRepo.listByOrder(id),
  });
});

router.get('/orders/:id/receipt', (req, res) => {
  const id = resolveOrderParamToId(req.params.id);
  const order = id ? orderRepo.getWithItems(id) : null;
  if (!order) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
  }
  const ok = requireOrderAccess(req, res, order);
  if (ok !== true) {
    if (ok) return ok;
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
  }
  return res.render('orders/receipt', {
    title: `Receipt ${order.order_code || `#${order.order_id}`}`,
    order,
    token: String(req.query.t || '').trim(),
  });
});

router.get('/orders/:id/offline-transfer', (req, res) => {
  const id = resolveOrderParamToId(req.params.id);
  const order = id ? orderRepo.getWithItems(id) : null;
  if (!order) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
  }
  const ok = requireOrderAccess(req, res, order);
  if (ok !== true) {
    if (ok) return ok;
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
  }
  if (order.payment_method !== 'OFFLINE_TRANSFER') {
    return res.redirect(`/orders/${order.order_id}`);
  }
  return res.render('orders/offline_transfer', {
    title: 'Offline Bank Transfer',
    order,
    existing: orderRepo.getOfflineTransfer(id),
  });
});

router.post(
  '/orders/:id/offline-transfer',
  upload.single('slip_image'),
  csrfProtection({ ignoreMultipart: false }),
  validate(
    z.object({
      body: z.object({
        bank_name: z.string().trim().min(2).max(128),
        reference_number: z.string().trim().min(2).max(128),
      }),
      query: z.any().optional(),
      params: z.object({ id: z.string() }),
    })
  ),
  async (req, res, next) => {
    try {
      const id = resolveOrderParamToId(req.params.id);
      const order = id ? orderRepo.getWithItems(id) : null;
      if (!order) return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
      const ok = requireOrderAccess(req, res, order);
      if (ok !== true) {
        if (ok) return ok;
        return res.status(404).render('shared/error', { title: 'Not Found', message: 'Order not found.' });
      }
      if (order.payment_method !== 'OFFLINE_TRANSFER') return res.redirect(`/orders/${order.order_id}`);

      const existing = orderRepo.getOfflineTransfer(order.order_id);

      if (!req.file) {
        const err = new Error('Slip image is required.');
        err.status = 400;
        throw err;
      }

      const optimizedPath = await imageService.optimizeAndSaveSlipImage(req.file.path, order.order_id);
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        // ignore
      }

      let upserted;
      try {
        upserted = orderRepo.upsertOfflineTransfer({
          order_id: order.order_id,
          bank_name: req.validated.body.bank_name,
          reference_number: req.validated.body.reference_number,
          slip_image_path: optimizedPath,
        });
      } catch (e) {
        // If DB replace fails (e.g., already verified), delete newly created optimized image to avoid orphan files.
        try {
          const file = path.basename(String(optimizedPath || ''));
          if (file) {
            const abs = path.join(process.cwd(), 'storage', 'uploads', 'slips', file);
            fs.unlinkSync(abs);
          }
        } catch (_) {
          // ignore
        }
        throw e;
      }

      // Log slip upload/replace in status history (even if payment status remains the same).
      try {
        const note = existing ? 'Slip replaced by customer' : 'Slip uploaded by customer';
        orderRepo.insertStatusHistory(
          order.order_id,
          'PAYMENT',
          String(order.payment_status || 'AWAITING_VERIFICATION'),
          String(order.payment_status || 'AWAITING_VERIFICATION'),
          note
        );
      } catch (_) {
        // ignore
      }

      // Delete replaced slip from disk to prevent storage bloat.
      try {
        const prev = upserted && upserted.previousSlipPath ? String(upserted.previousSlipPath) : '';
        const nextPath = optimizedPath ? String(optimizedPath) : '';
        if (prev && prev !== nextPath) {
          const prevFile = path.basename(prev);
          if (prevFile) {
            const absPrev = path.join(process.cwd(), 'storage', 'uploads', 'slips', prevFile);
            fs.unlinkSync(absPrev);
          }
        }
      } catch (_) {
        // ignore
      }

      // In-app admin notification (best-effort)
      try {
        const label = order.order_code || `#${order.order_id}`;
        adminNotificationRepo.create({
          type: 'BANK_SLIP_UPLOADED',
          title: `Bank slip uploaded for order ${label}`,
          body: `${req.validated.body.bank_name} • Ref: ${req.validated.body.reference_number} • Payment: ${order.payment_status} • Fulfilment: ${order.fulfilment_status}`,
          link: `/admin/orders/${order.order_id}`,
        });
      } catch (_) {
        // ignore
      }

      req.session.flash = { type: 'success', message: 'Slip uploaded. Awaiting admin verification.' };
      return res.redirect(`/orders/${order.order_id}`);
    } catch (e) {
      return next(e);
    }
  }
);

module.exports = router;
