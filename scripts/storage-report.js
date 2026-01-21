/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function statBytes(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function sumDirBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) total += sumDirBytes(p);
    else if (ent.isFile()) total += statBytes(p);
  }
  return total;
}

function human(bytes) {
  const b = Number(bytes || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let u = 0;
  let v = b;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(u === 0 ? 0 : 2)} ${units[u]}`;
}

function main() {
  const sqliteRel = process.env.SQLITE_PATH || 'storage/data/app.db';
  const sqlitePath = path.isAbsolute(sqliteRel) ? sqliteRel : path.join(process.cwd(), sqliteRel);

  const walPath = `${sqlitePath}-wal`;
  const shmPath = `${sqlitePath}-shm`;

  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });

  const pageSize = db.pragma('page_size', { simple: true });
  const pageCount = db.pragma('page_count', { simple: true });
  const freelist = db.pragma('freelist_count', { simple: true });
  const inUseBytes = (pageCount - freelist) * pageSize;
  const allocatedBytes = pageCount * pageSize;

  const tables = [
    'inventory',
    'users',
    'orders',
    'order_items',
    'order_item_refunds',
    'order_status_history',
    'offline_bank_transfers',
    'promo_codes',
    'order_promos',
    'payment_events',
    'admin_notifications',
  ];

  const counts = {};
  for (const t of tables) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(1) AS c FROM ${t}`).get().c;
    } catch {
      counts[t] = null;
    }
  }

  const uploadsDir = path.join(process.cwd(), 'storage', 'uploads');
  const uploadsBytes = sumDirBytes(uploadsDir);

  const report = {
    sqlitePath,
    files: {
      db: { bytes: statBytes(sqlitePath), human: human(statBytes(sqlitePath)) },
      wal: { bytes: statBytes(walPath), human: human(statBytes(walPath)) },
      shm: { bytes: statBytes(shmPath), human: human(statBytes(shmPath)) },
      uploads: { bytes: uploadsBytes, human: human(uploadsBytes) },
    },
    sqliteLogical: {
      pageSize,
      pageCount,
      freelist,
      inUseBytes,
      inUseHuman: human(inUseBytes),
      allocatedBytes,
      allocatedHuman: human(allocatedBytes),
    },
    tableCounts: counts,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
