function toCents(amountStr) {
  const normalized = String(amountStr || '').trim();
  if (!normalized) return 0;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid amount');
  return Math.round(value * 100);
}

function formatMoney(cents) {
  const value = Number(cents || 0) / 100;
  return value.toFixed(2);
}

module.exports = { toCents, formatMoney };
