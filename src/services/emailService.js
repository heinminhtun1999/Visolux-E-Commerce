const nodemailer = require('nodemailer');

const { env } = require('../config/env');
const settingsRepo = require('../repositories/settingsRepo');
const { formatDateTime } = require('../utils/datetime');

function isSmtpConfigured() {
  if (!env.email.enabled) return false;
  return Boolean(env.email.smtpHost && env.email.smtpPort && env.email.from);
}

function isStaffNotifyConfigured() {
  return Boolean(isSmtpConfigured() && getAdminNotifyConfig().to);
}

function getAdminNotifyConfig() {
  const toSetting = String(settingsRepo.get('email.admin_notify.to', '') || '').trim();
  const ccSetting = String(settingsRepo.get('email.admin_notify.cc', '') || '').trim();

  // Backward-compatible default: environment variable.
  const fallbackTo = String(env.email.orderNotifyTo || '').trim();

  return {
    to: toSetting || fallbackTo,
    cc: ccSetting,
  };
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

function getPublicBaseUrl() {
  let base = String(env.appBaseUrl || '').trim().replace(/\/$/, '');
  // If cookies are marked Secure, the public site should be HTTPS.
  // This prevents broken email links (e.g. http://...) in SSL-only deployments.
  if (env.secureCookies && base.startsWith('http://')) base = `https://${base.slice('http://'.length)}`;
  return base;
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

  const notify = getAdminNotifyConfig();

  const orderLink = `${getPublicBaseUrl()}/admin/orders/${order.order_id}`;
  const msg = buildOrderEmail({ order, promo, orderLink });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to: notify.to,
      cc: notify.cc || undefined,
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

  const base = getPublicBaseUrl();
  const orderLink = `${base}/orders/${order.order_id}`;
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

  const base = getPublicBaseUrl();
  const orderLink = `${base}/orders/${order.order_id}`;
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

function buildAdminEventEmail({ subject, heading, lines, linkUrl, linkLabel }) {
  const safeSubject = String(subject || '').trim() || 'Admin notification';
  const safeHeading = String(heading || '').trim() || 'Admin notification';
  const safeLines = Array.isArray(lines) ? lines.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const safeLinkUrl = linkUrl ? String(linkUrl).trim() : '';
  const safeLinkLabel = String(linkLabel || '').trim() || 'Open in admin';

  const textLines = [];
  textLines.push(safeHeading);
  if (safeLines.length) {
    textLines.push('');
    for (const l of safeLines) textLines.push(l);
  }
  if (safeLinkUrl) {
    textLines.push('');
    textLines.push(`${safeLinkLabel}: ${safeLinkUrl}`);
  }

  const htmlLines = safeLines.length
    ? `<ul style="margin:10px 0 0; padding-left:18px">${safeLines
        .map((l) => `<li>${escapeHtml(l)}</li>`)
        .join('')}</ul>`
    : '';

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.4">
      <h2 style="margin:0 0 8px">${escapeHtml(safeHeading)}</h2>
      ${htmlLines}
      ${safeLinkUrl ? `<p style="margin-top:12px"><a href="${escapeHtml(safeLinkUrl)}">${escapeHtml(safeLinkLabel)}</a></p>` : ''}
    </div>
  `;

  return { subject: safeSubject, text: textLines.join('\n'), html };
}

async function sendAdminOrderEventEmail({ order, subject, heading, lines, linkLabel }) {
  if (!isStaffNotifyConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] not configured; skipping admin order event email');
    return { sent: false, reason: 'not_configured' };
  }

  if (!order || !order.order_id) return { sent: false, reason: 'missing_order' };

  const notify = getAdminNotifyConfig();
  const adminLink = `${getPublicBaseUrl()}/admin/orders/${order.order_id}`;

  const msg = buildAdminEventEmail({
    subject,
    heading,
    lines,
    linkUrl: adminLink,
    linkLabel: linkLabel || 'View order',
  });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to: notify.to,
      cc: notify.cc || undefined,
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

async function sendAdminOrderStatusChangedEmail({ order, statusType, oldStatus, newStatus, note, actor, source }) {
  const orderLabel = order && (order.order_code || order.order_id) ? (order.order_code || `#${order.order_id}`) : 'Order';
  const type = String(statusType || '').trim().toUpperCase();
  const label = type === 'FULFILMENT' ? 'Fulfilment status' : 'Payment status';
  const safeOld = String(oldStatus || '').trim() || '-';
  const safeNew = String(newStatus || '').trim() || '-';
  const safeNote = String(note || '').trim();
  const safeSource = String(source || '').trim();

  const lines = [];
  lines.push(`Order: ${orderLabel}`);
  lines.push(`Customer: ${order.customer_name || '-'}`);
  lines.push(`${label}: ${safeOld} → ${safeNew}`);
  lines.push(`Payment: ${order.payment_status || '-'} (${order.payment_method || '-'})`);
  lines.push(`Fulfilment: ${order.fulfilment_status || '-'}`);
  if (safeNote) lines.push(`Note: ${safeNote}`);
  if (actor && actor.username) lines.push(`By: ${String(actor.username).trim()}`);
  if (safeSource) lines.push(`Source: ${safeSource}`);

  return sendAdminOrderEventEmail({
    order,
    subject: `${label} updated – ${orderLabel}`,
    heading: `${label} updated for ${orderLabel}`,
    lines,
    linkLabel: 'Open order',
  });
}

async function sendAdminRefundStatusChangedEmail({ order, oldRefundStatus, newRefundStatus, refundedAmountCents }) {
  const orderLabel = order && (order.order_code || order.order_id) ? (order.order_code || `#${order.order_id}`) : 'Order';
  const safeOld = String(oldRefundStatus || 'NONE').trim() || 'NONE';
  const safeNew = String(newRefundStatus || 'NONE').trim() || 'NONE';
  const rm = formatMoney(refundedAmountCents || 0);

  const lines = [];
  lines.push(`Order: ${orderLabel}`);
  lines.push(`Customer: ${order.customer_name || '-'}`);
  lines.push(`Refund status: ${safeOld} → ${safeNew}`);
  lines.push(`Refunded: ${rm}`);
  lines.push(`Payment: ${order.payment_status || '-'} (${order.payment_method || '-'})`);
  lines.push(`Fulfilment: ${order.fulfilment_status || '-'}`);

  return sendAdminOrderEventEmail({
    order,
    subject: `Refund update – ${orderLabel}`,
    heading: `Refund update for ${orderLabel}`,
    lines,
    linkLabel: 'Review order',
  });
}

async function sendAdminPaymentReceivedEmail({ order, note, stockDeducted, stockError }) {
  if (!isStaffNotifyConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] not configured; skipping admin payment received email');
    return { sent: false, reason: 'not_configured' };
  }

  if (!order || !order.order_id) return { sent: false, reason: 'missing_order' };

  const notify = getAdminNotifyConfig();
  const orderLabel = order.order_code || `#${order.order_id}`;
  const adminLink = `${getPublicBaseUrl()}/admin/orders/${order.order_id}`;

  const lines = [];
  lines.push(`Order: ${orderLabel}`);
  lines.push(`Customer: ${order.customer_name || '-'}`);
  lines.push(`Payment: ${order.payment_status || '-'} (${order.payment_method || '-'})`);
  lines.push(`Fulfilment: ${order.fulfilment_status || '-'}`);
  if (note) lines.push(`Note: ${String(note).trim()}`);
  if (stockDeducted === false) {
    lines.push(`Stock: NOT deducted${stockError ? ` (${String(stockError).trim()})` : ''}`);
  }

  const msg = buildAdminEventEmail({
    subject: `Payment received – ${orderLabel}`,
    heading: `Payment received for ${orderLabel}`,
    lines,
    linkUrl: adminLink,
    linkLabel: 'View order',
  });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to: notify.to,
      cc: notify.cc || undefined,
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

async function sendAdminOfflineSlipUploadedEmail({ order, bankName, referenceNumber, slipPath, isReplacement }) {
  if (!isStaffNotifyConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] not configured; skipping admin slip uploaded email');
    return { sent: false, reason: 'not_configured' };
  }

  if (!order || !order.order_id) return { sent: false, reason: 'missing_order' };

  const notify = getAdminNotifyConfig();
  const orderLabel = order.order_code || `#${order.order_id}`;
  const adminLink = `${getPublicBaseUrl()}/admin/orders/${order.order_id}`;
  const slipUrl = slipPath ? `${getPublicBaseUrl()}${String(slipPath).trim()}` : '';

  const lines = [];
  lines.push(`Order: ${orderLabel}`);
  lines.push(`Customer: ${order.customer_name || '-'}`);
  if (bankName) lines.push(`Bank: ${String(bankName).trim()}`);
  if (referenceNumber) lines.push(`Reference: ${String(referenceNumber).trim()}`);
  lines.push(`Payment: ${order.payment_status || '-'} (${order.payment_method || '-'})`);
  lines.push(`Fulfilment: ${order.fulfilment_status || '-'}`);
  if (slipUrl) lines.push(`Slip: ${slipUrl}`);

  const msg = buildAdminEventEmail({
    subject: `${isReplacement ? 'Bank slip replaced' : 'Bank slip uploaded'} – ${orderLabel}`,
    heading: `${isReplacement ? 'Bank slip replaced' : 'Bank slip uploaded'} for ${orderLabel}`,
    lines,
    linkUrl: adminLink,
    linkLabel: 'Review order',
  });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to: notify.to,
      cc: notify.cc || undefined,
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

async function sendRefundRequestFailedEmail({ order, toCustomerEmail, itemLabel, qty, amountCents, reason, errorMessage }) {
  if (!isSmtpConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[email] SMTP not configured; skipping refund failure email');
    return { sent: false, reason: 'not_configured' };
  }

  const notify = getAdminNotifyConfig();
  const recipients = [];
  if (notify.to) recipients.push(String(notify.to).trim());
  if (toCustomerEmail) recipients.push(String(toCustomerEmail).trim());

  const to = recipients.filter(Boolean).join(',');
  if (!to) return { sent: false, reason: 'missing_recipients' };

  const adminOrderLink = order && order.order_id
    ? `${getPublicBaseUrl()}/admin/orders/${order.order_id}`
    : null;
  const msg = buildRefundRequestFailedEmail({ order, itemLabel, qty, amountCents, reason, errorMessage, adminOrderLink });

  const transport = createTransport();
  try {
    await transport.sendMail({
      from: env.email.from,
      to,
      cc: notify.cc || undefined,
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
  sendAdminOrderEventEmail,
  sendAdminOrderStatusChangedEmail,
  sendAdminRefundStatusChangedEmail,
  sendAdminPaymentReceivedEmail,
  sendAdminOfflineSlipUploadedEmail,
  sendOrderPlacedEmailToCustomer,
  sendOrderStatusChangedEmailToCustomer,
  sendPasswordResetEmail,
  sendRefundRequestFailedEmail,
  isEmailConfigured: isSmtpConfigured,
};
