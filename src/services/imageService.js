const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const { env } = require('../config/env');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureAllowedImageSignature(inputPath) {
  const fd = fs.openSync(inputPath, 'r');
  try {
    const header = Buffer.alloc(12);
    const bytes = fs.readSync(fd, header, 0, header.length, 0);
    if (bytes < 12) {
      const err = new Error('Unsupported image format');
      err.status = 400;
      throw err;
    }

    const isPng = header.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isWebp = header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';

    if (!isPng && !isJpeg && !isWebp) {
      const err = new Error('Unsupported image format');
      err.status = 400;
      throw err;
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function optimizeAndSaveProductImage(inputPath, productId) {
  ensureAllowedImageSignature(inputPath);
  const outDir = path.join(process.cwd(), 'storage', 'uploads', 'products');
  ensureDir(outDir);

  const fileName = `product_${productId}.webp`;
  const outPath = path.join(outDir, fileName);

  await sharp(inputPath)
    .rotate()
    .resize({ width: env.productImageMaxWidth, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);

  return `/uploads/products/${fileName}`;
}

async function optimizeAndSaveProductGalleryImage(inputPath, productId) {
  ensureAllowedImageSignature(inputPath);
  const outDir = path.join(process.cwd(), 'storage', 'uploads', 'products');
  ensureDir(outDir);

  const nonce = crypto.randomBytes(8).toString('hex');
  const fileName = `product_${productId}_${nonce}.webp`;
  const outPath = path.join(outDir, fileName);

  await sharp(inputPath)
    .rotate()
    .resize({ width: env.productImageMaxWidth, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);

  return `/uploads/products/${fileName}`;
}

async function optimizeAndSaveVariantImage(inputPath, { productId, variantId }) {
  ensureAllowedImageSignature(inputPath);
  const outDir = path.join(process.cwd(), 'storage', 'uploads', 'products');
  ensureDir(outDir);

  const nonce = crypto.randomBytes(8).toString('hex');
  const fileName = `variant_${productId}_${variantId}_${nonce}.webp`;
  const outPath = path.join(outDir, fileName);

  await sharp(inputPath)
    .rotate()
    .resize({ width: env.productImageMaxWidth, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);

  return `/uploads/products/${fileName}`;
}

async function optimizeAndSaveSlipImage(inputPath, orderId) {
  ensureAllowedImageSignature(inputPath);
  const outDir = path.join(process.cwd(), 'storage', 'uploads', 'slips');
  ensureDir(outDir);

  const nonce = require('crypto').randomBytes(8).toString('hex');
  const fileName = `slip_order_${orderId}_${nonce}.webp`;
  const outPath = path.join(outDir, fileName);

  // Strip metadata by default with sharp when re-encoding.
  await sharp(inputPath)
    .rotate()
    .resize({ width: env.slipImageMaxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outPath);

  return `/uploads/slips/${fileName}`;
}

async function optimizeAndSaveSiteImage(inputPath, key) {
  ensureAllowedImageSignature(inputPath);
  const outDir = path.join(process.cwd(), 'storage', 'uploads', 'site');
  ensureDir(outDir);

  const safeKey = String(key || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'site';
  const fileName = `site_${safeKey}.webp`;
  const outPath = path.join(outDir, fileName);

  await sharp(inputPath)
    .rotate()
    .resize({ width: env.productImageMaxWidth, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);

  return `/uploads/site/${fileName}`;
}

async function optimizeAndSaveSiteContentImage(inputPath, key) {
  ensureAllowedImageSignature(inputPath);
  const outDir = path.join(process.cwd(), 'storage', 'uploads', 'site');
  ensureDir(outDir);

  const safeKey = String(key || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'content';
  const nonce = require('crypto').randomBytes(8).toString('hex');
  const fileName = `site_${safeKey}_${nonce}.webp`;
  const outPath = path.join(outDir, fileName);

  await sharp(inputPath)
    .rotate()
    .resize({ width: env.productImageMaxWidth, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);

  return `/uploads/site/${fileName}`;
}

module.exports = {
  optimizeAndSaveProductImage,
  optimizeAndSaveProductGalleryImage,
  optimizeAndSaveVariantImage,
  optimizeAndSaveSlipImage,
  optimizeAndSaveSiteImage,
  optimizeAndSaveSiteContentImage,
};
