const { env } = require('../config/env');

function parseSqliteDateTimeAsUtc(sqliteDateTime) {
  const raw = String(sqliteDateTime || '').trim();
  if (!raw) return null;

  // Typical SQLite datetime('now') format: "YYYY-MM-DD HH:MM:SS" (UTC)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const iso = raw.replace(' ', 'T');
    const d = new Date(`${iso}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Fallback: let JS parse it.
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(sqliteDateTime, opts = {}) {
  const d = parseSqliteDateTimeAsUtc(sqliteDateTime);
  if (!d) return String(sqliteDateTime || '');

  const timeZone = opts.timeZone || env.appTimeZone || 'Asia/Kuala_Lumpur';
  const locale = opts.locale || env.appLocale || 'en-MY';

  try {
    // Example output (en-MY): "15 Jan 2026, 21:05"
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch (_) {
    return d.toISOString();
  }
}

module.exports = {
  parseSqliteDateTimeAsUtc,
  formatDateTime,
};
