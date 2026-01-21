(function () {
  var STACK_KEY = 'visolux:navStack:v1';
  var MAX_STACK = 80;

  function safeParse(raw) {
    try {
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }

  function getStack() {
    try {
      if (!window.sessionStorage) return [];
      return safeParse(window.sessionStorage.getItem(STACK_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function setStack(stack) {
    try {
      if (!window.sessionStorage) return;
      window.sessionStorage.setItem(STACK_KEY, JSON.stringify(stack));
    } catch (_) {
      // ignore
    }
  }

  function currentEntry() {
    var path = (window.location && window.location.pathname) || '';
    var search = (window.location && window.location.search) || '';

    // Normalize trailing slash (except root) to avoid treating the same route as different.
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    return {
      key: path, // dedupe by route path (fixes repeated POST-redirect-GET refresh entries)
      url: path + search,
    };
  }

  function recordCurrent() {
    var entry = currentEntry();
    if (!entry.key) return;

    var stack = getStack();
    var last = stack.length ? stack[stack.length - 1] : null;
    if (last && last.key === entry.key) return;

    stack.push(entry);
    if (stack.length > MAX_STACK) stack = stack.slice(stack.length - MAX_STACK);
    setStack(stack);
  }

  function goBackSmart() {
    var entry = currentEntry();
    var stack = getStack();

    // Drop any trailing entries for the current route.
    while (stack.length && stack[stack.length - 1] && stack[stack.length - 1].key === entry.key) {
      stack.pop();
    }

    // Previous distinct page is now the last item.
    var prev = stack.length ? stack[stack.length - 1] : null;
    setStack(stack);

    if (prev && prev.url) {
      // Use replace so we don't add yet another history entry.
      window.location.replace(prev.url);
      return;
    }

    // Fallback to browser history, then hard fallback.
    try {
      if (window.history && window.history.length > 1) {
        window.history.back();
        return;
      }
    } catch (_) {
      // ignore
    }

    window.location.href = '/products';
  }

  function init() {
    var btn = document.querySelector('[data-back-button]');
    if (!btn) return;

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      goBackSmart();
    });
  }

  // Always record navigation, even on pages where the back button is hidden.
  recordCurrent();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
