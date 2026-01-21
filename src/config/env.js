const dotenv = require('dotenv');

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,

  logging: {
    level: process.env.LOG_LEVEL || ((process.env.NODE_ENV || 'development') === 'production' ? 'info' : 'debug'),
    dir: process.env.LOG_DIR || 'storage/logs',
    toFile: (() => {
      const raw = String(process.env.LOG_TO_FILE || '').trim().toLowerCase();
      // Prefer logging to stdout and let PM2 handle log files + rotation.
      // Only enable direct file logging when explicitly requested.
      if (!raw) return false;
      return raw === 'true' || raw === '1' || raw === 'yes';
    })(),
  },

  trustProxy: (() => {
    const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
    if (!raw) return (process.env.NODE_ENV || 'development') === 'production' ? 1 : 0;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    return (process.env.NODE_ENV || 'development') === 'production' ? 1 : 0;
  })(),

  // Display-only formatting preferences (timestamps are stored in SQLite as UTC datetime('now')).
  appTimeZone: process.env.APP_TIME_ZONE || 'Asia/Kuala_Lumpur',
  appLocale: process.env.APP_LOCALE || 'en-MY',

  sessionSecret: required('SESSION_SECRET'),
  secureCookies: (process.env.SECURE_COOKIES || 'false').toLowerCase() === 'true',
  iframeAncestors: process.env.IFRAME_ANCESTORS || "'self'",

  csrfAllowedOrigins: (process.env.CSRF_ALLOWED_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),

  adminUsernames: (process.env.ADMIN_USERNAMES || '').split(',').map((v) => v.trim()).filter(Boolean),
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((v) => v.trim()).filter(Boolean),

  sqlitePath: process.env.SQLITE_PATH || 'storage/data/app.db',

  uploadMaxBytes: Number(process.env.UPLOAD_MAX_MB || 8) * 1024 * 1024,
  productImageMaxWidth: Number(process.env.PRODUCT_IMAGE_MAX_WIDTH || 1200),
  slipImageMaxWidth: Number(process.env.SLIP_IMAGE_MAX_WIDTH || 1600),

  email: {
    enabled: (process.env.EMAIL_ENABLED || '').trim()
      ? (process.env.EMAIL_ENABLED || 'true').toLowerCase() === 'true'
      : true,
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    smtpSecure: (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com',
    orderNotifyTo: process.env.ORDER_NOTIFY_TO || 'customerservice@arvending.com.my',
  },

  passwordResetTokenTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60),

  rateLimit: {
    enabled: (() => {
      const raw = String(process.env.RATE_LIMIT_ENABLED || '').trim().toLowerCase();
      if (!raw) return (process.env.NODE_ENV || 'development') === 'production';
      return raw === 'true' || raw === '1' || raw === 'yes';
    })(),
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000),
    limit: Number(process.env.RATE_LIMIT_MAX || 1200),
  },

  fiuu: {
    merchantId: process.env.FIUU_MERCHANT_ID || '',
    verifyKey: process.env.FIUU_VERIFY_KEY || '',
    secretKey: process.env.FIUU_SECRET_KEY || '',
    gatewayUrl: process.env.FIUU_GATEWAY_URL || '',
    apiBase: process.env.FIUU_API_BASE || '',
    paymentMethod: process.env.FIUU_PAYMENT_METHOD || '',
    currency: process.env.FIUU_CURRENCY || 'MYR',
    requestMethod: (process.env.FIUU_REQUEST_METHOD || 'GET').toUpperCase(),
    vcodeMode: (process.env.FIUU_VCODE_MODE || 'legacy').toLowerCase(),
    logRequests: (process.env.FIUU_LOG_REQUESTS || (process.env.NODE_ENV === 'development' ? 'true' : 'false')).toLowerCase() === 'true',
    returnUrlPath: process.env.FIUU_RETURN_URL || '/payment/return',
    callbackUrlPath: process.env.FIUU_CALLBACK_URL || '/payment/callback',
    cancelUrlPath: process.env.FIUU_CANCEL_URL || '/payment/cancel',
  },
};

module.exports = { env, required };
