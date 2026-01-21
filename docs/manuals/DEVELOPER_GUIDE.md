# Visolux E‑Commerce — Developer Guide (Architecture + API)

**Audience:** Developers / maintainers

This guide documents the system structure, runtime behavior, database model, HTTP routes (“API”), payment flows, and operational practices.

---

## 1) Tech stack
- Node.js + Express 5
- EJS server-rendered views
- SQLite (`better-sqlite3`)
- Sessions: `express-session` + `connect-sqlite3`
- Validation: `zod`
- Security: `helmet` CSP + custom CSRF
- Payments: Fiuu hosted payment + callbacks
- Logging: structured JSON via `pino`

---

## 2) Code layout
- `src/server.js`: process boot, crash logging, starts HTTP listener
- `src/app.js`: middleware wiring, routes registration, `/healthz`
- `src/config/env.js`: env parsing/defaults
- `src/db/db.js`: SQLite open + schema load + migration-safe adjustments
- `src/db/schema.sql`: canonical schema
- `src/middleware/*`: auth, csrf, locals, errors, uploads, validate
- `src/repositories/*`: SQL layer (reads/writes)
- `src/services/*`: business logic (orders, refunds, payments)
- `src/routes/*`: controllers

---

## 3) Runtime behavior

### 3.1 App initialization
- `src/server.js` loads env, initializes DB, creates app via `createApp()`.
- Global crash logging for `unhandledRejection` and `uncaughtException`.

### 3.2 Health endpoint
- `GET /healthz` is registered early (before session/CSRF).
- Performs a lightweight DB query (`SELECT 1`).
- Returns `200` if OK; otherwise `503`.

Response example:
```json
{ "ok": true, "status": "ok", "uptimeSec": 123 }
```

---

## 4) Security model

### 4.1 Admin authorization
- Admin routes are guarded by `requireAdmin`.
- Admin “role” is derived from allowlists (env-configured) and session state.

### 4.2 CSRF
- Enabled site-wide for state-changing requests.
- Exempt endpoints for payment gateway callbacks/returns:
  - `/payment/callback`
  - `/payment/return`
  - `/payment/refund/notify`

### 4.3 Rate limiting
- Configurable via env.
- Skips:
  - `/healthz`
  - gateway endpoints above

---

## 5) Database schema (high level)

Reference: `src/db/schema.sql`

### 5.1 Key tables
- `inventory`: product catalog (price in cents)
- `categories`, `category_sections`: category model + markdown sections
- `users`: accounts
- `site_settings`: key/value config (logo, pages, shipping fees, promos)
- `orders`: order header
- `order_items`: snapshot line items
- `order_status_history`: status transitions
- `offline_bank_transfers`: slip uploads and verification
- `payment_events`: payment idempotency (provider + txn id uniqueness)
- `order_refunds`, `order_item_refunds`: refunds

### 5.2 Money convention
All money is stored as integer cents in DB.

---

## 6) HTTP routes (API) — by module

This app is server-rendered, but these routes are still the primary HTTP contract.

### 6.1 Storefront — `src/routes/shop.js`

#### `GET /`
- Purpose: home page (categories)
- Auth: none
- Response: HTML

#### `GET /products`
- Purpose: list products
- Query params:
  - `q` (string)
  - `category` (category slug)
  - `availability` (`IN_STOCK` | `OUT_OF_STOCK`)
  - `min_price`, `max_price` (RM string, parsed server-side)
  - `sort` (`NEWEST|PRICE_ASC|PRICE_DESC|NAME_ASC|NAME_DESC`)
  - `page`, `pageSize`
- Auth: none
- Response: HTML

#### `GET /products/:id`
- Params: `id` numeric
- Auth: none
- Response: HTML (404 if hidden/archived)

#### `GET /cart`
- Auth: normal users only (admins blocked)
- Response: HTML

#### `POST /cart/add`
- Body:
  - `product_id` (string/number)
  - `quantity` (optional)
  - `return_to` (optional relative path)
