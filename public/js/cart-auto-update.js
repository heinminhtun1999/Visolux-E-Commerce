(function () {
  function init() {
    var forms = document.querySelectorAll('form[action="/cart/update"]');
    if (!forms || !forms.length) return;

    forms.forEach(function (form) {
      var qty = form.querySelector('input[name="quantity"]');
      if (!qty) return;

      var timer = null;

      function submitNow() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        // Avoid submitting if the form/input is disabled.
        if (qty.disabled) return;

        // Trigger native HTML validation (min/max/required) before submit.
        if (typeof form.requestSubmit === 'function') {
          try {
            form.requestSubmit();
            return;
          } catch (_) {
            // fall back
          }
        }

        try {
          form.submit();
        } catch (_) {
          // ignore
        }
      }

      function scheduleSubmit() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(submitNow, 450);
      }

      qty.addEventListener('input', scheduleSubmit);
      qty.addEventListener('change', submitNow);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
