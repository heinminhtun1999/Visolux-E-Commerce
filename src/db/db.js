const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { env } = require('../config/env');
const { backfillOrderCodes } = require('../utils/orderCode');

let db;

function getDb() {
  if (db) return db;

  const dbPath = path.resolve(env.sqlitePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  initializeSchema(db);
  return db;
}

function initializeSchema(database) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  database.exec(schema);

  // Lightweight migrations for existing DB files.
  ensureUsersPasswordReset(database);
  ensureUsersAddressColumns(database);
  ensureUsersAccountClosure(database);
  ensureSiteSettings(database);
  ensureOrdersOrderCode(database);
  ensureOrdersRefundStatus(database);
  ensureOrdersDeliveryAddressColumns(database);
  ensureOrdersPricingColumns(database);
  ensureOrdersPaymentChannel(database);
  ensureOrdersPaymentStatusEnum(database);
  ensureOrdersAdminNote(database);
  ensureOrdersOfflineTransferRecipient(database);
  ensureOrdersOnlinePaymentSnapshot(database);
  ensureOrderItemRefunds(database);
  ensureOrderItemRefundGatewayColumns(database);
  ensureOrderRefunds(database);
  ensureOrderRefundGatewayColumns(database);
  ensureAdminNotifications(database);
  ensureOfflineTransferPurge(database);
  ensureOfflineTransferRejection(database);
  ensurePromoCodesV2(database);
  ensurePromoCodesShippingFlag(database);
  ensureCategories(database);
  ensureCategorySections(database);
  ensureInventoryCategoryIsFlexible(database);
  ensureInventoryDescriptionHtml(database);
  ensureInventoryCostAndDimensions(database);
  ensureProductImages(database);
  ensureContactMessages(database);
  seedCategoriesFromInventory(database);
  // Backfill is best-effort; existing orders fall back to order_id in UI if needed.
  backfillOrderCodes(database);
}

function ensureInventoryDescriptionHtml(database) {
  const cols = database.prepare("PRAGMA table_info('inventory')").all();
  const has = (name) => cols.some((c) => c.name === name);
  if (!has('description_html')) {
    database.exec("ALTER TABLE inventory ADD COLUMN description_html TEXT NOT NULL DEFAULT ''");
  }
}

function ensureInventoryCostAndDimensions(database) {
  const cols = database.prepare("PRAGMA table_info('inventory')").all();
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('cost_price')) {
    database.exec('ALTER TABLE inventory ADD COLUMN cost_price INTEGER');
  }
  if (!has('weight_kg')) {
    database.exec('ALTER TABLE inventory ADD COLUMN weight_kg REAL');
  }
  if (!has('height_cm')) {
    database.exec('ALTER TABLE inventory ADD COLUMN height_cm REAL');
  }
  if (!has('length_cm')) {
    database.exec('ALTER TABLE inventory ADD COLUMN length_cm REAL');
  }
  if (!has('width_cm')) {
    database.exec('ALTER TABLE inventory ADD COLUMN width_cm REAL');
  }
}

function ensureProductImages(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES inventory(product_id) ON DELETE CASCADE
    )`
  );
  database.exec('CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order, id)');
}

function ensureUsersAccountClosure(database) {
  const cols = database.prepare("PRAGMA table_info('users')").all();
  const has = (name) => cols.some((c) => c.name === name);
  if (!has('is_closed')) {
    // Keep migration simple for older SQLite versions.
    database.exec("ALTER TABLE users ADD COLUMN is_closed INTEGER NOT NULL DEFAULT 0");
  }
  if (!has('closed_at')) {
    database.exec('ALTER TABLE users ADD COLUMN closed_at TEXT');
  }
}

function ensureContactMessages(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      location TEXT,
      message TEXT NOT NULL,
      page_url TEXT,
      ip TEXT,
      user_agent TEXT,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  database.exec('CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(is_read, created_at)');
}

function ensureCategorySections(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS category_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      title TEXT,
      body_md TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`
  );

  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_category_sections_cat ON category_sections(category_id, active, sort_order, id)'
  );
  database.exec(
    `CREATE TRIGGER IF NOT EXISTS trg_category_sections_updated_at
     AFTER UPDATE ON category_sections
     BEGIN
       UPDATE category_sections SET updated_at = datetime('now') WHERE id = NEW.id;
     END;`
  );
}

