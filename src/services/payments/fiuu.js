const crypto = require('crypto');

const { env } = require('../../config/env');

function md5Hex(input) {
  return crypto.createHash('md5').update(String(input), 'utf8').digest('hex');
}

function buildConfig(override) {
  const o = override && typeof override === 'object' ? override : {};
  return {
    merchantId: String(o.merchantId || env.fiuu.merchantId || '').trim(),
    verifyKey: String(o.verifyKey || env.fiuu.verifyKey || '').trim(),
    secretKey: String(o.secretKey || env.fiuu.secretKey || '').trim(),
    // Default to production gateway base if not provided.
    gatewayUrl: String(o.gatewayUrl || env.fiuu.gatewayUrl || 'https://pay.fiuu.com/RMS/pay').trim(),
    apiBase: String(o.apiBase || env.fiuu.apiBase || '').trim(),
    paymentMethod: String(o.paymentMethod || env.fiuu.paymentMethod || '').trim(),
    currency: String(o.currency || env.fiuu.currency || 'MYR').trim(),
    requestMethod: String(o.requestMethod || env.fiuu.requestMethod || 'GET').toUpperCase(),
    vcodeMode: String(o.vcodeMode || env.fiuu.vcodeMode || 'legacy').toLowerCase(),
  };
}

function isConfigured(fiuuConfig) {
  const c = buildConfig(fiuuConfig);
  return Boolean(
    c.merchantId &&
      c.verifyKey &&
      c.secretKey &&
      c.gatewayUrl
  );
}

function isRefundConfigured(fiuuConfig) {
  const c = buildConfig(fiuuConfig);
  return Boolean(c.merchantId && c.secretKey);
}

function formatAmountFromCents(cents) {
  const v = Number(cents || 0) / 100;
  return v.toFixed(2);
}

function resolveNonPaymentApiBase(fiuuConfig) {
  const c = buildConfig(fiuuConfig);
  const fromEnv = String(c.apiBase || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const gw = String(c.gatewayUrl || '').trim();
  // Spec note: sandbox uses sandbox-payment.fiuu.com for non-payment APIs.
  if (gw.includes('sandbox-payment.fiuu.com')) return 'https://sandbox-payment.fiuu.com';

  return 'https://api.fiuu.com';
}

function buildRefundRequestSignature({ refundType, merchantId, refId, txnId, amountStr, secretKey }) {
  return md5Hex(`${refundType}${merchantId}${refId}${txnId}${amountStr}${secretKey}`);
}

function buildRefundResponseSignature({ refundType, merchantId, refId, refundId, txnId, amountStr, status, secretKey }) {
  return md5Hex(`${refundType}${merchantId}${refId}${refundId}${txnId}${amountStr}${status}${secretKey}`);
}

async function refundPartial({ txnId, refId, amountCents, notifyUrl, mdrFlag, fiuuConfig }) {
  const c = buildConfig(fiuuConfig);
  if (!isRefundConfigured(c)) {
    const err = new Error('Fiuu refund is not configured. Set FIUU_MERCHANT_ID and FIUU_SECRET_KEY.');
    err.status = 500;
    throw err;
  }

  const base = resolveNonPaymentApiBase(c);
  const url = `${base}/RMS/API/refundAPI/index.php`;

  const RefundType = 'P';
  const MerchantID = String(c.merchantId);
  const RefID = String(refId);
  const TxnID = String(txnId);
  const Amount = formatAmountFromCents(amountCents);
  const Signature = buildRefundRequestSignature({
    refundType: RefundType,
    merchantId: MerchantID,
    refId: RefID,
    txnId: TxnID,
    amountStr: Amount,
    secretKey: String(c.secretKey),
  });

  const params = new URLSearchParams();
  params.set('RefundType', RefundType);
  params.set('MerchantID', MerchantID);
  params.set('RefID', RefID);
  params.set('TxnID', TxnID);
  params.set('Amount', Amount);
  params.set('Signature', Signature);
  if (mdrFlag !== undefined && mdrFlag !== null && String(mdrFlag) !== '') params.set('mdr_flag', String(mdrFlag));
  if (notifyUrl) params.set('notify_url', String(notifyUrl));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: params,
  });

  const rawText = await res.text();
  let json = null;
  try {
    json = JSON.parse(rawText);
  } catch (_) {
    const err = new Error('Unexpected refund API response from Fiuu');
    err.status = 502;
    err.details = { httpStatus: res.status, body: rawText.slice(0, 2000) };
    throw err;
  }

  if (json && (json.error_code || json.error_desc)) {
    const err = new Error(`Fiuu refund rejected: ${json.error_code || 'ERR'} ${json.error_desc || ''}`.trim());
    err.status = 502;
    err.details = { ...json };
    throw err;
  }

  let signatureOk = null;
  try {
    const refundId = json.RefundID || json.refundID || json.refundId;
    const status = json.Status || json.status;
    const respSig = String(json.Signature || json.signature || '');
    if (refundId != null && status != null && respSig) {
      const expected = buildRefundResponseSignature({
        refundType: String(json.RefundType || RefundType),
        merchantId: String(json.MerchantID || MerchantID),
        refId: String(json.RefID || RefID),
        refundId: String(refundId),
        txnId: String(json.TxnID || TxnID),
        amountStr: String(json.Amount || Amount),
        status: String(status),
        secretKey: String(c.secretKey),
      });
      signatureOk = expected.toLowerCase() === respSig.toLowerCase();
    }
  } catch (_) {
    signatureOk = null;
  }

  return {
    httpStatus: res.status,
    request: { RefundType, MerchantID, RefID, TxnID, Amount, Signature, notify_url: notifyUrl || null },
    response: json,
    signatureOk,
    rawText,
  };
}

