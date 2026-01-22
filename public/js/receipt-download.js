(function () {
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 250);
  }

  async function ensureLibs() {
    if (!window.html2canvas) throw new Error('html2canvas not loaded');
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');
  }

  async function toCanvas(el) {
    // Better quality on retina.
    var scale = Math.min(2, window.devicePixelRatio || 1);
    return window.html2canvas(el, {
      scale: scale,
      backgroundColor: '#ffffff',
      useCORS: true,
    });
  }

  async function handlePng(btn) {
    var targetId = btn.getAttribute('data-receipt-target') || 'receipt';
    var el = document.getElementById(targetId);
    if (!el) return;

    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      await ensureLibs();
      var canvas = await toCanvas(el);
      canvas.toBlob(function (blob) {
        if (!blob) throw new Error('Failed to create image');
        var name = btn.getAttribute('data-download-name') || 'receipt.png';
        downloadBlob(blob, name);
      }, 'image/png');
    } finally {
      btn.disabled = false;
      btn.textContent = btn.getAttribute('data-label') || 'Download PNG';
    }
  }

  async function handlePdf(btn) {
    var targetId = btn.getAttribute('data-receipt-target') || 'receipt';
    var el = document.getElementById(targetId);
    if (!el) return;

    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      await ensureLibs();
      var canvas = await toCanvas(el);
      var imgData = canvas.toDataURL('image/png');

      var jsPDF = window.jspdf.jsPDF;
      var pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

      var pageW = pdf.internal.pageSize.getWidth();
      var pageH = pdf.internal.pageSize.getHeight();

      // Fit to width with margins.
      var margin = 28;
      var maxW = pageW - margin * 2;
      var ratio = canvas.height / canvas.width;
      var drawW = maxW;
      var drawH = drawW * ratio;

      // If too tall, fit to height.
      if (drawH > pageH - margin * 2) {
        drawH = pageH - margin * 2;
        drawW = drawH / ratio;
      }

      var x = (pageW - drawW) / 2;
      var y = margin;
      pdf.addImage(imgData, 'PNG', x, y, drawW, drawH);

      var name = btn.getAttribute('data-download-name') || 'receipt.pdf';
      pdf.save(name);
    } finally {
      btn.disabled = false;
      btn.textContent = btn.getAttribute('data-label') || 'Download PDF';
    }
  }

  function init() {
    var pdfBtns = Array.prototype.slice.call(document.querySelectorAll('[data-download-receipt-pdf]'));
    var pngBtns = Array.prototype.slice.call(document.querySelectorAll('[data-download-receipt-png]'));

    pdfBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        handlePdf(btn).catch(function () {
          // ignore
        });
      });
    });

    pngBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        handlePng(btn).catch(function () {
          // ignore
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
