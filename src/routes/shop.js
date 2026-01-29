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

  // Product SEO
  const galleryUrls = [];
  if (product && product.product_image) galleryUrls.push(product.product_image);
  (images || []).forEach((img) => { if (img && img.image_url) galleryUrls.push(img.image_url); });
  const uniqGallery = [...new Set(galleryUrls.filter(Boolean))];
  const effStock = (product.available_stock == null ? product.stock : product.available_stock);

  const descText = String(product.description || '').trim();
  const shortDesc = (descText.length > 180) ? `${descText.slice(0, 177)}...` : descText;
  const currency = 'MYR';
  const price = (Number(product.price || 0) / 100).toFixed(2);
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
