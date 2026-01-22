(function () {
  function init() {
    var pane = document.querySelector('[data-zoom-pane]');
    if (!pane) return;

    var img = pane.querySelector('img[data-zoom-img]');
    if (!img) return;

    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-product-thumb]'));
    if (!buttons.length) return;

    function setActive(btn) {
      buttons.forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
      });
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var src = String(btn.getAttribute('data-src') || '').trim();
        if (!src) return;
        img.setAttribute('src', src);
        img.setAttribute('data-zoom-img', src);
        setActive(btn);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
