(function () {
  function $(id) {
    return document.getElementById(id);
  }

  const totalsEl = $('checkoutTotals');
  const itemsTotalCents = Number(totalsEl && totalsEl.dataset ? totalsEl.dataset.itemsTotalCents : 0);
  const csrfToken = String(totalsEl && totalsEl.dataset ? totalsEl.dataset.csrfToken : '');

  const stateSelect = $('stateSelect');
  const postcodeInput = document.querySelector('input[name="postcode"]');
   const fulfillmentRadios = document.querySelectorAll('input[name="fulfillment_method"]');
   const deliveryAddressSection = document.getElementById('deliveryAddressSection');
  const regionLabel = $('regionLabel');
  const shippingMsg = $('shippingMessage');
  const shippingFeeEl = $('shippingFee');
  const preDiscountEl = $('preDiscountTotal');
  const discountEl = $('discountAmount');
  const grandTotalEl = $('grandTotal');

  const placeOrderBtn = $('placeOrderBtn');

  const paymentSelect = $('paymentMethodSelect');
  const bankDetails = $('offlineBankDetails');
  const bankSelect = $('offlineTransferBankSelect');
  const offlineBankName = $('offlineBankName');
  const offlineAccountNo = $('offlineAccountNo');
  const offlineAccountName = $('offlineAccountName');

  const form = document.getElementById('checkoutForm');
  const formMsg = $('checkoutFormMessage');
  const selfPickupEnabled = Boolean(document.querySelector('input[name="fulfillment_method"][value="PICKUP"]:not(:disabled)'));

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

  function getFieldErrorEl(field) {
    const next = field.nextElementSibling;
    if (next && next.classList && next.classList.contains('field-error')) return next;
    const el = document.createElement('div');
    el.className = 'field-error';
    field.insertAdjacentElement('afterend', el);
    return el;
  }

  function clearFieldError(field) {
    field.classList.remove('is-invalid');
    field.removeAttribute('aria-invalid');
    const next = field.nextElementSibling;
    if (next && next.classList && next.classList.contains('field-error')) next.remove();
  }

  function updateFieldError(field) {
    if (!field || field.disabled || field.type === 'hidden') return;
    const value = String(field.value || '').trim();
    const isRequired = field.dataset && field.dataset.required === '1';
    if (isRequired && !value) {
      const errEl = getFieldErrorEl(field);
      errEl.textContent = 'This field is required.';
      field.classList.add('is-invalid');
      field.setAttribute('aria-invalid', 'true');
      return;
    }
    if (typeof field.checkValidity === 'function' && !field.checkValidity()) {
      const msg = field.validationMessage || 'Please enter a valid value.';
      const errEl = getFieldErrorEl(field);
      errEl.textContent = msg;
      field.classList.add('is-invalid');
      field.setAttribute('aria-invalid', 'true');
      return;
    }
    if (value || !isRequired) {
      clearFieldError(field);
    }
  }

  function showFieldErrors() {
    if (!form || !form.elements) return;
    const fields = Array.from(form.elements).filter((el) =>
      el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
    );
    let firstInvalid = null;
    let allValid = true;
    for (const field of fields) {
      const value = String(field.value || '').trim();
      const isRequired = field.dataset && field.dataset.required === '1';
      const missingRequired = isRequired && !value;
      const invalidFormat = !missingRequired && typeof field.checkValidity === 'function' && !field.checkValidity();
      if (missingRequired || invalidFormat) {
        allValid = false;
        if (!firstInvalid) firstInvalid = field;
      }
      updateFieldError(field);
    }
    if (firstInvalid && typeof firstInvalid.focus === 'function') firstInvalid.focus();
    return allValid;
  }

  function updatePlaceOrderEnabled() {
    if (placeOrderBtn) placeOrderBtn.disabled = Boolean(quoteInFlight);
  }

  function formatMoneyCents(cents) {
    const rm = (Number(cents || 0) / 100).toFixed(2);
    return `RM ${rm}`;
  }

  async function requestQuote() {
      const isPickup = selfPickupEnabled && Array.from(fulfillmentRadios || []).some(r => r.checked && String(r.value) === 'PICKUP');
     if (isPickup) {
       if (regionLabel) regionLabel.textContent = 'Self pickup';
       setInlineMessage('', false);
       const shipping = 0;
       const discount = 0;
       const preDiscount = itemsTotalCents;
       const grand = itemsTotalCents;
       if (totalsEl && totalsEl.dataset) totalsEl.dataset.discountCents = String(0);
       if (shippingFeeEl) shippingFeeEl.textContent = formatMoneyCents(shipping);
       if (preDiscountEl) preDiscountEl.textContent = formatMoneyCents(preDiscount);
       if (discountEl) discountEl.textContent = formatMoneyCents(discount);
       if (grandTotalEl) grandTotalEl.textContent = formatMoneyCents(grand);
       lastShippingOk = true;
       updatePlaceOrderEnabled();
       return;
     }

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

    if (bankSelect) {
      const enabled = method === 'OFFLINE_TRANSFER';
      bankSelect.disabled = !enabled;
      if (enabled) bankSelect.setAttribute('required', 'required');
      else bankSelect.removeAttribute('required');

      // Convenience: default to the first real option.
      if (enabled && !String(bankSelect.value || '').trim() && bankSelect.options && bankSelect.options.length > 1) {
        bankSelect.selectedIndex = 1;
      }
    }

    // When we auto-select (or toggle visibility), ensure the snapshot UI updates.
    updateOfflineBankSnapshot();
  }

  function updateOfflineBankSnapshot() {
    if (!bankSelect) return;
    const opt = bankSelect.options && bankSelect.selectedIndex >= 0 ? bankSelect.options[bankSelect.selectedIndex] : null;
    const bank = opt && opt.dataset ? String(opt.dataset.bank || '') : '';
    const accountNo = opt && opt.dataset ? String(opt.dataset.accountNo || opt.dataset['account-no'] || '') : '';
    const accountName = opt && opt.dataset ? String(opt.dataset.accountName || opt.dataset['account-name'] || '') : '';

    if (offlineBankName) offlineBankName.textContent = bank || '-';
    if (offlineAccountNo) offlineAccountNo.textContent = accountNo || '-';
    if (offlineAccountName) offlineAccountName.textContent = accountName || '-';
  }

  function updateFulfillmentDisplay() {
    const isPickup = selfPickupEnabled && Array.from(fulfillmentRadios || []).some(r => r.checked && String(r.value) === 'PICKUP');
    if (deliveryAddressSection) deliveryAddressSection.style.display = isPickup ? 'none' : 'block';

    // Toggle required attributes for address fields when pickup selected.
    const addrFields = deliveryAddressSection ? Array.from(deliveryAddressSection.querySelectorAll('input,select,textarea')) : [];
    for (const f of addrFields) {
      if (isPickup) {
        f.disabled = true;
        if (f.dataset) f.dataset.required = '0';
        f.removeAttribute('required');
      } else {
        f.disabled = false;
        if (f.dataset && String(f.name || '').length) {
          // restore required flag only for those that had data-required in markup
          if (String(f.getAttribute('data-required') || '') === '1' || f.name === 'address_line1' || f.name === 'city' || f.name === 'postcode' || f.name === 'state') {
            f.dataset.required = '1';
          }
        }
      }
    }

    // When switched, recalc quote/display
    requestQuote();
  }

   if (stateSelect) stateSelect.addEventListener('change', requestQuote);
  if (postcodeInput) postcodeInput.addEventListener('input', function () {
    if (String(postcodeInput.value || '').trim().length >= 5) requestQuote();
  });
   if (fulfillmentRadios && fulfillmentRadios.length) {
     for (const r of fulfillmentRadios) r.addEventListener('change', updateFulfillmentDisplay);
   }
  if (paymentSelect) paymentSelect.addEventListener('change', updatePaymentDetails);
  if (bankSelect) bankSelect.addEventListener('change', updateOfflineBankSnapshot);

  if (form) {
    form.addEventListener('input', function (e) {
      updatePlaceOrderEnabled();
      if (e && e.target) updateFieldError(e.target);
    });
    form.addEventListener('change', function (e) {
      updatePlaceOrderEnabled();
      if (e && e.target) updateFieldError(e.target);
    });
    form.addEventListener('submit', function (e) {
      setFormMessage('', false);
      const valid = typeof form.checkValidity === 'function' ? form.checkValidity() : true;

      const customValid = showFieldErrors();
      if (!valid || !customValid) {
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
  updateOfflineBankSnapshot();
   updateFulfillmentDisplay();
})();
