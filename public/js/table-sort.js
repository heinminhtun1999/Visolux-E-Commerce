(function () {
  function normText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function parseMaybeNumber(s) {
    var t = normText(s);
    if (!t) return null;

    // Strip common currency/formatting characters (keeps digits, dot, minus).
    var cleaned = t
      .replace(/RM\s*/gi, '')
      .replace(/[,\s]/g, '')
      .replace(/[^0-9.\-]/g, '');

    if (!cleaned) return null;
    // Reject values that are just '-' or '.' etc.
    if (!/^-?\d*(\.\d+)?$/.test(cleaned)) return null;

    var n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function parseMaybeDate(s) {
    var t = normText(s);
    if (!t) return null;
    var ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }

  function getCellText(row, index) {
    var cells = row && row.children ? row.children : [];
    var cell = cells[index];
    return cell ? normText(cell.textContent) : '';
  }

  function initTable(table) {
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    var headers = Array.prototype.slice.call(thead.querySelectorAll('th'));
    if (!headers.length) return;

    headers.forEach(function (th, index) {
      if (!th) return;
      if (th.hasAttribute('data-nosort')) return;
      if (normText(th.textContent) === '') return;
      if (th.querySelector('a[href]')) return; // server-side sorting links

      th.classList.add('is-sortable');
      th.setAttribute('role', 'button');
      th.tabIndex = 0;

      function doSort() {
        var current = th.getAttribute('aria-sort');
        var nextDir = current === 'ascending' ? 'descending' : 'ascending';

        // Clear other headers
        headers.forEach(function (h) {
          if (h !== th && h.classList.contains('is-sortable')) {
            h.removeAttribute('aria-sort');
          }
        });
        th.setAttribute('aria-sort', nextDir);

        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        if (!rows.length) return;

        // Determine sort type from the first non-empty value
        var sample = null;
        for (var i = 0; i < rows.length; i++) {
          var v = getCellText(rows[i], index);
          if (v) {
            sample = v;
            break;
          }
        }

        var sampleNum = sample ? parseMaybeNumber(sample) : null;
        var sampleDate = sampleNum === null && sample ? parseMaybeDate(sample) : null;

        rows.sort(function (a, b) {
          var av = getCellText(a, index);
          var bv = getCellText(b, index);

          if (sampleNum !== null) {
            var an = parseMaybeNumber(av);
            var bn = parseMaybeNumber(bv);
            if (an === null && bn === null) return 0;
            if (an === null) return 1;
            if (bn === null) return -1;
            return an - bn;
          }

          if (sampleDate !== null) {
            var ad = parseMaybeDate(av);
            var bd = parseMaybeDate(bv);
            if (ad === null && bd === null) return 0;
            if (ad === null) return 1;
            if (bd === null) return -1;
            return ad - bd;
          }

          return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
        });

        if (nextDir === 'descending') rows.reverse();

        // Re-append in sorted order
        rows.forEach(function (r) {
          tbody.appendChild(r);
        });
      }

      th.addEventListener('click', doSort);
      th.addEventListener('keydown', function (e) {
        var k = e.key || '';
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          doSort();
        }
      });
    });
  }

  function init() {
    var tables = Array.prototype.slice.call(document.querySelectorAll('table.table'));
    tables.forEach(initTable);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
