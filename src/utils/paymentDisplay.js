function paymentMethodLabel(method) {
  const m = String(method || '').trim().toUpperCase();
  if (m === 'OFFLINE_TRANSFER') return 'Offline bank transfer';
  if (m === 'ONLINE') return 'Online payment';
  if (!m) return 'Payment';
  return m
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeChannel(channel) {
  return String(channel || '').trim();
}

function paymentChannelLabel({ payment_method, payment_channel } = {}) {
  const method = String(payment_method || '').trim().toUpperCase();
  if (method === 'OFFLINE_TRANSFER') return '';

  const raw = normalizeChannel(payment_channel);
  if (!raw) return '';

  const u = raw.toUpperCase();

  // Common FIUU channel / brand patterns.
  if (u === 'FPX') return 'FPX';
  if (u === 'CC' || u === 'CREDITCARD' || u === 'CREDIT_CARD') return 'Card';
  if (u === 'VISA') return 'Visa';
  if (u === 'MASTER' || u === 'MASTERCARD') return 'Mastercard';
  if (u === 'AMEX' || u === 'AMERICANEXPRESS' || u === 'AMERICAN_EXPRESS') return 'American Express';

  // Fall back to a friendly title-case label without leaking provider-specific jargon.
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function paymentSummaryLabel(order) {
  const methodLabel = paymentMethodLabel(order && order.payment_method);
  const channelLabel = paymentChannelLabel(order || {});
  if (channelLabel) return `${methodLabel} (${channelLabel})`;
  return methodLabel;
}

function sanitizeStatusHistoryNote(note) {
  const s = String(note || '').trim();
  if (!s) return '';

  // Hide gateway/provider metadata from being shown to humans.
  if (/(fiuu|tranid|gateway|merchant\s*id|secret\s*key|verify\s*key|signature)/i.test(s)) return '';

  return s;
}

module.exports = {
  paymentMethodLabel,
  paymentChannelLabel,
  paymentSummaryLabel,
  sanitizeStatusHistoryNote,
};