function ensurePromoCodesV2(database) {
  // If promo_codes is still the legacy (percent_off NOT NULL with CHECK), rebuild.
  const promoCols = database.prepare("PRAGMA table_info('promo_codes')").all();
  const hasPromo = (name) => promoCols.some((c) => c.name === name);
  const needsPromoUpgrade = promoCols.length > 0 && !hasPromo('discount_type');

  const orderPromoCols = database.prepare("PRAGMA table_info('order_promos')").all();
  const hasOrderPromo = (name) => orderPromoCols.some((c) => c.name === name);
  const needsOrderPromoUpgrade = orderPromoCols.length > 0 && !hasOrderPromo('discount_type');

  if (!needsPromoUpgrade && !needsOrderPromoUpgrade) {
    // Index creation must be guarded for older DBs that haven't been upgraded yet.
    // When promo_codes doesn't exist yet, the schema.sql CREATE TABLE will run.
    if (promoCols.length === 0 || hasPromo('archived')) {
      database.exec('CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(archived, active, code)');
    }
    return;
  }

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    if (needsPromoUpgrade) {
      database.exec(
        `CREATE TABLE promo_codes_new (
          code TEXT PRIMARY KEY,
          discount_type TEXT NOT NULL DEFAULT 'PERCENT' CHECK (discount_type IN ('PERCENT','FIXED')),
          percent_off INTEGER CHECK (percent_off BETWEEN 1 AND 100),
          amount_off_cents INTEGER CHECK (amount_off_cents > 0),
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
          max_redemptions INTEGER,
          redeemed_count INTEGER NOT NULL DEFAULT 0,
          start_date TEXT,
          end_date TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      );

      // Migrate percent-only promos.
      database.exec(
        `INSERT INTO promo_codes_new (code, discount_type, percent_off, amount_off_cents, active, archived, max_redemptions, redeemed_count, start_date, end_date, created_at)
         SELECT code, 'PERCENT', percent_off, NULL, active, 0, max_redemptions, redeemed_count, NULL, NULL, created_at
         FROM promo_codes`
      );

      database.exec('DROP TABLE promo_codes');
      database.exec('ALTER TABLE promo_codes_new RENAME TO promo_codes');
    }

    if (needsOrderPromoUpgrade) {
      database.exec(
        `CREATE TABLE order_promos_new (
          order_id INTEGER PRIMARY KEY,
          code TEXT NOT NULL,
          discount_type TEXT NOT NULL,
          percent_off INTEGER,
          amount_off_cents INTEGER,
          discount_amount INTEGER NOT NULL,
          FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
          FOREIGN KEY (code) REFERENCES promo_codes(code)
        )`
      );

      database.exec(
        `INSERT INTO order_promos_new (order_id, code, discount_type, percent_off, amount_off_cents, discount_amount)
         SELECT order_id, code, 'PERCENT', percent_off, NULL, discount_amount
         FROM order_promos`
      );

      database.exec('DROP TABLE order_promos');
      database.exec('ALTER TABLE order_promos_new RENAME TO order_promos');
    }

    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }

  // Create index after upgrade.
  database.exec('CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(archived, active, code)');
}

function ensurePromoCodesShippingFlag(database) {
  const promoCols = database.prepare("PRAGMA table_info('promo_codes')").all();
  const hasPromo = (name) => promoCols.some((c) => c.name === name);
  if (promoCols.length && !hasPromo('applies_to_shipping')) {
    database.exec('ALTER TABLE promo_codes ADD COLUMN applies_to_shipping INTEGER NOT NULL DEFAULT 0');
  }

  const orderPromoCols = database.prepare("PRAGMA table_info('order_promos')").all();
  const hasOrderPromo = (name) => orderPromoCols.some((c) => c.name === name);
  if (orderPromoCols.length && !hasOrderPromo('applies_to_shipping')) {
    database.exec('ALTER TABLE order_promos ADD COLUMN applies_to_shipping INTEGER NOT NULL DEFAULT 0');
  }
}

function ensureOrdersOnlinePaymentSnapshot(database) {
  const cols = database.prepare("PRAGMA table_info('orders')").all();
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('online_payment_provider')) {
    database.exec('ALTER TABLE orders ADD COLUMN online_payment_provider TEXT');
  }
  if (!has('online_payment_account_id')) {
    database.exec('ALTER TABLE orders ADD COLUMN online_payment_account_id TEXT');
  }
  if (!has('online_payment_merchant_id')) {
    database.exec('ALTER TABLE orders ADD COLUMN online_payment_merchant_id TEXT');
  }
  if (!has('online_payment_verify_key')) {
    database.exec('ALTER TABLE orders ADD COLUMN online_payment_verify_key TEXT');
  }
  if (!has('online_payment_secret_key')) {
    database.exec('ALTER TABLE orders ADD COLUMN online_payment_secret_key TEXT');
  }
  if (!has('online_payment_gateway_url')) {
    database.exec('ALTER TABLE orders ADD COLUMN online_payment_gateway_url TEXT');
  }
  if (!has('online_payment_currency')) {
    database.exec('ALTER TABLE orders ADD COLUMN online_payment_currency TEXT');
  }
}

function ensureCategories(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      image_url TEXT,
      visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  const cols = database.prepare("PRAGMA table_info('categories')").all();
  const has = (name) => cols.some((c) => c.name === name);
  const needsRebuild =
    cols.length > 0 &&
    (!has('archived') || !has('visible') || !has('sort_order') || !has('created_at') || !has('updated_at'));

  if (needsRebuild) {
    database.exec('PRAGMA foreign_keys = OFF');
    database.exec('BEGIN');
    try {
      database.exec('DROP TRIGGER IF EXISTS trg_categories_updated_at');
      database.exec('DROP INDEX IF EXISTS idx_categories_public');
      database.exec('DROP INDEX IF EXISTS idx_categories_slug');

      database.exec(
        `CREATE TABLE categories_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          image_url TEXT,
          visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      );

      const selImage = has('image_url') ? 'image_url' : 'NULL as image_url';
      const selVisible = has('visible') ? 'visible' : '1 as visible';
      const selArchived = has('archived') ? 'archived' : '0 as archived';
      const selSort = has('sort_order') ? 'sort_order' : '0 as sort_order';
      const selCreatedAt = has('created_at') ? 'created_at' : "datetime('now') as created_at";
      const selUpdatedAt = has('updated_at') ? 'updated_at' : "datetime('now') as updated_at";

      database.exec(
        `INSERT INTO categories_new (id, slug, name, image_url, visible, archived, sort_order, created_at, updated_at)
         SELECT id, slug, name, ${selImage}, ${selVisible}, ${selArchived}, ${selSort}, ${selCreatedAt}, ${selUpdatedAt}
         FROM categories`
      );

      database.exec('DROP TABLE categories');
      database.exec('ALTER TABLE categories_new RENAME TO categories');
      database.exec('COMMIT');
    } catch (e) {
      database.exec('ROLLBACK');
      throw e;
    } finally {
      database.exec('PRAGMA foreign_keys = ON');
    }
  } else if (!has('image_url')) {
    database.exec('ALTER TABLE categories ADD COLUMN image_url TEXT');
  }

  database.exec('CREATE INDEX IF NOT EXISTS idx_categories_public ON categories(archived, visible, sort_order, name)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)');
  database.exec(
    `CREATE TRIGGER IF NOT EXISTS trg_categories_updated_at
     AFTER UPDATE ON categories
     BEGIN
       UPDATE categories SET updated_at = datetime('now') WHERE id = NEW.id;
     END;`
  );

  // Seed defaults (legacy categories) if empty.
  const count = database.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (count === 0) {
    const insert = database.prepare(
      `INSERT INTO categories (slug, name, visible, archived, sort_order)
       VALUES (@slug, @name, 1, 0, @sort_order)`
    );
    insert.run({ slug: 'TCN_SPARE_PARTS', name: 'TCN Spare Parts', sort_order: 10 });
    insert.run({ slug: 'POST_MIX_DISPENSER_PARTS', name: 'Post Mix Dispenser Parts', sort_order: 20 });
  }
}

