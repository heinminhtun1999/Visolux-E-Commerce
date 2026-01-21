(function () {
  var STORAGE_KEY = 'visolux.filtersOpen';

  function readStored() {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
      return null;
    } catch (_) {
      return null;
    }
  }

  function writeStored(open) {
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch (_) {
      // ignore
    }
  }

  function init() {
    var btns = Array.prototype.slice.call(document.querySelectorAll('[data-filters-toggle]'));
    var panel = document.querySelector('[data-filters-panel]');
    var closeBtn = document.querySelector('[data-filters-close]');
    if (!btns.length || !panel) return;

    function setOpen(open) {
      // Use both a CSS class + the hidden attribute to be robust across styling/caching.
      panel.classList.toggle('is-collapsed', !open);
      panel.hidden = !open;
      if (!open) {
        panel.setAttribute('hidden', '');
      } else {
        panel.removeAttribute('hidden');
      }

      btns.forEach(function (b) {
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      writeStored(open);
    }

    // Default: collapsed on small screens, open otherwise.
    var stored = readStored();
    var open = stored;
    if (open === null) {
      open = true;
      try {
        open = window.matchMedia('(max-width: 640px)').matches ? false : true;
      } catch (_) {
        open = true;
      }
    }
    setOpen(open);

    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var isClosed = panel.classList.contains('is-collapsed') || panel.hasAttribute('hidden');
        setOpen(isClosed);
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        setOpen(false);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
