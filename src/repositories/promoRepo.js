const { getDb } = require('../db/db');

function mapPromo(row) {
  if (!row) return null;
  return {
    code: row.code,
    discount_type: row.discount_type,
    percent_off: row.percent_off == null ? null : Number(row.percent_off),
    amount_off_cents: row.amount_off_cents == null ? null : Number(row.amount_off_cents),
    active: Boolean(row.active),
    archived: Boolean(row.archived),
    max_redemptions: row.max_redemptions == null ? null : Number(row.max_redemptions),
    redeemed_count: Number(row.redeemed_count || 0),
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    created_at: row.created_at,
  };
}

function getByCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const db = getDb();
  return mapPromo(db.prepare('SELECT * FROM promo_codes WHERE code=?').get(c));
}

function getActive(code) {
  const p = getByCode(code);
  if (!p) return null;
  if (p.archived || !p.active) return null;
  if (p.max_redemptions != null && p.redeemed_count >= p.max_redemptions) return null;
  return p;
}

function listAdmin({ includeArchived } = {}) {
  const db = getDb();
  const where = [];
  if (!includeArchived) where.push('archived=0');
  const sql = `SELECT * FROM promo_codes${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY archived ASC, active DESC, created_at DESC, code ASC`;
  return db.prepare(sql).all().map(mapPromo);
}

function create({
  code,
  discount_type,
  percent_off,
  amount_off_cents,
  active,
  archived,
  max_redemptions,
  start_date,
  end_date,
} = {}) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) {
    const err = new Error('Promo code is required.');
    err.status = 400;
    throw err;
  }
  const dt = String(discount_type || '').trim().toUpperCase() || 'PERCENT';
  if (!['PERCENT', 'FIXED'].includes(dt)) {
    const err = new Error('Invalid discount type.');
    err.status = 400;
    throw err;
  }

  const pct = percent_off == null || percent_off === '' ? null : Number(percent_off);
  const amt = amount_off_cents == null || amount_off_cents === '' ? null : Number(amount_off_cents);

  if (dt === 'PERCENT') {
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      const err = new Error('Percent off must be between 1 and 100.');
      err.status = 400;
      throw err;
    }
  } else {
    if (!Number.isFinite(amt) || amt <= 0) {
      const err = new Error('Amount off must be greater than 0.');
      err.status = 400;
      throw err;
    }
  }

  const max = max_redemptions == null || max_redemptions === '' ? null : Number(max_redemptions);
  if (max != null && (!Number.isFinite(max) || max <= 0)) {
    const err = new Error('Invalid max redemptions.');
    err.status = 400;
    throw err;
  }

  const sd = start_date ? String(start_date).trim() : '';
  const ed = end_date ? String(end_date).trim() : '';
  if (sd && !/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
    const err = new Error('Invalid start date (use YYYY-MM-DD).');
    err.status = 400;
    throw err;
  }
  if (ed && !/^\d{4}-\d{2}-\d{2}$/.test(ed)) {
    const err = new Error('Invalid end date (use YYYY-MM-DD).');
    err.status = 400;
    throw err;
  }
  if (sd && ed && sd > ed) {
    const err = new Error('Start date must be before end date.');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO promo_codes (code, discount_type, percent_off, amount_off_cents, active, archived, max_redemptions, redeemed_count, start_date, end_date)
     VALUES (@code, @discount_type, @percent_off, @amount_off_cents, @active, @archived, @max_redemptions, 0, @start_date, @end_date)`
  ).run({
    code: c,
    discount_type: dt,
    percent_off: dt === 'PERCENT' ? Math.floor(pct) : null,
    amount_off_cents: dt === 'FIXED' ? Math.floor(amt) : null,
    active: active ? 1 : 0,
    archived: archived ? 1 : 0,
    max_redemptions: max,
    start_date: sd || null,
    end_date: ed || null,
  });
  return getByCode(c);
}

function update(code, patch = {}) {
  const current = getByCode(code);
  if (!current) return null;
  const next = { ...current, ...patch };
  const db = getDb();
  db.prepare(
    `UPDATE promo_codes
     SET discount_type=@discount_type,
         percent_off=@percent_off,
         amount_off_cents=@amount_off_cents,
         active=@active,
         archived=@archived,
         max_redemptions=@max_redemptions,
         start_date=@start_date,
         end_date=@end_date
     WHERE code=@code`
  ).run({
    code: current.code,
    discount_type: next.discount_type,
    percent_off: next.percent_off,
    amount_off_cents: next.amount_off_cents,
    active: next.active ? 1 : 0,
    archived: next.archived ? 1 : 0,
    max_redemptions: next.max_redemptions,
    start_date: next.start_date,
    end_date: next.end_date,
  });
  return getByCode(current.code);
}

function renameCode(oldCode, newCode) {
  const from = String(oldCode || '').trim().toUpperCase();
  const to = String(newCode || '').trim().toUpperCase();
  if (!from || !to) {
    const err = new Error('Promo code is required.');
    err.status = 400;
    throw err;
  }
  if (from === to) return getByCode(from);

  const current = getByCode(from);
  if (!current) {
    const err = new Error('Promo not found.');
    err.status = 404;
    throw err;
  }
  if (getByCode(to)) {
    const err = new Error('Promo code already exists.');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  const usedCount = db.prepare('SELECT COUNT(*) AS c FROM order_promos WHERE code=?').get(from).c;
  if (Number(usedCount || 0) > 0) {
    const err = new Error('Cannot rename a promo code that has been used in orders.');
    err.status = 400;
    throw err;
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO promo_codes (code, discount_type, percent_off, amount_off_cents, active, archived, max_redemptions, redeemed_count, start_date, end_date, created_at)
       VALUES (@code, @discount_type, @percent_off, @amount_off_cents, @active, @archived, @max_redemptions, @redeemed_count, @start_date, @end_date, @created_at)`
    ).run({
      code: to,
      discount_type: current.discount_type,
      percent_off: current.percent_off,
      amount_off_cents: current.amount_off_cents,
      active: current.active ? 1 : 0,
      archived: current.archived ? 1 : 0,
      max_redemptions: current.max_redemptions,
      redeemed_count: current.redeemed_count || 0,
      start_date: current.start_date,
      end_date: current.end_date,
      created_at: current.created_at,
    });

    db.prepare('DELETE FROM promo_codes WHERE code=?').run(from);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getByCode(to);
}

function setActive(code, active) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return;
  const db = getDb();
  db.prepare('UPDATE promo_codes SET active=? WHERE code=?').run(active ? 1 : 0, c);
}

function setArchived(code, archived) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return;
  const db = getDb();
  db.prepare('UPDATE promo_codes SET archived=? WHERE code=?').run(archived ? 1 : 0, c);
}

module.exports = {
  getByCode,
  getActive,
  listAdmin,
  create,
  update,
  renameCode,
  setActive,
  setArchived,
};