function ensureInventoryCategoryIsFlexible(database) {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory'")
    .get();
  const sql = String(row?.sql || '');
  const hasLegacyCheck = sql.includes("CHECK (category IN (");
  if (!hasLegacyCheck) return;

  // Rebuild inventory table to remove the hard-coded category CHECK constraint.
  // This is required for dynamic categories.
  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    database.exec('DROP TRIGGER IF EXISTS trg_inventory_price_min_insert');
    database.exec('DROP TRIGGER IF EXISTS trg_inventory_price_min_update');
    database.exec('DROP TRIGGER IF EXISTS trg_inventory_availability_insert');
    database.exec('DROP TRIGGER IF EXISTS trg_inventory_availability_update_stock');
    database.exec('DROP TRIGGER IF EXISTS trg_inventory_updated_at');
    database.exec('DROP INDEX IF EXISTS idx_inventory_list');
    database.exec('DROP INDEX IF EXISTS idx_inventory_name');

    database.exec(
      `CREATE TABLE inventory_new (
        product_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        price INTEGER NOT NULL CHECK (price >= 100),
        stock INTEGER NOT NULL CHECK (stock >= 0),
        availability INTEGER NOT NULL DEFAULT 0 CHECK (availability IN (0,1)),
        visibility INTEGER NOT NULL DEFAULT 1 CHECK (visibility IN (0,1)),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        product_image TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );

    database.exec(
      `INSERT INTO inventory_new (product_id, name, description, category, price, stock, availability, visibility, archived, product_image, created_at, updated_at)
       SELECT product_id, name, description, category, price, stock, availability, visibility, archived, product_image, created_at, updated_at
       FROM inventory`
    );

    database.exec('DROP TABLE inventory');
    database.exec('ALTER TABLE inventory_new RENAME TO inventory');

    // Re-create indexes and triggers.
    database.exec('CREATE INDEX IF NOT EXISTS idx_inventory_list ON inventory(archived, visibility, availability, created_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory(name)');

    database.exec(
      `CREATE TRIGGER IF NOT EXISTS trg_inventory_price_min_insert
       BEFORE INSERT ON inventory
       WHEN NEW.price < 100
       BEGIN
         SELECT RAISE(ABORT, 'Price must be at least RM 1.00');
       END;`
    );
    database.exec(
      `CREATE TRIGGER IF NOT EXISTS trg_inventory_price_min_update
       BEFORE UPDATE OF price ON inventory
       WHEN NEW.price < 100
       BEGIN
         SELECT RAISE(ABORT, 'Price must be at least RM 1.00');
       END;`
    );
    database.exec(
      `CREATE TRIGGER IF NOT EXISTS trg_inventory_availability_insert
       AFTER INSERT ON inventory
       BEGIN
         UPDATE inventory
         SET availability = CASE WHEN NEW.stock > 0 THEN 1 ELSE 0 END,
             updated_at = datetime('now')
         WHERE product_id = NEW.product_id;
       END;`
    );
    database.exec(
      `CREATE TRIGGER IF NOT EXISTS trg_inventory_availability_update_stock
       AFTER UPDATE OF stock ON inventory
       BEGIN
         UPDATE inventory
         SET availability = CASE WHEN NEW.stock > 0 THEN 1 ELSE 0 END,
             updated_at = datetime('now')
         WHERE product_id = NEW.product_id;
       END;`
    );
    database.exec(
      `CREATE TRIGGER IF NOT EXISTS trg_inventory_updated_at
       AFTER UPDATE ON inventory
       BEGIN
         UPDATE inventory SET updated_at = datetime('now') WHERE product_id = NEW.product_id;
       END;`
    );

    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function seedCategoriesFromInventory(database) {
  // Ensure any category slugs already in inventory exist as categories.
  database.exec(
    `INSERT OR IGNORE INTO categories (slug, name, visible, archived, sort_order)
     SELECT DISTINCT category, category, 1, 0, 0
     FROM inventory
     WHERE category IS NOT NULL AND TRIM(category) <> ''`
  );

  // Apply friendly legacy names (if present).
  database.exec(
    `UPDATE categories SET name='TCN Spare Parts' WHERE slug='TCN_SPARE_PARTS' AND (name IS NULL OR name='' OR name='TCN_SPARE_PARTS')`
  );
  database.exec(
    `UPDATE categories SET name='Post Mix Dispenser Parts' WHERE slug='POST_MIX_DISPENSER_PARTS' AND (name IS NULL OR name='' OR name='POST_MIX_DISPENSER_PARTS')`
  );
}

function ensureSiteSettings(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
}

function ensureUsersPasswordReset(database) {
  const cols = database.prepare("PRAGMA table_info('users')").all();
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('password_reset_token_hash')) {
    database.exec('ALTER TABLE users ADD COLUMN password_reset_token_hash TEXT');
  }
  if (!has('password_reset_expires_at')) {
    database.exec('ALTER TABLE users ADD COLUMN password_reset_expires_at TEXT');
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_users_password_reset_token_hash ON users(password_reset_token_hash)');
}

function ensureUsersAddressColumns(database) {
  const cols = database.prepare("PRAGMA table_info('users')").all();
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('address_line1')) database.exec('ALTER TABLE users ADD COLUMN address_line1 TEXT');
  if (!has('address_line2')) database.exec('ALTER TABLE users ADD COLUMN address_line2 TEXT');
  if (!has('city')) database.exec('ALTER TABLE users ADD COLUMN city TEXT');
  if (!has('state')) database.exec('ALTER TABLE users ADD COLUMN state TEXT');
  if (!has('postcode')) database.exec('ALTER TABLE users ADD COLUMN postcode TEXT');
}

function ensureOrdersAdminNote(database) {
  const cols = database.prepare("PRAGMA table_info('orders')").all();
  const has = (name) => cols.some((c) => c.name === name);
  if (!has('admin_note')) {
    database.exec("ALTER TABLE orders ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
  }
}

function ensureOrdersOrderCode(database) {
  const cols = database.prepare("PRAGMA table_info('orders')").all();
  const hasOrderCode = cols.some((c) => c.name === 'order_code');
  if (!hasOrderCode) {
    database.exec('ALTER TABLE orders ADD COLUMN order_code TEXT');
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code)');
}

function ensureOrdersRefundStatus(database) {
  const cols = database.prepare("PRAGMA table_info('orders')").all();
  const hasRefundStatus = cols.some((c) => c.name === 'refund_status');
  if (!hasRefundStatus) {
    database.exec("ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'NONE'");
  }
}

function ensureOrdersDeliveryAddressColumns(database) {
  const cols = database.prepare("PRAGMA table_info('orders')").all();
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('delivery_address_line1')) database.exec('ALTER TABLE orders ADD COLUMN delivery_address_line1 TEXT');
  if (!has('delivery_address_line2')) database.exec('ALTER TABLE orders ADD COLUMN delivery_address_line2 TEXT');
  if (!has('delivery_city')) database.exec('ALTER TABLE orders ADD COLUMN delivery_city TEXT');
  if (!has('delivery_state')) database.exec('ALTER TABLE orders ADD COLUMN delivery_state TEXT');
  if (!has('delivery_postcode')) database.exec('ALTER TABLE orders ADD COLUMN delivery_postcode TEXT');
  if (!has('delivery_region')) database.exec("ALTER TABLE orders ADD COLUMN delivery_region TEXT");
}

function ensureOrdersPricingColumns(database) {
  const cols = database.prepare("PRAGMA table_info('orders')").all();
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('items_subtotal')) database.exec('ALTER TABLE orders ADD COLUMN items_subtotal INTEGER NOT NULL DEFAULT 0');
  if (!has('discount_amount')) database.exec('ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0');
  if (!has('shipping_fee')) database.exec('ALTER TABLE orders ADD COLUMN shipping_fee INTEGER NOT NULL DEFAULT 0');
}

function ensureOrdersPaymentChannel(database) {
  const cols = database.prepare("PRAGMA table_info('orders')").all();
  const has = (name) => cols.some((c) => c.name === name);
  if (!has('payment_channel')) database.exec('ALTER TABLE orders ADD COLUMN payment_channel TEXT');
}

function ensureOrdersPaymentStatusEnum(database) {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'")
    .get();
  const sql = String(row?.sql || '');
  const hasPartiallyRefunded = sql.includes("'PARTIALLY_REFUNDED'");
  if (hasPartiallyRefunded) return;

  // Rebuild orders table to update the CHECK constraint (SQLite can't ALTER CHECK).
  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    database.exec('DROP INDEX IF EXISTS idx_orders_user_created');
    database.exec('DROP INDEX IF EXISTS idx_orders_payment_status');
    database.exec('DROP INDEX IF EXISTS idx_orders_order_code');

    database.exec(
      `CREATE TABLE orders_new (
        order_id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT,
        user_id INTEGER,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        address TEXT NOT NULL,
        delivery_address_line1 TEXT,
        delivery_address_line2 TEXT,
        delivery_city TEXT,
        delivery_state TEXT,
        delivery_postcode TEXT,
        delivery_region TEXT CHECK (delivery_region IN ('WEST','EAST')),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('ONLINE', 'OFFLINE_TRANSFER')),
        payment_channel TEXT,
        payment_status TEXT NOT NULL CHECK (payment_status IN ('PENDING','PAID','FAILED','PARTIALLY_REFUNDED','REFUNDED','AWAITING_VERIFICATION')),
        refund_status TEXT NOT NULL DEFAULT 'NONE' CHECK (refund_status IN ('NONE','PARTIAL_REFUND','FULL_REFUND')),
        fulfilment_status TEXT NOT NULL CHECK (fulfilment_status IN ('NEW','PROCESSING','SHIPPED','COMPLETED','CANCELLED')),
        items_subtotal INTEGER NOT NULL DEFAULT 0 CHECK (items_subtotal >= 0),
        discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
        shipping_fee INTEGER NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
        total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )`
    );

    database.exec(
      `INSERT INTO orders_new (
        order_id, order_code, user_id, customer_name, phone, email, address,
        delivery_address_line1, delivery_address_line2, delivery_city, delivery_state, delivery_postcode, delivery_region,
        payment_method, payment_channel, payment_status, refund_status, fulfilment_status,
        items_subtotal, discount_amount, shipping_fee, total_amount, created_at
      )
      SELECT
        order_id, order_code, user_id, customer_name, phone, email, address,
        delivery_address_line1, delivery_address_line2, delivery_city, delivery_state, delivery_postcode, delivery_region,
        payment_method, payment_channel,
        CASE WHEN payment_status='REFUNDED' THEN 'REFUNDED' ELSE payment_status END,
        COALESCE(refund_status, 'NONE'),
        fulfilment_status,
        COALESCE(items_subtotal, 0), COALESCE(discount_amount, 0), COALESCE(shipping_fee, 0), total_amount, created_at
      FROM orders`
    );

    database.exec('DROP TABLE orders');
    database.exec('ALTER TABLE orders_new RENAME TO orders');

    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status, created_at)');

    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function ensureOrderItemRefunds(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS order_item_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity_refunded INTEGER NOT NULL CHECK (quantity_refunded > 0),
      amount_refunded INTEGER NOT NULL CHECK (amount_refunded >= 0),
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES inventory(product_id)
    )`
  );
  database.exec('CREATE INDEX IF NOT EXISTS idx_order_item_refunds_order ON order_item_refunds(order_id, created_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_order_item_refunds_item ON order_item_refunds(order_item_id)');
}

