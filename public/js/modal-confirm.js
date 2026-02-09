(function () {
  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function isOpen(modal) {
    return Boolean(modal && modal.classList.contains('is-open'));
  }

  function show(modal) {
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    var focusTarget = qs('[data-confirm-cancel]', modal) || qs('[data-confirm-close]', modal) || qs('button', modal);
    if (focusTarget) focusTarget.focus();
  }

  function hide(modal) {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function init() {
    var modal = qs('[data-confirm-modal]');
    if (!modal) return;

    var titleEl = qs('[data-confirm-title]', modal);
    var msgEl = qs('[data-confirm-message]', modal);
    var promptWrap = qs('[data-confirm-prompt-wrap]', modal);
    var promptLabel = qs('[data-confirm-prompt-label]', modal);
    var promptInput = qs('[data-confirm-prompt-input]', modal);

    var btnCancel = qs('[data-confirm-cancel]', modal);
    var btnOk = qs('[data-confirm-ok]', modal);
    var btnClose = qs('[data-confirm-close]', modal);

    var state = {
      kind: 'confirm',
      target: null,
      form: null,
      promptName: null,
      requirePrompt: false,
    };

    function resetPrompt() {
      if (promptWrap) promptWrap.style.display = 'none';
      if (promptInput) {
        promptInput.value = '';
        promptInput.required = false;
      }
      state.promptName = null;
      state.requirePrompt = false;
    }

    function setModal(opts) {
      var o = opts || {};
      if (titleEl) titleEl.textContent = String(o.title || 'Confirm');
      if (msgEl) msgEl.textContent = String(o.message || 'Are you sure?');
      if (btnOk) btnOk.textContent = String(o.okText || 'Confirm');

      resetPrompt();

      if (o.promptLabel) {
        if (promptWrap) promptWrap.style.display = '';
        if (promptLabel) promptLabel.textContent = String(o.promptLabel || '');
        if (promptInput) {
          promptInput.placeholder = String(o.promptPlaceholder || '');
          promptInput.required = Boolean(o.promptRequired);
        }

        state.promptName = String(o.promptName || '').trim() || null;
        state.requirePrompt = Boolean(o.promptRequired);
      }
    }

    function openConfirmForTarget(target, opts) {
      state.target = target || null;
      state.form = null;
      setModal(opts);
      show(modal);
    }

    function openConfirmForForm(form, opts) {
      state.form = form || null;
      state.target = null;
      setModal(opts);
      show(modal);
    }

    function onBackdropClick(e) {
      if (e.target && e.target.hasAttribute('data-modal-backdrop')) {
        hide(modal);
      }
    }

    function onEsc(e) {
      if (e.key === 'Escape' && isOpen(modal)) hide(modal);
    }

    function resolvePromptValue() {
      if (!state.promptName) return null;
      return promptInput ? String(promptInput.value || '').trim() : '';
    }

    function applyPromptValueToForm(form) {
      if (!form || !state.promptName) return;
      var v = resolvePromptValue();
      if (state.requirePrompt && !v) {
        if (promptInput) promptInput.focus();
        return false;
      }

      var input = form.querySelector('input[name="' + state.promptName.replace(/"/g, '') + '"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = state.promptName;
        form.appendChild(input);
      }
      input.value = v || '';
      return true;
    }

    function confirmAction() {
      // Form submit confirmation
      if (state.form) {
        var ok = applyPromptValueToForm(state.form);
        if (ok === false) return;

        state.form.dataset.confirmed = '1';
        hide(modal);
        if (typeof state.form.requestSubmit === 'function') state.form.requestSubmit();
        else state.form.submit();
        return;
      }

      // Link/button confirmation
      if (state.target) {
        var t = state.target;
        hide(modal);

        if (t.tagName === 'A' && t.href) {
          window.location.href = t.href;
          return;
        }

        // If it's a button, try to click/submit its form.
        if (t.tagName === 'BUTTON') {
          var form = t.form || t.closest('form');
          if (form) {
            // If prompt is configured on the button, apply it.
            var ok2 = applyPromptValueToForm(form);
            if (ok2 === false) return;
            form.dataset.confirmed = '1';
            if (typeof form.requestSubmit === 'function') form.requestSubmit(t);
            else form.submit();
            return;
          }
        }
      }
    }

    if (btnClose) btnClose.addEventListener('click', function () { hide(modal); });
    if (btnCancel) btnCancel.addEventListener('click', function () { hide(modal); });
    if (btnOk) btnOk.addEventListener('click', confirmAction);

    modal.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onEsc);

    // Intercept form submissions.
    document.addEventListener(
      'submit',
      function (e) {
        var form = e.target;
        if (!form || form.nodeType !== 1) return;
        if (!form.hasAttribute('data-confirm')) return;
        if (form.dataset.confirmed === '1') return;

        e.preventDefault();

        var message = form.getAttribute('data-confirm') || 'Are you sure?';
        var title = form.getAttribute('data-confirm-title') || 'Confirm';
        var okText = form.getAttribute('data-confirm-ok') || 'Confirm';
        var promptLabel = form.getAttribute('data-confirm-prompt') || '';
        var promptName = form.getAttribute('data-confirm-prompt-name') || '';
        var promptRequired = String(form.getAttribute('data-confirm-prompt-required') || '') === '1';
        var promptPlaceholder = form.getAttribute('data-confirm-prompt-placeholder') || '';

        openConfirmForForm(form, {
          title: title,
          message: message,
          okText: okText,
          promptLabel: promptLabel || '',
          promptName: promptName || '',
          promptRequired: promptLabel ? promptRequired : false,
          promptPlaceholder: promptPlaceholder || '',
        });
      },
      true
    );

    // Intercept clicks on links/buttons.
    document.addEventListener(
      'click',
      function (e) {
        var t = e.target;
        if (!t) return;
        // If clicking inside a button/link
        var el = t.closest ? t.closest('[data-confirm]') : null;
        if (!el) return;

        // Let normal form submit handler handle submits.
        if (el.tagName === 'FORM') return;

        e.preventDefault();

        var message = el.getAttribute('data-confirm') || 'Are you sure?';
        var title = el.getAttribute('data-confirm-title') || 'Confirm';
        var okText = el.getAttribute('data-confirm-ok') || 'Confirm';
        var promptLabel = el.getAttribute('data-confirm-prompt') || '';
        var promptName = el.getAttribute('data-confirm-prompt-name') || '';
        var promptRequired = String(el.getAttribute('data-confirm-prompt-required') || '') === '1';
        var promptPlaceholder = el.getAttribute('data-confirm-prompt-placeholder') || '';

        openConfirmForTarget(el, {
          title: title,
          message: message,
          okText: okText,
          promptLabel: promptLabel || '',
          promptName: promptName || '',
          promptRequired: promptLabel ? promptRequired : false,
          promptPlaceholder: promptPlaceholder || '',
        });
      },
      true
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
