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
    var el = document.querySelector('[data-flash]');
    if (!el) return;

    var closeBtn = el.querySelector('[data-flash-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dismissFlash(el);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (!el || el.dataset.dismissed === '1') return;
      if (e && (e.key === 'Escape' || e.key === 'Esc')) dismissFlash(el);
    });
  });
})();
