const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

const { env } = require('../config/env');

function pad2(n) {
  return String(Math.max(0, Math.floor(Number(n || 0)))).padStart(2, '0');
}

function nowStampUtc() {
  const d = new Date();
  // Use UTC to avoid DST/timezone confusion on servers.
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function getProjectRoot() {
  return process.cwd();
}

function getBackupsDir() {
  const raw = String(process.env.BACKUPS_DIR || '').trim();
  if (raw) return path.resolve(raw);

  // Production default: match VPS layout.
  if (String(env.nodeEnv || '').toLowerCase() === 'production') {
    return '/var/www/visolux_store/backups';
  }

  // Local default: in-repo ./backups
  return path.resolve(getProjectRoot(), 'backups');
}

function getAppDbPath() {
  return path.resolve(getProjectRoot(), env.sqlitePath || 'storage/data/app.db');
}

function getSessionsDbPath() {
  return path.resolve(getProjectRoot(), 'storage', 'data', 'sessions.db');
}

function getUploadsDir() {
  return path.resolve(getProjectRoot(), 'storage', 'uploads');
}

function safeBaseName(name) {
  const base = path.basename(String(name || ''));
  // Prevent path traversal and restrict to expected patterns.
  if (!base) return null;
  if (/^app_\d{8}_\d{6}\.tgz$/i.test(base)) return base;
  if (/^appdb_\d{8}_\d{6}\.db$/i.test(base)) return base;
  if (/^sessions_\d{8}_\d{6}\.db$/i.test(base)) return base;
  return null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFileAtomic(src, dest) {
  ensureDir(path.dirname(dest));
  const tmp = `${dest}.tmp_${process.pid}_${Date.now()}`;
  fs.copyFileSync(src, tmp);
  try {
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(destDir);
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyDirRecursive(src, dest);
    } else if (ent.isFile()) {
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
    }
  }
}

function parseCheckpointFromName(name) {
  const base = safeBaseName(name);
  if (!base) return null;

  const m = base.match(/^(app|appdb|sessions)_(\d{8})_(\d{6})\.(tgz|db)$/i);
  if (!m) return null;

  const prefix = String(m[1] || '').toLowerCase();
  const ymd = String(m[2] || '');
  const hms = String(m[3] || '');

  const yyyy = ymd.slice(0, 4);
  const mm = ymd.slice(4, 6);
  const dd = ymd.slice(6, 8);
  const hh = hms.slice(0, 2);
  const mi = hms.slice(2, 4);
  const ss = hms.slice(4, 6);

  const sqliteUtc = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;

  const kind = (() => {
    if (prefix === 'app') return 'Full backup';
    if (prefix === 'appdb') return 'Database';
    if (prefix === 'sessions') return 'Sessions';
    return 'Backup';
  })();

  return {
    stamp: `${ymd}_${hms}`,
    checkpointLabel: `${sqliteUtc} UTC`,
    checkpointSqliteUtc: sqliteUtc,
    kind,
  };
}

function listBackups() {
  const dir = getBackupsDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .map((f) => ({ name: f, base: safeBaseName(f) }))
    .filter((x) => Boolean(x.base))
    .map((x) => x.base);

  return files
    .map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      const meta = parseCheckpointFromName(name) || {};
      return {
        name,
        checkpointLabel: meta.checkpointLabel || name,
        checkpointSqliteUtc: meta.checkpointSqliteUtc || null,
        kind: meta.kind || 'Backup',
        stamp: meta.stamp || null,
        fullPath: full,
        sizeBytes: Number(st.size || 0),
        mtimeMs: Number(st.mtimeMs || 0),
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function hasTar() {
  try {
    const r = childProcess.spawnSync('tar', ['--version'], { encoding: 'utf8' });
    return r && r.status === 0;
  } catch (_) {
    return false;
  }
}

function pruneOldBackups({ retentionDays = 7, keepAtLeast = 0 } = {}) {
  const days = Number(retentionDays);
  const safeDays = Number.isFinite(days) && days >= 0 ? days : 7;
  const keep = Math.max(0, Math.floor(Number(keepAtLeast || 0)));

  const backups = listBackups();
  if (!backups.length) return { deleted: 0, kept: 0, retentionDays: safeDays };

  const cutoffMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const sorted = backups.slice().sort((a, b) => b.mtimeMs - a.mtimeMs);

  let deleted = 0;
  let kept = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const b = sorted[i];
    if (!b || !b.fullPath) continue;
    const mustKeep = i < keep;
    const isOld = Number(b.mtimeMs || 0) < cutoffMs;
    if (!mustKeep && isOld) {
      try {
        fs.unlinkSync(b.fullPath);
        deleted += 1;
      } catch (_) {
        // ignore
      }
    } else {
      kept += 1;
    }
  }

  return { deleted, kept, retentionDays: safeDays };
}

function parseRetentionDaysFromEnv() {
  const raw = String(process.env.BACKUP_RETENTION_DAYS || '').trim();
  if (!raw) return 7;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 7;
}

function createBackup({ includeUploads = true, mode = 'tgz-only', prune = true, retentionDays } = {}) {
  const backupsDir = getBackupsDir();
  ensureDir(backupsDir);

  const stamp = nowStampUtc();

  const appDb = getAppDbPath();
  if (!fs.existsSync(appDb)) {
    const err = new Error(`App DB not found at ${appDb}`);
    err.code = 'APP_DB_NOT_FOUND';
    throw err;
  }

  const wantsTgzOnly = String(mode || '').toLowerCase() === 'tgz-only';
  const wantsDbOnly = String(mode || '').toLowerCase() === 'db-only';
  const wantsBoth = String(mode || '').toLowerCase() === 'both';

  let appDbOut = null;
  let sessionsDbOut = null;
  let tgzOut = null;

  const tarAvailable = hasTar();

  if (tarAvailable && (wantsTgzOnly || wantsBoth)) {
    tgzOut = path.join(backupsDir, `app_${stamp}.tgz`);

    // Pack only the stateful files: DB + uploads.
    // Use -C to avoid absolute paths in the archive.
    const cwd = getProjectRoot();

    const args = ['-czf', tgzOut, '-C', cwd, 'storage/data/app.db'];
    if (fs.existsSync(path.join(cwd, 'storage', 'data', 'sessions.db'))) args.push('storage/data/sessions.db');
    if (includeUploads && fs.existsSync(path.join(cwd, 'storage', 'uploads'))) args.push('storage/uploads');

    const r = childProcess.spawnSync('tar', args, { encoding: 'utf8' });
    if (!r || r.status !== 0) {
      try { fs.unlinkSync(tgzOut); } catch (_) { /* ignore */ }
      const err = new Error(`tar failed: ${(r && (r.stderr || r.stdout)) || 'unknown error'}`);
      err.code = 'TAR_FAILED';
      throw err;
    }
  }

  // If tar isn't available (or user explicitly asked for db-only), fall back to DB snapshots.
  if (wantsDbOnly || wantsBoth || !tgzOut) {
    appDbOut = path.join(backupsDir, `appdb_${stamp}.db`);
    copyFileAtomic(appDb, appDbOut);

    const sessionsDb = getSessionsDbPath();
    if (fs.existsSync(sessionsDb)) {
      sessionsDbOut = path.join(backupsDir, `sessions_${stamp}.db`);
      copyFileAtomic(sessionsDb, sessionsDbOut);
    }
  }

  const pruneResult = (() => {
    if (prune === false) return null;
    const days = retentionDays == null ? parseRetentionDaysFromEnv() : retentionDays;
    try {
      // Keep nothing special by default; strict retention is simplest.
      return pruneOldBackups({ retentionDays: days, keepAtLeast: 0 });
    } catch (_) {
      return null;
    }
  })();

  return {
    stamp,
    backupsDir,
    mode: tgzOut && !wantsBoth && !wantsDbOnly ? 'tgz-only' : String(mode || ''),
    appDbOut,
    sessionsDbOut,
    tgzOut,
    pruneResult,
  };
}

function restoreFromBackupFile(fileNameOrBase, { restoreUploads = true, restoreSessions = true, preBackup = true } = {}) {
  const base = safeBaseName(fileNameOrBase);
  if (!base) {
    const err = new Error('Invalid backup file');
    err.status = 400;
    throw err;
  }

  const backupsDir = getBackupsDir();
  const full = path.join(backupsDir, base);
  if (!fs.existsSync(full)) {
    const err = new Error('Backup file not found');
    err.status = 404;
    throw err;
  }

  if (preBackup) {
    // Best-effort checkpoint before restoring.
    try { createBackup({ includeUploads: true }); } catch (_) { /* ignore */ }
  }

  const appDbDest = getAppDbPath();
  const sessionsDest = getSessionsDbPath();
  const uploadsDest = getUploadsDir();

  if (/^appdb_\d{8}_\d{6}\.db$/i.test(base)) {
    copyFileAtomic(full, appDbDest);
    return { restored: ['app.db'], source: base };
  }

  if (/^sessions_\d{8}_\d{6}\.db$/i.test(base)) {
    if (!restoreSessions) return { restored: [], source: base };
    copyFileAtomic(full, sessionsDest);
    return { restored: ['sessions.db'], source: base };
  }

  if (/^app_\d{8}_\d{6}\.tgz$/i.test(base)) {
    if (!hasTar()) {
      const err = new Error('Cannot restore .tgz backups because tar is not available on this server');
      err.code = 'TAR_MISSING';
      err.status = 500;
      throw err;
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'visolux_restore_'));
    try {
      // Extract into tmpRoot.
      const r = childProcess.spawnSync('tar', ['-xzf', full, '-C', tmpRoot], { encoding: 'utf8' });
      if (!r || r.status !== 0) {
        const err = new Error(`tar extract failed: ${(r && (r.stderr || r.stdout)) || 'unknown error'}`);
        err.code = 'TAR_EXTRACT_FAILED';
        throw err;
      }

      const extractedAppDb = path.join(tmpRoot, 'storage', 'data', 'app.db');
      if (!fs.existsSync(extractedAppDb)) {
        const err = new Error('Backup archive did not contain storage/data/app.db');
        err.code = 'MISSING_APP_DB_IN_ARCHIVE';
        throw err;
      }

      copyFileAtomic(extractedAppDb, appDbDest);

      const restored = ['app.db'];

      const extractedSessions = path.join(tmpRoot, 'storage', 'data', 'sessions.db');
      if (restoreSessions && fs.existsSync(extractedSessions)) {
        copyFileAtomic(extractedSessions, sessionsDest);
        restored.push('sessions.db');
      }

      const extractedUploads = path.join(tmpRoot, 'storage', 'uploads');
      if (restoreUploads && fs.existsSync(extractedUploads)) {
        // Replace uploads directory contents.
        // We do a best-effort replace: delete target then copy.
        try { fs.rmSync(uploadsDest, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        copyDirRecursive(extractedUploads, uploadsDest);
        restored.push('uploads');
      }

      return { restored, source: base };
    } finally {
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  }

  const err = new Error('Unsupported backup file');
  err.status = 400;
  throw err;
}

function deleteBackupFile(fileNameOrBase) {
  const base = safeBaseName(fileNameOrBase);
  if (!base) {
    const err = new Error('Invalid backup file');
    err.status = 400;
    throw err;
  }

  const backupsDir = getBackupsDir();
  const full = path.join(backupsDir, base);
  if (!fs.existsSync(full)) {
    const err = new Error('Backup file not found');
    err.status = 404;
    throw err;
  }

  // Extra safety: only allow deleting regular files.
  const st = fs.statSync(full);
  if (!st.isFile()) {
    const err = new Error('Not a file');
    err.status = 400;
    throw err;
  }

  fs.unlinkSync(full);
  return { deleted: true, file: base };
}

module.exports = {
  listBackups,
  createBackup,
  restoreFromBackupFile,
  getBackupsDir,
  pruneOldBackups,
  deleteBackupFile,
};
