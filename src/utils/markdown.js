const sanitizeHtml = require('sanitize-html');
const { marked } = require('marked');

marked.setOptions({
  mangle: false,
  headerIds: false,
});

function sanitizeHtmlFragment(html) {
  return sanitizeHtml(String(html == null ? '' : html), {
    allowedTags: [
      'p',
      'br',
      'hr',
      'strong',
      'em',
      'b',
      'i',
      'u',
      's',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'a',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'div',
      'span',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    transformTags: {
      a: (tagName, attribs) => {
        const next = { ...attribs };
        // Keep links safe when opened in a new tab.
        if (String(next.target || '') === '_blank') {
          next.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const next = { ...attribs };
        if (!next.alt) next.alt = '';
        return { tagName, attribs: next };
      },
    },
  });
}

function sanitizeHtmlFragmentNoImages(html) {
  return sanitizeHtml(String(html == null ? '' : html), {
    allowedTags: [
      'p',
      'br',
      'hr',
      'strong',
      'em',
      'b',
      'i',
      'u',
      's',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'div',
      'span',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      a: (tagName, attribs) => {
        const next = { ...attribs };
        if (String(next.target || '') === '_blank') {
          next.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: next };
      },
    },
  });
}

function renderMarkdown(markdown) {
  const md = String(markdown == null ? '' : markdown);
  const rawHtml = marked.parse(md);

  return sanitizeHtmlFragment(rawHtml);
}

module.exports = { renderMarkdown, sanitizeHtmlFragment, sanitizeHtmlFragmentNoImages };
