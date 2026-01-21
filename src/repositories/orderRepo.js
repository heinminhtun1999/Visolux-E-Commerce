const { getDb } = require('../db/db');
const { generateOrderCode } = require('../utils/orderCode');

function mapOrder(row) {
  if (!row) return null;
  return {
    order_id: row.order_id,
    order_code: row.order_code || null,
    user_id: row.user_id,
    customer_name: row.customer_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    delivery_address_line1: row.delivery_address_line1,
    delivery_address_line2: row.delivery_address_line2,
    delivery_city: row.delivery_city,
    delivery_state: row.delivery_state,
    delivery_postcode: row.delivery_postcode,
    delivery_region: row.delivery_region,
    payment_method: row.payment_method,
    payment_channel: row.payment_channel || null,
    payment_status: row.payment_status,
    refund_status: row.refund_status || 'NONE',
    fulfilment_status: row.fulfilment_status,
    items_subtotal: row.items_subtotal,
    discount_amount: row.discount_amount,
    shipping_fee: row.shipping_fee,
    total_amount: row.total_amount,
    created_at: row.created_at,
  };
}

function updatePaymentChannel(orderId, paymentChannel) {
  const db = getDb();
  const channel = String(paymentChannel || '').trim();
  if (!channel) return getById(orderId);
  db.prepare('UPDATE orders SET payment_channel=? WHERE order_id=?').run(channel, orderId);
  return getById(orderId);
}

function listItems(orderId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id ASC')
    .all(orderId)
    .map((r) => ({
      id: r.id,
      order_id: r.order_id,
      product_id: r.product_id,
      product_name_snapshot: r.product_name_snapshot,
      price_snapshot: r.price_snapshot,
      quantity: r.quantity,
      subtotal: r.subtotal,
    }));
}

function getById(orderId) {
  const db = getDb();
  return mapOrder(db.prepare('SELECT * FROM orders WHERE order_id=?').get(orderId));
}

function getByCode(orderCode) {
  const code = String(orderCode || '').trim();
  if (!code) return null;
  const db = getDb();
  return mapOrder(db.prepare('SELECT * FROM orders WHERE order_code=?').get(code));
}

function getWithItems(orderId) {
  const order = getById(orderId);
  if (!order) return null;
  return { ...order, items: listItems(orderId) };
}

function listByUser(userId, { limit, offset }) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(userId, limit, offset)
    .map(mapOrder);
}

function countByUser(userId) {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as c FROM orders WHERE user_id=?').get(userId).c;
}

function buildDateRangeWhere({ column, dateFrom, dateTo, where, params }) {
  const from = String(dateFrom || '').trim();
  const to = String(dateTo || '').trim();
  if (from) {
    where.push(`${column} >= @date_from`);
    params.date_from = `${from} 00:00:00`;
  }
  if (to) {
    where.push(`${column} <= @date_to`);
    params.date_to = `${to} 23:59:59`;
  }
}

function listByUserFiltered(userId, {
  q,
  payment_status,
  payment_method,
  fulfilment_status,
  date_from,
  date_to,
  limit,
  offset,
} = {}) {
  const db = getDb();
  const where = ['o.user_id=@user_id'];
  const params = { user_id: userId, limit, offset };

  const query = String(q || '').trim();
  if (query) {
    where.push('(o.order_code LIKE @q OR o.customer_name LIKE @q OR o.email LIKE @q)');
    params.q = `%${query}%`;
  }
  if (payment_status) {
    where.push('o.payment_status=@ps');
    params.ps = payment_status;
  }
  if (payment_method) {
    where.push('o.payment_method=@pm');
    params.pm = payment_method;
  }
  if (fulfilment_status) {
    where.push('o.fulfilment_status=@fs');
    params.fs = fulfilment_status;
  }
  buildDateRangeWhere({ column: 'o.created_at', dateFrom: date_from, dateTo: date_to, where, params });

  const sql = `SELECT o.*
    FROM orders o
    WHERE ${where.join(' AND ')}
    ORDER BY o.created_at DESC
    LIMIT @limit OFFSET @offset`;
  return db.prepare(sql).all(params).map(mapOrder);
}

