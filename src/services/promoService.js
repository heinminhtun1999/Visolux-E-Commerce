const dayjs = require('dayjs');

const promoRepo = require('../repositories/promoRepo');

function isWithinDateWindow({ start_date, end_date }) {
  const today = dayjs().format('YYYY-MM-DD');
  if (start_date && today < start_date) return false;
  if (end_date && today > end_date) return false;
  return true;
}

function applyPromoToTotal({ promoCodeInput, totalCents }) {
  const input = String(promoCodeInput || '').trim().toUpperCase();
  if (!input) return { promo: null, discount: 0, reason: 'EMPTY' };

  const total = Math.max(0, Number(totalCents || 0));
  if (total <= 0) return { promo: null, discount: 0, reason: 'NO_TOTAL' };

  const p = promoRepo.getActive(input);
  if (!p) return { promo: null, discount: 0, reason: 'NOT_ACTIVE' };
  if (!isWithinDateWindow(p)) return { promo: null, discount: 0, reason: 'OUT_OF_DATE' };

  let discount = 0;
  const type = String(p.discount_type || '').toUpperCase();

  if (type === 'PERCENT') {
    const pct = Number(p.percent_off || 0);
    discount = pct > 0 ? Math.floor((total * pct) / 100) : 0;
  } else if (type === 'FIXED') {
    const amt = Number(p.amount_off_cents || 0);
    discount = Math.min(Math.max(0, amt), total);
  }

  if (discount <= 0) return { promo: null, discount: 0, reason: 'NO_DISCOUNT' };

  return {
    promo: {
      code: p.code,
      discount_type: type,
      percent_off: type === 'PERCENT' ? Number(p.percent_off || 0) : 0,
      amount_off_cents: type === 'FIXED' ? Number(p.amount_off_cents || 0) : null,
      discount_amount: discount,
    },
    discount,
    reason: 'OK',
  };
}

module.exports = {
  applyPromoToTotal,
};
