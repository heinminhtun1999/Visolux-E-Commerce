/* eslint-disable no-console */

// App-level storage metrics logger.
// Appends a timestamped row to storage/storage-metrics.csv so you can compute growth rates over time.

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

function ensureHeader(filePath, headerLine) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${headerLine}\n`, 'utf8');
    return;
  }

  const existing = fs.readFileSync(filePath, 'utf8');
  if (!existing.startsWith(headerLine)) {
    // Preserve existing content but add a header at top.
    fs.writeFileSync(filePath, `${headerLine}\n${existing}`, 'utf8');
  }
}

function main() {
  const sqliteRel = process.env.SQLITE_PATH || 'storage/data/app.db';
  const sqlitePath = path.isAbsolute(sqliteRel) ? sqliteRel : path.join(process.cwd(), sqliteRel);
  const walPath = `${sqlitePath}-wal`;
  const shmPath = `${sqlitePath}-shm`;

  const dbBytes = statBytes(sqlitePath);
  const walBytes = statBytes(walPath);
  const shmBytes = statBytes(shmPath);

  const uploadsDir = path.join(process.cwd(), 'storage', 'uploads');
  const uploadsBytes = sumDirBytes(uploadsDir);

  const totalBytes = dbBytes + walBytes + shmBytes + uploadsBytes;

  const out = path.join(process.cwd(), 'storage', 'storage-metrics.csv');
  const header = 'timestamp,db_bytes,wal_bytes,shm_bytes,uploads_bytes,total_bytes';
  ensureHeader(out, header);

  const ts = new Date().toISOString();
  const row = `${ts},${dbBytes},${walBytes},${shmBytes},${uploadsBytes},${totalBytes}`;
  fs.appendFileSync(out, `${row}\n`, 'utf8');
  console.log(row);
}

main();
