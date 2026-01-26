(function () {
  function parseDaily(raw) {
    try {
      var arr = JSON.parse(String(raw || '[]'));
      if (!Array.isArray(arr)) return [];
      return arr
        .map(function (r) {
          return {
            day: String(r.day || ''),
            gross_cents: Number(r.gross_cents || 0),
            net_cents: Number(r.net_cents || 0),
            refund_cents: Number(r.refund_cents || 0),
            profit_cents: Number(r.profit_cents || 0),
            orders_count: Number(r.orders_count || 0),
          };
        })
        .filter(function (r) {
          return r.day;
        });
    } catch (_) {
      return [];
    }
  }

  function formatRM(cents) {
    var rm = (Number(cents || 0) / 100) || 0;
    // For axis labels, keep compact.
    return 'RM ' + rm.toFixed(0);
  }

  function formatRM2(cents) {
    var rm = (Number(cents || 0) / 100) || 0;
    return 'RM ' + rm.toFixed(2);
  }

  function drawLine(ctx, points, strokeStyle, lineWidth) {
    if (!points.length) return;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth || 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  function drawArea(ctx, points, fillStyle, bottomY) {
    if (!points.length) return;
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.moveTo(points[0].x, bottomY);
    ctx.lineTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.lineTo(points[points.length - 1].x, bottomY);
    ctx.closePath();
    ctx.fill();
  }

  function getPoints(series, x0, y0, w, h, maxY) {
    var n = series.length;
    if (!n) return [];
    var stepX = n === 1 ? 0 : w / (n - 1);
    return series.map(function (v, i) {
      var x = x0 + stepX * i;
      var t = maxY > 0 ? v / maxY : 0;
      var y = y0 + h - t * h;
      return { x: x, y: y };
    });
  }

  function drawPoint(ctx, x, y, fill, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke || 'rgba(255,255,255,1)';
    ctx.stroke();
  }

  function nearestIndex(points, x) {
    if (!points.length) return -1;
    var best = 0;
    var bestDist = Math.abs(points[0].x - x);
    for (var i = 1; i < points.length; i++) {
      var d = Math.abs(points[i].x - x);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  }

  function ensureTooltip(canvas) {
    var parent = canvas.parentElement;
    if (!parent) return null;
    if (window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    var existing = parent.querySelector('.chart-tooltip');
    if (existing) return existing;
    var div = document.createElement('div');
    div.className = 'chart-tooltip';
    div.style.display = 'none';
    parent.appendChild(div);
    return div;
  }

  function initOne(canvas) {
    var daily = parseDaily(canvas.getAttribute('data-sales-daily'));
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI.
    var cssWidth = canvas.clientWidth || 800;
    var cssHeight = canvas.getAttribute('height') ? Number(canvas.getAttribute('height')) : 120;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.scale(dpr, dpr);

    // Background.
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (!daily.length) {
      ctx.fillStyle = 'rgba(100,116,139,.9)';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText('No data to chart for this range.', 12, 22);
      return;
    }

    // Keep extra room so the Y-min label and X-date labels don't overlap (esp. on small screens).
    var padding = { l: 44, r: 12, t: 10, b: 46 };
    var x0 = padding.l;
    var y0 = padding.t;
    var w = cssWidth - padding.l - padding.r;
    var h = cssHeight - padding.t - padding.b;

    var gross = daily.map(function (r) {
      return Math.max(0, r.gross_cents);
    });
    var net = daily.map(function (r) {
      return Math.max(0, r.net_cents);
    });
    var profit = daily.map(function (r) {
      return Math.max(0, r.profit_cents);
    });

    var maxY = 0;
    gross.forEach(function (v) {
      if (v > maxY) maxY = v;
    });
    net.forEach(function (v) {
      if (v > maxY) maxY = v;
    });
    profit.forEach(function (v) {
      if (v > maxY) maxY = v;
    });

    // Add a little headroom.
    maxY = Math.ceil(maxY * 1.1);

    // Grid lines (3).
    ctx.strokeStyle = 'rgba(226,232,240,1)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 3; g++) {
      var gy = y0 + (h / 3) * g;
      ctx.beginPath();
      ctx.moveTo(x0, gy);
      ctx.lineTo(x0 + w, gy);
      ctx.stroke();
    }

    // Labels (min/max only for simplicity).
    ctx.fillStyle = 'rgba(100,116,139,.9)';
    ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    var yLabelTopY = y0 + 10;
    var yLabelBottomY = y0 + h + 18;
    var xLabelY = y0 + h + 38;
    ctx.fillText(formatRM(maxY), x0 + 2, yLabelTopY);
    ctx.fillText(formatRM(0), x0 + 2, yLabelBottomY);

    var grossPts = getPoints(gross, x0, y0, w, h, maxY);
    var netPts = getPoints(net, x0, y0, w, h, maxY);
    var profitPts = getPoints(profit, x0, y0, w, h, maxY);

    // Area under gross.
    drawArea(ctx, grossPts, 'rgba(37,99,235,.12)', y0 + h);

    // Lines.
    drawLine(ctx, grossPts, 'rgba(37,99,235,1)', 2.5);
    drawLine(ctx, netPts, 'rgba(100,116,139,.9)', 2);
    drawLine(ctx, profitPts, 'rgba(22,163,74,.95)', 2);

    // Points (last point emphasized).
    if (grossPts.length) drawPoint(ctx, grossPts[grossPts.length - 1].x, grossPts[grossPts.length - 1].y, 'rgba(37,99,235,1)');
    if (netPts.length) drawPoint(ctx, netPts[netPts.length - 1].x, netPts[netPts.length - 1].y, 'rgba(100,116,139,.95)');
    if (profitPts.length) drawPoint(ctx, profitPts[profitPts.length - 1].x, profitPts[profitPts.length - 1].y, 'rgba(22,163,74,.95)');

    // X labels: first and last date.
    var first = daily[0].day;
    var last = daily[daily.length - 1].day;
    ctx.fillStyle = 'rgba(100,116,139,.9)';
    ctx.fillText(first, x0, xLabelY);
    var lastWidth = ctx.measureText(last).width;
    ctx.fillText(last, x0 + w - lastWidth, xLabelY);

    // Legend.
    var lx = x0 + w - 180;
    var ly = y0 + 6;
    ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillStyle = 'rgba(100,116,139,.95)';
    ctx.fillText('Gross', lx + 14, ly + 10);
    ctx.fillText('Net', lx + 72, ly + 10);
    ctx.fillText('Profit', lx + 110, ly + 10);
    ctx.fillStyle = 'rgba(37,99,235,1)';
    ctx.fillRect(lx, ly + 3, 10, 10);
    ctx.fillStyle = 'rgba(100,116,139,.95)';
    ctx.fillRect(lx + 54, ly + 3, 10, 10);
    ctx.fillStyle = 'rgba(22,163,74,.95)';
    ctx.fillRect(lx + 92, ly + 3, 10, 10);

    // Tooltip interactions.
    var tooltip = ensureTooltip(canvas);
    if (!tooltip) return;

    function showAt(clientX) {
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left;
      var idx = nearestIndex(grossPts, x);
      if (idx < 0 || idx >= daily.length) return;

      var r = daily[idx];
      tooltip.innerHTML =
        '<div class="chart-tooltip__date">' + r.day + '</div>' +
        '<div class="chart-tooltip__row"><span class="dot dot--gross"></span> Gross: <strong>' + formatRM2(r.gross_cents) + '</strong></div>' +
        '<div class="chart-tooltip__row"><span class="dot dot--net"></span> Net: <strong>' + formatRM2(r.net_cents) + '</strong></div>' +
        '<div class="chart-tooltip__row"><span class="dot dot--profit"></span> Profit (est.): <strong>' + formatRM2(r.profit_cents) + '</strong></div>' +
        '<div class="chart-tooltip__meta">Orders: ' + String(r.orders_count || 0) + ' • Refunds: ' + formatRM2(r.refund_cents) + '</div>';

      tooltip.style.display = 'block';

      // Position within the parent.
      var left = Math.max(8, Math.min((canvas.clientWidth || rect.width) - 220, x + 10));
      tooltip.style.left = left + 'px';
      tooltip.style.top = '12px';
    }

    function hide() {
      tooltip.style.display = 'none';
    }

    canvas.addEventListener('mousemove', function (e) {
      showAt(e.clientX);
    });
    canvas.addEventListener('mouseleave', hide);
    canvas.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches.length) return;
      showAt(e.touches[0].clientX);
    }, { passive: true });
    canvas.addEventListener('touchend', hide);
  }

  function init() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('canvas[data-sales-daily]'));
    nodes.forEach(function (c) {
      try {
        initOne(c);
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
