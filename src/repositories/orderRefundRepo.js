const { getDb } = require('../db/db');

function create({
  orderId,
  orderItemId,
  productId,
  quantityRefunded,
  amountRefunded,
  reason,
  provider,
  providerRefId,
  providerTxnId,
  providerRefundId,
  providerStatus,
  providerReason,
  providerSignatureOk,
  providerResponseJson,
}) {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO order_item_refunds (
         order_id, order_item_id, product_id, quantity_refunded, amount_refunded, reason,
         provider, provider_ref_id, provider_txn_id, provider_refund_id, provider_status, provider_reason,
         provider_signature_ok, provider_response_json
       )
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      orderId,
      orderItemId,
      productId,
      quantityRefunded,
      amountRefunded,
      reason || null,
      provider ? String(provider) : null,
      providerRefId ? String(providerRefId) : null,
      providerTxnId ? String(providerTxnId) : null,
      providerRefundId ? String(providerRefundId) : null,
      providerStatus ? String(providerStatus) : null,
      providerReason ? String(providerReason) : null,
      providerSignatureOk === null || providerSignatureOk === undefined ? null : (providerSignatureOk ? 1 : 0),
      providerResponseJson ? String(providerResponseJson) : null
    );
  return getById(res.lastInsertRowid);
}

function getById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM order_item_refunds WHERE id=?').get(id) || null;
}

function listByOrder(orderId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM order_item_refunds WHERE order_id=? ORDER BY datetime(created_at) DESC, id DESC')
    .all(orderId)
    .map((r) => ({
      id: r.id,
      order_id: r.order_id,
      order_item_id: r.order_item_id,
      product_id: r.product_id,
      quantity_refunded: r.quantity_refunded,
      amount_refunded: r.amount_refunded,
      reason: r.reason || '',
      provider: r.provider || '',
      provider_ref_id: r.provider_ref_id || '',
      provider_txn_id: r.provider_txn_id || '',
      provider_refund_id: r.provider_refund_id || '',
      provider_status: r.provider_status || '',
      provider_reason: r.provider_reason || '',
      provider_signature_ok: r.provider_signature_ok,
      created_at: r.created_at,
    }));
}

function updateGatewayByProviderRefId({
  provider,
  providerRefId,
  providerRefundId,
  providerStatus,
  providerReason,
  providerSignatureOk,
  providerResponseJson,
  providerTxnId,
}) {
  const db = getDb();
  const p = provider ? String(provider) : null;
  const ref = providerRefId ? String(providerRefId) : null;
  if (!p || !ref) return null;

  const updates = db
    .prepare(
      `UPDATE order_item_refunds
       SET
         provider_refund_id = COALESCE(?, provider_refund_id),
         provider_txn_id = COALESCE(?, provider_txn_id),
         provider_status = COALESCE(?, provider_status),
         provider_reason = COALESCE(?, provider_reason),
         provider_signature_ok = COALESCE(?, provider_signature_ok),
         provider_response_json = COALESCE(?, provider_response_json)
       WHERE provider = ? AND provider_ref_id = ?`
    )
    .run(
      providerRefundId ? String(providerRefundId) : null,
      providerTxnId ? String(providerTxnId) : null,
      providerStatus ? String(providerStatus) : null,
      providerReason ? String(providerReason) : null,
      providerSignatureOk === null || providerSignatureOk === undefined ? null : (providerSignatureOk ? 1 : 0),
      providerResponseJson ? String(providerResponseJson) : null,
      p,
      ref
    );

  if (!updates.changes) return null;
  return db
    .prepare(
      'SELECT * FROM order_item_refunds WHERE provider=? AND provider_ref_id=? ORDER BY id DESC LIMIT 1'
    )
    .get(p, ref) || null;
}

