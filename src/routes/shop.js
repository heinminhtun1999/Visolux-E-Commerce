const express = require('express');
const { z } = require('zod');

const inventoryRepo = require('../repositories/inventoryRepo');
const productVariantRepo = require('../repositories/productVariantRepo');
const cartService = require('../services/cartService');
const fiuuAccountsService = require('../services/fiuuAccountsService');
const { getPagination, getPageCount } = require('../utils/pagination');
const { validate } = require('../middleware/validate');
const categoryRepo = require('../repositories/categoryRepo');
const categorySectionRepo = require('../repositories/categorySectionRepo');
const settingsRepo = require('../repositories/settingsRepo');
const { env } = require('../config/env');
const { renderMarkdown, sanitizeHtmlFragment } = require('../utils/markdown');
const productImageRepo = require('../repositories/productImageRepo');
const contactMessageRepo = require('../repositories/contactMessageRepo');

const router = express.Router();

function buildCartLinesForFiuuAccountCheck(session) {
  const cart = cartService.getCart(session);
  const lines = [];
  for (const [key, raw] of Object.entries(cart.items || {})) {
    const productId = (raw && typeof raw === 'object' && raw.product_id != null)
      ? Number(raw.product_id)
      : (() => {
        const s = String(key || '').trim();
        const m = /^(?:p:)?(\d+)$/.exec(s);
        return m ? Number(m[1]) : NaN;
      })();
    if (!Number.isFinite(productId) || productId <= 0) continue;
    const product = inventoryRepo.getById(productId);
    if (!product || product.archived || !product.visibility) continue;
    const rawQty = (raw && typeof raw === 'object') ? raw.qty : raw;
    const q = Math.max(1, Math.floor(Number(rawQty || 0)));
    lines.push({ product, quantity: q });
  }
  return lines;
}