- Side effects: updates session cart
- Response: redirect

#### `POST /cart/update`
- Body: product quantities map (see view form)
- Side effects: updates session cart
- Response: redirect

---

### 6.2 Orders & checkout — `src/routes/orders.js`

#### `GET /checkout`
- Auth: normal users only (admins blocked)
- Response: HTML

#### `POST /checkout/promo-check`
- Auth: normal users only
- CSRF: required
- Body:
  - `promo_code` (string)
  - `state` (Malaysia state enum)
- Response: JSON
```json
{ "ok": true, "discountCents": 100, "shippingCents": 800, "grandTotalCents": 12345 }
```

#### `POST /checkout`
- Auth: normal users only
- CSRF: required
- Body:
  - customer fields (name/phone/email/address)
  - `promo_code` (optional)
  - `payment_method` (`ONLINE`|`OFFLINE_TRANSFER`)
- Behavior:
  - Creates order + items
  - Clears cart
  - If offline: redirect to slip page
  - If online: redirects to payment gateway (GET redirect or auto-post form)

#### `GET /orders/:id`
- Auth: order owner, or guest session for last guest order
- Response: HTML

#### `GET /orders/history`
- Auth: logged-in user
- Response: HTML

#### Offline slip upload
- `GET /orders/:id/offline-transfer`
- `POST /orders/:id/offline-transfer` (multipart)

---

### 6.3 Payments — `src/routes/payments.js`

#### `POST /payment/callback`
- Called by payment gateway (server-to-server)
- CSRF: exempt
- Validates:
  - signature
  - currency/amount rules
  - idempotency via `payment_events`
- Response: `200` on accepted, `4xx` on rejected

#### `GET|POST /payment/return`
- Called by user browser returning from gateway
- CSRF: exempt
- Similar validation + idempotency
- Response: redirect to confirmation or error page

#### `POST /payment/refund/notify`
- Called by gateway to update refund status
- CSRF: exempt

---

### 6.4 Admin — `src/routes/admin.js`

All routes below require `requireAdmin`.

Main areas:
- Products CRUD
- Orders management
- Slip queue approve/reject
- Refund initiation
- Categories and content blocks
- Settings:
  - branding (`site.logo.image`)
  - shipping fees
  - promos
  - footer/pages
- Reports:
  - `GET /admin/reports/sales`
  - `GET /admin/reports/sales.csv`

---

## 7) Core business flows

### 7.1 Order placement → payment confirmation
- Order is created first.
- Payment confirmation changes payment status and triggers stock deduction.

### 7.2 Idempotency
- Gateway callback/return events are deduplicated using `payment_events` uniqueness.

### 7.3 Stock deduction
- Must be atomic and guarded against negative stock.
- If payment is confirmed but stock is insufficient, fulfilment is cancelled with a note for manual handling.

### 7.4 Refunds
- Refund requests create refund records.
- Notify callback updates status when provider confirms.
- FPX refunds are blocked by rule.

---

## 8) Observability & ops

### 8.1 Logging
- JSON logs via `pino` wrapper.
- Error handler logs request metadata.
- PM2 log files:
  - `storage/logs/pm2-out.log`
  - `storage/logs/pm2-error.log`

### 8.2 Deployment
- GitHub Actions deploy workflow rsyncs code while preserving:
  - `.env`
  - SQLite DB
  - uploads
- Pre-deploy backup is created on VPS.
- Post-restart `/healthz` check verifies service readiness.

---

## 9) Developer workflow
- `npm run dev`
- `npm run seed -- --reset`
- `npm run create-admin -- --username ... --email ... --password ...`

---

## 10) Doc generation
- Source manuals: `docs/manuals/*.md`
- Generate docx:
  - `npm run docs:docx`
- Outputs (gitignored):
  - `docs/generated/Visolux_Admin_Manual.docx`
  - `docs/generated/Visolux_Developer_Guide.docx`
