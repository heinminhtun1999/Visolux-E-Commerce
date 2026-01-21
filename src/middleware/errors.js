const { env } = require('../config/env');

function notFoundHandler(req, res) {
  res.status(404);
  if (req.accepts('html')) return res.render('shared/error', { title: 'Not Found', message: 'Page not found.' });
  return res.json({ error: 'not_found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = Number(err.status || 500);
  const isDev = env.nodeEnv === 'development';
  const message = isDev ? (err.message || 'Request failed.') : (status >= 500 ? 'Something went wrong.' : (err.message || 'Request failed.'));
  const details = isDev
    ? {
        ...(err.details ? { details: err.details } : {}),
        stack: err && err.stack ? String(err.stack) : undefined,
      }
    : undefined;

  // eslint-disable-next-line no-console
  console.error(err);

  res.status(status);
  if (req.accepts('html')) return res.render('shared/error', { title: 'Error', message, details });
  return res.json({ error: 'server_error', message });
}

module.exports = { notFoundHandler, errorHandler };
