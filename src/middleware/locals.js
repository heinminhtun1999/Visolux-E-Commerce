const { formatMoney } = require('../utils/money');
const { icon } = require('../utils/icons');
const { formatDateTime } = require('../utils/datetime');
const adminNotificationRepo = require('../repositories/adminNotificationRepo');
const settingsRepo = require('../repositories/settingsRepo');
const contactMessageRepo = require('../repositories/contactMessageRepo');

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

function attachLocals(req, res, next) {
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

  // Site branding
  try {
    res.locals.siteLogoUrl = settingsRepo.get('site.logo.image', '');
  } catch (_) {
    res.locals.siteLogoUrl = '';
  }
  res.locals.siteName = 'Visolux';

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
