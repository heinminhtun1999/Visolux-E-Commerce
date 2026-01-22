const { env } = require('../config/env');
const { logger } = require('../utils/logger');

function notFoundHandler(req, res) {
  res.status(404);
  if (req.accepts('html')) return res.render('shared/error', { title: 'Not Found', message: 'Page not found.' });
  return res.json({ error: 'not_found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // If a response was already started (e.g. redirect sent) we cannot safely render an error page.
  // Attempting to do so throws ERR_HTTP_HEADERS_SENT and can crash the process if unhandled.
  if (res.headersSent) {
    logger.error(
      {
        err,
        req: {
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
        },
      },
      'request failed after headers sent'
    );
    return next(err);
  }

  const status = Number(err.status || 500);
  const isDev = env.nodeEnv === 'development';
  const message = isDev ? (err.message || 'Request failed.') : (status >= 500 ? 'Something went wrong.' : (err.message || 'Request failed.'));
  const details = isDev
    ? {
        ...(err.details ? { details: err.details } : {}),
        stack: err && err.stack ? String(err.stack) : undefined,
      }
    : undefined;

  logger.error(
    {
      err,
      status,
      req: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
      },
    },
    'request failed'
  );

  res.status(status);
  if (req.accepts('html')) return res.render('shared/error', { title: 'Error', message, details });
  return res.json({ error: 'server_error', message });
}

module.exports = { notFoundHandler, errorHandler };
