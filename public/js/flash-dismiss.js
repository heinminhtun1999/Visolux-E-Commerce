(function () {
  function dismissFlash(el) {
    if (!el || el.dataset.dismissed === '1') return;
    el.dataset.dismissed = '1';
    el.classList.add('is-hiding');
    window.setTimeout(function () {
      try {
        el.remove();
      } catch (_) {
        // ignore
      }
    }, 280);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var el = document.querySelector('.flash');
    if (!el) return;

    // Let errors stay a little longer.
    var ms = el.classList.contains('error') ? 6500 : 3500;
    window.setTimeout(function () {
      dismissFlash(el);
    }, ms);

    // Allow click to dismiss.
    el.addEventListener('click', function () {
      dismissFlash(el);
    });
  });
})();
