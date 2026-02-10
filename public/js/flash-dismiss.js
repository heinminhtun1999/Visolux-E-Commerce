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
    document.addEventListener('click', function (e) {
      var target = e && e.target;
      if (!target) return;
      var btn = target.closest ? target.closest('[data-flash-close]') : null;
      if (!btn) return;

      var el = btn.closest ? btn.closest('[data-flash]') : null;
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();
      dismissFlash(el);
    });

    document.addEventListener('keydown', function (e) {
      if (!e || (e.key !== 'Escape' && e.key !== 'Esc')) return;
      var flashes = document.querySelectorAll('[data-flash]');
      if (!flashes || !flashes.length) return;
      flashes.forEach(function (el) {
        dismissFlash(el);
      });
    });
  });
})();
