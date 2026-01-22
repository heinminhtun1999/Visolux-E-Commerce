const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const { env } = require('../config/env');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function optimizeAndSaveProductImage(inputPath, productId) {
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

async function optimizeAndSaveSlipImage(inputPath, orderId) {
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
  optimizeAndSaveSlipImage,
  optimizeAndSaveSiteImage,
  optimizeAndSaveSiteContentImage,
};
