function svg(attrs, path) {
  return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function icon(name, opts = {}) {
  const size = Number(opts.size || 18);
  const cls = String(opts.class || 'icon');
  const title = opts.title ? String(opts.title) : null;
  const baseAttrs = `width="${size}" height="${size}" class="${cls}" aria-hidden="true" focusable="false"`;
  const titleTag = title ? `<title>${escapeHtml(title)}</title>` : '';

  switch (String(name)) {
    // Lucide icons (preferred)
    case 'chevron-down':
      return svg(baseAttrs, `${titleTag}<path d="m6 9 6 6 6-6"/>`);
    case 'sun':
      return svg(
        baseAttrs,
        `${titleTag}
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2"/>
        <path d="M12 20v2"/>
        <path d="M4.93 4.93l1.41 1.41"/>
        <path d="M17.66 17.66l1.41 1.41"/>
        <path d="M2 12h2"/>
        <path d="M20 12h2"/>
        <path d="M4.93 19.07l1.41-1.41"/>
        <path d="M17.66 6.34l1.41-1.41"/>
        `
      );
    case 'moon':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z"/>
        `
      );
    case 'panel-left':
      return svg(
        baseAttrs,
        `${titleTag}
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M9 3v18"/>
        `
      );
    case 'columns-2':
      return svg(
        baseAttrs,
        `${titleTag}
        <rect x="3" y="4" width="18" height="16" rx="2"/>
        <path d="M12 4v16"/>
        `
      );
    case 'bar-chart-3':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M3 3v18h18"/>
        <path d="M7 16v-6"/>
        <path d="M12 16V6"/>
        <path d="M17 16v-9"/>
        `
      );
    case 'layout-dashboard':
    case 'dashboard':
      return svg(
        baseAttrs,
        `${titleTag}
        <rect x="3" y="3" width="7" height="9" rx="1"/>
        <rect x="14" y="3" width="7" height="5" rx="1"/>
        <rect x="14" y="12" width="7" height="9" rx="1"/>
        <rect x="3" y="16" width="7" height="5" rx="1"/>
        `
      );
    case 'box':
    case 'products':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
        <path d="M3.3 7 12 12l8.7-5"/>
        <path d="M12 22V12"/>
        `
      );
    case 'layers':
    case 'categories':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.84l8.57 3.9a2 2 0 0 0 1.66 0l8.57-3.9a1 1 0 0 0 0-1.84Z"/>
        <path d="m2 12 9.17 4.19a2 2 0 0 0 1.66 0L22 12"/>
        <path d="m2 16 9.17 4.19a2 2 0 0 0 1.66 0L22 16"/>
        `
      );
    case 'shopping-bag':
    case 'orders-admin':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
        <path d="M3 6h18"/>
        <path d="M16 10a4 4 0 0 1-8 0"/>
        `
      );
    case 'users':
    case 'customers':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        `
      );
    case 'settings':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.15.08a2 2 0 0 1-2-.02l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.08a2 2 0 0 1 1 1.73V12a2 2 0 0 1-1 1.73l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2-.02l.15.08a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.15-.08a2 2 0 0 1 2 .02l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.73v-.36a2 2 0 0 1 1-1.73l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 .02l-.15-.08a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/>
        <circle cx="12" cy="12" r="3"/>
        `
      );
    case 'plus':
    case 'add':
      return svg(baseAttrs, `${titleTag}<path d="M12 5v14"/><path d="M5 12h14"/>`);
    case 'pencil':
    case 'edit-lucide':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        <path d="m15 5 4 4"/>
        `
      );
    case 'trash-2':
    case 'trash':
    case 'delete':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M3 6h18"/>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
        <path d="M10 11v6"/>
        <path d="M14 11v6"/>
        `
      );
    case 'file-text':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/>
        <path d="M14 2v6h6"/>
        <path d="M8 13h8"/>
        <path d="M8 17h8"/>
        <path d="M8 9h3"/>
        `
      );
    case 'eye':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
        <circle cx="12" cy="12" r="3"/>
        `
      );
    case 'search':
      return svg(baseAttrs, `${titleTag}<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>`);
    case 'sliders-horizontal':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M21 4H14"/>
        <path d="M10 4H3"/>
        <path d="M21 12H12"/>
        <path d="M8 12H3"/>
        <path d="M21 20H16"/>
        <path d="M12 20H3"/>
        <path d="M14 2v4"/>
        <path d="M8 10v4"/>
        <path d="M16 18v4"/>
        `
      );
    case 'log-out':
      return svg(
        baseAttrs,
        `${titleTag}
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <path d="M16 17l5-5-5-5"/>
        <path d="M21 12H9"/>
        `
      );

    case 'home':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M3 10.5 12 3l9 7.5V21a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75v-6.75h-4.5V21a.75.75 0 0 1-.75.75H3.75A.75.75 0 0 1 3 21V10.5Z"/>`);
    case 'cart':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.5l.75 3m0 0 1.5 6h12l2.25-8.25H4.5Zm3 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm10.5 0a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"/>`);
    case 'shopping-cart':
      return icon('cart', opts);
    case 'orders':
      return svg(
        baseAttrs,
        `${titleTag}
        <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3.75h6.9L17.25 7.35V20.25A2.25 2.25 0 0 1 15 22.5H6.75A2.25 2.25 0 0 1 4.5 20.25V6A2.25 2.25 0 0 1 6.75 3.75Z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 3.75V7.5h3.75"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 11.25h6"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 14.25h5.25"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.25 12.25h1.3l.55 2.2m0 0 .9 3.6h6.7l1.35-5.8H10.55Z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M12.4 20.25a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2Zm5.1 0a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2Z"/>
        `
      );
    case 'slip':
      return svg(
        baseAttrs,
        `${titleTag}
        <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3.75h6.9L17.25 7.35V20.25A2.25 2.25 0 0 1 15 22.5H6.75A2.25 2.25 0 0 1 4.5 20.25V6A2.25 2.25 0 0 1 6.75 3.75Z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 3.75V7.5h3.75"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 12h6"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 15.75h6"/>
        `
      );
    case 'user':
      return svg(
        baseAttrs,
        `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0"/>`
      );
    case 'admin':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12a7.5 7.5 0 0 0-.09-1.17l1.62-1.26-1.5-2.6-1.95.78a7.59 7.59 0 0 0-2.02-1.17l-.3-2.07h-3l-.3 2.07a7.59 7.59 0 0 0-2.02 1.17l-1.95-.78-1.5 2.6 1.62 1.26A7.5 7.5 0 0 0 4.5 12c0 .4.03.79.09 1.17l-1.62 1.26 1.5 2.6 1.95-.78c.62.5 1.3.9 2.02 1.17l.3 2.07h3l.3-2.07c.72-.27 1.4-.67 2.02-1.17l1.95.78 1.5-2.6-1.62-1.26c.06-.38.09-.77.09-1.17Z"/>`);
    case 'logout':
      return icon('log-out', opts);
    case 'login':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 12h9m0 0-3-3m3 3-3 3"/>`);
    case 'filter':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M3 5.25h18l-7.5 8.25V20.25l-3-1.5v-5.25L3 5.25Z"/>`);
    case 'back':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12l7.5-7.5M3 12h18"/>`);
    case 'plus':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>`);
    case 'edit':
      return icon('pencil', opts);
    case 'gear':
      return icon('settings', opts);
    case 'view':
      return icon('eye', opts);
    case 'check':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 4.5 4.5 10.5-12"/>`);
    case 'x':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18"/>`);
    case 'store':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6h16.5l-1.5 12.75a2.25 2.25 0 0 1-2.235 2.0H7.485a2.25 2.25 0 0 1-2.235-2.0L3.75 6Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 6V4.5A1.5 1.5 0 0 1 9 3h6a1.5 1.5 0 0 1 1.5 1.5V6"/>`);
    case 'bell':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9a6 6 0 1 0-12 0v.75a8.967 8.967 0 0 1-2.31 6.022 23.848 23.848 0 0 0 5.454 1.31m5.713 0a3 3 0 1 1-5.714 0m5.714 0H9.143"/>`);
    case 'mail':
      return svg(
        baseAttrs,
        `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5A2.25 2.25 0 0 1 22.5 9v9A2.25 2.25 0 0 1 20.25 20.25H3.75A2.25 2.25 0 0 1 1.5 18V9A2.25 2.25 0 0 1 3.75 6.75Z"/><path stroke-linecap="round" stroke-linejoin="round" d="m3.75 9 8.25 5.25L20.25 9"/>`
      );
    case 'desktop-bell':
      return svg(
        baseAttrs,
        `${titleTag}
        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 5.25h15A2.25 2.25 0 0 1 21.75 7.5v7.5A2.25 2.25 0 0 1 19.5 17.25h-15A2.25 2.25 0 0 1 2.25 15V7.5A2.25 2.25 0 0 1 4.5 5.25Z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 20.25h6"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 17.25v3"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.2 13.5a7.7 7.7 0 0 0 2.8-.7 3.2 3.2 0 0 1-1.1-2.45V10a2.35 2.35 0 1 0-4.7 0v.35c0 .95-.39 1.85-1.1 2.45 1.0.39 1.94.62 2.8.7m0 0a1.2 1.2 0 1 1-2.4 0m2.4 0h-2.4"/>
        `
      );
    case 'grid':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 4.5h6v6h-6v-6Zm9 0h6v6h-6v-6Zm-9 9h6v6h-6v-6Zm9 0h6v6h-6v-6Z"/>`);
    case 'chart':
      return svg(
        baseAttrs,
        `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 19.5V5.25"/><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 19.5H21"/><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 16.5v-6"/><path stroke-linecap="round" stroke-linejoin="round" d="M12.75 16.5v-9"/><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 16.5v-3"/>`
      );
    case 'list':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12M8.25 17.25h12"/><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 6.75h.75v.75H4.5v-.75Zm0 5.25h.75V12H4.5v-.75Zm0 5.25h.75v.75H4.5v-.75Z"/>`);
    case 'tag':
      return svg(
        baseAttrs,
        `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 10.5V6.75A2.25 2.25 0 0 1 6 4.5h3.75a2.25 2.25 0 0 1 1.591.659l8.159 8.159a2.25 2.25 0 0 1 0 3.182l-3 3a2.25 2.25 0 0 1-3.182 0l-8.159-8.159A2.25 2.25 0 0 1 3.75 10.5Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h.008v.008H7.5V8.25Z"/>`
      );
    default:
      return '';
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

module.exports = { icon };
