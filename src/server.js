const { createApp } = require('./app');
const { env } = require('./config/env');
const { getDb } = require('./db/db');

function main() {
  // Ensure DB initialized on boot
  getDb();

  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[visolux] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

main();
