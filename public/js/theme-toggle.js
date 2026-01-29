(function () {
  function getTheme() {
    var t = '';
    try {
      t = String(localStorage.getItem('theme') || '');
    } catch (_) {
      t = '';
    }
    if (t === 'dark' || t === 'light') return t;

    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch (_) {
      // ignore
    }
    return 'light';
  }

  function setTheme(theme) {
    var t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('theme', t);
    } catch (_) {
      // ignore
    }
  }

  function syncButton(btn) {
    if (!btn) return;
    var t = String(document.documentElement.dataset.theme || getTheme());
    var next = t === 'dark' ? 'Light mode' : 'Dark mode';
    btn.setAttribute('aria-label', 'Toggle ' + next);
    btn.setAttribute('title', 'Toggle ' + next);
  }

  function init() {
    // Ensure theme is set (in case inline head script failed).
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = getTheme();
    }

    var btn = document.getElementById('themeToggle');
    if (!btn) return;

    syncButton(btn);

    btn.addEventListener('click', function () {
      var current = String(document.documentElement.dataset.theme || getTheme());
      var next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
      syncButton(btn);
    });

    // If user changes OS theme and they haven't explicitly chosen one, keep in sync.
    try {
      var hasExplicit = false;
      try {
        var saved = String(localStorage.getItem('theme') || '');
        hasExplicit = saved === 'dark' || saved === 'light';
      } catch (_) {
        hasExplicit = false;
      }
      if (!hasExplicit && window.matchMedia) {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener('change', function (e) {
          setTheme(e && e.matches ? 'dark' : 'light');
          syncButton(btn);
        });
      }
    } catch (_) {
      // ignore
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
