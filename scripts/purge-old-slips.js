/* eslint-disable no-console */

// Purge old bank-slip images from disk, while keeping a DB audit trail.
//
// Usage:
//   node scripts/purge-old-slips.js --days 365 --dry-run
//   node scripts/purge-old-slips.js --days 365
//
// Notes:
// - Marks offline_bank_transfers.slip_deleted=1 and sets slip_deleted_at.
// - Does not delete the offline_bank_transfers row (keeps bank/ref metadata).

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { days: 365, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i] || '');
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--days') {
      const v = Number(argv[i + 1]);
      i += 1;
      if (Number.isFinite(v) && v > 0) out.days = Math.floor(v);
    }
  }
  return out;
}

function slipFileFromPublicPath(slipPath) {
  const p = String(slipPath || '');
  const prefix = '/uploads/slips/';
  if (!p.startsWith(prefix)) return null;
  const file = path.basename(p.slice(prefix.length));
  if (!file) return null;
  return file;
}

function main() {
  const { days, dryRun } = parseArgs(process.argv);

  const sqliteRel = process.env.SQLITE_PATH || 'storage/data/app.db';
  const sqlitePath = path.isAbsolute(sqliteRel) ? sqliteRel : path.join(process.cwd(), sqliteRel);

  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath);
  db.pragma('foreign_keys = ON');

  // Ensure columns exist (in case script is run before app boot).
  const cols = db.prepare("PRAGMA table_info('offline_bank_transfers')").all();
  const hasSlipDeleted = cols.some((c) => c.name === 'slip_deleted');
  const hasSlipDeletedAt = cols.some((c) => c.name === 'slip_deleted_at');
  if (!hasSlipDeleted) db.exec('ALTER TABLE offline_bank_transfers ADD COLUMN slip_deleted INTEGER NOT NULL DEFAULT 0');
  if (!hasSlipDeletedAt) db.exec('ALTER TABLE offline_bank_transfers ADD COLUMN slip_deleted_at TEXT');

  const rows = db
    .prepare(
      `SELECT id, order_id, slip_image_path, uploaded_at
       FROM offline_bank_transfers
       WHERE COALESCE(slip_deleted, 0) = 0
         AND datetime(uploaded_at) < datetime('now', ?)
       ORDER BY datetime(uploaded_at) ASC, id ASC`
    )
    .all(`-${days} days`);

  const slipsDir = path.join(process.cwd(), 'storage', 'uploads', 'slips');

  let deletedFiles = 0;
  let markedRows = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      const file = slipFileFromPublicPath(r.slip_image_path);
      const abs = file ? path.join(slipsDir, file) : null;

      if (abs && fs.existsSync(abs)) {
        if (!dryRun) fs.unlinkSync(abs);
        deletedFiles += 1;
      }

      if (!dryRun) {
        db.prepare('UPDATE offline_bank_transfers SET slip_deleted=1, slip_deleted_at=datetime(\'now\') WHERE id=?').run(r.id);
      }
      markedRows += 1;

      console.log(
        `${dryRun ? '[dry-run]' : '[purged]'} order_id=${r.order_id} id=${r.id} uploaded_at=${r.uploaded_at} file=${file || '-'} ${
          abs ? `path=${abs}` : ''
        }`
      );
    }
  });

  tx();

  console.log(
    JSON.stringify(
      {
        sqlitePath,
        days,
        dryRun,
        candidates: rows.length,
        deletedFiles,
        markedRows,
      },
      null,
      2
    )
  );
}

main();
