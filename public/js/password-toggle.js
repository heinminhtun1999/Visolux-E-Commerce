(function () {
  function initOne(wrapper) {
    if (!wrapper) return;
    var input = wrapper.querySelector('input[type="password"], input[data-password-input]');
    var btn = wrapper.querySelector('[data-password-toggle-btn]');
    if (!input || !btn) return;

    function setState(isVisible) {
      try {
        input.type = isVisible ? 'text' : 'password';
      } catch (_) {
        // ignore
      }
      btn.textContent = isVisible ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
      btn.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
    }

    setState(false);

    btn.addEventListener('click', function () {
      var visible = input.type === 'text';
      setState(!visible);
      input.focus();
    });
  }

  function init() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-password-field]'));
    nodes.forEach(function (n) {
      try {
        initOne(n);
      } catch (_) {
        // ignore
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
