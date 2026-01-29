const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const SQLiteStoreFactory = require('connect-sqlite3');

const { env } = require('./config/env');
const { getDb } = require('./db/db');
const { attachLocals } = require('./middleware/locals');
const { logoutClosedAccountSessions } = require('./middleware/auth');
const { ensureCsrfToken, csrfProtection } = require('./middleware/csrf');
const { notFoundHandler, errorHandler } = require('./middleware/errors');
const settingsRepo = require('./repositories/settingsRepo');
const { logger } = require('./utils/logger');
const categoryRepo = require('./repositories/categoryRepo');

const shopRoutes = require('./routes/shop');
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payments');
const uploadRoutes = require('./routes/uploads');

function getFiuuGatewayOrigin() {
  const raw = String(env.fiuu.gatewayUrl || '').trim();
  if (!raw) return null;
  try {
    // Support templates like https://pay.fiuu.com/RMS/pay/{MerchantID}/{Payment_Method}
    const candidate = raw
      .replaceAll('{MerchantID}', 'merchant')
      .replaceAll('{Payment_Method}', 'method');
    return new URL(candidate).origin;
  } catch (_) {
    return null;
  }
}

function createApp() {
  const app = express();

  // Health check for uptime monitors. Keep it before session/CSRF so it doesn't write cookies.
  app.locals.startedAt = Date.now();
  app.get('/healthz', (req, res) => {
    let dbOk = true;
    let dbError = null;
    try {
      // Lightweight DB check (also ensures schema/migrations can run).
      const db = getDb();
      db.prepare('SELECT 1 as ok').get();
    } catch (e) {
      dbOk = false;
      dbError = String(e && e.message ? e.message : e);
    }

    const ok = dbOk;
    return res.status(ok ? 200 : 503).json({
      ok,
      status: ok ? 'ok' : 'db_error',
      nodeEnv: env.nodeEnv,
      uptimeSec: Math.round(process.uptime()),
      startedAt: new Date(app.locals.startedAt).toISOString(),
      now: new Date().toISOString(),
      ...(ok ? {} : { error: dbError }),
    });
  });

  // Use the configured branding logo as the site icon.
  // Keep it before session/CSRF so it doesn't write cookies.
  app.get('/favicon.ico', (req, res) => {
    try {
      const logoUrl = settingsRepo.get('site.logo.image', '');
      if (logoUrl) return res.redirect(302, logoUrl);
    } catch (_) {
      // ignore
    }
    return res.status(204).end();
  });

  // robots.txt: keep before session/CSRF so crawlers don't get cookies.
  app.get('/robots.txt', (req, res) => {
    const base = String(env.appBaseUrl || '').replace(/\/+$/, '');
    const sitemapUrl = base ? `${base}/sitemap.xml` : '/sitemap.xml';
    res.type('text/plain');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(
      [
        'User-agent: *',
        'Disallow: /admin',
        'Disallow: /login',
        'Disallow: /register',
        'Disallow: /forgot-password',
        'Disallow: /reset-password',
        'Disallow: /cart',
        'Disallow: /orders',
        'Disallow: /checkout',
        'Disallow: /payment',
        'Allow: /uploads/',
        `Sitemap: ${sitemapUrl}`,
        '',
      ].join('\n')
    );
  });

  // sitemap.xml: include core pages + category pages + product pages.
  // Keep before session/CSRF so crawlers don't get cookies.
  app.get('/sitemap.xml', (req, res) => {
    const base = String(env.appBaseUrl || '').replace(/\/+$/, '');
    const abs = (p) => (base ? `${base}${p}` : p);
    const escapeXml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const toLastMod = (v) => {
      const d = v ? new Date(v) : null;
      if (!d || Number.isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    };

    const urls = [];
    const pushUrl = (loc, lastmod) => {
      const lm = toLastMod(lastmod);
      urls.push({ loc, lastmod: lm });
    };

    // Static/public pages
    pushUrl(abs('/'), null);
    pushUrl(abs('/products'), null);
    pushUrl(abs('/how-to-order'), null);
    pushUrl(abs('/privacy'), null);
    pushUrl(abs('/terms'), null);

    // Categories
    try {
      const cats = categoryRepo.listPublic();
      (cats || []).forEach((c) => {
        if (!c || !c.slug) return;
        pushUrl(abs(`/categories/${encodeURIComponent(c.slug)}`), c.updated_at || c.created_at || null);
      });
    } catch (_) {
      // ignore
    }

    // Products
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT i.product_id, i.updated_at, i.created_at
         FROM inventory i
         JOIN categories c ON c.slug = i.category
         WHERE i.archived=0 AND i.visibility=1 AND c.archived=0 AND c.visible=1`
      ).all();
      (rows || []).forEach((r) => {
        if (!r || !r.product_id) return;
        pushUrl(abs(`/products/${r.product_id}`), r.updated_at || r.created_at || null);
      });
    } catch (_) {
      // ignore
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => {
        const loc = escapeXml(u.loc);
        const lm = u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : '';
        return `  <url><loc>${loc}</loc>${lm}</url>`;
      }).join('\n') +
      `\n</urlset>\n`;

    res.type('application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(xml);
  });

  app.set('trust proxy', env.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));
  app.set('view cache', env.nodeEnv === 'production');

  // Iframe embedding: use CSP frame-ancestors; don't use X-Frame-Options deny.
  const fiuuOrigin = getFiuuGatewayOrigin();
  const formAction = ["'self'", 'https://pay.fiuu.com', 'https://sandbox-payment.fiuu.com'];
  if (fiuuOrigin) formAction.push(fiuuOrigin);

  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // Allow the admin rich-text editor (TinyMCE) CDN.
          'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          'script-src-elem': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          'script-src-attr': ["'unsafe-inline'"],
          'frame-ancestors': env.iframeAncestors.split(/\s+/).filter(Boolean),
          // Allow posting the hosted-payment form to Fiuu.
          'form-action': formAction,
        },
      },
    })
  );

  if (env.rateLimit.enabled) {
    app.use(
      rateLimit({
        windowMs: env.rateLimit.windowMs,
        limit: env.rateLimit.limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: (req) => {
          const p = String(req.path || '');
          if (p === '/healthz') return true;
          if (p === '/payment/callback' || p === '/payment/return' || p === '/payment/refund/notify') return true;
          if (p.startsWith('/public/')) return true;
          if (p.startsWith('/uploads/')) return true;
          if (p === '/favicon.ico') return true;
          return false;
        },
      })
    );
  }

  const staticOpts = env.nodeEnv === 'development'
    ? { etag: false, lastModified: false, maxAge: 0 }
    : { immutable: true, maxAge: '7d' };

  app.use('/public', express.static(path.join(process.cwd(), 'public'), staticOpts));
  app.use('/uploads/products', express.static(path.join(process.cwd(), 'storage', 'uploads', 'products'), staticOpts));
  app.use('/uploads/site', express.static(path.join(process.cwd(), 'storage', 'uploads', 'site'), staticOpts));

  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const SQLiteStore = SQLiteStoreFactory(session);
  app.use(
    session({
      name: 'visolux.sid',
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new SQLiteStore({
        db: 'sessions.db',
        dir: path.join(process.cwd(), 'storage', 'data'),
      }),
      cookie: {
        httpOnly: true,
        secure: env.secureCookies,
        sameSite: env.secureCookies ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // If an account is closed after a session was created, clear the session user.
  // Keep it before attachLocals so the UI immediately reflects the logged-out state.
  app.use(logoutClosedAccountSessions);

  // Attach view locals early so error pages render safely.
  app.use(attachLocals);

  // Guard against accidental double-sends or responses after client disconnect.
  // This prevents ERR_HTTP_HEADERS_SENT from bubbling into uncaughtException.
  app.use((req, res, next) => {
    const isClosed = () => Boolean(req.aborted || res.headersSent || res.writableEnded);

    const wrap = (name) => {
      const original = res[name].bind(res);
      res[name] = (...args) => {
        if (isClosed()) {
          logger.error(
            {
              req: { method: req.method, url: req.originalUrl, ip: req.ip },
              res: { headersSent: res.headersSent, writableEnded: res.writableEnded },
              err: { code: 'ERR_HTTP_HEADERS_SENT' },
            },
            `${name} called after response finished`
          );
          return res;
        }
        return original(...args);
      };
    };

    wrap('render');
    wrap('send');
    wrap('json');
    wrap('redirect');
    return next();
  });

  // CSRF: required because cookies are cross-site in iframe mode (SameSite=None).
  // Exempt payment return/callback because they are initiated by the gateway.
  app.use(ensureCsrfToken);
  app.use(csrfProtection({ exemptPaths: ['/payment/callback', '/payment/return', '/payment/refund/notify'] }));

  // Home page is provided by shop routes.

  app.use('/', shopRoutes);
  app.use('/', authRoutes);
  app.use('/', orderRoutes);
  app.use('/', uploadRoutes);
  app.use('/', paymentRoutes);
  app.use('/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