function countByUserFiltered(userId, {
  q,
  payment_status,
  payment_method,
  fulfilment_status,
  date_from,
  date_to,
} = {}) {
  const db = getDb();
  const where = ['user_id=@user_id'];
  const params = { user_id: userId };

  const query = String(q || '').trim();
  if (query) {
    where.push('(order_code LIKE @q OR customer_name LIKE @q OR email LIKE @q)');
    params.q = `%${query}%`;
  }
  if (payment_status) {
    where.push('payment_status=@ps');
    params.ps = payment_status;
  }
  if (payment_method) {
    where.push('payment_method=@pm');
    params.pm = payment_method;
  }
  if (fulfilment_status) {
    where.push('fulfilment_status=@fs');
    params.fs = fulfilment_status;
  }
  buildDateRangeWhere({ column: 'created_at', dateFrom: date_from, dateTo: date_to, where, params });

  const sql = `SELECT COUNT(*) as c FROM orders${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).get(params).c;
}

function countAdmin({ payment_status, fulfilment_status }) {
  const db = getDb();
  const where = [];
  const params = {};
  if (payment_status) {
    where.push('payment_status=@ps');
    params.ps = payment_status;
  }
  if (fulfilment_status) {
    where.push('fulfilment_status=@fs');
    params.fs = fulfilment_status;
  }
  const sql = `SELECT COUNT(*) as c FROM orders${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).get(params).c;
}

function listAdmin({ payment_status, fulfilment_status, limit, offset }) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };
  if (payment_status) {
    where.push('payment_status=@ps');
    params.ps = payment_status;
  }
  if (fulfilment_status) {
    where.push('fulfilment_status=@fs');
    params.fs = fulfilment_status;
  }
  const sql = `SELECT * FROM orders${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`;
  return db.prepare(sql).all(params).map(mapOrder);
}

function countAdminFiltered({
  q,
  payment_status,
  payment_method,
  fulfilment_status,
  refund_status,
  date_from,
  date_to,
} = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  const query = String(q || '').trim();
  if (query) {
    where.push('(order_code LIKE @q OR customer_name LIKE @q OR email LIKE @q)');
    params.q = `%${query}%`;
  }
  if (payment_status) {
    where.push('payment_status=@ps');
    params.ps = payment_status;
  }
  if (payment_method) {
    where.push('payment_method=@pm');
    params.pm = payment_method;
  }
  if (fulfilment_status) {
    where.push('fulfilment_status=@fs');
    params.fs = fulfilment_status;
  }
  if (refund_status) {
    where.push('COALESCE(refund_status,\'NONE\')=@rs');
    params.rs = refund_status;
  }
  buildDateRangeWhere({ column: 'created_at', dateFrom: date_from, dateTo: date_to, where, params });

  const sql = `SELECT COUNT(*) as c FROM orders${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).get(params).c;
}

function listAdminFiltered({
  q,
  payment_status,
  payment_method,
  fulfilment_status,
  refund_status,
  date_from,
  date_to,
  limit,
  offset,
} = {}) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };

  const query = String(q || '').trim();
  if (query) {
    where.push('(order_code LIKE @q OR customer_name LIKE @q OR email LIKE @q)');
    params.q = `%${query}%`;
  }
  if (payment_status) {
    where.push('payment_status=@ps');
    params.ps = payment_status;
  }
  if (payment_method) {
    where.push('payment_method=@pm');
    params.pm = payment_method;
  }
  if (fulfilment_status) {
    where.push('fulfilment_status=@fs');
    params.fs = fulfilment_status;
  }
  if (refund_status) {
    where.push('COALESCE(refund_status,\'NONE\')=@rs');
    params.rs = refund_status;
  }
  buildDateRangeWhere({ column: 'created_at', dateFrom: date_from, dateTo: date_to, where, params });

  const sql = `SELECT * FROM orders${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`;
  return db.prepare(sql).all(params).map(mapOrder);
}

function insertStatusHistory(orderId, statusType, oldStatus, newStatus, note) {
  const db = getDb();
  db.prepare(
    `INSERT INTO order_status_history (order_id, status_type, old_status, new_status, note)
     VALUES (?,?,?,?,?)`
  ).run(orderId, statusType, oldStatus || null, newStatus, note || null);
}

function listStatusHistory(orderId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT *
       FROM order_status_history
       WHERE order_id=?
       ORDER BY datetime(changed_at) ASC, id ASC`
    )
    .all(orderId)
    .map((r) => ({
      id: r.id,
      order_id: r.order_id,
      status_type: r.status_type,
      old_status: r.old_status || null,
      new_status: r.new_status,
      note: r.note || '',
      changed_at: r.changed_at,
    }));
}