function ensureOrderItemRefundGatewayColumns(database) {
  const cols = database.prepare("PRAGMA table_info('order_item_refunds')").all();
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('provider')) database.exec('ALTER TABLE order_item_refunds ADD COLUMN provider TEXT');
  if (!has('provider_ref_id')) database.exec('ALTER TABLE order_item_refunds ADD COLUMN provider_ref_id TEXT');
  if (!has('provider_txn_id')) database.exec('ALTER TABLE order_item_refunds ADD COLUMN provider_txn_id TEXT');
  if (!has('provider_refund_id')) database.exec('ALTER TABLE order_item_refunds ADD COLUMN provider_refund_id TEXT');
  if (!has('provider_status')) database.exec('ALTER TABLE order_item_refunds ADD COLUMN provider_status TEXT');
  if (!has('provider_reason')) database.exec('ALTER TABLE order_item_refunds ADD COLUMN provider_reason TEXT');
  if (!has('provider_signature_ok')) database.exec('ALTER TABLE order_item_refunds ADD COLUMN provider_signature_ok INTEGER');
  if (!has('provider_response_json')) database.exec('ALTER TABLE order_item_refunds ADD COLUMN provider_response_json TEXT');
}

function ensureOrderRefunds(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS order_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      amount_refunded INTEGER NOT NULL CHECK (amount_refunded >= 0),
      reason TEXT,
      provider TEXT,
      provider_ref_id TEXT,
      provider_txn_id TEXT,
      provider_refund_id TEXT,
      provider_status TEXT,
      provider_reason TEXT,
      provider_signature_ok INTEGER,
      provider_response_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
    )`
  );
  database.exec('CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON order_refunds(order_id, created_at)');
}

function ensureOrderRefundGatewayColumns(database) {
  const cols = database.prepare("PRAGMA table_info('order_refunds')").all();
  if (!cols || cols.length === 0) return;
  const has = (name) => cols.some((c) => c.name === name);

  // These are all present in the current schema, but keep this for older DBs.
  if (!has('provider')) database.exec('ALTER TABLE order_refunds ADD COLUMN provider TEXT');
  if (!has('provider_ref_id')) database.exec('ALTER TABLE order_refunds ADD COLUMN provider_ref_id TEXT');
  if (!has('provider_txn_id')) database.exec('ALTER TABLE order_refunds ADD COLUMN provider_txn_id TEXT');
  if (!has('provider_refund_id')) database.exec('ALTER TABLE order_refunds ADD COLUMN provider_refund_id TEXT');
  if (!has('provider_status')) database.exec('ALTER TABLE order_refunds ADD COLUMN provider_status TEXT');
  if (!has('provider_reason')) database.exec('ALTER TABLE order_refunds ADD COLUMN provider_reason TEXT');
  if (!has('provider_signature_ok')) database.exec('ALTER TABLE order_refunds ADD COLUMN provider_signature_ok INTEGER');
  if (!has('provider_response_json')) database.exec('ALTER TABLE order_refunds ADD COLUMN provider_response_json TEXT');
}

function ensureOrdersOfflineTransferRecipient(database) {
  const cols = database.prepare("PRAGMA table_info('orders')").all();
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('offline_transfer_bank')) {
    database.exec("ALTER TABLE orders ADD COLUMN offline_transfer_bank TEXT");
  }
  if (!has('offline_transfer_account_no')) {
    database.exec("ALTER TABLE orders ADD COLUMN offline_transfer_account_no TEXT");
  }
  if (!has('offline_transfer_account_name')) {
    database.exec("ALTER TABLE orders ADD COLUMN offline_transfer_account_name TEXT");
  }
}

function ensureAdminNotifications(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS admin_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    )`
  );
  database.exec('CREATE INDEX IF NOT EXISTS idx_admin_notifications_read_created ON admin_notifications(read_at, created_at)');
}

