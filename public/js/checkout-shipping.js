(function () {
  function $(id) {
    return document.getElementById(id);
  }

  const totalsEl = $('checkoutTotals');
  const itemsTotalCents = Number(totalsEl && totalsEl.dataset ? totalsEl.dataset.itemsTotalCents : 0);
  const csrfToken = String(totalsEl && totalsEl.dataset ? totalsEl.dataset.csrfToken : '');

  const stateSelect = $('stateSelect');
  const postcodeInput = document.querySelector('input[name="postcode"]');
  const regionLabel = $('regionLabel');
  const shippingMsg = $('shippingMessage');
  const shippingFeeEl = $('shippingFee');
  const preDiscountEl = $('preDiscountTotal');
  const discountEl = $('discountAmount');
  const grandTotalEl = $('grandTotal');

  const placeOrderBtn = $('placeOrderBtn');

  const paymentSelect = $('paymentMethodSelect');
  const bankDetails = $('offlineBankDetails');

  const form = document.getElementById('checkoutForm');
  const formMsg = $('checkoutFormMessage');

  let quoteInFlight = false;
  let lastShippingOk = false;

  function setInlineMessage(text, isError) {
    if (shippingMsg) {
      shippingMsg.textContent = text ? String(text) : '';
      shippingMsg.classList.toggle('text-danger', Boolean(isError) && Boolean(text));
      shippingMsg.classList.toggle('muted', !Boolean(isError) && Boolean(text));
    }
  }

  function setFormMessage(text, isError) {
    if (!formMsg) return;
    formMsg.textContent = text ? String(text) : '';
    formMsg.classList.toggle('text-danger', Boolean(isError) && Boolean(text));
    formMsg.classList.toggle('muted', !Boolean(isError) && Boolean(text));
  }

  function updatePlaceOrderEnabled() {
    const basicValid = form && typeof form.checkValidity === 'function' ? form.checkValidity() : true;
    const ok = basicValid && lastShippingOk && !quoteInFlight;
    if (placeOrderBtn) placeOrderBtn.disabled = !ok;
  }

  function formatMoneyCents(cents) {
    const rm = (Number(cents || 0) / 100).toFixed(2);
    return `RM ${rm}`;
  }

  async function requestQuote() {
    const state = stateSelect ? stateSelect.value : '';
    const postcode = postcodeInput ? String(postcodeInput.value || '').trim() : '';

    if (!state || !postcode || postcode.length < 5) {
      if (regionLabel) regionLabel.textContent = '-';
      setInlineMessage('', false);
      lastShippingOk = false;
      updatePlaceOrderEnabled();
      return;
    }

    const promoInput = $('promoCodeInput');
    const promo = promoInput ? String(promoInput.value || '').trim() : '';

    try {
      quoteInFlight = true;
      updatePlaceOrderEnabled();
      setFormMessage('', false);

      const resp = await fetch('/checkout/quote', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify({ state, postcode, promo_code: promo }),
        credentials: 'same-origin',
      });

      const data = await resp.json().catch(function () { return null; });
      if (!resp.ok || !data) {
        lastShippingOk = false;
        setInlineMessage('Unable to calculate shipping right now. Please try again.', true);
        updatePlaceOrderEnabled();
        return;
      }

      const shippingOk = (data.shippingOk === undefined) ? true : Boolean(data.shippingOk);
      if (!shippingOk) {
        if (regionLabel) regionLabel.textContent = '-';
        setInlineMessage(
          data && data.message ? String(data.message) : 'Shipping is not available for the selected address. Please select a different delivery area or contact us.',
          true
        );
        if (shippingFeeEl) shippingFeeEl.textContent = formatMoneyCents(0);
        if (preDiscountEl) preDiscountEl.textContent = formatMoneyCents(itemsTotalCents);
        if (discountEl) discountEl.textContent = formatMoneyCents(0);
        if (grandTotalEl) grandTotalEl.textContent = formatMoneyCents(itemsTotalCents);
        lastShippingOk = false;
        updatePlaceOrderEnabled();
        return;
      }

      const shipping = Number(data.shippingCents || 0);
      const discount = Number(data.discountCents || 0);
      const preDiscount = Number(data.preDiscountGrandTotalCents || (itemsTotalCents + shipping));
      const grand = Number(data.grandTotalCents || Math.max(0, preDiscount - discount));

      if (totalsEl && totalsEl.dataset) totalsEl.dataset.discountCents = String(discount);

      if (regionLabel) regionLabel.textContent = data.shippingLabel ? String(data.shippingLabel) : '-';
      setInlineMessage('', false);
      if (shippingFeeEl) shippingFeeEl.textContent = formatMoneyCents(shipping);
      if (preDiscountEl) preDiscountEl.textContent = formatMoneyCents(preDiscount);
      if (discountEl) discountEl.textContent = formatMoneyCents(discount);
      if (grandTotalEl) grandTotalEl.textContent = formatMoneyCents(grand);
      lastShippingOk = true;
      updatePlaceOrderEnabled();
    } catch (_) {
      lastShippingOk = false;
      setInlineMessage('Unable to calculate shipping right now. Please try again.', true);
      updatePlaceOrderEnabled();
    } finally {
      quoteInFlight = false;
      updatePlaceOrderEnabled();
    }
  }

  function updatePaymentDetails() {
    if (!bankDetails) return;
    const method = paymentSelect ? paymentSelect.value : '';
    bankDetails.style.display = method === 'OFFLINE_TRANSFER' ? 'block' : 'none';
  }

  if (stateSelect) stateSelect.addEventListener('change', requestQuote);
  if (postcodeInput) postcodeInput.addEventListener('input', function () {
    if (String(postcodeInput.value || '').trim().length >= 5) requestQuote();
  });
  if (paymentSelect) paymentSelect.addEventListener('change', updatePaymentDetails);

  if (form) {
    form.addEventListener('input', updatePlaceOrderEnabled);
    form.addEventListener('change', updatePlaceOrderEnabled);
    form.addEventListener('submit', function (e) {
      setFormMessage('', false);
      const valid = typeof form.checkValidity === 'function' ? form.checkValidity() : true;

      if (!valid) {
        e.preventDefault();
        setFormMessage('Please fill in all required fields correctly.', true);
        if (typeof form.reportValidity === 'function') form.reportValidity();
        return;
      }
      if (quoteInFlight) {
        e.preventDefault();
        setFormMessage('Please wait while we calculate shipping…', true);
        return;
      }
      if (!lastShippingOk) {
        e.preventDefault();
        setFormMessage('Shipping is not available for the selected address.', true);
        return;
      }
    });
  }

  requestQuote();
  updatePaymentDetails();
})();
