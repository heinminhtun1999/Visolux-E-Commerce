const fs = require('fs');
const path = require('path');
const pino = require('pino');

const { env } = require('../config/env');

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (_) {
    // Best-effort. If this fails, we still log to stdout.
  }
}

function createLogger() {
  const isProd = env.nodeEnv === 'production';
  const level = env.logging?.level || (isProd ? 'info' : 'debug');
  const logDir = env.logging?.dir || 'storage/logs';
  const toFile = Boolean(env.logging?.toFile);

  const redact = [
    'req.headers.cookie',
    'req.headers.authorization',
    'password',
    'newPassword',
    'token',
    'secret',
    'sessionSecret',
    'smtpPass',
    'fiuu.secretKey',
    'fiuu.verifyKey',
  ];

  const base = {
    app: 'visolux',
    env: env.nodeEnv,
  };

  const streams = [{ level, stream: process.stdout }];

  if (toFile) {
    const resolvedDir = path.isAbsolute(logDir) ? logDir : path.join(process.cwd(), logDir);
    ensureDir(resolvedDir);

    streams.push({ level, stream: pino.destination(path.join(resolvedDir, 'app.log')) });
    streams.push({ level: 'error', stream: pino.destination(path.join(resolvedDir, 'error.log')) });
  }

  return pino(
    {
      level,
      base,
      redact,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams)
  );
}

const logger = createLogger();

module.exports = { logger };
