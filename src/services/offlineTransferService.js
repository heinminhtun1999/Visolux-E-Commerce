const settingsRepo = require('../repositories/settingsRepo');

const SETTINGS_KEY = 'offline_transfer.banks.v1';

function normalizeBankRow(row) {
  const id = String(row?.id || '').trim();
  const bank = String(row?.bank || '').trim();
  const account_no = String(row?.account_no || '').trim();
  const account_name = String(row?.account_name || '').trim();
  const display_at_checkout = Boolean(row?.display_at_checkout);

  if (!id || !bank || !account_no || !account_name) return null;

  return {
    id,
    bank: bank.slice(0, 128),
    account_no: account_no.slice(0, 64),
    account_name: account_name.slice(0, 128),
    display_at_checkout,
  };
}

function getBanks() {
  const raw = String(settingsRepo.get(SETTINGS_KEY, '') || '').trim();
  if (!raw) {
    // Backward-compatible default: mirrors the old hardcoded checkout details.
    return [
      {
        id: 'default_public_bank',
        bank: 'Public Bank Berhad',
        account_no: '3140814122',
        account_name: 'Visolux (M) Sdn Bhd',
        display_at_checkout: true,
      },
    ];
  }

  try {
    const parsed = JSON.parse(raw);
    const banks = Array.isArray(parsed?.banks) ? parsed.banks : [];
    const normalized = banks.map(normalizeBankRow).filter(Boolean);
    return normalized;
  } catch (_) {
    // If the JSON is corrupted, fail safe: no banks.
    return [];
  }
}

function getBanksForCheckout() {
  return getBanks().filter((b) => Boolean(b.display_at_checkout));
}

function saveBanks(banks) {
  const normalized = (banks || []).map(normalizeBankRow).filter(Boolean);
  settingsRepo.set(SETTINGS_KEY, JSON.stringify({ version: 1, banks: normalized }));
  return normalized;
}

module.exports = {
  SETTINGS_KEY,
  getBanks,
  getBanksForCheckout,
  saveBanks,
};
