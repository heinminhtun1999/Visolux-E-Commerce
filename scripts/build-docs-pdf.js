/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function requireOptional(name) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(name);
  } catch (e) {
    return null;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildHtml({ title, markdownHtml }) {
  const css = `
    @page { size: A4; margin: 18mm 16mm; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color: #0f172a; }
    h1,h2,h3 { margin: 18px 0 8px; }
    h1 { font-size: 26px; }
    h2 { font-size: 18px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    h3 { font-size: 15px; }
    p,li { font-size: 11.5px; line-height: 1.55; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; }
    pre { background: #0b1220; color: #e2e8f0; padding: 10px 12px; border-radius: 10px; overflow: hidden; }
    pre code { color: inherit; }
    a { color: #0284c7; text-decoration: none; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 11px; vertical-align: top; }
    th { background: #f8fafc; }
    blockquote { border-left: 4px solid #e2e8f0; padding-left: 12px; color: #334155; }
    .titlepage { margin-bottom: 16px; }
    .titlepage h1 { margin-top: 0; }
    .muted { color: #64748b; }
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${css}</style>
</head>
<body>
  ${markdownHtml}
</body>
</html>`;
}

async function main() {
  const marked = requireOptional('marked');
  const puppeteer = requireOptional('puppeteer');

  if (!marked || !puppeteer) {
    console.error('Missing dependencies for PDF generation. Install dev deps:');
    console.error('  npm install --save-dev marked puppeteer');
    process.exit(2);
  }

  const docsDir = path.join(process.cwd(), 'docs');
  const inputPath = path.join(docsDir, 'PROJECT_DOCUMENTATION.md');
  const outputPath = path.join(docsDir, 'Visolux-E-Commerce-Documentation.pdf');

  const md = fs.readFileSync(inputPath, 'utf8');
  const markdownHtml = marked.parse(md);

  const html = buildHtml({
    title: 'Visolux E-Commerce — Documentation',
    markdownHtml,
  });

  const browser = await puppeteer.launch({
    headless: 'new',
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="font-size:9px; width:100%; padding:0 16mm; color:#64748b; display:flex; justify-content:space-between;">' +
        '<span>Visolux E-Commerce</span>' +
        '<span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
        '</div>',
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await browser.close();
  }

  console.log(`[docs] wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
