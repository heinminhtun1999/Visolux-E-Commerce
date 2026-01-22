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
    return 'RM ' + rm.toFixed(0);
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

    // Keep extra room at the bottom so the Y-min label and X-date labels don't overlap.
    var padding = { l: 10, r: 10, t: 10, b: 36 };
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

    var maxY = 0;
    gross.forEach(function (v) {
      if (v > maxY) maxY = v;
    });
    net.forEach(function (v) {
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
    var yLabelBottomY = y0 + h + 14;
    var xLabelY = y0 + h + 30;
    ctx.fillText(formatRM(maxY), x0 + 2, yLabelTopY);
    ctx.fillText(formatRM(0), x0 + 2, yLabelBottomY);

    var grossPts = getPoints(gross, x0, y0, w, h, maxY);
    var netPts = getPoints(net, x0, y0, w, h, maxY);

    // Area under gross.
    drawArea(ctx, grossPts, 'rgba(37,99,235,.12)', y0 + h);

    // Lines.
    drawLine(ctx, grossPts, 'rgba(37,99,235,1)', 2.5);
    drawLine(ctx, netPts, 'rgba(100,116,139,.9)', 2);

    // X labels: first and last date.
    var first = daily[0].day;
    var last = daily[daily.length - 1].day;
    ctx.fillStyle = 'rgba(100,116,139,.9)';
    ctx.fillText(first, x0, xLabelY);
    var lastWidth = ctx.measureText(last).width;
    ctx.fillText(last, x0 + w - lastWidth, xLabelY);
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
