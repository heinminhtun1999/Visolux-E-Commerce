const nodemailer = require('nodemailer');

const { env } = require('../config/env');
const { createOrderViewToken } = require('../utils/orderViewToken');
const { formatDateTime } = require('../utils/datetime');

function isSmtpConfigured() {
  if (!env.email.enabled) return false;
  return Boolean(env.email.smtpHost && env.email.smtpPort && env.email.from);
}

function isStaffNotifyConfigured() {
  return Boolean(isSmtpConfigured() && env.email.orderNotifyTo);
}

function createTransport() {
  return nodemailer.createTransport({
    host: env.email.smtpHost,
    port: env.email.smtpPort,
    secure: env.email.smtpSecure,
    auth: env.email.smtpUser
      ? {
          user: env.email.smtpUser,
          pass: env.email.smtpPass,
        }
      : undefined,
  });
}

function formatMoney(cents) {
  const value = Number(cents || 0) / 100;
  return `RM ${value.toFixed(2)}`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOrderEmail({ order, promo, orderLink }) {
  const orderLabel = order.order_code || `#${order.order_id}`;

  const lines = [];
  lines.push(`New order received: ${orderLabel}`);
  lines.push('');
  lines.push(`Order link: ${orderLink}`);
  lines.push('');
  lines.push(`Customer: ${order.customer_name}`);
  lines.push(`Email: ${order.email}`);
  lines.push(`Phone: ${order.phone}`);
  lines.push(`Address: ${order.address}`);
  lines.push('');
  lines.push(`Payment method: ${order.payment_method}`);
  lines.push(`Payment status: ${order.payment_status}`);
  lines.push(`Fulfilment status: ${order.fulfilment_status}`);
  lines.push(`Created: ${formatDateTime(order.created_at)}`);
  lines.push('');
  lines.push('Items:');
  for (const it of order.items || []) {
    lines.push(`- ${it.product_name_snapshot} x${it.quantity} @ ${formatMoney(it.price_snapshot)} = ${formatMoney(it.subtotal)}`);
  }
  lines.push('');
  if (promo) {
    if (Number(promo.percent_off || 0) > 0) {
      lines.push(`Promo: ${promo.code} (-${promo.percent_off}%)`);
    } else {
      lines.push(`Promo: ${promo.code}`);
    }
    lines.push(`Discount: ${formatMoney(promo.discount_amount)}`);
  }
  lines.push(`Total: ${formatMoney(order.total_amount)}`);

  const text = lines.join('\n');

  const itemsHtml = (order.items || [])
    .map(
      (it) =>
        `<tr>
          <td>${escapeHtml(it.product_name_snapshot)}</td>
          <td style="text-align:right">${escapeHtml(String(it.quantity))}</td>
          <td style="text-align:right">${escapeHtml(formatMoney(it.price_snapshot))}</td>
          <td style="text-align:right">${escapeHtml(formatMoney(it.subtotal))}</td>
        </tr>`
    )
    .join('');

  const promoHtml = promo
    ? `<p><strong>Promo:</strong> ${escapeHtml(promo.code)}${Number(promo.percent_off || 0) > 0 ? ` (-${escapeHtml(String(promo.percent_off))}%)` : ''}<br/>
      <strong>Discount:</strong> ${escapeHtml(formatMoney(promo.discount_amount))}</p>`
    : '';

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.4">
      <h2 style="margin:0 0 8px">New order received: ${escapeHtml(orderLabel)}</h2>
      <p style="margin:0 0 12px"><a href="${escapeHtml(orderLink)}">View order</a></p>

      <h3 style="margin:16px 0 6px">Customer</h3>
      <div>${escapeHtml(order.customer_name)}</div>
      <div>${escapeHtml(order.email)} • ${escapeHtml(order.phone)}</div>
      <div style="margin-top:6px">${escapeHtml(order.address)}</div>

      <h3 style="margin:16px 0 6px">Status</h3>
      <div><strong>Payment:</strong> ${escapeHtml(order.payment_status)} (${escapeHtml(order.payment_method)})</div>
      <div><strong>Fulfilment:</strong> ${escapeHtml(order.fulfilment_status)}</div>
      <div><strong>Created:</strong> ${escapeHtml(formatDateTime(order.created_at))}</div>

      <h3 style="margin:16px 0 6px">Items</h3>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse; width:100%; max-width:760px">
        <thead>
          <tr>
            <th align="left">Item</th>
            <th align="right">Qty</th>
            <th align="right">Price</th>
            <th align="right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      ${promoHtml}

      <p style="margin-top:12px"><strong>Total:</strong> ${escapeHtml(formatMoney(order.total_amount))}</p>
    </div>
  `;

  return { subject: `New order ${orderLabel}`, text, html };
}

function buildCustomerOrderEmail({ order, promo, orderLink }) {
  const orderLabel = order.order_code || `#${order.order_id}`;

  const lines = [];
  lines.push(`Thank you for your order: ${orderLabel}`);
  lines.push('');
  lines.push(`View your order: ${orderLink}`);
  lines.push('');
  lines.push('Order details:');
  for (const it of order.items || []) {
    lines.push(`- ${it.product_name_snapshot} x${it.quantity} @ ${formatMoney(it.price_snapshot)} = ${formatMoney(it.subtotal)}`);
  }
  lines.push('');
  if (promo) {
    if (Number(promo.percent_off || 0) > 0) {
      lines.push(`Promo: ${promo.code} (-${promo.percent_off}%)`);
    } else {
      lines.push(`Promo: ${promo.code}`);
    }
    lines.push(`Discount: ${formatMoney(promo.discount_amount)}`);
  }
  lines.push(`Total: ${formatMoney(order.total_amount)}`);
  lines.push('');
  lines.push(`Payment method: ${order.payment_method}`);
  lines.push(`Payment status: ${order.payment_status}`);
  lines.push('');
  lines.push('If you created an account, sign in to view your order.');

  const text = lines.join('\n');

  const itemsHtml = (order.items || [])
    .map(
      (it) =>
        `<tr>
          <td>${escapeHtml(it.product_name_snapshot)}</td>
          <td style="text-align:right">${escapeHtml(String(it.quantity))}</td>
          <td style="text-align:right">${escapeHtml(formatMoney(it.price_snapshot))}</td>
          <td style="text-align:right">${escapeHtml(formatMoney(it.subtotal))}</td>
        </tr>`
    )
    .join('');

  const promoHtml = promo
    ? `<p><strong>Promo:</strong> ${escapeHtml(promo.code)}${Number(promo.percent_off || 0) > 0 ? ` (-${escapeHtml(String(promo.percent_off))}%)` : ''}<br/>
      <strong>Discount:</strong> ${escapeHtml(formatMoney(promo.discount_amount))}</p>`
    : '';

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.4">
      <h2 style="margin:0 0 8px">Thank you for your order: ${escapeHtml(orderLabel)}</h2>
      <p style="margin:0 0 12px"><a href="${escapeHtml(orderLink)}">View your order</a></p>

      <h3 style="margin:16px 0 6px">Items</h3>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse; width:100%; max-width:760px">
        <thead>
          <tr>
            <th align="left">Item</th>
            <th align="right">Qty</th>
            <th align="right">Price</th>
            <th align="right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      ${promoHtml}

      <p style="margin-top:12px"><strong>Total:</strong> ${escapeHtml(formatMoney(order.total_amount))}</p>
      <p style="margin-top:12px"><strong>Payment method:</strong> ${escapeHtml(order.payment_method)}<br/>
         <strong>Payment status:</strong> ${escapeHtml(order.payment_status)}</p>

      <p style="margin-top:12px" class="muted">If you created an account, sign in to view your order.</p>
    </div>
  `;

  return { subject: `Your order ${orderLabel}`, text, html };
}

function buildCustomerOrderStatusEmail({ order, event, note, orderLink }) {
  const orderLabel = order.order_code || `#${order.order_id}`;
  const when = formatDateTime(new Date());
  const ev = String(event || 'STATUS_UPDATE');

  let headline = 'Order update';
  if (ev === 'PAYMENT_STATUS') headline = 'Payment status updated';
  if (ev === 'FULFILMENT_STATUS') headline = 'Fulfilment status updated';
  if (ev === 'OFFLINE_VERIFIED') headline = 'Offline payment verified';
  if (ev === 'OFFLINE_REJECTED') headline = 'Offline payment rejected';
  if (ev === 'REFUND') headline = 'Refund processed';
  if (ev === 'PARTIAL_REFUND') headline = 'Partial refund processed';
  if (ev === 'FULL_REFUND') headline = 'Full refund processed';

  const safeNote = String(note || '').trim();

  const lines = [];
  lines.push(`${headline}: ${orderLabel}`);
  lines.push('');
  lines.push(`View your order: ${orderLink}`);
  lines.push('');
  lines.push(`Payment method: ${order.payment_method}`);
  lines.push(`Payment status: ${order.payment_status}`);
  lines.push(`Fulfilment status: ${order.fulfilment_status}`);
  if (safeNote) {
    lines.push('');
    lines.push(`Note: ${safeNote}`);
  }
  lines.push('');
  lines.push(`Updated: ${when}`);
  const text = lines.join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.4">
      <h2 style="margin:0 0 8px">${escapeHtml(headline)}: ${escapeHtml(orderLabel)}</h2>
      <p style="margin:0 0 12px"><a href="${escapeHtml(orderLink)}">View your order</a></p>

      <h3 style="margin:16px 0 6px">Current status</h3>
      <div><strong>Payment method:</strong> ${escapeHtml(order.payment_method)}</div>
      <div><strong>Payment status:</strong> ${escapeHtml(order.payment_status)}</div>
      <div><strong>Fulfilment status:</strong> ${escapeHtml(order.fulfilment_status)}</div>

      ${safeNote ? `<p style="margin-top:12px"><strong>Note:</strong> ${escapeHtml(safeNote)}</p>` : ''}

      <p style="margin-top:12px" class="muted"><strong>Updated:</strong> ${escapeHtml(when)}</p>
    </div>
  `;

  return { subject: `${headline} – ${orderLabel}`, text, html };
}

function buildPasswordResetEmail({ resetLink, username, ttlMinutes }) {
  const minutes = Number(ttlMinutes || 0);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 60;

  const name = String(username || '').trim();
  const hello = name ? `Hi ${name},` : 'Hi,';
  const lines = [];
  lines.push(hello);
  lines.push('');
  lines.push('We received a request to reset your password.');
  lines.push(`This link expires in ${safeMinutes} minute(s).`);
  lines.push('');
  lines.push(`Reset your password: ${resetLink}`);
  lines.push('');
  lines.push('If you did not request this, you can ignore this email.');

  const text = lines.join('\n');
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.4">
      <p style="margin:0 0 12px">${escapeHtml(hello)}</p>
      <p style="margin:0 0 12px">We received a request to reset your password.</p>
      <p style="margin:0 0 12px">This link expires in <strong>${escapeHtml(String(safeMinutes))}</strong> minute(s).</p>
      <p style="margin:0 0 12px"><a href="${escapeHtml(resetLink)}">Reset your password</a></p>
      <p style="margin:0">If you did not request this, you can ignore this email.</p>
    </div>
  `;

  return { subject: 'Reset your password', text, html };
}

async function sendOrderReceivedEmail({ order, promo }) {
  if (!isStaffNotifyConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] not configured; skipping order email');
    return { sent: false, reason: 'not_configured' };
  }

  const orderLink = `${String(env.appBaseUrl || '').replace(/\/$/, '')}/admin/orders/${order.order_id}`;
  const msg = buildOrderEmail({ order, promo, orderLink });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to: env.email.orderNotifyTo,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { sent: true };
  } finally {
    try {
      transport.close();
    } catch (_) {
      // ignore
    }
  }
}

