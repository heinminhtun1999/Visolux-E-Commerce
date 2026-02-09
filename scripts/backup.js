const backupService = require('../src/services/backupService');

function getArgValue(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => String(a || '').startsWith(prefix));
  if (!hit) return null;
  return hit.slice(prefix.length);
}

function main() {
  const includeUploads = !process.argv.includes('--no-uploads');
  const mode = getArgValue('--mode') || 'tgz-only';
  const retentionDaysRaw = getArgValue('--retention-days');
  const retentionDays = retentionDaysRaw == null ? undefined : Number(retentionDaysRaw);
  const prune = !process.argv.includes('--no-prune');

  const result = backupService.createBackup({ includeUploads, mode, prune, retentionDays });
  // eslint-disable-next-line no-console
  console.log('Backup created:');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('Backup failed:', e && e.message ? e.message : e);
  process.exitCode = 1;
}
