const { createApp } = require('./app');
const { env } = require('./config/env');
const { getDb } = require('./db/db');
const { logger } = require('./utils/logger');

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal({ err }, 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  // Let PM2/systemd restart us.
  process.exit(1);
});

function main() {
  // Ensure DB initialized on boot
  getDb();

  const app = createApp();
  app.listen(env.port, () => {
    logger.info({ port: env.port }, `[visolux] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

main();
