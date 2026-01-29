const { formatMoney } = require('../utils/money');
const { icon } = require('../utils/icons');
const { formatDateTime } = require('../utils/datetime');
const adminNotificationRepo = require('../repositories/adminNotificationRepo');
const settingsRepo = require('../repositories/settingsRepo');
const contactMessageRepo = require('../repositories/contactMessageRepo');
const categoryRepo = require('../repositories/categoryRepo');
const cartService = require('../services/cartService');
const { env } = require('../config/env');

function titleCase(s) {
  return String(s || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function labelForSegment(seg, prevSeg) {
  const s = String(seg || '').trim();
  if (!s) return '';

  const map = {
    products: 'Products',
    cart: 'Cart',
    orders: 'Orders',
    history: 'History',
    checkout: 'Checkout',
    account: 'Account',
    admin: 'Admin',
    site: 'Site',
    login: 'Sign in',
    register: 'Register',
    'forgot-password': 'Forgot Password',
    'reset-password': 'Reset Password',
  };

  if (map[s]) return map[s];
  if (/^\d+$/.test(s) && (prevSeg === 'orders' || prevSeg === 'products')) return `#${s}`;
  return titleCase(s);
}

function buildBreadcrumbs(pathname) {
  const path = String(pathname || '/').split('?')[0];
  const parts = path.split('/').filter(Boolean);

  // Always include a home link.
  const crumbs = [{ label: 'Home', href: '/' }];

  let acc = '';
  for (let i = 0; i < parts.length; i += 1) {
    const seg = parts[i];
    acc += `/${seg}`;
    crumbs.push({
      label: labelForSegment(seg, parts[i - 1] || ''),
      href: acc,
    });
  }

  // Don't show duplicates like Home -> Products when already on /products.
  if (crumbs.length === 2 && crumbs[1].href === '/products') return crumbs;
  return crumbs;
}

function normalizeBaseUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function escapeJsonLdUrl(u) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  // JSON.stringify will escape as needed; this just keeps things clean.
  return raw;
}

function buildBreadcrumbListJsonLd({ siteUrl, breadcrumbs }) {
  const base = normalizeBaseUrl(siteUrl);
  const crumbs = Array.isArray(breadcrumbs) ? breadcrumbs : [];
  if (!base || !crumbs.length) return null;

  const itemListElement = crumbs
    .filter((c) => c && c.label && c.href)
    .map((c, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: String(c.label),
      item: escapeJsonLdUrl(base + String(c.href)),
    }));

  if (!itemListElement.length) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement,
  };
}

