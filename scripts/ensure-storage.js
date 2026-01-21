const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const root = process.cwd();

  ensureDir(path.join(root, 'storage', 'data'));

  // Product uploads
  ensureDir(path.join(root, 'storage', 'uploads', 'products'));

  // Bank slip uploads
  ensureDir(path.join(root, 'storage', 'uploads', 'slips'));

  // Temp uploads
  ensureDir(path.join(root, 'storage', 'uploads', 'tmp'));

  // Site/editor uploads
  ensureDir(path.join(root, 'storage', 'uploads', 'site'));
}

main();
