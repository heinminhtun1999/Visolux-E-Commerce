const settingsRepo = require('../repositories/settingsRepo');
const { getMalaysiaRegionForState } = require('../utils/malaysia');

function parseNonNegativeInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function getCourierFeesCents() {
  const westDefault = 800;
  const eastDefault = 1800;

  const west = parseNonNegativeInt(settingsRepo.get('shipping.courier.west_fee_cents', String(westDefault)), westDefault);
  const east = parseNonNegativeInt(settingsRepo.get('shipping.courier.east_fee_cents', String(eastDefault)), eastDefault);

  return { west, east };
}

function getCourierFeeCentsForState(state) {
  const region = getMalaysiaRegionForState(state);
  if (!region) return 0;
  const fees = getCourierFeesCents();
  return region === 'EAST' ? fees.east : fees.west;
}

module.exports = {
  getCourierFeesCents,
  getCourierFeeCentsForState,
};