function attachLocals(req, res, next) {
  // Keep cart consistent with current effective stock (stock - reservations).
  // This prevents "ghost" cart counts when items become unavailable.
  if (!req.session.user?.isAdmin) {
    try {
      const result = cartService.sanitizeCart(req.session);
      if (result?.changed && !req.session.flash) {
        const removedCount = (result.removed || []).length;
        const adjustedCount = (result.adjusted || []).length;
        const removed = Array.isArray(result.removed) ? result.removed : [];
        const anyTemp = removed.some((r) => String(r?.reason || '') === 'temporarily_out_of_stock');
        let message = '';
        if (removedCount > 0 && adjustedCount > 0) {
          message = 'Some items were removed and some quantities were adjusted due to stock changes.';
        } else if (removedCount > 0) {
          message = anyTemp
            ? 'Some items were removed from your cart because they are temporarily out of stock.'
            : 'Some items were removed from your cart because they are out of stock.';
        } else if (adjustedCount > 0) {
          message = 'Some cart quantities were reduced due to limited stock.';
        }
        if (message) req.session.flash = { type: 'error', message };
      }
    } catch (_) {
      // ignore
    }
  }

  res.locals.currentPath = req.path;
  res.locals.currentUrl = req.originalUrl;
  res.locals.formatMoney = formatMoney;
  res.locals.formatDateTime = formatDateTime;
  res.locals.icon = icon;
  res.locals.currentUser = req.session.user || null;
  res.locals.isAdmin = Boolean(req.session.user?.isAdmin);
  res.locals.cart = req.session.cart || { items: {} };
  const items = (res.locals.cart && res.locals.cart.items) ? res.locals.cart.items : {};
  res.locals.cartItemCount = Object.values(items).reduce((sum, v) => {
    const n = Number(v);
    return sum + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }, 0);
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  res.locals.breadcrumbs = buildBreadcrumbs(req.path);

  // Store navigation: categories dropdown (public pages only)
  if (!String(req.path || '').startsWith('/admin')) {
    try {
      res.locals.navCategories = categoryRepo.listPublic();
    } catch (_) {
      res.locals.navCategories = [];
    }
  } else {
    res.locals.navCategories = [];
  }

  // Site branding
  try {
    res.locals.siteLogoUrl = settingsRepo.get('site.logo.image', '');
  } catch (_) {
    res.locals.siteLogoUrl = '';
  }

  // Prefer admin-configurable site name, but keep a strong default.
  try {
    res.locals.siteName = String(settingsRepo.get('site.name', 'Visolux Store') || '').trim() || 'Visolux Store';
  } catch (_) {
    res.locals.siteName = 'Visolux Store';
  }

  try {
    res.locals.siteDescription = String(settingsRepo.get('site.meta.description', '') || '').trim();
  } catch (_) {
    res.locals.siteDescription = '';
  }

  res.locals.siteUrl = normalizeBaseUrl(env.appBaseUrl);
  res.locals.canonicalUrl = res.locals.siteUrl ? (res.locals.siteUrl + (req.path || '/')) : (req.path || '/');

  // Robots / indexing defaults
  const p = String(req.path || '');
  const noindex = (
    p.startsWith('/admin') ||
    p === '/login' ||
    p === '/register' ||
    p === '/forgot-password' ||
    p === '/reset-password' ||
    p.startsWith('/cart') ||
    p.startsWith('/orders') ||
    p === '/checkout' ||
    p.startsWith('/payment')
  );
  res.locals.robotsMeta = noindex
    ? 'noindex,nofollow'
    : 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
  res.setHeader('X-Robots-Tag', res.locals.robotsMeta);

  // Baseline structured data (public pages only)
  res.locals.structuredData = [];
  if (!p.startsWith('/admin') && res.locals.siteUrl) {
    const orgId = `${res.locals.siteUrl}/#organization`;
    const websiteId = `${res.locals.siteUrl}/#website`;
    res.locals.structuredData.push({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': orgId,
      name: res.locals.siteName,
      url: res.locals.siteUrl,
      ...(res.locals.siteLogoUrl ? { logo: escapeJsonLdUrl(res.locals.siteLogoUrl) } : {}),
    });

    res.locals.structuredData.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': websiteId,
      url: res.locals.siteUrl,
      name: res.locals.siteName,
      publisher: { '@id': orgId },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${res.locals.siteUrl}/products?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    });

    const breadcrumbLd = buildBreadcrumbListJsonLd({ siteUrl: res.locals.siteUrl, breadcrumbs: res.locals.breadcrumbs });
    if (breadcrumbLd) res.locals.structuredData.push(breadcrumbLd);
  }

  // Footer links/content
  try {
    res.locals.footerTechnicianSupportUrl = settingsRepo.get('site.footer.technician_support_url', '');
  } catch (_) {
    res.locals.footerTechnicianSupportUrl = '';
  }
  try {
    res.locals.footerCopyright = settingsRepo.get('site.footer.copyright', '');
  } catch (_) {
    res.locals.footerCopyright = '';
  }

  // Contact info (admin-configurable)
  const getSetting = (key, fallback) => {
    try {
      return settingsRepo.get(key, fallback || '');
    } catch (_) {
      return fallback || '';
    }
  };

  res.locals.contactInfo = {
    phone: String(getSetting('site.contact.phone', '') || '').trim(),
    whatsapp: String(getSetting('site.contact.whatsapp', '') || '').trim(),
    email: String(getSetting('site.contact.email', '') || '').trim(),
    address: String(getSetting('site.contact.address', '') || '').trim(),
    facebook_url: String(getSetting('site.contact.facebook_url', '') || '').trim(),
  };

  // Admin-only UI: unread notifications badge
  if (res.locals.isAdmin) {
    try {
      res.locals.adminUnreadNotificationCount = adminNotificationRepo.countUnread();
    } catch (_) {
      res.locals.adminUnreadNotificationCount = 0;
    }

    try {
      res.locals.adminUnreadContactMessageCount = contactMessageRepo.countUnread();
    } catch (_) {
      res.locals.adminUnreadContactMessageCount = 0;
    }
  } else {
    res.locals.adminUnreadNotificationCount = 0;
    res.locals.adminUnreadContactMessageCount = 0;
  }
  next();
}

module.exports = { attachLocals };
