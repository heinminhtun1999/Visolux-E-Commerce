const { createApp } = require('./app');
const { env } = require('./config/env');
const { getDb } = require('./db/db');
const orderRepo = require('./repositories/orderRepo');
const { logger } = require('./utils/logger');

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal({ err }, 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');

  // This commonly happens when code attempts to write/render after a redirect/response.
  // It's still a bug, but restarting the whole process causes user-visible 502s.
  if (err && err.code === 'ERR_HTTP_HEADERS_SENT') return;

  // Let PM2/systemd restart us for all other uncaught exceptions.
  process.exit(1);
});

function main() {
  // Ensure DB initialized on boot
  getDb();

  const app = createApp();
  app.listen(env.port, () => {
    logger.info({ port: env.port }, `[visolux|arvending] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const runAutoCompleteShippedOrders = () => {
    try {
      const updated = orderRepo.autoCompleteShippedOrders({ days: 30 });
      if (updated.length) {
        logger.info({ count: updated.length }, 'Auto-completed shipped orders');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to auto-complete shipped orders');
    }
  };

  // Run once on boot and then daily.
  runAutoCompleteShippedOrders();
  setInterval(runAutoCompleteShippedOrders, 24 * 60 * 60 * 1000);
}

main();
