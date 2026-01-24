const express = require('express');
const { z } = require('zod');

const inventoryRepo = require('../repositories/inventoryRepo');
const cartService = require('../services/cartService');
const { getPagination, getPageCount } = require('../utils/pagination');
const { validate } = require('../middleware/validate');
const categoryRepo = require('../repositories/categoryRepo');
const categorySectionRepo = require('../repositories/categorySectionRepo');
const settingsRepo = require('../repositories/settingsRepo');
const { renderMarkdown, sanitizeHtmlFragment } = require('../utils/markdown');
const productImageRepo = require('../repositories/productImageRepo');
const contactMessageRepo = require('../repositories/contactMessageRepo');

const router = express.Router();

router.get('/', (req, res) => {
  const categories = categoryRepo.listPublic();
  return res.render('home', { title: 'Home', categories });
});

function getDefaultPageMd({ title }) {
  const t = String(title || '');
  return `# ${t}\n\nContent coming soon.`;
}

function safeExternalUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw;
}

router.get('/privacy', (req, res) => {
  const storedHtml = settingsRepo.get('page.privacy.html', '');
  const md = settingsRepo.get('page.privacy.md', '');
  const html = storedHtml
    ? sanitizeHtmlFragment(storedHtml)
    : renderMarkdown(md || getDefaultPageMd({ title: 'Privacy' }));
  return res.render('site/page', {
    title: 'Privacy',
    pageTitle: 'Privacy',
    html,
  });
});

router.get('/terms', (req, res) => {
  const storedHtml = settingsRepo.get('page.terms.html', '');
  const md = settingsRepo.get('page.terms.md', '');
  const html = storedHtml
    ? sanitizeHtmlFragment(storedHtml)
    : renderMarkdown(md || getDefaultPageMd({ title: 'Terms' }));
  return res.render('site/page', {
    title: 'Terms',
    pageTitle: 'Terms',
    html,
  });
});

router.get('/how-to-order', (req, res) => {
  const storedHtml = settingsRepo.get('page.how_to_order.html', '');
  const md = settingsRepo.get('page.how_to_order.md', '');
  const html = storedHtml
    ? sanitizeHtmlFragment(storedHtml)
    : renderMarkdown(md || getDefaultPageMd({ title: 'How to Order' }));
  return res.render('site/page', {
    title: 'How to Order',
    pageTitle: 'How to Order',
    html,
  });
});

function safeRedirectBack(req, fallbackPath) {
  const fallback = fallbackPath || '/';
  const ref = String(req.get('referer') || '').trim();
  if (!ref) return fallback;

  try {
    const host = String(req.get('host') || '').toLowerCase();
    const u = new URL(ref, host ? `http://${host}` : 'http://localhost');
    if (!host || String(u.host || '').toLowerCase() !== host) return fallback;
    const path = `${u.pathname || ''}${u.search || ''}`;
    if (!path || !path.startsWith('/')) return fallback;
    return path;
  } catch (_) {
    return fallback;
  }
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

router.post(
  '/contact',
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(80),
        subject: z.string().trim().min(2).max(160),
        message: z.string().trim().min(2).max(2000),
        return_to: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res, next) => {
    try {
      const pageUrl = String(req.get('referer') || '').trim();
      contactMessageRepo.create({
        name: req.validated.body.name,
        subject: req.validated.body.subject,
        message: req.validated.body.message,
        page_url: pageUrl,
        ip: req.ip,
        user_agent: req.get('user-agent'),
      });

      req.session.flash = { type: 'success', message: 'Message sent. We will contact you soon.' };
      const returnTo = safeReturnTo(req.validated.body.return_to, '');
      return res.redirect(returnTo || safeRedirectBack(req, '/'));
    } catch (e) {
      return next(e);
    }
  }
);

router.get(
  '/products',
  validate(
    z.object({
      query: z.object({
        q: z.string().trim().max(80).optional().or(z.literal('')),
        category: z.string().trim().max(80).optional().or(z.literal('')),
        availability: z.enum(['IN_STOCK', 'OUT_OF_STOCK']).optional().or(z.literal('')),
        min_price: z.string().trim().max(32).optional().or(z.literal('')),
        max_price: z.string().trim().max(32).optional().or(z.literal('')),
        sort: z.enum(['NEWEST', 'PRICE_ASC', 'PRICE_DESC', 'NAME_ASC', 'NAME_DESC']).optional().or(z.literal('')),
        pageSize: z.string().optional(),
        page: z.string().optional(),
      }),
      body: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res) => {
    function parseMoneyToCents(v) {
      const s = String(v || '').trim();
      if (!s) return null;
      const n = Number(s.replace(/,/g, ''));
      if (!Number.isFinite(n)) return null;
      if (n < 0) return null;
      return Math.round(n * 100);
    }

    const q = (req.validated.query.q || '').trim() || null;
    const requestedCategory = (req.validated.query.category || '').trim() || null;
    const categories = categoryRepo.listPublic();
    const category = requestedCategory && categories.some((c) => c.slug === requestedCategory) ? requestedCategory : null;
    const availability = (req.validated.query.availability || '').trim() || null;
    const sort = (req.validated.query.sort || '').trim() || 'NEWEST';
    const minPriceCents = parseMoneyToCents(req.validated.query.min_price);
    const maxPriceCents = parseMoneyToCents(req.validated.query.max_price);

    const { page, pageSize, offset, limit } = getPagination({
      page: req.validated.query.page,
      pageSize: req.validated.query.pageSize || 12,
    });

    const total = inventoryRepo.countPublic({
      q,
      category,
      availability,
      minPriceCents,
      maxPriceCents,
    });
    const products = inventoryRepo.listPublic({
      q,
      category,
      availability,
      minPriceCents,
      maxPriceCents,
      sort,
      limit,
      offset,
    });
    const pageCount = getPageCount(total, pageSize);

    const categorySections = category
      ? categorySectionRepo.listPublicByCategorySlug(category).map((s) => ({
          ...s,
          html: renderMarkdown(s.body_md),
        }))
      : [];

    res.render('shop/products', {
      title: 'Products',
      products,
      categories,
      categorySections,
      q: q || '',
      category: category || '',
      availability: availability || '',
      min_price: (req.validated.query.min_price || '').trim(),
      max_price: (req.validated.query.max_price || '').trim(),
      sort,
      pageSize,
      page,
      pageCount,
      total,
    });
  }
);

router.get('/products/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    const err = new Error('Invalid product');
    err.status = 400;
    return next(err);
  }

  const product = inventoryRepo.getById(id);
  if (!product || product.archived || !product.visibility) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Product not found.' });
  }

  const cat = categoryRepo.getBySlug(product.category);
  if (!cat || cat.archived || !cat.visible) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Product not found.' });
  }

  const images = productImageRepo.listByProductId(id);
  return res.render('shop/product', { title: product.name, product, images });
});