function createOrder({
  user_id,
  customer_name,
  phone,
  email,
  address,
  delivery_address_line1,
  delivery_address_line2,
  delivery_city,
  delivery_state,
  delivery_postcode,
  delivery_region,
  payment_method,
  payment_status,
  fulfilment_status,
  items_subtotal,
  discount_amount,
  shipping_fee,
  total_amount,
  items,
  promo,
}) {
  const db = getDb();

  const tx = db.transaction(() => {
    let inserted;
    let orderCode;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      orderCode = generateOrderCode();
      try {
        inserted = db
          .prepare(
            `INSERT INTO orders (
              order_code, user_id, customer_name, phone, email, address,
              delivery_address_line1, delivery_address_line2, delivery_city, delivery_state, delivery_postcode, delivery_region,
              payment_method, payment_status, fulfilment_status,
              items_subtotal, discount_amount, shipping_fee,
              total_amount
            )
             VALUES (
              @order_code, @user_id, @customer_name, @phone, @email, @address,
              @delivery_address_line1, @delivery_address_line2, @delivery_city, @delivery_state, @delivery_postcode, @delivery_region,
              @payment_method, @payment_status, @fulfilment_status,
              @items_subtotal, @discount_amount, @shipping_fee,
              @total_amount
            )`
          )
          .run({
            order_code: orderCode,
            user_id: user_id || null,
            customer_name,
            phone,
            email,
            address,
            delivery_address_line1: delivery_address_line1 || null,
            delivery_address_line2: delivery_address_line2 || null,
            delivery_city: delivery_city || null,
            delivery_state: delivery_state || null,
            delivery_postcode: delivery_postcode || null,
            delivery_region: delivery_region || null,
            payment_method,
            payment_status,
            fulfilment_status,
            items_subtotal: Number(items_subtotal || 0),
            discount_amount: Number(discount_amount || 0),
            shipping_fee: Number(shipping_fee || 0),
            total_amount,
          });
        break;
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (msg.toLowerCase().includes('unique') && msg.toLowerCase().includes('order_code')) continue;
        throw e;
      }
    }

    if (!inserted) {
      throw new Error('Failed to allocate a unique order code. Please retry.');
    }
    const orderId = inserted.lastInsertRowid;

    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, price_snapshot, quantity, subtotal)
       VALUES (@order_id, @product_id, @product_name_snapshot, @price_snapshot, @quantity, @subtotal)`
    );

    for (const it of items) {
      insertItem.run({
        order_id: orderId,
        product_id: it.product_id,
        product_name_snapshot: it.product_name_snapshot,
        price_snapshot: it.price_snapshot,
        quantity: it.quantity,
        subtotal: it.subtotal,
      });
    }

    if (promo) {
      db.prepare(
        `INSERT INTO order_promos (order_id, code, discount_type, percent_off, amount_off_cents, discount_amount)
         VALUES (?,?,?,?,?,?)`
      ).run(
        orderId,
        promo.code,
        String(promo.discount_type || 'PERCENT'),
        promo.percent_off == null ? null : promo.percent_off,
        promo.amount_off_cents == null ? null : promo.amount_off_cents,
        promo.discount_amount
      );

      // Redemption count increment (best-effort guard by max_redemptions)
      db.prepare(
        `UPDATE promo_codes
         SET redeemed_count = redeemed_count + 1
         WHERE code = ? AND archived=0 AND active=1 AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)`
      ).run(promo.code);
    }

    insertStatusHistory(orderId, 'PAYMENT', null, payment_status, 'Order created');
    insertStatusHistory(orderId, 'FULFILMENT', null, fulfilment_status, 'Order created');

    return Number(orderId);
  });

  const orderId = tx();
  return getWithItems(orderId);
}

function updatePaymentStatus(orderId, newStatus, note) {
  const db = getDb();
  const current = getById(orderId);
  if (!current) return null;
  if (current.payment_status === newStatus) return current;

  db.prepare('UPDATE orders SET payment_status=? WHERE order_id=?').run(newStatus, orderId);
  insertStatusHistory(orderId, 'PAYMENT', current.payment_status, newStatus, note);
  return getById(orderId);
}

function updateFulfilmentStatus(orderId, newStatus, note) {
  const db = getDb();
  const current = getById(orderId);
  if (!current) return null;
  if (current.fulfilment_status === newStatus) return current;

  db.prepare('UPDATE orders SET fulfilment_status=? WHERE order_id=?').run(newStatus, orderId);
  insertStatusHistory(orderId, 'FULFILMENT', current.fulfilment_status, newStatus, note);
  return getById(orderId);
}

function getPromoForOrder(orderId) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM order_promos WHERE order_id=?').get(orderId);
  if (!r) return null;
  return {
    order_id: r.order_id,
    code: r.code,
    discount_type: r.discount_type || 'PERCENT',
    percent_off: r.percent_off,
    amount_off_cents: r.amount_off_cents,
    discount_amount: r.discount_amount,
  };
}

function getOfflineTransfer(orderId) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM offline_bank_transfers WHERE order_id=?').get(orderId);
  if (!r) return null;
  return {
    id: r.id,
    order_id: r.order_id,
    bank_name: r.bank_name,
    reference_number: r.reference_number,
    slip_image_path: r.slip_image_path,
    uploaded_at: r.uploaded_at,
    slip_deleted: Boolean(r.slip_deleted),
    slip_deleted_at: r.slip_deleted_at,
    slip_rejection_reason: r.slip_rejection_reason || '',
    slip_rejected_at: r.slip_rejected_at,
    verified: Boolean(r.verified),
  };
}

function getOfflineTransferBySlipPath(slipImagePath) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM offline_bank_transfers WHERE slip_image_path=?').get(slipImagePath);
  if (!r) return null;
  return {
    id: r.id,
    order_id: r.order_id,
    bank_name: r.bank_name,
    reference_number: r.reference_number,
    slip_image_path: r.slip_image_path,
    uploaded_at: r.uploaded_at,
    slip_deleted: Boolean(r.slip_deleted),
    slip_deleted_at: r.slip_deleted_at,
    slip_rejection_reason: r.slip_rejection_reason || '',
    slip_rejected_at: r.slip_rejected_at,
    verified: Boolean(r.verified),
  };
}

function upsertOfflineTransfer({ order_id, bank_name, reference_number, slip_image_path }) {
  const db = getDb();
  const existing = getOfflineTransfer(order_id);
  if (existing && existing.verified) {
    const err = new Error('Slip already verified; cannot replace.');
    err.status = 400;
    throw err;
  }

  const previousSlipPath = existing ? existing.slip_image_path : null;

  const tx = db.transaction(() => {
    if (!existing) {
      db.prepare(
        `INSERT INTO offline_bank_transfers (order_id, bank_name, reference_number, slip_image_path, slip_deleted, slip_deleted_at, slip_rejection_reason, slip_rejected_at, verified)
         VALUES (?,?,?,?,0,NULL,NULL,NULL,0)`
      ).run(order_id, bank_name, reference_number, slip_image_path);
    } else {
      db.prepare(
        `UPDATE offline_bank_transfers
         SET bank_name=?, reference_number=?, slip_image_path=?, uploaded_at=datetime('now'), slip_deleted=0, slip_deleted_at=NULL,
             slip_rejection_reason=NULL, slip_rejected_at=NULL, verified=0
         WHERE order_id=?`
      ).run(bank_name, reference_number, slip_image_path, order_id);
    }
  });

  tx();
  return { offline: getOfflineTransfer(order_id), previousSlipPath };
}

function rejectOfflineTransfer({ orderId, reason }) {
  const db = getDb();
  const r = String(reason || '').trim() || null;
  db.prepare(
    `UPDATE offline_bank_transfers
     SET verified=0,
         slip_rejection_reason=?,
         slip_rejected_at=datetime('now')
     WHERE order_id=?`
  ).run(r, orderId);
  return getOfflineTransfer(orderId);
}

function setOfflineTransferVerified(orderId, verified) {
  const db = getDb();
  db.prepare('UPDATE offline_bank_transfers SET verified=? WHERE order_id=?').run(verified ? 1 : 0, orderId);
  return getOfflineTransfer(orderId);
}

function listSlips({ status, verified, q, date_from, date_to, limit, offset }) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };

  const st = String(status || '').trim().toUpperCase();
  if (st === 'PURGED') {
    where.push('obt.slip_deleted=1');
  } else if (st === 'VERIFIED') {
    where.push('obt.verified=1');
    where.push('obt.slip_deleted=0');
  } else if (st === 'PENDING') {
    where.push('obt.verified=0');
    where.push('obt.slip_deleted=0');
  }

  if (!st) {
    if (verified === true || verified === 1 || verified === '1') {
      where.push('obt.verified=1');
    } else if (verified === false || verified === 0 || verified === '0') {
      where.push('obt.verified=0');
    }
  }

  const query = String(q || '').trim();
  if (query) {
    where.push('(o.order_code LIKE @q OR o.customer_name LIKE @q OR o.email LIKE @q OR obt.reference_number LIKE @q OR obt.bank_name LIKE @q)');
    params.q = `%${query}%`;
  }
  buildDateRangeWhere({ column: 'obt.uploaded_at', dateFrom: date_from, dateTo: date_to, where, params });

  return db
    .prepare(
      `SELECT o.*, obt.bank_name, obt.reference_number, obt.slip_image_path, obt.uploaded_at, obt.verified, obt.slip_deleted, obt.slip_deleted_at,
              obt.slip_rejection_reason, obt.slip_rejected_at
       FROM offline_bank_transfers obt
       JOIN orders o ON o.order_id = obt.order_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY obt.uploaded_at DESC
       LIMIT @limit OFFSET @offset`
    )
    .all(params)
    .map((r) => ({
      order: mapOrder(r),
      slip: {
        bank_name: r.bank_name,
        reference_number: r.reference_number,
        slip_image_path: r.slip_image_path,
        uploaded_at: r.uploaded_at,
        slip_deleted: Boolean(r.slip_deleted),
        slip_deleted_at: r.slip_deleted_at,
        slip_rejection_reason: r.slip_rejection_reason || '',
        slip_rejected_at: r.slip_rejected_at,
        verified: Boolean(r.verified),
      },
    }));
}

function countSlips({ status, verified, q, date_from, date_to } = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  const st = String(status || '').trim().toUpperCase();
  if (st === 'PURGED') {
    where.push('slip_deleted=1');
  } else if (st === 'VERIFIED') {
    where.push('verified=1');
    where.push('slip_deleted=0');
  } else if (st === 'PENDING') {
    where.push('verified=0');
    where.push('slip_deleted=0');
  } else {
    if (verified === true || verified === 1 || verified === '1') where.push('verified=1');
    else if (verified === false || verified === 0 || verified === '0') where.push('verified=0');
  }

  const query = String(q || '').trim();
  if (query) {
    where.push('(order_id IN (SELECT order_id FROM orders WHERE order_code LIKE @q OR customer_name LIKE @q OR email LIKE @q) OR reference_number LIKE @q OR bank_name LIKE @q)');
    params.q = `%${query}%`;
  }
  buildDateRangeWhere({ column: 'uploaded_at', dateFrom: date_from, dateTo: date_to, where, params });

  const sql = `SELECT COUNT(*) as c FROM offline_bank_transfers${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).get(params).c;
}

