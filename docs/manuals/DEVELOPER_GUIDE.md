# Visolux E‑Commerce — Developer Guide

**Audience:** Developers maintaining/deploying the app

**Purpose:** Architecture + flows + APIs + operational guidance for ongoing development.

---

## 1) Architecture overview

- **Runtime:** Node.js + Express 5
- **Rendering:** EJS (`views/`)
- **DB:** SQLite via `better-sqlite3`
- **Sessions:** `express-session` + `connect-sqlite3` store
- **Payments:** Fiuu hosted payment flow + callback/return verification + idempotency
- **Uploads:** `multer` temp + `sharp` optimization

Entry points:
- `src/server.js` boots the process.
- `src/app.js` wires middleware/routes.

---

## 2) Repository structure

- `src/`
  - `app.js`: express app wiring + middleware
  - `server.js`: server boot + crash logging
  - `config/env.js`: environment parsing and defaults
  - `db/db.js`: DB open, schema creation, lightweight migrations
  - `db/schema.sql`: canonical schema
  - `middleware/`: auth, csrf, errors, locals, uploads, validate
  - `repositories/`: DB access layer (SQL)
  - `services/`: business logic
  - `routes/`: HTTP controllers
  - `utils/`: helpers (money, markdown, order code, pagination, logging)
- `views/`: EJS templates
- `public/`: static assets
- `storage/`:
  - `data/`: SQLite DB files
  - `uploads/`: product/site images
  - `logs/`: PM2/app logs
- `scripts/`: maintenance scripts (seed, create-admin, docs)

---

## 3) Configuration (.env)

See `.env.example` for all settings.

Critical production settings:
- `NODE_ENV=production`
- `APP_BASE_URL=https://store.visolux.com.my`
- `TRUST_PROXY=1` (behind Nginx)
- `SECURE_COOKIES=true` (HTTPS)
- `SESSION_SECRET=<long random>`

Payments:
- FIUU vars: `FIUU_MERCHANT_ID`, `FIUU_VERIFY_KEY`, `FIUU_SECRET_KEY`, `FIUU_GATEWAY_URL`

---

## 4) Database model

Schema lives in `src/db/schema.sql`.

Key tables:
- Catalog: `inventory`, `categories`, `category_sections`
- Users: `users`
- Orders: `orders`, `order_items`, `order_status_history`
- Offline slips: `offline_bank_transfers`
- Promos: `promo_codes`, `order_promos`
- Idempotency: `payment_events`
- Refunds: `order_refunds`, `order_item_refunds`
- Settings: `site_settings`

Cents convention:
- Money values stored as integers in cents.

---

## 5) HTTP routes / API surface

### 5.1 Public storefront (`src/routes/shop.js`)
- `GET /` (home)
- `GET /products` (search/filter/pagination)
- `GET /products/:id`
- `GET /cart`
- `POST /cart/add`
- `POST /cart/update`
- `POST /cart/remove`
- `POST /cart/clear`
- Site pages:
  - `GET /privacy`
  - `GET /terms`
  - `GET /how-to-order`

### 5.2 Auth (`src/routes/auth.js`)
- `GET /login`, `POST /login`
- `GET /register`, `POST /register`
- `POST /logout`
- `GET /account`
- `POST /account/profile`
- `POST /account/password`
- Password reset:
  - `GET /forgot-password`, `POST /forgot-password`
  - `GET /reset-password`, `POST /reset-password`

### 5.3 Orders (`src/routes/orders.js`)
- `GET /checkout`
- `POST /checkout/promo-check`
- `POST /checkout`
- `GET /orders/:id`
- `GET /orders/:id/confirmation`
- `GET /orders/history`
- Offline transfer:
  - `GET /orders/:id/offline-transfer`
  - `POST /orders/:id/offline-transfer` (slip upload)

### 5.4 Payments (`src/routes/payments.js`)
- `POST /payment/callback`
- `GET|POST /payment/return`
- `GET /payment/cancel`
- Refund notify:
  - `POST /payment/refund/notify`

### 5.5 Uploads (`src/routes/uploads.js`)
- Product and site uploads used by admin tooling.

### 5.6 Admin (`src/routes/admin.js`)
- `GET /admin/products` + CRUD
- `GET /admin/orders` + order management
- Slips queue + approve/reject
- Refund initiation
- `GET /admin/categories` + CRUD and home layout
- `GET /admin/settings` (branding, shipping, promos, footer/pages)
- `GET /admin/notifications`
- `GET /admin/reports/sales` (+ CSV)

---

## 6) Core flows (implementation notes)

### 6.1 Order placement
- Order is created first.
- Payment is confirmed later (online callback/return OR offline slip approval).

### 6.2 Payment idempotency
- Incoming gateway events are recorded into `payment_events`.
- Unique constraints prevent double-processing.

### 6.3 Stock deduction
- Deduct stock only when payment is confirmed.
- Done inside a SQLite transaction with conditional updates.

### 6.4 Refunds
- Refund records are created first; later notify callback may update status.
- FPX refunds are blocked by business rules.

---

## 7) Security middleware

- `helmet` CSP configured for iframe embedding (`frame-ancestors`).
- Custom CSRF:
  - Sets token cookie
  - Exempts payment callback/return endpoints
- Rate limiting:
  - configurable via env
  - skips health check and gateway callbacks

---

## 8) Logging & observability

- Structured JSON logs via `pino` wrapper (`src/utils/logger.js`).
- Express error handler logs request context.
- Process crash logging for:
  - `unhandledRejection`
  - `uncaughtException`

Operational endpoints:
- `GET /healthz` checks DB reachability.

---

## 9) Deployment

### 9.1 Process manager
- PM2 config: `ecosystem.config.cjs`
- Logs:
  - `storage/logs/pm2-out.log`
  - `storage/logs/pm2-error.log`

### 9.2 GitHub Actions deploy
Workflow: `.github/workflows/deploy-hostinger-vps.yml`

Key behavior:
- rsync deploy excludes:
  - `.env`
  - SQLite DB files
  - uploads
- pre-deploy backup to `${VPS_PATH}/backups`
- post-restart `/healthz` validation

### 9.3 Nginx
Nginx should proxy HTTPS to `127.0.0.1:$PORT` and forward headers.

---

## 10) Development workflow

- `npm run dev` for local development.
- `npm run seed -- --reset` to create demo data.
- `npm run create-admin -- ...` to create users.

---

## 11) Extension points

- Add new pages via `site_settings` keys + rendering.
- Add new admin modules under `/admin` with `requireAdmin`.
- Add new payment channels by extending the payment service layer.