function buildVcode({ amountStr, merchantId, orderId, verifyKey, currency, mode }) {
  // Spec:
  // - legacy:   md5({amount}{merchantID}{orderID}{verify_key})
  // - extended: md5({amount}{merchantID}{orderID}{verify_key}{currency})
  const m = String(mode || 'legacy').toLowerCase();
  if (m === 'extended') {
    return md5Hex(`${amountStr}${merchantId}${orderId}${verifyKey}${String(currency || '')}`);
  }
  return md5Hex(`${amountStr}${merchantId}${orderId}${verifyKey}`);
}

function sanitizeMobile(phone) {
  // Fiuu billing mobile tends to be strict. Keep digits and leading +.
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/\D+/g, '');
  return plus + digits;
}

function getField(payload, names) {
  for (const name of names) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, name)) {
      const v = payload[name];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
  }

  // Case-insensitive fallback for gateways that change casing.
  const lowerNames = names.map((n) => String(n).toLowerCase());
  for (const [k, v] of Object.entries(payload || {})) {
    if (v === undefined || v === null) continue;
    const lk = String(k).toLowerCase();
    if (lowerNames.includes(lk) && String(v).trim() !== '') return String(v);
  }

  return '';
}

function verifyRefundSignature(payload, secretKey) {
  const RefundType = normTrim(getField(payload, ['RefundType', 'refundType']));
  const MerchantID = normTrim(getField(payload, ['MerchantID', 'merchantId', 'merchantID']));
  const RefID = normTrim(getField(payload, ['RefID', 'refId', 'refID']));
  const RefundID = normTrim(getField(payload, ['RefundID', 'refundId', 'refundID']));
  const TxnID = normTrim(getField(payload, ['TxnID', 'txnId', 'txnID', 'tranID', 'tranId']));
  const Amount = normTrim(getField(payload, ['Amount', 'amount']));
  const Status = normTrim(getField(payload, ['Status', 'status']));
  const Signature = normTrim(getField(payload, ['Signature', 'signature']));

  const missing = [];
  if (!RefundType) missing.push('RefundType');
  if (!MerchantID) missing.push('MerchantID');
  if (!RefID) missing.push('RefID');
  if (!RefundID) missing.push('RefundID');
  if (!TxnID) missing.push('TxnID');
  if (!Amount) missing.push('Amount');
  if (!Status) missing.push('Status');
  if (!Signature) missing.push('Signature');
  if (missing.length) return { ok: false, reason: `missing_fields:${missing.join(',')}` };

  const expected = buildRefundResponseSignature({
    refundType: RefundType,
    merchantId: MerchantID,
    refId: RefID,
    refundId: RefundID,
    txnId: TxnID,
    amountStr: Amount,
    status: Status,
    secretKey: String(secretKey || ''),
  });

  return {
    ok: expected.toLowerCase() === Signature.toLowerCase(),
    expected,
    received: Signature,
    used: { RefundType, MerchantID, RefID, RefundID, TxnID, Amount, Status },
  };
}

