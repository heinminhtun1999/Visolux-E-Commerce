/* eslint-disable no-console */

// Factory reset for Visolux: wipes ALL persisted data.
// - Deletes SQLite DB files (app db + sessions db) including -wal/-shm.
// - Empties storage/uploads (products/slips/tmp/site) and optionally storage/logs.
//
// Usage:
//   node scripts/factory-reset.js --yes
//   node scripts/factory-reset.js --dry-run
//   node scripts/factory-reset.js --yes --keep-logs
//
// Recommended in production:
//   pm2 stop visolux
//   node scripts/factory-reset.js --yes
//   pm2 startOrReload ecosystem.config.cjs --env production

const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    yes: args.has('--yes') || args.has('-y'),
    dryRun: args.has('--dry-run'),
    keepLogs: args.has('--keep-logs'),
    dbOnly: args.has('--db-only'),
    uploadsOnly: args.has('--uploads-only'),
  };
}

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function safeUnlink(filePath, { dryRun }) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (!dryRun) fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    throw new Error(`Failed to delete file: ${filePath} (${e && e.message ? e.message : e})`);
  }
}

function emptyDir(dirPath, { dryRun }) {
  if (!fs.existsSync(dirPath)) return { existed: false, deleted: 0 };
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) return { existed: false, deleted: 0 };

  let deleted = 0;
  const entries = fs.readdirSync(dirPath);
  for (const name of entries) {
    const abs = path.join(dirPath, name);
    if (!dryRun) {
      fs.rmSync(abs, { recursive: true, force: true });
    }
    deleted += 1;
  }
  return { existed: true, deleted };
}

async function confirmOrExit({ yes }) {
  if (yes) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(
      'DANGER: This will permanently delete ALL data (DB + uploads). Type WIPE to continue: ',
      (a) => resolve(String(a || '').trim())
    );
  });
  rl.close();
  if (answer !== 'WIPE') {
    console.log('Aborted.');
    process.exit(2);
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.dbOnly && opts.uploadsOnly) {
    console.error('Invalid flags: cannot combine --db-only and --uploads-only');
    process.exit(2);
  }

  const sqliteRel = process.env.SQLITE_PATH || 'storage/data/app.db';
  const appDbPath = resolvePath(sqliteRel);
  const sessionDbPath = path.join(process.cwd(), 'storage', 'data', 'sessions.db');

  const uploadDirs = [
    path.join(process.cwd(), 'storage', 'uploads', 'products'),
    path.join(process.cwd(), 'storage', 'uploads', 'slips'),
    path.join(process.cwd(), 'storage', 'uploads', 'tmp'),
    path.join(process.cwd(), 'storage', 'uploads', 'site'),
  ];
  const logsDir = path.join(process.cwd(), 'storage', 'logs');

  console.log(
    JSON.stringify(
      {
        dryRun: opts.dryRun,
        keepLogs: opts.keepLogs,
        dbOnly: opts.dbOnly,
        uploadsOnly: opts.uploadsOnly,
        appDbPath,
        sessionDbPath,
        uploadDirs,
        logsDir,
      },
      null,
      2
    )
  );

  await confirmOrExit(opts);

  const summary = {
    deletedFiles: [],
    emptiedDirs: [],
  };

  if (!opts.uploadsOnly) {
    const dbFiles = [
      appDbPath,
      `${appDbPath}-wal`,
      `${appDbPath}-shm`,
      sessionDbPath,
      `${sessionDbPath}-wal`,
      `${sessionDbPath}-shm`,
    ];
    for (const f of dbFiles) {
      const deleted = safeUnlink(f, { dryRun: opts.dryRun });
      if (deleted) summary.deletedFiles.push(f);
    }
  }

  if (!opts.dbOnly) {
    for (const d of uploadDirs) {
      const r = emptyDir(d, { dryRun: opts.dryRun });
      summary.emptiedDirs.push({ dir: d, ...r });
    }
    if (!opts.keepLogs) {
      const r = emptyDir(logsDir, { dryRun: opts.dryRun });
      summary.emptiedDirs.push({ dir: logsDir, ...r });
    }
  }

  console.log('\nDONE. Summary:');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nNext steps:');
  console.log('- Start the app (schema auto-creates on boot)');
  console.log('- Recreate an admin user: npm run create-admin -- --username admin --email admin@example.com --password "StrongPass123!"');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
