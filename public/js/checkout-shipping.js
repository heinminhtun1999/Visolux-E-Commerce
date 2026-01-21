(function () {
  function $(id) {
    return document.getElementById(id);
  }

  const totalsEl = $('checkoutTotals');
  const itemsTotalCents = Number(totalsEl && totalsEl.dataset ? totalsEl.dataset.itemsTotalCents : 0);
  const westFeeCents = Number(totalsEl && totalsEl.dataset ? totalsEl.dataset.westFeeCents : 800);
  const eastFeeCents = Number(totalsEl && totalsEl.dataset ? totalsEl.dataset.eastFeeCents : 1800);

  const stateSelect = $('stateSelect');
  const regionLabel = $('regionLabel');
  const shippingFeeEl = $('shippingFee');
  const preDiscountEl = $('preDiscountTotal');
  const discountEl = $('discountAmount');
  const grandTotalEl = $('grandTotal');

  const paymentSelect = $('paymentMethodSelect');
  const bankDetails = $('offlineBankDetails');

  const EAST = new Set(['Sabah', 'Sarawak', 'Labuan']);

  function formatMoneyCents(cents) {
    const rm = (Number(cents || 0) / 100).toFixed(2);
    return `RM ${rm}`;
  }

  function computeShippingCents(state) {
    if (!state) return 0;
    return EAST.has(state) ? eastFeeCents : westFeeCents;
  }

  function updateShipping() {
    const state = stateSelect ? stateSelect.value : '';
    const isEast = state && EAST.has(state);
    const region = state ? (isEast ? 'East Malaysia' : 'West Malaysia') : '-';
    const ship = computeShippingCents(state);
    const preDiscount = itemsTotalCents + ship;
    const discount = Number(totalsEl && totalsEl.dataset ? totalsEl.dataset.discountCents : 0) || 0;
    const grand = Math.max(0, preDiscount - discount);

    if (regionLabel) regionLabel.textContent = region;
    if (shippingFeeEl) shippingFeeEl.textContent = formatMoneyCents(ship);
    if (preDiscountEl) preDiscountEl.textContent = formatMoneyCents(preDiscount);
    if (discountEl) discountEl.textContent = formatMoneyCents(discount);
    if (grandTotalEl) grandTotalEl.textContent = formatMoneyCents(grand);
  }

  function updatePaymentDetails() {
    if (!bankDetails) return;
    const method = paymentSelect ? paymentSelect.value : '';
    bankDetails.style.display = method === 'OFFLINE_TRANSFER' ? 'block' : 'none';
  }

  if (stateSelect) stateSelect.addEventListener('change', updateShipping);
  if (paymentSelect) paymentSelect.addEventListener('change', updatePaymentDetails);

  updateShipping();
  updatePaymentDetails();
})();
