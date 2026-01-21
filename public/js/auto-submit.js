(function () {
  function attemptTopNavigate(url) {
    try {
      if (window.top && window.top.location) {
        window.top.location.href = url;
        return true;
      }
    } catch (_) {
      // blocked
    }

    try {
      window.location.href = url;
      return true;
    } catch (_) {
      return false;
    }
  }

  function submitPayment() {
    var redirectEl = document.querySelector('[data-payment-redirect]');
    var method = redirectEl ? String(redirectEl.getAttribute('data-method') || '').toUpperCase() : '';

    // GET mode: try immediate top navigation.
    if (method === 'GET') {
      // Prefer submitting a target=_top form if available.
      var fGet = document.getElementById('payForm');
      if (fGet) {
        fGet.setAttribute('target', '_top');
        try {
          fGet.submit();
          return;
        } catch (_) {
          // fallback below
        }
      }

      var url = redirectEl ? redirectEl.getAttribute('data-url') : '';
      if (url) attemptTopNavigate(url);
      return;
    }

    // POST mode: submit the form (even inside iframe). If the browser blocks top-level navigation,
    // the user can still click the Continue button.
    var f = document.getElementById('payForm');
    if (!f) return;

    f.setAttribute('target', '_top');

    var delayAttr = f.getAttribute('data-auto-submit-delay') || '0';
    var delay = Number(delayAttr) || 0;
    setTimeout(function () {
      try {
        f.submit();
      } catch (_) {
        // ignore
      }
    }, delay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', submitPayment);
  } else {
    submitPayment();
  }
})();