router.get('/', (req, res) => {
  const categories = categoryRepo.listPublic();
  return res.render('home', {
    title: 'Visolux Store',
    description: 'Visolux Store — shop parts and components online.',
    categories,
  });
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

function getSupportEmailForDataDeletion() {
  const fromSettings = String(settingsRepo.get('site.contact.email', '') || '').trim();
  if (fromSettings) return fromSettings;
  const fromEnv = String(env?.email?.orderNotifyTo || env?.email?.from || '').trim();
  return fromEnv || '';
}

router.get('/data-deletion', (req, res) => {
  const supportEmail = getSupportEmailForDataDeletion();
  const storedHtml = settingsRepo.get('page.data_deletion.html', '');
  const md = settingsRepo.get('page.data_deletion.md', '');

  const fallbackMd =
    `# Data deletion\n\n` +
    `If you want us to delete your personal data from **Visolux Store**, please contact us with the email address used on your account and include the subject **Data Deletion Request**.\n\n` +
    (supportEmail ? `Contact email: **${supportEmail}**\n\n` : '') +
    `## What we may store\n\n` +
    `Depending on how you use the site, we may store your account profile (username/email), order history, and OAuth identifiers used to sign in.\n\n` +
    `## What to include\n\n` +
    `- Your name\n` +
    `- Your account email\n` +
    `- A brief request to delete your data\n\n` +
    `We will process deletion requests as soon as possible.`;

  const html = storedHtml
    ? sanitizeHtmlFragment(storedHtml)
    : renderMarkdown(md || fallbackMd);

  return res.render('site/page', {
    title: 'Data Deletion',
    pageTitle: 'Data Deletion',
    html,
  });
});

router.get('/data-deletion/status', (req, res) => {
  const code = String(req.query.code || '').trim();
  const md =
    `# Data deletion request received\n\n` +
    `Your request has been received.\n\n` +
    (code ? `Confirmation code: **${code}**\n` : '');
  return res.render('site/page', {
    title: 'Data Deletion Status',
    pageTitle: 'Data Deletion Status',
    html: renderMarkdown(md),
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

function parseMoneyToCents(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return Math.round(n * 100);
}

const productsQuerySchema = z.object({
  q: z.string().trim().max(80).optional().or(z.literal('')),
  category: z.string().trim().max(80).optional().or(z.literal('')),
  availability: z.enum(['IN_STOCK', 'OUT_OF_STOCK']).optional().or(z.literal('')),
  min_price: z.string().trim().max(32).optional().or(z.literal('')),
  max_price: z.string().trim().max(32).optional().or(z.literal('')),
  sort: z.enum(['NEWEST', 'PRICE_ASC', 'PRICE_DESC', 'NAME_ASC', 'NAME_DESC']).optional().or(z.literal('')),
  pageSize: z.string().optional(),
  page: z.string().optional(),
});

function renderProductsListing(req, res, query) {
  const q = (query.q || '').trim() || null;
  const requestedCategory = (query.category || '').trim() || null;
  const categories = categoryRepo.listPublic();
  const category = requestedCategory && categories.some((c) => c.slug === requestedCategory) ? requestedCategory : null;
  const availability = (query.availability || '').trim() || null;
  const sort = (query.sort || '').trim() || 'NEWEST';
  const minPriceCents = parseMoneyToCents(query.min_price);
  const maxPriceCents = parseMoneyToCents(query.max_price);

  const { page, pageSize, offset, limit } = getPagination({
    page: query.page,
    pageSize: query.pageSize || 12,
  });

  const total = inventoryRepo.countPublic({
    q,
    category,
    availability,
    minPriceCents,
    maxPriceCents,
  });

  let products = inventoryRepo.listPublic({
    q,
    category,
    availability,
    minPriceCents,
    maxPriceCents,
    sort,
    limit,
    offset,
  });

  products = (products || []).map((p) => ({
    ...p,
    available_stock: inventoryRepo.getEffectiveAvailableStock(p.product_id),
  }));

  const pageCount = getPageCount(total, pageSize);

  const categorySections = category
    ? categorySectionRepo.listPublicByCategorySlug(category).map((s) => ({
        ...s,
        html: renderMarkdown(s.body_md),
      }))
    : [];

  const selectedCategory = category ? (categories.find((c) => c.slug === category) || null) : null;
  const pageTitle = selectedCategory ? `${selectedCategory.name} Products` : 'Products';
  const pageDescription = selectedCategory
    ? `Browse ${selectedCategory.name} products at ${res.locals.siteName || 'Visolux Store'}.`
    : `Browse products at ${res.locals.siteName || 'Visolux Store'}.`;

  return res.render('shop/products', {
    title: pageTitle,
    description: pageDescription,
    products,
    categories,
    categorySections,
    q: q || '',
    category: category || '',
    availability: availability || '',
    min_price: (query.min_price || '').trim(),
    max_price: (query.max_price || '').trim(),
    sort,
    pageSize,
    page,
    pageCount,
    total,
  });
}

router.get(
  '/products',
  validate(
    z.object({
      query: productsQuerySchema,
      body: z.any().optional(),
      params: z.any().optional(),
    })
  ),
  (req, res) => {
    return renderProductsListing(req, res, req.validated.query);
  }
);

// SEO-friendly category pages (indexable URLs)
router.get(
  '/categories/:slug',
  validate(
    z.object({
      params: z.object({ slug: z.string().trim().min(1).max(80) }),
      query: productsQuerySchema.omit({ category: true }).passthrough(),
      body: z.any().optional(),
    })
  ),
  (req, res) => {
    const slug = String(req.validated.params.slug || '').trim();
    const query = {
      ...req.validated.query,
      category: slug,
    };
    // Canonical should remain /categories/:slug (handled by req.path)
    return renderProductsListing(req, res, query);
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

  product.available_stock = inventoryRepo.getEffectiveAvailableStock(id);

  const cat = categoryRepo.getBySlug(product.category);
  if (!cat || cat.archived || !cat.visible) {
    return res.status(404).render('shared/error', { title: 'Not Found', message: 'Product not found.' });
  }

  const images = productImageRepo.listByProductId(id);
  const variants = productVariantRepo.listByProductId(id, { includeInactive: false });

  const cheapestVariant = (variants && variants.length)
    ? variants.reduce((best, v) => (!best || Number(v.price || 0) < Number(best.price || 0)) ? v : best, null)
    : null;

  // Product SEO
  const galleryUrls = [];
  if (product && product.product_image) galleryUrls.push(product.product_image);
  (images || []).forEach((img) => { if (img && img.image_url) galleryUrls.push(img.image_url); });
  const uniqGallery = [...new Set(galleryUrls.filter(Boolean))];
  const effStock = (product.available_stock == null ? product.stock : product.available_stock);

  const descText = String(product.description || '').trim();
  const shortDesc = (descText.length > 180) ? `${descText.slice(0, 177)}...` : descText;
  const currency = 'MYR';
  const offerPriceCents = cheapestVariant ? Number(cheapestVariant.price || 0) : Number(product.price || 0);
  const price = (offerPriceCents / 100).toFixed(2);
  const base = String(res.locals.siteUrl || '').replace(/\/+$/, '');
  const url = base ? `${base}/products/${product.product_id}` : `/products/${product.product_id}`;

  if (Array.isArray(res.locals.structuredData)) {
    res.locals.structuredData.push({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      ...(shortDesc ? { description: shortDesc } : {}),
      ...(uniqGallery.length ? { image: uniqGallery } : {}),
      category: product.category_name || product.category,
      offers: {
        '@type': 'Offer',
        priceCurrency: currency,
        price,
        url,
        availability: effStock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
      },
    });
  }

  return res.render('shop/product', {
    title: product.name,
    description: shortDesc || `Buy ${product.name} at ${res.locals.siteName || 'Visolux Store'}.`,
    ogTypeOverride: 'product',
    product,
    images,
    variants,
  });
});

router.get('/cart', async (req, res) => {
  if (req.session.user?.isAdmin) {
    req.session.flash = { type: 'error', message: 'Admin accounts do not have carts.' };
    return res.redirect('/admin/orders');
  }

  cartService.sanitizeCart(req.session);
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
        variant_id: z.string().optional().or(z.literal('')),
        quantity: z.string().optional(),
        product_type: z.string().trim().max(32).optional().or(z.literal('')),
        note: z.string().trim().max(500).optional().or(z.literal('')),
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
    const variantIdRaw = String(req.validated.body.variant_id || '').trim();
    const variantId = variantIdRaw ? Number(variantIdRaw) : null;

    const product = inventoryRepo.getById(productId);
    if (!product || product.archived || !product.visibility) {
      req.session.flash = { type: 'error', message: 'Product is not available.' };
      return res.redirect('/');
    }

    let variant = null;
    if (variantId != null && Number.isFinite(variantId) && variantId > 0) {
      const v = productVariantRepo.getById(variantId);
      if (!v || !v.active || v.product_id !== productId) {
        req.session.flash = { type: 'error', message: 'Selected type is not available.' };
        const returnTo = safeReturnTo(req.validated.body.return_to, '');
        if (returnTo) return res.redirect(returnTo);
        return res.redirect(safeRedirectBack(req, `/products/${productId}`));
      }
      variant = v;
    }

    // Prevent mixing different FIUU merchant accounts in a single cart.
    // Only blocks when the combined cart would require multiple accounts.
    try {
      cartService.sanitizeCart(req.session);
      const cart = cartService.getCart(req.session);
      const alreadyHasProduct = Object.entries(cart.items || {}).some(([k, v]) => {
        if (v && typeof v === 'object' && Number(v.product_id) === productId) return true;
        const s = String(k || '').trim();
        return s === String(productId) || s === `p:${productId}`;
      });
      if (!alreadyHasProduct) {
        const lines = buildCartLinesForFiuuAccountCheck(req.session);
        lines.push({ product, quantity: 1 });

        const resolved = fiuuAccountsService.resolveAccountForCartItems(lines);
        if (!resolved.ok && resolved.reason === 'multiple_accounts_required') {
          req.session.flash = {
            type: 'error',
            message:
              'This item uses a different payment merchant account from items already in your cart. Please checkout separately, or clear your cart first.',
          };
          const returnTo = safeReturnTo(req.validated.body.return_to, '');
          if (returnTo) return res.redirect(returnTo);
          return res.redirect(safeRedirectBack(req, '/cart'));
        }
      }
    } catch (_) {
      // ignore
    }

    const availableStock = variant ? Math.max(0, Math.floor(Number(variant.stock || 0))) : inventoryRepo.getEffectiveAvailableStock(productId);
    if (availableStock <= 0) {
      req.session.flash = { type: 'error', message: 'This product is out of stock.' };
      const returnTo = safeReturnTo(req.validated.body.return_to, '');
      if (returnTo) return res.redirect(returnTo);
      return res.redirect(safeRedirectBack(req, '/'));
    }

    const q = Math.max(1, Math.min(99, Math.floor(quantity)));

    const key = (variant ? `v:${variant.variant_id}` : `p:${productId}`);
    const entry = req.session.cart?.items?.[key];
    const currentQty = Number((entry && typeof entry === 'object') ? entry.qty : (entry || 0));
    const desiredQty = Math.max(0, Math.floor(currentQty) + q);
    const cappedQty = Math.min(desiredQty, availableStock);
    cartService.setQty(req.session, { productId, variantId: variant ? variant.variant_id : null, variantLabel: variant ? variant.label : '' }, cappedQty);

    if (!variant && Object.prototype.hasOwnProperty.call(req.validated.body, 'product_type')) {
      cartService.setType(req.session, { productId }, req.validated.body.product_type);
    }

    const note = String(req.validated.body.note || '').trim();
    if (note) cartService.setNote(req.session, { productId, variantId: variant ? variant.variant_id : null }, note);

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
        cart_key: z.string().optional().or(z.literal('')),
        product_id: z.string(),
        variant_id: z.string().optional().or(z.literal('')),
        quantity: z.string(),
        product_type: z.string().trim().max(32).optional().or(z.literal('')),
        note: z.string().trim().max(500).optional().or(z.literal('')),
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
    const cartKey = String(req.validated.body.cart_key || '').trim();
    const variantIdRaw = String(req.validated.body.variant_id || '').trim();
    const variantId = variantIdRaw ? Number(variantIdRaw) : null;

    const product = inventoryRepo.getById(productId);
    if (!product || product.archived || !product.visibility) {
      // Remove by key if provided; otherwise fallback to product-only key.
      if (cartKey && req.session.cart?.items) delete req.session.cart.items[cartKey];
      cartService.setQty(req.session, { productId }, 0);
      req.session.flash = { type: 'error', message: 'Product is no longer available and was removed from your cart.' };
      return res.redirect('/cart');
    }

    let variant = null;
    if (variantId != null && Number.isFinite(variantId) && variantId > 0) {
      const v = productVariantRepo.getById(variantId);
      if (!v || !v.active || v.product_id !== productId) {
        req.session.flash = { type: 'error', message: 'Selected type is not available.' };
        return res.redirect('/cart');
      }
      variant = v;
    }

    const availableStock = variant ? Math.max(0, Math.floor(Number(variant.stock || 0))) : inventoryRepo.getEffectiveAvailableStock(productId);
    const desiredQty = Math.max(0, Math.min(99, Math.floor(quantity)));

    // Prevent adding a new product (via update) that would mix FIUU merchant accounts.
    try {
      cartService.sanitizeCart(req.session);
      const cart = cartService.getCart(req.session);
      const alreadyHasProduct = Object.entries(cart.items || {}).some(([k, v]) => {
        if (v && typeof v === 'object' && Number(v.product_id) === productId) return true;
        const s = String(k || '').trim();
        return s === String(productId) || s === `p:${productId}`;
      });
      if (desiredQty > 0 && !alreadyHasProduct) {
        const lines = buildCartLinesForFiuuAccountCheck(req.session);
        lines.push({ product, quantity: 1 });

        const resolved = fiuuAccountsService.resolveAccountForCartItems(lines);
        if (!resolved.ok && resolved.reason === 'multiple_accounts_required') {
          req.session.flash = {
            type: 'error',
            message:
              'This item uses a different payment merchant account from items already in your cart. Please checkout separately, or clear your cart first.',
          };
          return res.redirect('/cart');
        }
      }
    } catch (_) {
      // ignore
    }

    if (desiredQty > 0 && availableStock <= 0) {
      if (cartKey && req.session.cart?.items) delete req.session.cart.items[cartKey];
      cartService.setQty(req.session, { productId, variantId: variant ? variant.variant_id : null }, 0);
      req.session.flash = { type: 'error', message: 'This product is out of stock and was removed from your cart.' };
      return res.redirect('/cart');
    }

    const cappedQty = Math.min(desiredQty, availableStock);

    const existingLine = (cartKey && req.session.cart?.items) ? req.session.cart.items[cartKey] : null;
    const existingNote = (existingLine && typeof existingLine === 'object') ? String(existingLine.note || '').trim() : '';
    const effectiveNote = Object.prototype.hasOwnProperty.call(req.validated.body, 'note') ? String(req.validated.body.note || '').trim() : existingNote;

    const newKey = variant ? `v:${variant.variant_id}` : `p:${productId}`;
    const changingKey = Boolean(cartKey) && cartKey !== newKey;
    if (changingKey && req.session.cart?.items) {
      delete req.session.cart.items[cartKey];
    }

    cartService.setQty(req.session, { productId, variantId: variant ? variant.variant_id : null, variantLabel: variant ? variant.label : '' }, cappedQty);

    if (cappedQty > 0) {
      if (Object.prototype.hasOwnProperty.call(req.validated.body, 'note')) {
        cartService.setNote(req.session, { productId, variantId: variant ? variant.variant_id : null }, effectiveNote);
      }

      if (!variant && Object.prototype.hasOwnProperty.call(req.validated.body, 'product_type')) {
        cartService.setType(req.session, { productId }, req.validated.body.product_type);
      }
    }

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
