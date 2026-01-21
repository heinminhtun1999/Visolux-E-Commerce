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
const { ensureCsrfToken, csrfProtection } = require('./middleware/csrf');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

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

  app.set('trust proxy', env.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));
  app.set('view cache', env.nodeEnv === 'production');

  // Iframe embedding: use CSP frame-ancestors; don't use X-Frame-Options deny.
  const fiuuOrigin = getFiuuGatewayOrigin();
  const formAction = ["'self'"];
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

  // Attach view locals early so error pages render safely.
  app.use(attachLocals);

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
