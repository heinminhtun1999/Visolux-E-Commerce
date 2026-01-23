const settingsRepo = require('../repositories/settingsRepo');

function normalizePostcode(postcode) {
  const s = String(postcode || '').trim();
  const digits = s.replace(/\D/g, '');
  return digits;
}

function parseZonesConfig() {
  const raw = String(settingsRepo.get('shipping.zones.v1', '') || '').trim();
  if (!raw) return { zones: [] };

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { zones: [] };
    const zones = Array.isArray(parsed.zones) ? parsed.zones : [];
    return { zones };
  } catch (_) {
    return { zones: [] };
  }
}

function getZones() {
  return parseZonesConfig().zones;
}

function saveZones(zones) {
  const safeZones = Array.isArray(zones) ? zones : [];
  settingsRepo.set('shipping.zones.v1', JSON.stringify({ version: 1, zones: safeZones }));
}

function zoneMatches({ zone, state, postcode }) {
  if (!zone) return false;

  const mode = String(zone.match_by || '').toUpperCase();
  if (mode === 'ZIP_CODES') {
    const pc = normalizePostcode(postcode);
    if (!pc) return false;
    const patterns = Array.isArray(zone.zip_codes) ? zone.zip_codes : [];
    for (const pRaw of patterns) {
      const p = normalizePostcode(pRaw);
      if (!p) continue;

      // Allow simple prefix match via trailing '*', e.g. '88*'
      const raw = String(pRaw || '').trim();
      if (raw.endsWith('*')) {
        const prefix = normalizePostcode(raw.slice(0, -1));
        if (prefix && pc.startsWith(prefix)) return true;
        continue;
      }

      if (pc === p) return true;
    }
    return false;
  }

  // Default: SUBREGIONS (states)
  const s = String(state || '').trim();
  if (!s) return false;
  const subs = Array.isArray(zone.subregions) ? zone.subregions : [];
  return subs.includes(s);
}

function pickMethodForWeight({ methods, weightKg }) {
  const w = Number(weightKg || 0);
  const list = Array.isArray(methods) ? methods : [];
  if (!list.length) return null;

  // Methods can optionally have a minimum weight; pick the highest eligible.
  const eligible = list
    .map((m) => ({
      ...m,
      min_weight_kg: Number(m && m.min_weight_kg != null ? m.min_weight_kg : 0) || 0,
    }))
    .filter((m) => w >= (Number(m.min_weight_kg) || 0));

  if (!eligible.length) return null;
  eligible.sort((a, b) => (Number(b.min_weight_kg) || 0) - (Number(a.min_weight_kg) || 0));
  return eligible[0];
}

function computeShippingForMethod({ method, weightKg }) {
  const w = Math.max(0, Number(weightKg || 0) || 0);
  if (!method) return 0;

  const type = String(method.type || 'BASE').toUpperCase();
  if (type === 'PER_STEP') {
    const stepKg = Math.max(0.0001, Number(method.step_kg || 0) || 0);
    const feeCents = Math.max(0, Number(method.fee_cents_per_step || 0) || 0);
    const steps = Math.ceil(w / stepKg);
    return Math.max(0, steps) * feeCents;
  }

  // BASE: first weight+fee, then every additional step.
  const firstWeightKg = Math.max(0, Number(method.first_weight_kg || 0) || 0);
  const firstFeeCents = Math.max(0, Number(method.first_fee_cents || 0) || 0);
  const addWeightKg = Math.max(0.0001, Number(method.additional_weight_kg || 0) || 0);
  const addFeeCents = Math.max(0, Number(method.additional_fee_cents || 0) || 0);

  if (w <= firstWeightKg) return firstFeeCents;
  const extraKg = Math.max(0, w - firstWeightKg);
  const steps = Math.ceil(extraKg / addWeightKg);
  return firstFeeCents + Math.max(0, steps) * addFeeCents;
}

function quoteShippingCents({ state, postcode, weightKg }) {
  const zones = getZones();
  const w = Math.max(0, Number(weightKg || 0) || 0);

  for (const zone of zones) {
    if (!zoneMatches({ zone, state, postcode })) continue;
    const method = pickMethodForWeight({ methods: zone.methods, weightKg: w });
    const cents = computeShippingForMethod({ method, weightKg: w });
    return {
      shippingCents: Math.max(0, Number(cents || 0) || 0),
      zone: { id: String(zone.id || ''), name: String(zone.name || '') },
    };
  }

  // No legacy fallback: shipping must match a configured zone.
  return {
    shippingCents: 0,
    zone: null,
    noMatch: true,
  };
}

module.exports = {
  getZones,
  saveZones,
  quoteShippingCents,
};
