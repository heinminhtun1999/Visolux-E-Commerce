(function () {
  function handleButtonLinkClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('button[data-href]') : null;
    if (!btn) return;
    if (btn.disabled) return;

    var href = btn.getAttribute('data-href');
    if (!href) return;

    // Allow buttons to opt out.
    if (btn.hasAttribute('data-no-nav')) return;

    // Hash navigation (in-page anchors)
    if (href.charAt(0) === '#') {
      e.preventDefault();
      try {
        var el = document.querySelector(href);
        if (el && el.scrollIntoView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Keep URL hash in sync
        if (window.location) window.location.hash = href;
      } catch (_) {
        // ignore
      }
      return;
    }

    // Normal navigation
    e.preventDefault();
    try {
      if (e && (e.ctrlKey || e.metaKey)) {
        window.open(href, '_blank', 'noopener');
      } else {
        window.location.href = href;
      }
    } catch (_) {
      // ignore
    }
  }

  document.addEventListener('click', handleButtonLinkClick);
})();
