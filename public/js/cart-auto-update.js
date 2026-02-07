(function () {
  function init() {
    var forms = document.querySelectorAll('form[action="/cart/update"]');
    if (!forms || !forms.length) return;

    forms.forEach(function (form) {
      var qty = form.querySelector('input[name="quantity"]');
      if (!qty) return;

      // Some fields may sit outside the <form> (e.g. table columns) and use the
      // HTML "form" attribute to associate with this form.
      var note = form.querySelector('textarea[data-cart-note], textarea[name="note"], input[name="note"]');
      if (!note && form.id) {
        try {
          note = document.querySelector('[form="' + form.id + '"][data-cart-note], [form="' + form.id + '"][name="note"]');
        } catch (_) {
          // ignore
        }
      }

      var noteHidden = form.querySelector('input[type="hidden"][name="note"]');

      function syncNoteToHidden() {
        if (!note || !noteHidden) return;
        try {
          noteHidden.value = String(note.value || '');
        } catch (_) {
          // ignore
        }
      }

      var timer = null;

      function submitNow() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        // Avoid submitting if the form/input is disabled.
        if (qty.disabled) return;

        // Trigger native HTML validation (min/max/required) before submit.
        if (typeof form.requestSubmit === 'function') {
          try {
            form.requestSubmit();
            return;
          } catch (_) {
            // fall back
          }
        }

        try {
          form.submit();
        } catch (_) {
          // ignore
        }
      }

      function scheduleSubmit() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(submitNow, 450);
      }

      qty.addEventListener('input', scheduleSubmit);
      qty.addEventListener('change', submitNow);

      if (note) {
        // Keep hidden field up to date so the server always receives notes.
        note.addEventListener('input', syncNoteToHidden);

        // Notes are free text; don't auto-submit on every keystroke (it reloads the page
        // and feels like text is disappearing). Save when the user finishes editing.
        note.addEventListener('change', function () { syncNoteToHidden(); submitNow(); });
        note.addEventListener('blur', function () { syncNoteToHidden(); submitNow(); });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
