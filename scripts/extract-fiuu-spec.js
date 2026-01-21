const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: node scripts/extract-fiuu-spec.js <path-to-pdf>');
    process.exit(1);
  }
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buf });
  const data = await parser.getText();
  const text = data.text || '';

  const out = {
    pages: data.numpages,
    chars: text.length,
    sample: text.slice(0, 2000),
  };

  console.log(JSON.stringify(out, null, 2));

  const interesting = [
    'checksum',
    'signature',
    'vcode',
    'skey validation',
    'verify payment',
    'skey',
    'vkey',
    'verify',
    'returnurl',
    'callback',
    'callback url',
    'return url',
    'notification url',
    'notify url',
    'hosted payment page',
    'payment request',
    'notification',
    'txn',
    'amount',
    'orderid',
    'MerchantID',
    'Merchant Code',
  ];

  const lower = text.toLowerCase();
  for (const needle of interesting) {
    const needleLower = needle.toLowerCase();
    let fromIndex = 0;
    let hitCount = 0;
    while (hitCount < 5) {
      const idx = lower.indexOf(needleLower, fromIndex);
      if (idx === -1) break;
      const start = Math.max(0, idx - 500);
      const end = Math.min(text.length, idx + 1200);
      console.log(`\n--- HIT: ${needle} (${hitCount + 1}) ---\n`);
      console.log(text.slice(start, end));
      hitCount += 1;
      fromIndex = idx + needleLower.length;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