function listSlipsByUser(userId, { status, verified, q, date_from, date_to, limit, offset } = {}) {
  const db = getDb();
  const where = ['o.user_id=@user_id'];
  const params = { user_id: userId, limit, offset };

  const st = String(status || '').trim().toUpperCase();
  if (st === 'PURGED') {
    where.push('obt.slip_deleted=1');
  } else if (st === 'VERIFIED') {
    where.push('obt.verified=1');
    where.push('obt.slip_deleted=0');
  } else if (st === 'PENDING') {
    where.push('obt.verified=0');
    where.push('obt.slip_deleted=0');
  }

  if (!st) {
    if (verified === true || verified === 1 || verified === '1') {
      where.push('obt.verified=1');
    } else if (verified === false || verified === 0 || verified === '0') {
      where.push('obt.verified=0');
    }
  }

  const query = String(q || '').trim();
  if (query) {
    where.push('(o.order_code LIKE @q OR obt.reference_number LIKE @q OR obt.bank_name LIKE @q)');
    params.q = `%${query}%`;
  }
  buildDateRangeWhere({ column: 'obt.uploaded_at', dateFrom: date_from, dateTo: date_to, where, params });

  return db
    .prepare(
      `SELECT o.*, obt.bank_name, obt.reference_number, obt.slip_image_path, obt.uploaded_at, obt.verified, obt.slip_deleted, obt.slip_deleted_at,
              obt.slip_rejection_reason, obt.slip_rejected_at
       FROM offline_bank_transfers obt
       JOIN orders o ON o.order_id = obt.order_id
       WHERE ${where.join(' AND ')}
       ORDER BY obt.uploaded_at DESC
       LIMIT @limit OFFSET @offset`
    )
    .all(params)
    .map((r) => ({
      order: mapOrder(r),
      slip: {
        bank_name: r.bank_name,
        reference_number: r.reference_number,
        slip_image_path: r.slip_image_path,
        uploaded_at: r.uploaded_at,
        slip_deleted: Boolean(r.slip_deleted),
        slip_deleted_at: r.slip_deleted_at,
        slip_rejection_reason: r.slip_rejection_reason || '',
        slip_rejected_at: r.slip_rejected_at,
        verified: Boolean(r.verified),
      },
    }));
}