function updateGatewayByProviderRefundId({
  provider,
  providerRefundId,
  providerStatus,
  providerReason,
  providerSignatureOk,
  providerResponseJson,
  providerTxnId,
  providerRefId,
}) {
  const db = getDb();
  const p = provider ? String(provider) : null;
  const rid = providerRefundId ? String(providerRefundId) : null;
  if (!p || !rid) return null;

  const updates = db
    .prepare(
      `UPDATE order_item_refunds
       SET
         provider_ref_id = COALESCE(?, provider_ref_id),
         provider_txn_id = COALESCE(?, provider_txn_id),
         provider_status = COALESCE(?, provider_status),
         provider_reason = COALESCE(?, provider_reason),
         provider_signature_ok = COALESCE(?, provider_signature_ok),
         provider_response_json = COALESCE(?, provider_response_json)
       WHERE provider = ? AND provider_refund_id = ?`
    )
    .run(
      providerRefId ? String(providerRefId) : null,
      providerTxnId ? String(providerTxnId) : null,
      providerStatus ? String(providerStatus) : null,
      providerReason ? String(providerReason) : null,
      providerSignatureOk === null || providerSignatureOk === undefined ? null : (providerSignatureOk ? 1 : 0),
      providerResponseJson ? String(providerResponseJson) : null,
      p,
      rid
    );

  if (!updates.changes) return null;
  return db
    .prepare('SELECT * FROM order_item_refunds WHERE provider=? AND provider_refund_id=? ORDER BY id DESC LIMIT 1')
    .get(p, rid) || null;
}

function summaryConfirmedByOrder(orderId) {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT
        COALESCE(SUM(quantity_refunded), 0) as qty,
        COALESCE(SUM(amount_refunded), 0) as amount
       FROM order_item_refunds
       WHERE order_id=?
         AND (
           COALESCE(provider, '') <> 'FIUU'
           OR (
             COALESCE(provider_status, '') = '00'
             AND COALESCE(provider_signature_ok, 0) = 1
           )
         )`
    )
    .get(orderId);
  return { quantity_refunded: r.qty, amount_refunded: r.amount };
}

function summariesConfirmedByOrder(orderId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        order_item_id,
        COALESCE(SUM(quantity_refunded), 0) as qty,
        COALESCE(SUM(amount_refunded), 0) as amount
       FROM order_item_refunds
       WHERE order_id=?
         AND (
           COALESCE(provider, '') <> 'FIUU'
           OR (
             COALESCE(provider_status, '') = '00'
             AND COALESCE(provider_signature_ok, 0) = 1
           )
         )
       GROUP BY order_item_id`
    )
    .all(orderId);

  const map = {};
  for (const r of rows) {
    map[String(r.order_item_id)] = { quantity_refunded: r.qty, amount_refunded: r.amount };
  }
  return map;
}

function summaryByOrder(orderId) {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT
        COALESCE(SUM(quantity_refunded), 0) as qty,
        COALESCE(SUM(amount_refunded), 0) as amount
       FROM order_item_refunds
       WHERE order_id=?
         AND (
           COALESCE(provider, '') <> 'FIUU'
           OR COALESCE(provider_status, '') IN ('', 'PENDING', '00')
         )`
    )
    .get(orderId);
  return { quantity_refunded: r.qty, amount_refunded: r.amount };
}

function summaryByOrderItem(orderItemId) {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT
        COALESCE(SUM(quantity_refunded), 0) as qty,
        COALESCE(SUM(amount_refunded), 0) as amount
       FROM order_item_refunds
       WHERE order_item_id=?
         AND (
           COALESCE(provider, '') <> 'FIUU'
           OR COALESCE(provider_status, '') IN ('', 'PENDING', '00')
         )`
    )
    .get(orderItemId);
  return { quantity_refunded: r.qty, amount_refunded: r.amount };
}

function summariesByOrder(orderId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        order_item_id,
        COALESCE(SUM(quantity_refunded), 0) as qty,
        COALESCE(SUM(amount_refunded), 0) as amount
       FROM order_item_refunds
       WHERE order_id=?
         AND (
           COALESCE(provider, '') <> 'FIUU'
           OR COALESCE(provider_status, '') IN ('', 'PENDING', '00')
         )
       GROUP BY order_item_id`
    )
    .all(orderId);

  const map = {};
  for (const r of rows) {
    map[String(r.order_item_id)] = { quantity_refunded: r.qty, amount_refunded: r.amount };
  }
  return map;
}

module.exports = {
  create,
  getById,
  listByOrder,
  updateGatewayByProviderRefId,
  updateGatewayByProviderRefundId,
  summaryByOrder,
  summaryByOrderItem,
  summariesByOrder,
  summaryConfirmedByOrder,
  summariesConfirmedByOrder,
};
