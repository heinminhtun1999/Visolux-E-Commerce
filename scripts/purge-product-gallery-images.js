/*
  Purge legacy product gallery images.

  Background:
  - Main product image is stored as /uploads/products/product_<productId>.webp
  - Legacy gallery images were stored in product_images table with URLs like:
      /uploads/products/product_<productId>_<nonce>.webp
  - Variant images are stored as:
      /uploads/products/variant_<productId>_<variantId>_<nonce>.webp

  This script deletes only legacy gallery images and their DB rows.

  Usage:
    node scripts/purge-product-gallery-images.js --dry-run
    node scripts/purge-product-gallery-images.js --confirm
*/

const fs = require('fs');
const path = require('path');

const { getDb } = require('../src/db/db');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has('--dry-run') || (!args.has('--confirm')),
    confirm: args.has('--confirm'),
    verbose: args.has('--verbose'),
  };
}

function isLegacyGalleryUrl(url) {
  const s = String(url || '').trim();
  if (!s.startsWith('/uploads/products/')) return false;
  const file = path.posix.basename(s);

  // Main image: product_<id>.webp (do NOT delete)
  if (/^product_\d+\.webp$/i.test(file)) return false;

  // Variant image: variant_<pid>_<vid>_<nonce>.webp (do NOT delete)
  if (/^variant_\d+_\d+_[0-9a-f]{16}\.webp$/i.test(file)) return false;

  // Legacy gallery image: product_<pid>_<nonce>.webp (delete)
  if (/^product_\d+_[0-9a-f]{16}\.webp$/i.test(file)) return true;

  return false;
}

function resolveUploadPathFromUrl(url) {
  const s = String(url || '').trim();
  if (!s.startsWith('/uploads/products/')) return null;
  const file = path.posix.basename(s);
  return path.join(process.cwd(), 'storage', 'uploads', 'products', file);
}

function main() {
  const args = parseArgs(process.argv);
  const db = getDb();

  const rows = db
    .prepare('SELECT id, product_id, image_url FROM product_images ORDER BY product_id ASC, id ASC')
    .all();

  const candidates = rows.filter((r) => isLegacyGalleryUrl(r.image_url));

  const summary = {
    totalRows: rows.length,
    candidateRows: candidates.length,
    filesDeleted: 0,
    dbRowsDeleted: 0,
    filesMissing: 0,
  };

  console.log(`product_images rows: ${summary.totalRows}`);
  console.log(`legacy gallery candidates: ${summary.candidateRows}`);
  console.log(args.dryRun ? 'Mode: DRY RUN (no changes)' : 'Mode: CONFIRM (will delete)');

  if (!candidates.length) {
    console.log('Nothing to purge.');
    return;
  }

  const deleteStmt = db.prepare('DELETE FROM product_images WHERE id=?');

  const tx = db.transaction(() => {
    for (const r of candidates) {
      const url = String(r.image_url || '').trim();
      const fullPath = resolveUploadPathFromUrl(url);

      if (args.verbose) {
        console.log(`- candidate #${r.id} product ${r.product_id}: ${url}`);
      }

      if (args.dryRun) continue;

      if (fullPath) {
        try {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            summary.filesDeleted += 1;
          } else {
            summary.filesMissing += 1;
          }
        } catch (_) {
          // keep going
        }
      }

      try {
        deleteStmt.run(r.id);
        summary.dbRowsDeleted += 1;
      } catch (_) {
        // keep going
      }
    }
  });

  tx();

  console.log('---');
  console.log(`DB rows deleted: ${summary.dbRowsDeleted}`);
  console.log(`Files deleted: ${summary.filesDeleted}`);
  console.log(`Files missing: ${summary.filesMissing}`);

  if (args.dryRun) {
    console.log('Run again with --confirm to apply deletions.');
  }
}

main();