function countSlipsByUser(userId, { status, verified, q, date_from, date_to } = {}) {
  const db = getDb();
  const where = ['o.user_id=@user_id'];
  const params = { user_id: userId };

  const st = String(status || '').trim().toUpperCase();
  if (st === 'PURGED') {
    where.push('obt.slip_deleted=1');
  } else if (st === 'VERIFIED') {
    where.push('obt.verified=1');
    where.push('obt.slip_deleted=0');
  } else if (st === 'PENDING') {
    where.push('obt.verified=0');
    where.push('obt.slip_deleted=0');
  } else {
    if (verified === true || verified === 1 || verified === '1') {
      where.push('obt.verified=1');
    } else if (verified === false || verified === 0 || verified === '0') {
      where.push('obt.verified=0');
    }
  }

  const query = String(q || '').trim();
  if (query) {
    where.push('(o.order_code LIKE @q OR obt.reference_number LIKE @q OR obt.bank_name LIKE @q)');
    params.q = `%${query}%`;
  }
  buildDateRangeWhere({ column: 'obt.uploaded_at', dateFrom: date_from, dateTo: date_to, where, params });

  const sql = `SELECT COUNT(*) as c
    FROM offline_bank_transfers obt
    JOIN orders o ON o.order_id = obt.order_id
    WHERE ${where.join(' AND ')}`;
  return db.prepare(sql).get(params).c;
}

function listUnverifiedSlips({ limit, offset }) {
  return listSlips({ verified: false, limit, offset });
}

function countUnverifiedSlips() {
  return countSlips({ verified: false });
}

module.exports = {
  getById,
  getByCode,
  getWithItems,
  listByUser,
  countByUser,
  listByUserFiltered,
  countByUserFiltered,
  countAdmin,
  listAdmin,
  countAdminFiltered,
  listAdminFiltered,
  createOrder,
  updatePaymentStatus,
  updateFulfilmentStatus,
  insertStatusHistory,
  listStatusHistory,
  updatePaymentChannel,
  getPromoForOrder,
  getOfflineTransfer,
  getOfflineTransferBySlipPath,
  upsertOfflineTransfer,
  rejectOfflineTransfer,
  setOfflineTransferVerified,
  listSlips,
  countSlips,
  listSlipsByUser,
  countSlipsByUser,
  listUnverifiedSlips,
  countUnverifiedSlips,
};