router.get('/cart', async (req, res) => {
  if (req.session.user?.isAdmin) {
    req.session.flash = { type: 'error', message: 'Admin accounts do not have carts.' };
    return res.redirect('/admin/orders');
  }

  const cart = cartService.getCart(req.session);
  const hydrated = await cartService.hydrateCart(cart);
  res.render('shop/cart', { title: 'Cart', cart: hydrated });
});

router.post(
  '/cart/add',
  validate(
    z.object({
      body: z.object({
        product_id: z.string(),
        quantity: z.string().optional(),
        return_to: z.string().max(500).optional(),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res) => {
    if (req.session.user?.isAdmin) {
      req.session.flash = { type: 'error', message: 'Admin accounts cannot add items to cart.' };
      return res.redirect('/admin/orders');
    }

    const productId = Number(req.validated.body.product_id);
    const quantity = Number(req.validated.body.quantity || 1);

    const product = inventoryRepo.getById(productId);
    if (!product || product.archived || !product.visibility) {
      req.session.flash = { type: 'error', message: 'Product is not available.' };
      return res.redirect('/');
    }

    const availableStock = inventoryRepo.getEffectiveAvailableStock(productId);
    if (availableStock <= 0) {
      req.session.flash = { type: 'error', message: 'This product is out of stock.' };
      const returnTo = safeReturnTo(req.validated.body.return_to, '');
      if (returnTo) return res.redirect(returnTo);
      return res.redirect(safeRedirectBack(req, '/'));
    }

    const q = Math.max(1, Math.min(99, Math.floor(quantity)));

    const currentQty = Number(req.session.cart?.items?.[String(productId)] || 0);
    const desiredQty = Math.max(0, Math.floor(currentQty) + q);
    const cappedQty = Math.min(desiredQty, availableStock);
    cartService.setQty(req.session, productId, cappedQty);

    if (cappedQty < desiredQty) {
      req.session.flash = {
        type: 'error',
        message: `Only ${availableStock} in stock. Your cart quantity was adjusted.`,
      };
    } else {
      req.session.flash = { type: 'success', message: 'Added to cart.' };
    }
    const returnTo = safeReturnTo(req.validated.body.return_to, '');
    if (returnTo) return res.redirect(returnTo);
    return res.redirect(safeRedirectBack(req, '/'));
  }
);

router.post(
  '/cart/update',
  validate(
    z.object({
      body: z.object({
        product_id: z.string(),
        quantity: z.string(),
      }),
      query: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res) => {
    if (req.session.user?.isAdmin) {
      req.session.flash = { type: 'error', message: 'Admin accounts cannot modify carts.' };
      return res.redirect('/admin/orders');
    }

    const productId = Number(req.validated.body.product_id);
    const quantity = Number(req.validated.body.quantity);

    const product = inventoryRepo.getById(productId);
    if (!product || product.archived || !product.visibility) {
      cartService.setQty(req.session, productId, 0);
      req.session.flash = { type: 'error', message: 'Product is no longer available and was removed from your cart.' };
      return res.redirect('/cart');
    }

    const availableStock = inventoryRepo.getEffectiveAvailableStock(productId);
    const desiredQty = Math.max(0, Math.min(99, Math.floor(quantity)));

    if (desiredQty > 0 && availableStock <= 0) {
      cartService.setQty(req.session, productId, 0);
      req.session.flash = { type: 'error', message: 'This product is out of stock and was removed from your cart.' };
      return res.redirect('/cart');
    }

    const cappedQty = Math.min(desiredQty, availableStock);
    cartService.setQty(req.session, productId, cappedQty);

    if (desiredQty !== cappedQty) {
      req.session.flash = {
        type: 'error',
        message: `Only ${availableStock} in stock. Your cart quantity was adjusted.`,
      };
    }
    return res.redirect('/cart');
  }
);

router.post(
  '/cart/clear',
  (req, res) => {
    if (req.session.user?.isAdmin) {
      req.session.flash = { type: 'error', message: 'Admin accounts cannot modify carts.' };
      return res.redirect('/admin/orders');
    }

    cartService.clear(req.session);
    return res.redirect('/cart');
  }
);

module.exports = router;
