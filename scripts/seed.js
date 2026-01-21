/* eslint-disable no-console */

require('dotenv').config();

const { getDb } = require('../src/db/db');
const inventoryRepo = require('../src/repositories/inventoryRepo');
const promoRepo = require('../src/repositories/promoRepo');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    reset: args.has('--reset') || args.has('-r'),
  };
}

function resetDb(db) {
  // FK order: child tables first
  db.exec(`
    DELETE FROM payment_events;
    DELETE FROM order_status_history;
    DELETE FROM order_items;
    DELETE FROM order_promos;
    DELETE FROM offline_bank_transfers;
    DELETE FROM orders;
    DELETE FROM promo_codes;
    DELETE FROM users;
    DELETE FROM inventory;
  `);
}

function seedProducts() {
  const existing = inventoryRepo.countAdmin({ q: null, includeArchived: true });
  if (existing > 0) {
    console.log(`[seed] inventory already has ${existing} product(s); skipping product seed`);
    return;
  }

  const products = [
    {
      name: 'TCN Spiral Coil 6mm – Standard',
      description: 'Replacement spiral coil for TCN vending machines. Standard 6mm pitch.',
      category: 'TCN_SPARE_PARTS',
      price: 3500,
      stock: 25,
    },
    {
      name: 'TCN Drop Sensor – V2',
      description: 'Drop sensor module compatible with common TCN series controllers.',
      category: 'TCN_SPARE_PARTS',
      price: 12900,
      stock: 10,
    },
    {
      name: 'TCN Door Lock Assembly',
      description: 'Complete lock set with keys. For front-door cabinet.',
      category: 'TCN_SPARE_PARTS',
      price: 8900,
      stock: 12,
    },
    {
      name: 'Post Mix Nozzle Set',
      description: 'Nozzle + diffuser set for post mix dispenser heads.',
      category: 'POST_MIX_DISPENSER_PARTS',
      price: 2200,
      stock: 40,
    },
    {
      name: 'Post Mix Solenoid Valve 24V',
      description: '24V solenoid valve for syrup/water control. Verify fittings before install.',
      category: 'POST_MIX_DISPENSER_PARTS',
      price: 15800,
      stock: 8,
    },
    {
      name: 'Post Mix O-Ring Kit (Assorted)',
      description: 'Assorted food-grade O-rings for post mix maintenance.',
      category: 'POST_MIX_DISPENSER_PARTS',
      price: 2800,
      stock: 60,
    },
  ];

  for (const p of products) {
    inventoryRepo.create({
      ...p,
      visibility: true,
      archived: false,
      product_image: null,
    });
  }

  console.log(`[seed] created ${products.length} products`);
}

function seedPromos() {
  promoRepo.ensureDefaultPromo(10);
  console.log('[seed] ensured default promo code WELCOME10 (10% off)');
}

async function main() {
  const { reset } = parseArgs(process.argv);
  const db = getDb();

  if (reset) {
    resetDb(db);
    console.log('[seed] database reset complete');
  }

  seedPromos();
  seedProducts();

  console.log('[seed] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
