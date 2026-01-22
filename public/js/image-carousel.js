(function () {
  function decodeItems(raw) {
    var s = String(raw || '').trim();
    if (!s) return [];
    return s
      .split('|')
      .map(function (part) {
        try {
          return decodeURIComponent(part);
        } catch (_) {
          return part;
        }
      })
      .map(function (v) {
        return String(v || '').trim();
      })
      .filter(Boolean);
  }

  function initCarousel(root) {
    var items = decodeItems(root.getAttribute('data-items'));
    if (!items.length) return;

    var img = root.querySelector('[data-carousel-img]');
    if (!img) return;

    var thumbs = Array.prototype.slice.call(root.querySelectorAll('[data-carousel-thumb]'));
    var prevBtn = root.querySelector('[data-carousel-prev]');
    var nextBtn = root.querySelector('[data-carousel-next]');

    var current = 0;

    function setActive(index) {
      current = ((index % items.length) + items.length) % items.length;
      var src = items[current];
      img.setAttribute('src', src);

      // If this is the zoom-pan image, keep its expected data attribute updated.
      if (img.hasAttribute('data-zoom-img')) {
        img.setAttribute('data-zoom-img', src);
      }

      if (thumbs.length) {
        thumbs.forEach(function (t) {
          var ti = Number(t.getAttribute('data-idx'));
          t.classList.toggle('is-active', ti === current);
        });
      }
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        setActive(current - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        setActive(current + 1);
      });
    }

    if (thumbs.length) {
      thumbs.forEach(function (t) {
        t.addEventListener('click', function () {
          var ti = Number(t.getAttribute('data-idx'));
          if (!Number.isFinite(ti)) return;
          setActive(ti);
        });
      });
    }

    // Optional keyboard support when the carousel is focused.
    root.addEventListener('keydown', function (e) {
      var key = String(e.key || '');
      if (key === 'ArrowLeft') {
        e.preventDefault();
        setActive(current - 1);
      }
      if (key === 'ArrowRight') {
        e.preventDefault();
        setActive(current + 1);
      }
    });

    // Initialize to the image currently shown (best effort).
    var initialSrc = String(img.getAttribute('src') || '').trim();
    var initialIndex = initialSrc ? items.indexOf(initialSrc) : -1;
    setActive(initialIndex >= 0 ? initialIndex : 0);
  }

  function init() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-image-carousel]'));
    nodes.forEach(function (n) {
      try {
        // Make focusable for keyboard arrows.
        if (!n.hasAttribute('tabindex')) n.setAttribute('tabindex', '0');
        initCarousel(n);
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
