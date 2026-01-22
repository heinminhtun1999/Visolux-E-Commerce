function svg(attrs, path) {
  return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">${path}</svg>`;
}

function icon(name, opts = {}) {
  const size = Number(opts.size || 18);
  const cls = String(opts.class || 'icon');
  const title = opts.title ? String(opts.title) : null;
  const baseAttrs = `width="${size}" height="${size}" class="${cls}" aria-hidden="true" focusable="false"`;
  const titleTag = title ? `<title>${escapeHtml(title)}</title>` : '';

  switch (String(name)) {
    case 'home':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M3 10.5 12 3l9 7.5V21a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75v-6.75h-4.5V21a.75.75 0 0 1-.75.75H3.75A.75.75 0 0 1 3 21V10.5Z"/>`);
    case 'cart':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.5l.75 3m0 0 1.5 6h12l2.25-8.25H4.5Zm3 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm10.5 0a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"/>`);
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
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15"/><path stroke-linecap="round" stroke-linejoin="round" d="M18 12H9m0 0 3-3m-3 3 3 3"/>`);
    case 'login':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 12h9m0 0-3-3m3 3-3 3"/>`);
    case 'filter':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M3 5.25h18l-7.5 8.25V20.25l-3-1.5v-5.25L3 5.25Z"/>`);
    case 'back':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12l7.5-7.5M3 12h18"/>`);
    case 'plus':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>`);
    case 'edit':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487 19.5 7.125M7.5 20.25H4.5v-3L15.75 6l3 3L7.5 20.25Z"/>`);
    case 'gear':
      return svg(
        baseAttrs,
        `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.094c.55 0 1.02.398 1.11.94l.149.894c.07.424.37.776.78.93.329.123.64.285.928.483.356.246.84.262 1.205.043l.761-.457c.474-.284 1.08-.152 1.38.3l.547.82c.3.451.25 1.07-.12 1.412l-.693.637c-.328.3-.44.78-.287 1.182.122.322.214.66.27 1.01.07.424.37.776.78.93l.894.335c.51.191.825.716.725 1.258l-.214 1.137c-.1.542-.57.94-1.12.94h-.895c-.425 0-.81.247-.99.634-.154.329-.347.64-.574.926-.246.356-.262.84-.043 1.205l.457.761c.284.474.152 1.08-.3 1.38l-.82.547c-.451.3-1.07.25-1.412-.12l-.637-.693c-.3-.328-.78-.44-1.182-.287-.322.122-.66.214-1.01.27-.424.07-.776.37-.93.78l-.335.894c-.191.51-.716.825-1.258.725l-1.137-.214c-.542-.1-.94-.57-.94-1.12v-.895c0-.425-.247-.81-.634-.99-.329-.154-.64-.347-.926-.574-.356-.246-.84-.262-1.205-.043l-.761.457c-.474.284-1.08.152-1.38-.3l-.547-.82c-.3-.451-.25-1.07.12-1.412l.693-.637c.328-.3.44-.78.287-1.182-.122-.322-.214-.66-.27-1.01-.07-.424-.37-.776-.78-.93l-.894-.335c-.51-.191-.825-.716-.725-1.258l.214-1.137c.1-.542.57-.94 1.12-.94h.895c.425 0 .81-.247.99-.634.154-.329.347-.64.574-.926.246-.356.262-.84.043-1.205l-.457-.761c-.284-.474-.152-1.08.3-1.38l.82-.547c.451-.3 1.07-.25 1.412.12l.637.693c.3.328.78.44 1.182.287.322-.122.66-.214 1.01-.27.424-.07.776-.37.93-.78l.335-.894Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"/>`
      );
    case 'view':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12s3.75-7.5 9.75-7.5S21.75 12 21.75 12s-3.75 7.5-9.75 7.5S2.25 12 2.25 12Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>`);
    case 'check':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 4.5 4.5 10.5-12"/>`);
    case 'x':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18"/>`);
    case 'store':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6h16.5l-1.5 12.75a2.25 2.25 0 0 1-2.235 2.0H7.485a2.25 2.25 0 0 1-2.235-2.0L3.75 6Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 6V4.5A1.5 1.5 0 0 1 9 3h6a1.5 1.5 0 0 1 1.5 1.5V6"/>`);
    case 'bell':
      return svg(baseAttrs, `${titleTag}<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9a6 6 0 1 0-12 0v.75a8.967 8.967 0 0 1-2.31 6.022 23.848 23.848 0 0 0 5.454 1.31m5.713 0a3 3 0 1 1-5.714 0m5.714 0H9.143"/>`);
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
