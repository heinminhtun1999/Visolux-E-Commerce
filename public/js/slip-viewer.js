(function () {
  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function isOpen(modal) {
    return Boolean(modal && modal.classList.contains('is-open'));
  }

  function show(modal) {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    const closeBtn = qs('[data-modal-close]', modal);
    if (closeBtn) closeBtn.focus();
  }

  function hide(modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function initModal(modal) {
    const pane = qs('[data-zoom-pane]', modal);
    const img = qs('[data-slip-modal-img]', modal);

    function ensureZoomInit() {
      if (!pane || !window.__visoluxInitZoomPane) return;
      if (pane.dataset.zoomInit === '1') return;
      window.__visoluxInitZoomPane(pane);
      pane.dataset.zoomInit = '1';
    }

    function resetZoom() {
      if (!pane) return;
      if (typeof pane.__visoluxZoomReset === 'function') {
        pane.__visoluxZoomReset();
        return;
      }
      // Fallback: at least clear transform if hook isn't present.
      const innerImg = qs('[data-zoom-img]', pane);
      if (innerImg) innerImg.style.transform = 'translate(0px, 0px) scale(1)';
    }

    modal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-modal-backdrop')) {
        hide(modal);
      }
    });

    // Prevent trackpad pinch / ctrl-wheel from zooming the whole page while modal is open.
    // Must be on window in some browsers; zoom-pane will still handle zooming the image.
    window.addEventListener(
      'wheel',
      (e) => {
        if (!isOpen(modal)) return;
        if (e.ctrlKey || e.metaKey) e.preventDefault();
      },
      { passive: false, capture: true }
    );

    // iOS Safari: prevent gesture zoom while modal is open.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((evt) => {
      document.addEventListener(
        evt,
        (e) => {
          if (!isOpen(modal)) return;
          e.preventDefault();
        },
        { passive: false }
      );
    });

    const closeBtn = qs('[data-modal-close]', modal);
    if (closeBtn) closeBtn.addEventListener('click', () => { resetZoom(); hide(modal); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) {
        resetZoom();
        hide(modal);
      }
    });

    document.querySelectorAll('[data-slip-open]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e) e.preventDefault();
        const src = btn.getAttribute('data-slip-src');
        if (!src) return;
        if (img) img.src = src;
        show(modal);

        // Defer zoom init until modal is visible (pane has size).
        window.requestAnimationFrame(() => {
          ensureZoomInit();
          resetZoom();
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.querySelector('[data-slip-modal]');
    if (!modal) return;
    initModal(modal);
  });
})();