async function sendOrderPlacedEmailToCustomer({ order, promo }) {
  if (!isSmtpConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] SMTP not configured; skipping customer email');
    return { sent: false, reason: 'not_configured' };
  }

  const to = String(order.email || '').trim();
  if (!to) {
    return { sent: false, reason: 'missing_customer_email' };
  }

  const base = String(env.appBaseUrl || '').replace(/\/$/, '');
  const token = order.user_id ? '' : createOrderViewToken({ orderId: order.order_id, ttlDays: 180 });
  const orderLink = `${base}/orders/${order.order_id}${token ? `?t=${encodeURIComponent(token)}` : ''}`;
  const msg = buildCustomerOrderEmail({ order, promo, orderLink });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { sent: true };
  } finally {
    try {
      transport.close();
    } catch (_) {
      // ignore
    }
  }
}

async function sendOrderStatusChangedEmailToCustomer({ order, event, note }) {
  if (!isSmtpConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] SMTP not configured; skipping status email');
    return { sent: false, reason: 'not_configured' };
  }

  const to = String(order.email || '').trim();
  if (!to) {
    return { sent: false, reason: 'missing_customer_email' };
  }

  const base = String(env.appBaseUrl || '').replace(/\/$/, '');
  const token = order.user_id ? '' : createOrderViewToken({ orderId: order.order_id, ttlDays: 180 });
  const orderLink = `${base}/orders/${order.order_id}${token ? `?t=${encodeURIComponent(token)}` : ''}`;
  const msg = buildCustomerOrderStatusEmail({ order, event, note, orderLink });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { sent: true };
  } finally {
    try {
      transport.close();
    } catch (_) {
      // ignore
    }
  }
}

