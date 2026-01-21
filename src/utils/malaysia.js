const MALAYSIA_STATES = [
  // West Malaysia
  'Johor',
  'Kedah',
  'Kelantan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Penang',
  'Perak',
  'Perlis',
  'Selangor',
  'Terengganu',
  'Kuala Lumpur',
  'Putrajaya',

  // East Malaysia
  'Sabah',
  'Sarawak',
  'Labuan',
];

const EAST_MALAYSIA_STATES = new Set(['Sabah', 'Sarawak', 'Labuan']);

function normalizeState(state) {
  return String(state || '').trim();
}

function getMalaysiaRegionForState(state) {
  const s = normalizeState(state);
  if (!s) return null;
  return EAST_MALAYSIA_STATES.has(s) ? 'EAST' : 'WEST';
}

function getCourierFeeCentsForRegion(region) {
  if (region === 'EAST') return 1800; // RM 18
  if (region === 'WEST') return 800; // RM 8
  return 0;
}

function getCourierFeeCentsForState(state) {
  const region = getMalaysiaRegionForState(state);
  return getCourierFeeCentsForRegion(region);
}

function buildMalaysiaFullAddress({ line1, line2, city, state, postcode }) {
  const parts = [
    String(line1 || '').trim(),
    String(line2 || '').trim(),
    [String(postcode || '').trim(), String(city || '').trim()].filter(Boolean).join(' '),
    String(state || '').trim(),
    'Malaysia',
  ].filter((v) => v);

  return parts.join(', ');
}

module.exports = {
  MALAYSIA_STATES,
  EAST_MALAYSIA_STATES,
  getMalaysiaRegionForState,
  getCourierFeeCentsForState,
  getCourierFeeCentsForRegion,
  buildMalaysiaFullAddress,
};
