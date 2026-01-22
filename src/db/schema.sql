-- SQLite schema for Visolux embedded e-commerce
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory (
  product_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Sanitized HTML version of description (used for rich text display)
  description_html TEXT NOT NULL DEFAULT '',
  -- Category slug (managed via categories table)
  category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 100), -- stored in cents (min RM 1.00)
  stock INTEGER NOT NULL CHECK (stock >= 0),
  availability INTEGER NOT NULL DEFAULT 0 CHECK (availability IN (0,1)),
  visibility INTEGER NOT NULL DEFAULT 1 CHECK (visibility IN (0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  product_image TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Additional product images (gallery)
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES inventory(product_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order, id);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  image_url TEXT,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Configurable sections per category (supports markdown)
CREATE TABLE IF NOT EXISTS category_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  title TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Category indexes/triggers are created in code (see db.js) to be migration-safe
-- for older DB files that may not yet have the newest columns.

-- Enforce minimum price even on existing DBs where table CHECK cannot be altered.
CREATE TRIGGER IF NOT EXISTS trg_inventory_price_min_insert
BEFORE INSERT ON inventory
WHEN NEW.price < 100
BEGIN
  SELECT RAISE(ABORT, 'Price must be at least RM 1.00');
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_price_min_update
BEFORE UPDATE OF price ON inventory
WHEN NEW.price < 100
BEGIN
  SELECT RAISE(ABORT, 'Price must be at least RM 1.00');
END;

CREATE INDEX IF NOT EXISTS idx_inventory_list ON inventory(archived, visibility, availability, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory(name);

CREATE TRIGGER IF NOT EXISTS trg_inventory_availability_insert
AFTER INSERT ON inventory
BEGIN
  UPDATE inventory
  SET availability = CASE WHEN NEW.stock > 0 THEN 1 ELSE 0 END,
      updated_at = datetime('now')
  WHERE product_id = NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_availability_update_stock
AFTER UPDATE OF stock ON inventory
BEGIN
  UPDATE inventory
  SET availability = CASE WHEN NEW.stock > 0 THEN 1 ELSE 0 END,
      updated_at = datetime('now')
  WHERE product_id = NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_updated_at
AFTER UPDATE ON inventory
BEGIN
  UPDATE inventory SET updated_at = datetime('now') WHERE product_id = NEW.product_id;
END;

CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postcode TEXT,
  password_reset_token_hash TEXT,
  password_reset_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Simple key-value settings store (admin-configurable site settings)
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
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
);

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  price_snapshot INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES inventory(product_id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Per-line-item refunds (supports partial refunds per product)
CREATE TABLE IF NOT EXISTS order_item_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity_refunded INTEGER NOT NULL CHECK (quantity_refunded > 0),
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
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES inventory(product_id)
);

CREATE INDEX IF NOT EXISTS idx_order_item_refunds_order ON order_item_refunds(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_item_refunds_item ON order_item_refunds(order_item_id);

-- Order-level refunds (e.g., shipping / adjustment refunds)
CREATE TABLE IF NOT EXISTS order_refunds (
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
);

CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON order_refunds(order_id, created_at);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status_type TEXT NOT NULL CHECK (status_type IN ('PAYMENT','FULFILMENT')),
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, changed_at);

CREATE TABLE IF NOT EXISTS offline_bank_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  bank_name TEXT NOT NULL,
  reference_number TEXT NOT NULL,
  slip_image_path TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  slip_deleted INTEGER NOT NULL DEFAULT 0 CHECK (slip_deleted IN (0,1)),
  slip_deleted_at TEXT,
  slip_rejection_reason TEXT,
  slip_rejected_at TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

-- Minimal promo code system
CREATE TABLE IF NOT EXISTS promo_codes (
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
);

CREATE TABLE IF NOT EXISTS order_promos (
  order_id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  percent_off INTEGER,
  amount_off_cents INTEGER,
  discount_amount INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (code) REFERENCES promo_codes(code)
);

-- Indexes for promo codes are created in code (see db.js) to be migration-safe
-- for older DB files that may not yet have the newest columns.

-- Payment callback idempotency + replay protection support
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_txn_id TEXT,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  UNIQUE(provider, provider_txn_id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

-- In-app admin notifications (shown only when admin is logged in)
CREATE TABLE IF NOT EXISTS admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_read_created ON admin_notifications(read_at, created_at);
