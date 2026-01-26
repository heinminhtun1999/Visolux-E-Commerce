const { getDb } = require('../db/db');

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

function normalizeDateInput(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  // Expect yyyy-mm-dd (HTML date input)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s;
}

function getConfirmedRefundsWhereSql() {
  // Keep consistent with orderRefundRepo summaryConfirmedByOrder.
  return `(
    COALESCE(provider, '') <> 'FIUU'
    OR (
      COALESCE(provider_status, '') = '00'
      AND COALESCE(provider_signature_ok, 0) = 1
    )
  )`;
}

function getSalesReport({ dateFrom, dateTo } = {}) {
  const db = getDb();
  const df = normalizeDateInput(dateFrom);
  const dt = normalizeDateInput(dateTo);

  const paidWhere = [`payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')`];
  const paidParams = {};
  buildDateRangeWhere({ column: 'created_at', dateFrom: df, dateTo: dt, where: paidWhere, params: paidParams });

  const paidSummary = db
    .prepare(
      `SELECT
        COUNT(*) as orders_count,
        COALESCE(SUM(items_subtotal), 0) as items_subtotal_cents,
        COALESCE(SUM(discount_amount), 0) as discount_cents,
        COALESCE(SUM(shipping_fee), 0) as shipping_cents,
        COALESCE(SUM(total_amount), 0) as gross_cents
       FROM orders
       WHERE ${paidWhere.join(' AND ')}`
    )
    .get(paidParams);

  const unitsSummary = db
    .prepare(
      `SELECT
        COALESCE(SUM(oi.quantity), 0) as units_sold
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       WHERE o.${paidWhere.join(' AND o.')}`
    )
    .get(paidParams);

  // Estimated gross profit uses current inventory cost_price (when available).
  // If cost_price is NULL (unknown) or the product row is missing, we treat it as unknown cost.
  const profitSummary = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN i.cost_price IS NOT NULL THEN oi.subtotal ELSE 0 END), 0) as known_sales_cents,
        COALESCE(SUM(CASE WHEN i.cost_price IS NOT NULL THEN (oi.quantity * i.cost_price) ELSE 0 END), 0) as known_cogs_cents,
        COALESCE(SUM(CASE WHEN i.cost_price IS NULL THEN oi.quantity ELSE 0 END), 0) as unknown_cost_units
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       LEFT JOIN inventory i ON i.product_id = oi.product_id
       WHERE o.${paidWhere.join(' AND o.')}`
    )
    .get(paidParams);

  const refundsWhereItem = [getConfirmedRefundsWhereSql()];
  const refundsParamsItem = {};
  buildDateRangeWhere({ column: 'created_at', dateFrom: df, dateTo: dt, where: refundsWhereItem, params: refundsParamsItem });

  const itemRefunds = db
    .prepare(
      `SELECT COALESCE(SUM(amount_refunded), 0) as refund_cents
       FROM order_item_refunds
       WHERE ${refundsWhereItem.join(' AND ')}`
    )
    .get(refundsParamsItem);

  const refundsWhereExtra = [getConfirmedRefundsWhereSql()];
  const refundsParamsExtra = {};
  buildDateRangeWhere({ column: 'created_at', dateFrom: df, dateTo: dt, where: refundsWhereExtra, params: refundsParamsExtra });

  const extraRefunds = db
    .prepare(
      `SELECT COALESCE(SUM(amount_refunded), 0) as refund_cents
       FROM order_refunds
       WHERE ${refundsWhereExtra.join(' AND ')}`
    )
    .get(refundsParamsExtra);

  const refundCents = Number(itemRefunds.refund_cents || 0) + Number(extraRefunds.refund_cents || 0);

  const dailyOrders = db
    .prepare(
      `SELECT
        date(created_at) as day,
        COUNT(*) as orders_count,
        COALESCE(SUM(total_amount), 0) as gross_cents
       FROM orders
       WHERE ${paidWhere.join(' AND ')}
       GROUP BY date(created_at)
       ORDER BY day ASC`
    )
    .all(paidParams)
    .map((r) => ({
      day: r.day,
      orders_count: r.orders_count,
      gross_cents: r.gross_cents,
    }));

  const dailyProfitRows = db
    .prepare(
      `SELECT
        date(o.created_at) as day,
        COALESCE(SUM(CASE WHEN i.cost_price IS NOT NULL THEN oi.subtotal ELSE 0 END), 0) as known_sales_cents,
        COALESCE(SUM(CASE WHEN i.cost_price IS NOT NULL THEN (oi.quantity * i.cost_price) ELSE 0 END), 0) as known_cogs_cents,
        COALESCE(SUM(CASE WHEN i.cost_price IS NULL THEN oi.quantity ELSE 0 END), 0) as unknown_cost_units
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       LEFT JOIN inventory i ON i.product_id = oi.product_id
       WHERE o.${paidWhere.join(' AND o.')}
       GROUP BY date(o.created_at)
       ORDER BY day ASC`
    )
    .all(paidParams);

  const profitByDay = new Map();
  for (const r of dailyProfitRows) {
    const knownSales = Number(r.known_sales_cents || 0);
    const knownCogs = Number(r.known_cogs_cents || 0);
    profitByDay.set(String(r.day), {
      known_sales_cents: knownSales,
      known_cogs_cents: knownCogs,
      profit_cents: knownSales - knownCogs,
      unknown_cost_units: Number(r.unknown_cost_units || 0),
    });
  }

  const dailyRefundRows = db
    .prepare(
      `SELECT day, COALESCE(SUM(refund_cents), 0) as refund_cents
       FROM (
         SELECT date(created_at) as day, COALESCE(SUM(amount_refunded), 0) as refund_cents
         FROM order_item_refunds
         WHERE ${refundsWhereItem.join(' AND ')}
         GROUP BY date(created_at)
         UNION ALL
         SELECT date(created_at) as day, COALESCE(SUM(amount_refunded), 0) as refund_cents
         FROM order_refunds
         WHERE ${refundsWhereExtra.join(' AND ')}
         GROUP BY date(created_at)
       )
       GROUP BY day
       ORDER BY day ASC`
    )
    .all({ ...refundsParamsItem, ...refundsParamsExtra });

  const refundByDay = new Map();
  for (const r of dailyRefundRows) {
    refundByDay.set(String(r.day), Number(r.refund_cents || 0));
  }

  const daily = dailyOrders.map((r) => {
    const refunds = refundByDay.get(String(r.day)) || 0;
    const profit = profitByDay.get(String(r.day)) || {
      known_sales_cents: 0,
      known_cogs_cents: 0,
      profit_cents: 0,
      unknown_cost_units: 0,
    };
    return {
      day: r.day,
      orders_count: r.orders_count,
      gross_cents: r.gross_cents,
      refund_cents: refunds,
      net_cents: Number(r.gross_cents || 0) - refunds,
      profit_cents: profit.profit_cents,
      profit_known_sales_cents: profit.known_sales_cents,
      profit_known_cogs_cents: profit.known_cogs_cents,
      profit_unknown_cost_units: profit.unknown_cost_units,
    };
  });

  const topProducts = db
    .prepare(
      `SELECT
        oi.product_id as product_id,
        oi.product_name_snapshot as product_name,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.subtotal), 0) as subtotal_cents,
        COALESCE(SUM(CASE WHEN i.cost_price IS NOT NULL THEN (oi.quantity * i.cost_price) ELSE 0 END), 0) as known_cogs_cents,
        COALESCE(SUM(CASE WHEN i.cost_price IS NOT NULL THEN oi.subtotal ELSE 0 END), 0) as known_sales_cents,
        COALESCE(SUM(CASE WHEN i.cost_price IS NULL THEN oi.quantity ELSE 0 END), 0) as unknown_cost_units
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       LEFT JOIN inventory i ON i.product_id = oi.product_id
       WHERE o.${paidWhere.join(' AND o.')}
       GROUP BY oi.product_id, oi.product_name_snapshot
       ORDER BY subtotal_cents DESC
       LIMIT 20`
    )
    .all(paidParams)
    .map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      quantity: r.quantity,
      subtotal_cents: r.subtotal_cents,
      profit_known_cogs_cents: Number(r.known_cogs_cents || 0),
      profit_known_sales_cents: Number(r.known_sales_cents || 0),
      profit_cents: Number(r.known_sales_cents || 0) - Number(r.known_cogs_cents || 0),
      profit_unknown_cost_units: Number(r.unknown_cost_units || 0),
    }));

  const grossCents = Number(paidSummary.gross_cents || 0);
  const netCents = grossCents - refundCents;

  const itemsSubtotalCents = Number(paidSummary.items_subtotal_cents || 0);
  const discountCents = Number(paidSummary.discount_cents || 0);
  const shippingCents = Number(paidSummary.shipping_cents || 0);

  const unitsSold = Number(unitsSummary.units_sold || 0);

  const knownSalesCents = Number(profitSummary.known_sales_cents || 0);
  const knownCogsCents = Number(profitSummary.known_cogs_cents || 0);
  const profitCents = knownSalesCents - knownCogsCents;
  const unknownCostUnits = Number(profitSummary.unknown_cost_units || 0);

  const ordersCount = Number(paidSummary.orders_count || 0);
  const avgOrderValueCents = ordersCount > 0 ? Math.round(grossCents / ordersCount) : 0;

  return {
    date_from: df,
    date_to: dt,
    summary: {
      orders_count: ordersCount,
      avg_order_value_cents: avgOrderValueCents,
      units_sold: unitsSold,
      items_subtotal_cents: itemsSubtotalCents,
      discount_cents: discountCents,
      shipping_cents: shippingCents,
      gross_cents: grossCents,
      refund_cents: refundCents,
      net_cents: netCents,
      profit_cents: profitCents,
      profit_known_sales_cents: knownSalesCents,
      profit_known_cogs_cents: knownCogsCents,
      profit_unknown_cost_units: unknownCostUnits,
    },
    daily,
    topProducts,
  };
}

module.exports = {
  getSalesReport,
};
