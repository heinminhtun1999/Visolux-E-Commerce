(function () {
  function collectFields(form) {
    var fields = {};
    var inputs = form.querySelectorAll('input[type="hidden"][name]');
    for (var i = 0; i < inputs.length; i++) {
      var k = inputs[i].getAttribute('name');
      var v = inputs[i].value;
      fields[k] = v;
    }
    return fields;
  }

  function run() {
    var form = document.getElementById('payForm');
    if (!form) return;

    var debug = form.getAttribute('data-debug') === '1';
    if (!debug) return;

    try {
      var action = form.getAttribute('action');
      var fields = collectFields(form);
      var embedded = false;
      try {
        embedded = window.top && window.self && window.top !== window.self;
      } catch (_) {
        embedded = true;
      }
      console.log('[fiuu] POST action:', action);
      console.log('[fiuu] embedded:', embedded);
      console.log('[fiuu] fields:', fields);

      // Also print an encoded string for copy/paste comparison.
      var params = new URLSearchParams();
      Object.keys(fields)
        .sort()
        .forEach(function (k) {
          params.set(k, String(fields[k]));
        });
      console.log('[fiuu] urlencoded:', params.toString());
    } catch (e) {
      console.warn('[fiuu] debug logging failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
