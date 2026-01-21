(function () {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function initZoomPane(pane) {
    if (pane.dataset.zoomInit === '1') return;
    const img = pane.querySelector('[data-zoom-img]');
    if (!img) return;

    let scale = 1;
    let tx = 0;
    let ty = 0;

    // Pointer state
    const pointers = new Map(); // id -> {x,y}
    let dragStart = null;
    let pinchStart = null;

    function getRect() {
      return pane.getBoundingClientRect();
    }

    function clampToBounds(nextTx, nextTy, nextScale) {
      const rect = getRect();
      const scaledW = rect.width * nextScale;
      const scaledH = rect.height * nextScale;

      // When scaled <= container, keep centered at (0,0)
      if (scaledW <= rect.width) nextTx = 0;
      else nextTx = clamp(nextTx, rect.width - scaledW, 0);

      if (scaledH <= rect.height) nextTy = 0;
      else nextTy = clamp(nextTy, rect.height - scaledH, 0);

      return { tx: nextTx, ty: nextTy };
    }

    function apply() {
      const bounded = clampToBounds(tx, ty, scale);
      tx = bounded.tx;
      ty = bounded.ty;
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      img.style.willChange = scale !== 1 ? 'transform' : 'auto';
    }

    function reset() {
      scale = 1;
      tx = 0;
      ty = 0;
      apply();
    }

    function zoomAt(clientX, clientY, nextScale) {
      const rect = getRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const prevScale = scale;
      nextScale = clamp(nextScale, 1, 4);

      // Keep point under cursor stable.
      const px = (x - tx) / prevScale;
      const py = (y - ty) / prevScale;

      const nextTx = x - px * nextScale;
      const nextTy = y - py * nextScale;

      scale = nextScale;
      tx = nextTx;
      ty = nextTy;
      apply();
    }

    pane.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const intensity = 0.001;
        const factor = Math.exp(-e.deltaY * intensity);
        zoomAt(e.clientX, e.clientY, scale * factor);
      },
      { passive: false }
    );

    pane.addEventListener('dblclick', (e) => {
      e.preventDefault();
      reset();
    });

    pane.addEventListener('pointerdown', (e) => {
      pane.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1) {
        pane.classList.add('is-dragging');
        dragStart = {
          x: e.clientX,
          y: e.clientY,
          tx,
          ty,
        };
      } else if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;

        pinchStart = {
          dist,
          scale,
          midX,
          midY,
          tx,
          ty,
        };
        dragStart = null;
      }
    });

    pane.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1 && dragStart) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        tx = dragStart.tx + dx;
        ty = dragStart.ty + dy;
        apply();
        return;
      }

      if (pointers.size === 2 && pinchStart) {
        const pts = Array.from(pointers.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy);
        if (!dist) return;

        const nextScale = clamp(pinchStart.scale * (dist / pinchStart.dist), 1, 4);

        // Combine pinch zoom around midpoint AND panning by midpoint delta.
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const dmx = midX - pinchStart.midX;
        const dmy = midY - pinchStart.midY;

        // Re-anchor zoom at the pinch midpoint.
        const rect = getRect();
        const x = pinchStart.midX - rect.left;
        const y = pinchStart.midY - rect.top;
        const prevScale = pinchStart.scale;

        const px = (x - pinchStart.tx) / prevScale;
        const py = (y - pinchStart.ty) / prevScale;

        const baseTx = x - px * nextScale;
        const baseTy = y - py * nextScale;

        scale = nextScale;
        tx = baseTx + dmx;
        ty = baseTy + dmy;
        apply();
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        pane.classList.remove('is-dragging');
        dragStart = null;
        pinchStart = null;
      }
      if (pointers.size === 1) {
        // Transition from pinch to drag smoothly.
        const remaining = Array.from(pointers.values())[0];
        dragStart = { x: remaining.x, y: remaining.y, tx, ty };
        pinchStart = null;
      }
    }

    pane.addEventListener('pointerup', endPointer);
    pane.addEventListener('pointercancel', endPointer);

    // initial
    img.style.transformOrigin = '0 0';
    apply();

    // Expose a safe reset hook for other UI (e.g. modals).
    pane.__visoluxZoomReset = reset;

    pane.dataset.zoomInit = '1';
  }

  // Allow other scripts (e.g., modals) to initialize panes after becoming visible.
  window.__visoluxInitZoomPane = initZoomPane;

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-zoom-pane]').forEach(initZoomPane);
  });
})();