async function sendPasswordResetEmail({ to, username, resetLink, ttlMinutes }) {
  if (!isSmtpConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] SMTP not configured; skipping password reset email');
    return { sent: false, reason: 'not_configured' };
  }

  const recipient = String(to || '').trim();
  if (!recipient) return { sent: false, reason: 'missing_email' };

  const msg = buildPasswordResetEmail({ resetLink, username, ttlMinutes });
  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to: recipient,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { sent: true };
  } finally {
    try {
      transport.close();
    } catch (_) {
      // ignore
    }
  }
}

function buildRefundRequestFailedEmail({ order, itemLabel, qty, amountCents, reason, errorMessage, adminOrderLink }) {
  const orderLabel = (order && (order.order_code || order.order_id)) ? (order.order_code || `#${order.order_id}`) : 'Order';
  const rm = `RM ${(Number(amountCents || 0) / 100).toFixed(2)}`;
  const safeReason = String(reason || '').trim();
  const safeErr = String(errorMessage || '').trim() || 'Refund request failed.';

  const lines = [];
  lines.push(`Refund request FAILED for ${orderLabel}`);
  lines.push('');
  lines.push(`Item: ${itemLabel}`);
  lines.push(`Qty: ${qty}`);
  lines.push(`Amount: ${rm}`);
  if (safeReason) lines.push(`Reason: ${safeReason}`);
  lines.push('');
  lines.push(`Error: ${safeErr}`);
  if (adminOrderLink) {
    lines.push('');
    lines.push(`Admin link: ${adminOrderLink}`);
  }
  const text = lines.join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.4">
      <h2 style="margin:0 0 8px">Refund request failed</h2>
      <p style="margin:0 0 10px"><strong>Order:</strong> ${escapeHtml(orderLabel)}</p>
      <p style="margin:0 0 10px"><strong>Item:</strong> ${escapeHtml(itemLabel)}<br/>
         <strong>Qty:</strong> ${escapeHtml(String(qty))}<br/>
         <strong>Amount:</strong> ${escapeHtml(rm)}
         ${safeReason ? `<br/><strong>Reason:</strong> ${escapeHtml(safeReason)}` : ''}
      </p>
      <p style="margin:0 0 10px"><strong>Error:</strong> ${escapeHtml(safeErr)}</p>
      ${adminOrderLink ? `<p style="margin:0"><a href="${escapeHtml(adminOrderLink)}">Open order in admin</a></p>` : ''}
    </div>
  `;

  return { subject: `Refund failed – ${orderLabel}`, text, html };
}

async function sendRefundRequestFailedEmail({ order, toCustomerEmail, itemLabel, qty, amountCents, reason, errorMessage }) {
  if (!isSmtpConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] SMTP not configured; skipping refund failure email');
    return { sent: false, reason: 'not_configured' };
  }

  const recipients = [];
  if (env.email.orderNotifyTo) recipients.push(String(env.email.orderNotifyTo).trim());
  if (toCustomerEmail) recipients.push(String(toCustomerEmail).trim());

  const to = recipients.filter(Boolean).join(',');
  if (!to) return { sent: false, reason: 'missing_recipients' };

  const adminOrderLink = order && order.order_id
    ? `${String(env.appBaseUrl || '').replace(/\/$/, '')}/admin/orders/${order.order_id}`
    : null;
  const msg = buildRefundRequestFailedEmail({ order, itemLabel, qty, amountCents, reason, errorMessage, adminOrderLink });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { sent: true };
  } finally {
    try {
      transport.close();
    } catch (_) {
      // ignore
    }
  }
}

module.exports = {
  sendOrderReceivedEmail,
  sendOrderPlacedEmailToCustomer,
  sendOrderStatusChangedEmailToCustomer,
  sendPasswordResetEmail,
  sendRefundRequestFailedEmail,
  isEmailConfigured: isSmtpConfigured,
};
