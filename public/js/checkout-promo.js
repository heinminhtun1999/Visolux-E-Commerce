(function () {
  function $(id) {
    return document.getElementById(id);
  }

  const totalsEl = $('checkoutTotals');
  const itemsTotalCents = Number(totalsEl && totalsEl.dataset ? totalsEl.dataset.itemsTotalCents : 0);
  const csrfToken = String(totalsEl && totalsEl.dataset ? totalsEl.dataset.csrfToken : '');

  const stateSelect = $('stateSelect');
  const postcodeInput = document.querySelector('input[name="postcode"]');
  const promoInput = $('promoCodeInput');
  const promoBtn = $('promoCheckBtn');
  const promoMsg = $('promoMessage');

  const shippingFeeEl = $('shippingFee');
  const preDiscountEl = $('preDiscountTotal');
  const discountEl = $('discountAmount');
  const grandTotalEl = $('grandTotal');

  const placeOrderBtn = $('placeOrderBtn');

  function formatMoneyCents(cents) {
    const rm = (Number(cents || 0) / 100).toFixed(2);
    return `RM ${rm}`;
  }

  async function checkPromo() {
    if (!promoMsg) return;
    promoMsg.textContent = '';

    const state = stateSelect ? stateSelect.value : '';
    if (!state) {
      promoMsg.textContent = 'Please select a state first.';
      return;
    }

    const postcode = postcodeInput ? String(postcodeInput.value || '').trim() : '';
    if (!/^\d{5}$/.test(postcode)) {
      promoMsg.textContent = 'Please enter a valid postcode first.';
      return;
    }

    const code = promoInput ? promoInput.value : '';

    try {
      if (promoBtn) promoBtn.disabled = true;
      promoMsg.textContent = 'Checking…';

      const resp = await fetch('/checkout/quote', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          // Server reads CSRF from body._csrf or the x-csrf-token header.
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify({ promo_code: code, state, postcode }),
        credentials: 'same-origin',
      });

      let data = null;
      try {
        data = await resp.json();
      } catch (_) {
        data = null;
      }

      if (!resp.ok) {
        if (resp.status === 403) {
          promoMsg.textContent = 'Session expired. Refresh the page and try again.';
          return;
        }

        promoMsg.textContent = (data && data.message)
          ? String(data.message)
          : `Could not check promo right now. (HTTP ${resp.status})`;
        return;
      }

      const shippingOk = (data && data.shippingOk === undefined) ? true : Boolean(data && data.shippingOk);
      if (!shippingOk) {
        promoMsg.textContent = (data && data.message)
          ? String(data.message)
          : 'Shipping not available for the selected address.';
        if (shippingFeeEl) shippingFeeEl.textContent = formatMoneyCents(0);
        if (preDiscountEl) preDiscountEl.textContent = formatMoneyCents(itemsTotalCents);
        if (discountEl) discountEl.textContent = formatMoneyCents(0);
        if (grandTotalEl) grandTotalEl.textContent = formatMoneyCents(itemsTotalCents);
        if (placeOrderBtn) placeOrderBtn.disabled = true;
        return;
      }

      const shipping = Number(data.shippingCents || 0);
      const discount = Number(data.discountCents || 0);
      const preDiscount = Number(data.preDiscountGrandTotalCents || (itemsTotalCents + shipping));
      const grand = Number(data.grandTotalCents || (itemsTotalCents + shipping));

      if (totalsEl && totalsEl.dataset) totalsEl.dataset.discountCents = String(discount);

      if (shippingFeeEl) shippingFeeEl.textContent = formatMoneyCents(shipping);
      if (preDiscountEl) preDiscountEl.textContent = formatMoneyCents(preDiscount);
      if (discountEl) discountEl.textContent = formatMoneyCents(discount);
      if (grandTotalEl) grandTotalEl.textContent = formatMoneyCents(grand);

      if (placeOrderBtn) placeOrderBtn.disabled = false;

      promoMsg.textContent = data && data.message
        ? String(data.message)
        : (data && data.ok ? 'Promo applied.' : 'Promo code is not valid.');
    } catch (e) {
      promoMsg.textContent = 'Could not check promo right now.';
    } finally {
      if (promoBtn) promoBtn.disabled = false;
    }
  }

  if (promoBtn) promoBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    checkPromo();
  });
})();
