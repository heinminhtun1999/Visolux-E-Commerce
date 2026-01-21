/*
  Purge orphaned page images from storage/uploads/site.
  Only deletes files like: site_page_<nonce>.webp

  Usage:
    node scripts/purge-orphan-site-page-images.js --dry-run
    node scripts/purge-orphan-site-page-images.js
*/

const fs = require('fs');
const path = require('path');

const settingsRepo = require('../src/repositories/settingsRepo');

function extractSitePageImageNamesFromHtml(html) {
  const out = new Set();
  const s = String(html == null ? '' : html);
  const re = /\bsrc\s*=\s*["']([^"']+)["']/gi;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    const src = String(m[1] || '').trim();
    if (!src.startsWith('/uploads/site/')) continue;
    const fileName = path.posix.basename(src);
    if (!/^site_page_[0-9a-f]{16}\.webp$/i.test(fileName)) continue;
    out.add(fileName);
  }
  return out;
}

function getReferencedSitePageImageNames() {
  const keys = ['page.privacy.html', 'page.terms.html', 'page.how_to_order.html'];
  const values = settingsRepo.getMany(keys);
  const referenced = new Set();
  for (const k of keys) {
    const html = values[k];
    for (const f of extractSitePageImageNamesFromHtml(html)) referenced.add(f);
  }
  return referenced;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const siteDir = path.join(process.cwd(), 'storage', 'uploads', 'site');

  const files = fs.existsSync(siteDir) ? fs.readdirSync(siteDir) : [];
  const candidates = files.filter((f) => /^site_page_[0-9a-f]{16}\.webp$/i.test(f));

  const referenced = getReferencedSitePageImageNames();
  const orphaned = candidates.filter((f) => !referenced.has(f));

  if (!orphaned.length) {
    console.log('No orphaned site page images found.');
    return;
  }

  if (dryRun) {
    console.log(`Would delete ${orphaned.length} file(s):`);
    for (const f of orphaned) console.log(`- ${f}`);
    return;
  }

  let deleted = 0;
  for (const f of orphaned) {
    const abs = path.join(siteDir, f);
    try {
      fs.unlinkSync(abs);
      deleted += 1;
    } catch (e) {
      console.warn(`Failed to delete ${f}: ${e && e.message ? e.message : e}`);
    }
  }

  console.log(`Deleted ${deleted}/${orphaned.length} orphaned file(s).`);
}

main();
