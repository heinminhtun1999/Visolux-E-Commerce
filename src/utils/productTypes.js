function getProductTypeOptions() {
  return [
    { key: 'ECOMMERCE', label: 'E-commerce' },
    { key: 'SHOPEE', label: 'Shopee' },
  ];
}

function normalizeProductType(value) {
  const raw = String(value || '').trim().toUpperCase();
  const opts = getProductTypeOptions();
  const allowed = new Set(opts.map((o) => o.key));
  if (allowed.has(raw)) return raw;
  return opts[0].key;
}

function productTypeLabel(value) {
  const key = normalizeProductType(value);
  const opts = getProductTypeOptions();
  const found = opts.find((o) => o.key === key);
  return found ? found.label : key;
}

module.exports = {
  getProductTypeOptions,
  normalizeProductType,
  productTypeLabel,
};