function ensureOfflineTransferPurge(database) {
  const cols = database.prepare("PRAGMA table_info('offline_bank_transfers')").all();
  const hasSlipDeleted = cols.some((c) => c.name === 'slip_deleted');
  if (!hasSlipDeleted) {
    database.exec('ALTER TABLE offline_bank_transfers ADD COLUMN slip_deleted INTEGER NOT NULL DEFAULT 0');
  }
  const hasSlipDeletedAt = cols.some((c) => c.name === 'slip_deleted_at');
  if (!hasSlipDeletedAt) {
    database.exec('ALTER TABLE offline_bank_transfers ADD COLUMN slip_deleted_at TEXT');
  }
}

function ensureOfflineTransferRejection(database) {
  const cols = database.prepare("PRAGMA table_info('offline_bank_transfers')").all();
  if (!cols || cols.length === 0) return;
  const has = (name) => cols.some((c) => c.name === name);
  if (!has('slip_rejection_reason')) {
    database.exec('ALTER TABLE offline_bank_transfers ADD COLUMN slip_rejection_reason TEXT');
  }
  if (!has('slip_rejected_at')) {
    database.exec('ALTER TABLE offline_bank_transfers ADD COLUMN slip_rejected_at TEXT');
  }
}

module.exports = { getDb };
