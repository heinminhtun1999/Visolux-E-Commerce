const settingsRepo = require('../repositories/settingsRepo');

const ACCOUNTS_KEY = 'payments.fiuu.accounts.v1';
const DEFAULT_ID_KEY = 'payments.fiuu.default_account_id.v1';
const CATEGORY_MAP_KEY = 'payments.fiuu.category_account_map.v1';

function safeJsonParse(raw, fallback) {
  try {
    if (raw == null) return fallback;
    const s = String(raw || '').trim();
    if (!s) return fallback;
    return JSON.parse(s);
  } catch (_) {
    return fallback;
  }
}

function normTrim(v) {
  const s = String(v == null ? '' : v).trim();
  return s || '';
}

function getAccountsRaw() {
  const raw = settingsRepo.get(ACCOUNTS_KEY, '');
  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function getAccounts() {
  return getAccountsRaw()
    .map((a) => ({
      id: normTrim(a.id),
      label: normTrim(a.label),
      merchantId: normTrim(a.merchantId || a.merchant_id),
      verifyKey: normTrim(a.verifyKey || a.verify_key),
      secretKey: normTrim(a.secretKey || a.secret_key),
      gatewayUrl: normTrim(a.gatewayUrl || a.gateway_url),
      currency: normTrim(a.currency) || 'MYR',
      paymentMethod: normTrim(a.paymentMethod || a.payment_method),
      requestMethod: (normTrim(a.requestMethod || a.request_method) || '').toUpperCase() || '',
      vcodeMode: normTrim(a.vcodeMode || a.vcode_mode) || 'legacy',
    }))
    .filter((a) => a.id);
}

function getDefaultAccountId() {
  return normTrim(settingsRepo.get(DEFAULT_ID_KEY, '')) || null;
}

function getCategoryAccountMap() {
  const raw = settingsRepo.get(CATEGORY_MAP_KEY, '');
  const parsed = safeJsonParse(raw, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    const slug = normTrim(k);
    const id = normTrim(v);
    if (!slug) continue;
    // Drop legacy env-based mappings.
    if (id === 'env') {
      out[slug] = '';
      continue;
    }
    out[slug] = id || '';
  }
  return out;
}

function findAccountById(id) {
  const target = normTrim(id);
  if (!target) return null;
  return getAccounts().find((a) => a.id === target) || null;
}

function getDefaultAccount() {
  const accounts = getAccounts();
  const defaultId = getDefaultAccountId();
  const selected = defaultId ? accounts.find((a) => a.id === defaultId) : null;
  if (selected) return selected;
  if (accounts.length > 0) return accounts[0];
  return null;
}

function isOnlinePaymentConfigured() {
  const a = getDefaultAccount();
  return Boolean(a && a.merchantId && a.secretKey);
}

function resolveAccountIdForCategorySlug(categorySlug) {
  const slug = normTrim(categorySlug);
  const map = getCategoryAccountMap();
  const mapped = map[slug];
  if (mapped) return mapped;
  return getDefaultAccount()?.id || null;
}

function resolveAccountForCartItems(cartItems) {
  const slugs = new Set();
  for (const line of cartItems || []) {
    const slug = normTrim(line?.product?.category);
    if (slug) slugs.add(slug);
  }

  const defaultAccount = getDefaultAccount();
  if (!defaultAccount) {
    return { ok: false, reason: 'no_default_account', account: null, categorySlugs: Array.from(slugs), accountIdsUsed: [] };
  }

  const categorySlugs = Array.from(slugs);
  const resolvedPairs = categorySlugs.map((slug) => ({ slug, accountId: resolveAccountIdForCategorySlug(slug) }));

  const distinct = new Set(resolvedPairs.map((p) => p.accountId).filter(Boolean));
  const accountIdsUsed = Array.from(distinct);

  if (distinct.size > 1) {
    return {
      ok: false,
      reason: 'multiple_accounts_required',
      account: null,
      categorySlugs,
      accountIdsUsed,
      resolvedPairs,
    };
  }

  const onlyId = accountIdsUsed[0] || defaultAccount.id;
  const account = findAccountById(onlyId);

  if (!account || !account.merchantId || !account.secretKey) {
    return {
      ok: false,
      reason: 'account_not_configured',
      account: null,
      categorySlugs,
      accountIdsUsed: [onlyId],
    };
  }

  return { ok: true, reason: null, account, categorySlugs, accountIdsUsed: [onlyId] };
}

function buildOrderPaymentSnapshot(account) {
  if (!account) return null;
  return {
    provider: 'FIUU',
    account_id: normTrim(account.id) || null,
    merchant_id: normTrim(account.merchantId) || null,
    verify_key: normTrim(account.verifyKey) || null,
    secret_key: normTrim(account.secretKey) || null,
    gateway_url: normTrim(account.gatewayUrl) || null,
    currency: normTrim(account.currency) || 'MYR',
    payment_method: normTrim(account.paymentMethod) || null,
    request_method: (normTrim(account.requestMethod) || '').toUpperCase() || null,
    vcode_mode: normTrim(account.vcodeMode) || 'legacy',
  };
}

function getAdminSettingsViewModel() {
  const accounts = getAccounts();
  const defaultId = getDefaultAccountId();
  return {
    accounts,
    defaultId: defaultId || (accounts[0]?.id || ''),
  };
}

function saveAccounts({ accounts, defaultId }) {
  const normalized = (accounts || [])
    .map((a) => ({
      id: normTrim(a.id),
      label: normTrim(a.label),
      merchantId: normTrim(a.merchantId || a.merchant_id),
      verifyKey: normTrim(a.verifyKey || a.verify_key),
      secretKey: normTrim(a.secretKey || a.secret_key),
      gatewayUrl: normTrim(a.gatewayUrl || a.gateway_url),
      currency: normTrim(a.currency) || 'MYR',
      paymentMethod: normTrim(a.paymentMethod || a.payment_method),
      requestMethod: (normTrim(a.requestMethod || a.request_method) || '').toUpperCase() || '',
      vcodeMode: normTrim(a.vcodeMode || a.vcode_mode) || 'legacy',
    }))
    .filter((a) => a.id);

  // Validate unique IDs.
  const ids = new Set();
  for (const a of normalized) {
    if (ids.has(a.id)) {
      const err = new Error(`Duplicate account id: ${a.id}`);
      err.status = 400;
      throw err;
    }
    ids.add(a.id);

    if (!a.label) {
      const err = new Error('Each FIUU account must have a label.');
      err.status = 400;
      throw err;
    }
    if (!a.merchantId || !a.verifyKey || !a.secretKey) {
      const err = new Error('Each FIUU account must have Merchant ID, Verify Key, and Secret Key.');
      err.status = 400;
      throw err;
    }
  }

  const chosenDefault = normTrim(defaultId);
  if (chosenDefault && normalized.length > 0 && !normalized.some((a) => a.id === chosenDefault)) {
    const err = new Error('Default FIUU account id does not exist.');
    err.status = 400;
    throw err;
  }

  settingsRepo.set(ACCOUNTS_KEY, JSON.stringify(normalized));
  settingsRepo.set(DEFAULT_ID_KEY, chosenDefault || '');

  return { ok: true };
}

function setCategoryAccountForSlug({ slug, accountId }) {
  const categorySlug = normTrim(slug);
  const id = normTrim(accountId);
  if (!categorySlug) {
    const err = new Error('Missing category slug.');
    err.status = 400;
    throw err;
  }

  const isValidSaved = Boolean(id && getAccounts().some((a) => a.id === id));
  const isBlank = !id;

  if (!isBlank && !isValidSaved) {
    const err = new Error(`Unknown FIUU account id: ${id}`);
    err.status = 400;
    throw err;
  }

  const map = getCategoryAccountMap();
  if (isBlank) {
    delete map[categorySlug];
  } else {
    map[categorySlug] = id;
  }
  settingsRepo.set(CATEGORY_MAP_KEY, JSON.stringify(map));
  return { ok: true };
}

function clearCategoryMappingForSlug(slug) {
  const categorySlug = normTrim(slug);
  if (!categorySlug) return { ok: true };
  const map = getCategoryAccountMap();
  if (!(categorySlug in map)) return { ok: true };
  delete map[categorySlug];
  settingsRepo.set(CATEGORY_MAP_KEY, JSON.stringify(map));
  return { ok: true };
}

module.exports = {
  getAccounts,
  getDefaultAccount,
  getDefaultAccountId,
  getCategoryAccountMap,
  isOnlinePaymentConfigured,
  resolveAccountForCartItems,
  buildOrderPaymentSnapshot,
  getAdminSettingsViewModel,
  saveAccounts,
  setCategoryAccountForSlug,
  clearCategoryMappingForSlug,
};
