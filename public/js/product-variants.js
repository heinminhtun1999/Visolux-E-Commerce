(function () {
  function init() {
    var select = document.querySelector('[data-variant-select]');
    if (!select) return;

    var priceEl = document.querySelector('[data-product-price]');
    var stockEl = document.querySelector('[data-product-stock]');
    var mainImg = document.querySelector('[data-carousel-img]');
    var carouselRoot = document.querySelector('[data-image-carousel]');

    var initialPriceText = priceEl ? String(priceEl.textContent || '') : '';
    var initialStockText = stockEl ? String(stockEl.textContent || '') : '';
    var initialStockIsOk = stockEl ? stockEl.classList.contains('ok') : false;
    var initialStockIsNo = stockEl ? stockEl.classList.contains('no') : false;

    function encodeItems(items) {
      return (items || [])
        .map(function (u) {
          try {
            return encodeURIComponent(String(u || '').trim());
          } catch (_) {
            return String(u || '').trim();
          }
        })
        .filter(Boolean)
        .join('|');
    }

    function renderThumbs(root, items, activeIndex) {
      if (!root) return;
      var gallery = root.querySelector('.product-gallery');
      if (!gallery) return;

      gallery.innerHTML = '';

      (items || []).forEach(function (url, idx) {
        var btn = document.createElement('button');
        btn.className = 'product-gallery__thumb' + (idx === activeIndex ? ' is-active' : '');
        btn.type = 'button';
        btn.setAttribute('data-carousel-thumb', '');
        btn.setAttribute('data-idx', String(idx));
        btn.setAttribute('aria-label', 'View image ' + (idx + 1));

        var img = document.createElement('img');
        img.src = url;
        img.alt = 'Thumbnail ' + (idx + 1);
        img.loading = 'lazy';
        img.decoding = 'async';
        btn.appendChild(img);

        gallery.appendChild(btn);
      });
    }

    function dispatchUpdate(root, items, activeIndex) {
      if (!root) return;
      try {
        root.dispatchEvent(new CustomEvent('carousel:updateItems', { detail: { items: items, activeIndex: activeIndex } }));
        return;
      } catch (_) {
        // ignore
      }

      try {
        var ev = document.createEvent('CustomEvent');
        ev.initCustomEvent('carousel:updateItems', true, true, { items: items, activeIndex: activeIndex });
        root.dispatchEvent(ev);
      } catch (_) {
        // ignore
      }
    }

    function applyFromSelected() {
      var opt = select.options[select.selectedIndex];
      if (!opt) return;

      // Placeholder option: don't overwrite the initial UI.
      var isPlaceholder = opt.hasAttribute('data-placeholder') || String(opt.value || '').trim() === '';
      if (isPlaceholder) {
        if (priceEl) priceEl.textContent = initialPriceText;
        if (stockEl) {
          stockEl.textContent = initialStockText;
          stockEl.classList.toggle('ok', initialStockIsOk);
          stockEl.classList.toggle('no', initialStockIsNo);
        }
        return;
      }

      var priceLabel = opt.getAttribute('data-price-label') || '';
      var stock = opt.getAttribute('data-stock');
      var imageUrl = opt.getAttribute('data-image-url') || '';

      if (priceEl && priceLabel) {
        priceEl.textContent = priceLabel;
      }

      if (stockEl) {
        var n = Number(stock);
        if (Number.isFinite(n)) {
          stockEl.textContent = n > 0 ? ('In stock: ' + Math.max(0, Math.floor(n))) : 'Out of stock';
          stockEl.classList.toggle('ok', n > 0);
          stockEl.classList.toggle('no', n <= 0);
        }
      }

      // Update carousel to always show: [main product image, selected variant image (if any)].
      if (carouselRoot) {
        var mainUrl = String(carouselRoot.getAttribute('data-main-image') || '').trim();
        if (!mainUrl && mainImg) {
          mainUrl = String(mainImg.getAttribute('src') || '').trim();
        }

        var items = [];
        if (mainUrl) items.push(mainUrl);
        if (imageUrl && imageUrl !== mainUrl) items.push(imageUrl);

        var activeIndex = (imageUrl && imageUrl !== mainUrl) ? 1 : 0;

        carouselRoot.setAttribute('data-items', encodeItems(items));
        renderThumbs(carouselRoot, items, activeIndex);
        dispatchUpdate(carouselRoot, items, activeIndex);
      } else if (mainImg && imageUrl) {
        // Fallback if carousel wrapper isn't present.
        mainImg.src = imageUrl;
      }
    }

    select.addEventListener('change', applyFromSelected);
    applyFromSelected();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
