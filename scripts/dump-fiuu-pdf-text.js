const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function main() {
  const pdfPath = process.argv[2];
  const outPath = process.argv[3];

  if (!pdfPath || !outPath) {
    console.error('Usage: node scripts/dump-fiuu-pdf-text.js <pdfPath> <outTextPath>');
    process.exit(1);
  }

  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buf });
  const data = await parser.getText();
  const text = String(data.text || '');

  fs.writeFileSync(outPath, text, 'utf8');
  console.log(`Wrote ${text.length} chars to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
