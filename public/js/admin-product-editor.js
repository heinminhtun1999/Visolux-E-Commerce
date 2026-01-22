(function () {
  function htmlToText(html) {
    try {
      var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      return String((doc.body && doc.body.textContent) || '')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (e) {
      return String(html || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  function init() {
    var textareaText = document.querySelector('[data-product-desc-textarea]');
    var textareaHtml = document.querySelector('[data-product-desc-html]');
    var wrap = document.querySelector('[data-product-desc-editor]');
    if (!textareaText || !textareaHtml || !wrap) return;
    if (!window.Quill) return;

    // Keep plain-text fallback for no-JS. With JS, we swap to Quill.
    textareaText.style.display = 'none';
    wrap.style.display = 'block';

    var toolbar = wrap.querySelector('.rte__toolbar');
    var editorEl = wrap.querySelector('.rte__editor');

    var quill = new window.Quill(editorEl, {
      theme: 'snow',
      modules: {
        toolbar: {
          container: toolbar,
          handlers: {},
        },
      },
    });

    // Build toolbar UI.
    toolbar.innerHTML =
      '<span class="ql-formats">' +
      '<select class="ql-header">' +
      '<option selected></option>' +
      '<option value="1"></option>' +
      '<option value="2"></option>' +
      '<option value="3"></option>' +
      '</select>' +
      '</span>' +
      '<span class="ql-formats">' +
      '<button class="ql-bold"></button>' +
      '<button class="ql-italic"></button>' +
      '<button class="ql-underline"></button>' +
      '<button class="ql-strike"></button>' +
      '</span>' +
      '<span class="ql-formats">' +
      '<button class="ql-list" value="ordered"></button>' +
      '<button class="ql-list" value="bullet"></button>' +
      '</span>' +
      '<span class="ql-formats">' +
      '<button class="ql-link"></button>' +
      '<button class="ql-clean"></button>' +
      '</span>';

    // Load initial content (prefer HTML field; fallback to plain text).
    var initialHtml = (textareaHtml.value || '').trim();
    if (initialHtml) {
      quill.clipboard.dangerouslyPasteHTML(initialHtml);
    } else {
      var t = (textareaText.value || '').trim();
      if (t) quill.setText(t);
    }

    function sync() {
      var html = editorEl.querySelector('.ql-editor') ? editorEl.querySelector('.ql-editor').innerHTML : '';
      textareaHtml.value = html;
      textareaText.value = htmlToText(html);
    }

    quill.on('text-change', sync);
    sync();

    // Ensure fields are synced before submit.
    var form = textareaText.form;
    if (form) {
      form.addEventListener('submit', function () {
        sync();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