function normTrim(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeAmountVariants(amountRaw) {
  const raw = normTrim(amountRaw);
  const variants = new Set();
  if (raw) variants.add(raw);

  const deComma = raw.replace(/,/g, '');
  if (deComma) variants.add(deComma);

  const n = Number(deComma);
  if (Number.isFinite(n)) {
    variants.add(String(n));
    variants.add(n.toFixed(2));
  }

  return Array.from(variants);
}

function normalizeCurrencyVariants(currencyRaw, fallback) {
  const raw = normTrim(currencyRaw);
  const fb = normTrim(fallback);
  const variants = new Set();
  if (raw) {
    variants.add(raw);
    variants.add(raw.toUpperCase());
  }
  if (fb) {
    variants.add(fb);
    variants.add(fb.toUpperCase());
  }
  return Array.from(variants);
}

function normalizeMerchantVariants(merchantRaw, fallback) {
  const raw = normTrim(merchantRaw);
  const fb = normTrim(fallback);
  const variants = new Set();
  if (raw) variants.add(raw);
  if (fb) variants.add(fb);
  return Array.from(variants);
}

function verifySkey(payload, secretKey) {
  const tranID = normTrim(getField(payload, ['tranID', 'tranId', 'tranid', 'tran_id', 'txnID', 'txnId', 'txnid', 'txn_id']));
  const orderid = normTrim(getField(payload, ['orderid', 'orderId', 'orderID', 'order']));
  const status = normTrim(getField(payload, ['status', 'stat']));

  // Per spec for payment response skey: merchant ID is provided in `domain`.
  // Some integrations also send `merchant_id`; accept both as candidates.
  const domainRaw = getField(payload, ['domain']);
  const merchantIdFieldRaw = getField(payload, ['merchant_id', 'merchantId', 'merchantID', 'MerchantID']);
  const merchantCandidates = [domainRaw, merchantIdFieldRaw, env.fiuu.merchantId].filter((v) => normTrim(v));

  const amountRaw = getField(payload, ['amount', 'amt']);
  const currencyRaw = getField(payload, ['currency', 'cur']);
  const appcode = normTrim(getField(payload, ['appcode', 'app_code', 'appCode']));
  const paydate = normTrim(getField(payload, ['paydate', 'pay_date', 'payDate']));
  const skey = normTrim(getField(payload, ['skey', 'sKey', 'SKEY']));

  const merchantVariants = Array.from(new Set(merchantCandidates));
  const amountVariants = normalizeAmountVariants(amountRaw);
  const currencyVariants = normalizeCurrencyVariants(currencyRaw, env.fiuu.currency);

  const missing = [];
  if (!tranID) missing.push('tranID');
  if (!orderid) missing.push('orderid');
  if (!status) missing.push('status');
  if (!merchantVariants.length) missing.push('domain');
  if (!amountVariants.length) missing.push('amount');
  if (!currencyVariants.length) missing.push('currency');
  if (!paydate) missing.push('paydate');
  if (!skey) missing.push('skey');

  if (missing.length) {
    return { ok: false, reason: `missing_fields:${missing.join(',')}` };
  }

  // From spec:
  // pre_skey = md5({txnID}{orderID}{status}{merchantID}{amount}{currency})
  // skey     = md5({paydate}{merchantID}{pre_skey}{appcode}{secret_key})
  // Note: some Fiuu payloads omit appcode; treat it as optional and attempt with empty string.

  const appcodeVariants = appcode ? [appcode] : [''];

  const receivedLower = skey.toLowerCase();
  let best = null;
  let attempts = 0;

  for (const merchantId of merchantVariants) {
    for (const amount of amountVariants) {
      for (const currency of currencyVariants) {
        for (const ac of appcodeVariants) {
          attempts += 1;
          const pre = md5Hex(`${tranID}${orderid}${status}${merchantId}${amount}${currency}`);
          const expected = md5Hex(`${paydate}${merchantId}${pre}${ac}${secretKey}`);

          if (expected.toLowerCase() === receivedLower) {
            best = { expected, merchantId, amount, currency, appcode: ac };
            break;
          }
        }
        if (best) break;
      }
      if (best) break;
    }
    if (best) break;
  }

  if (best) {
    return {
      ok: true,
      reason: null,
      expected: best.expected,
      received: skey,
      used: {
        tranID,
        orderid,
        status,
        merchantId: best.merchantId,
        amount: best.amount,
        currency: best.currency,
        appcode: best.appcode,
        paydate,
        attempts,
      },
    };
  }

  // Provide a deterministic "expected" for logging (first variant) even on failure.
  const fallbackMerchantId = merchantVariants[0] || '';
  const fallbackAmount = amountVariants[0] || '';
  const fallbackCurrency = currencyVariants[0] || '';
  const fallbackAppcode = appcodeVariants[0] || '';
  const pre0 = md5Hex(`${tranID}${orderid}${status}${fallbackMerchantId}${fallbackAmount}${fallbackCurrency}`);
  const expected0 = md5Hex(`${paydate}${fallbackMerchantId}${pre0}${fallbackAppcode}${secretKey}`);

  return {
    ok: false,
    reason: 'mismatch',
    expected: expected0,
    received: skey,
    used: {
      tranID,
      orderid,
      status,
      merchantId: fallbackMerchantId,
      amount: fallbackAmount,
      currency: fallbackCurrency,
      appcode: fallbackAppcode,
      paydate,
      attempts,
      candidates: {
        merchant: merchantVariants,
        amount: amountVariants,
        currency: currencyVariants,
      },
    },
  };
}

function statusToPaymentStatus(statCode) {
  // Fiuu uses 00 success, 11 fail, 22 pending (per spec sections).
  switch (String(statCode)) {
    case '00':
      return 'PAID';
    case '22':
      return 'PENDING';
    default:
      return 'FAILED';
  }
}

function buildHostedPaymentRequest({ order, customer, channel, fiuuConfig }) {
  const c = buildConfig(fiuuConfig);
  if (!isConfigured(c)) {
    const err = new Error('Fiuu is not configured.');
    err.status = 500;
    throw err;
  }

  const merchantId = c.merchantId;
  const currency = c.currency || 'MYR';
  const amountStr = formatAmountFromCents(order.total_amount);
  const method = String(c.requestMethod || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
  // Use the same order id format shown in the dashboard (order_code), so the gateway and emails are consistent.
  // Fallback to numeric order_id only if order_code is missing.
  const orderRef = String(order.order_code || order.order_id);

  const fields = {
    merchant_id: merchantId,
    amount: amountStr,
    orderid: orderRef,
    bill_name: customer.customer_name,
    bill_email: customer.email,
    bill_mobile: sanitizeMobile(customer.phone),
    bill_desc: `Order ${orderRef}`,
    currency,
    returnurl: `${env.appBaseUrl}${env.fiuu.returnUrlPath}`,
    callbackurl: `${env.appBaseUrl}${env.fiuu.callbackUrlPath}`,
    cancelurl: `${env.appBaseUrl}${env.fiuu.cancelUrlPath}`,
  };

  if (channel) fields.channel = channel;

  fields.vcode = buildVcode({
    amountStr,
    merchantId,
    orderId: orderRef,
    verifyKey: c.verifyKey,
    currency,
    mode: c.vcodeMode,
  });

  // Gateway URL patterns from spec:
  //   https://pay.fiuu.com/RMS/pay/{MerchantID}/{Payment_Method}
  //   https://sandbox-payment.fiuu.com/RMS/pay/{MerchantID}/{Payment_Method}
  // We accept:
  // - a full URL or template containing {MerchantID} and optional {Payment_Method}
  // - a URL that ends at /RMS/pay (domain or base path)
  // - a URL that ends at /RMS/pay/<merchantId> (lets Fiuu show all available channels)
  // - a full URL /RMS/pay/<merchantId>/<method>
  const rawGateway = String(c.gatewayUrl || '').replace(/\/$/, '');
  const paymentMethod = String(c.paymentMethod || '').trim();

  const merchantInPathRegex = new RegExp(`/RMS/pay/${String(merchantId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|$)`, 'i');

  // If user provided the full hosted URL already, use it directly.
  // Supports both:
  // - /RMS/pay/<merchantId>
  // - /RMS/pay/<merchantId>/<method>
  if (!rawGateway.includes('{') && /\/RMS\/pay\/[^/]+(\/[^/]+)?$/i.test(rawGateway)) {
    if (merchantInPathRegex.test(rawGateway) && Object.prototype.hasOwnProperty.call(fields, 'merchant_id')) {
      delete fields.merchant_id;
    }

    let fullUrl = null;
    if (method === 'GET') {
      try {
        const u = new URL(rawGateway);
        const merchantInPath = u.pathname.includes(`/${merchantId}`);
        const fieldsForQs = { ...fields };
        if (merchantInPath && Object.prototype.hasOwnProperty.call(fieldsForQs, 'merchant_id')) {
          delete fieldsForQs.merchant_id;
        }
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(fieldsForQs)) qs.set(k, String(v));
        fullUrl = `${rawGateway}?${qs.toString()}`;
      } catch {
        // ignore; leave fullUrl null
      }
    }
    return { url: rawGateway, fields, fullUrl, method };
  }

  let url = rawGateway;
  if (rawGateway.includes('{MerchantID}') || rawGateway.includes('{Payment_Method}')) {
    url = rawGateway.replaceAll('{MerchantID}', encodeURIComponent(merchantId));
    if (url.includes('{Payment_Method}')) {
      if (paymentMethod) {
        url = url.replaceAll('{Payment_Method}', encodeURIComponent(paymentMethod));
      } else {
        // Remove the optional payment method segment so Fiuu can show all available channels.
        url = url.replaceAll('/{Payment_Method}', '').replaceAll('{Payment_Method}', '');
      }
    }
  } else if (/\/RMS\/pay\b/i.test(rawGateway)) {
    // If user provided the /RMS/pay base, append merchantId, and append paymentMethod only if present.
    if (/\/RMS\/pay$/i.test(rawGateway)) {
      url = `${rawGateway}/${encodeURIComponent(merchantId)}`;
      if (paymentMethod) url = `${url}/${encodeURIComponent(paymentMethod)}`;
    } else {
      // If it already includes /RMS/pay/<merchantId>, keep it and optionally append method.
      url = rawGateway;
      if (/\/RMS\/pay\/[^/]+$/i.test(rawGateway) && paymentMethod) {
        url = `${rawGateway}/${encodeURIComponent(paymentMethod)}`;
      }
    }
  } else {
    // Treat as domain base.
    url = `${rawGateway}/RMS/pay/${encodeURIComponent(merchantId)}`;
    if (paymentMethod) url = `${url}/${encodeURIComponent(paymentMethod)}`;
  }

  url = String(url).replace(/\/+$/, '');

  if (merchantInPathRegex.test(url) && Object.prototype.hasOwnProperty.call(fields, 'merchant_id')) {
    delete fields.merchant_id;
  }

  let fullUrl = null;
  if (method === 'GET') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) qs.set(k, String(v));
    fullUrl = `${url}?${qs.toString()}`;
  }

  return { url, fields, fullUrl, method, meta: { vcodeMode: c.vcodeMode } };
}

module.exports = {
  formatAmountFromCents,
  buildVcode,
  verifySkey,
  verifyRefundSignature,
  statusToPaymentStatus,
  isConfigured,
  isRefundConfigured,
  buildHostedPaymentRequest,
  refundPartial,
};
