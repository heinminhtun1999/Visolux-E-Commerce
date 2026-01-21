# Visolux E-Commerce — Project Documentation

**Generated:** 2026-01-15

## 1. Purpose & scope

Visolux E-Commerce is a server-rendered Node.js + Express + SQLite e-commerce application designed to be embedded inside an iframe (no global header/footer). It supports:

- Storefront: product grid, search, pagination, product detail
- Cart: session-based cart
- Checkout:
  - Guest checkout
  - Authenticated checkout
  - Promo codes
- Payments:
  - Offline bank transfer with slip upload and admin approval
  - Fiuu Hosted Payment Page (return/callback/cancel), signature verification, replay/idempotency protection
- Admin:
  - Product management (create/update + image upload)
  - Orders list
  - Slip verification queue (approve/reject)

This document describes how the system is structured and how to operate it.

## 2. High-level architecture

### 2.1 Components

- **Express application**: routing + middleware + EJS rendering
- **SQLite database** (better-sqlite3): data persistence, transactional stock updates
- **Session layer** (express-session + connect-sqlite3): auth session + cart persistence
- **Image pipeline** (multer + sharp): validates uploads, re-encodes images to WebP
- **Payment integration** (Fiuu): hosted payment request generation + callback verification

### 2.2 Rendering strategy (iframe-safe)

- The UI is rendered by EJS templates.
- CSP is configured with `frame-ancestors` to allow embedding.
- When redirecting to the online payment gateway, the app posts a form with `target="_top"` to avoid loading bank pages inside the iframe.

## 3. Project structure

```
.
├─ src/
│  ├─ app.js                 # Express app wiring
│  ├─ server.js              # Boot server
│  ├─ config/env.js          # Environment config
│  ├─ db/
│  │  ├─ db.js               # SQLite init + schema load
│  │  └─ schema.sql          # Tables + triggers
│  ├─ middleware/            # auth, locals, uploads, errors, validation
│  ├─ repositories/          # DB access layer
│  ├─ services/              # business logic
│  │  └─ payments/fiuu.js     # Fiuu helpers
│  └─ routes/                # HTTP route controllers
├─ views/                    # EJS templates
├─ public/                   # CSS + static assets
├─ storage/                  # sqlite + uploads
└─ scripts/                  # seeding, admin creation, docs build
```

## 4. Configuration

### 4.1 Required

- `SESSION_SECRET`: session signing secret

### 4.2 Common

- `PORT`: server port (default 3000)
- `APP_BASE_URL`: public base URL used for Fiuu return/callback URLs
- `SQLITE_PATH`: SQLite file path

### 4.3 Embedding

- `IFRAME_ANCESTORS`: space-separated CSP `frame-ancestors` origins
- `SECURE_COOKIES`: set `true` when behind HTTPS

### 4.4 Admin allowlist

Admin access is controlled via allowlists:

- `ADMIN_USERNAMES` (comma-separated)
- `ADMIN_EMAILS` (comma-separated)

### 4.5 Fiuu (online payments)

Online payment is automatically disabled until configured.

- `FIUU_MERCHANT_ID`
- `FIUU_VERIFY_KEY`
- `FIUU_SECRET_KEY`
- `FIUU_GATEWAY_URL`
- `FIUU_CURRENCY` (default `MYR`)

Optional:

- `FIUU_PAYMENT_METHOD` (if omitted, Fiuu can show all available channels)

Supported gateway URL formats:

1) Domain base + `FIUU_PAYMENT_METHOD`

- `FIUU_GATEWAY_URL=https://sandbox-payment.fiuu.com`
- `FIUU_PAYMENT_METHOD=fpx` (example)

2) Full template:

- `FIUU_GATEWAY_URL=https://sandbox-payment.fiuu.com/RMS/pay/{MerchantID}/{Payment_Method}`

3) Merchant-only (recommended if you want all channels):

- `FIUU_GATEWAY_URL=https://sandbox-payment.fiuu.com/RMS/pay/{MerchantID}`

Return/callback/cancel paths:

- `FIUU_RETURN_URL=/payment/return`
- `FIUU_CALLBACK_URL=/payment/callback`
- `FIUU_CANCEL_URL=/payment/cancel`

## 5. Database model (SQLite)

### 5.1 Inventory

Table: `inventory`

- `price` stored as integer cents
- `stock` is non-negative
- `availability` is maintained by triggers based on stock
- `visibility` controls storefront display
- `archived` hides products from storefront and prevents stock decrement

Triggers:

- `trg_inventory_availability_insert`
- `trg_inventory_availability_update_stock`
- `trg_inventory_updated_at`

### 5.2 Users

Table: `users`

- `password_hash` is bcrypt
- Unique `username` and `email`

### 5.3 Orders

Tables:

- `orders`
- `order_items` (snapshots product name/price at time of purchase)
- `order_status_history` (PAYMENT and FULFILMENT timelines)

Statuses:

- `payment_status`: `PENDING | PAID | FAILED | REFUNDED | AWAITING_VERIFICATION`
- `fulfilment_status`: `NEW | PROCESSING | SHIPPED | COMPLETED | CANCELLED`

### 5.4 Offline bank transfers

Table: `offline_bank_transfers`

- Stores slip metadata and path
- `verified=1` indicates admin approval

### 5.5 Promo codes

Tables:

- `promo_codes`
- `order_promos` (one promo per order)

### 5.6 Payment idempotency

Table: `payment_events`

- Stores a hash of received payloads
- Unique constraint on `(provider, provider_txn_id)`
- Used to de-duplicate Fiuu callbacks/returns

## 6. Business logic

### 6.1 Cart

- Stored in the session (`req.session.cart.items`)
- Hydration pulls product data from DB at render time
- Archived products are omitted from hydration

### 6.2 Placing an order

When checkout is posted:

1) Cart is hydrated
2) Total is computed (promo applied if valid)
3) Order + items are inserted
4) Status history records initial PAYMENT and FULFILMENT statuses
5) Cart is cleared

Guest order access:

- For guest checkout, the server stores `session.lastGuestOrderId` to allow viewing that order without a login.

### 6.3 Stock deduction rules

Stock is deducted only when payment is confirmed:

- Online: when Fiuu callback/return indicates success (`status=00`)
- Offline: when admin approves the slip

Stock deduction is performed inside a SQLite transaction and uses conditional updates to prevent negative stock.

If payment succeeds but stock is insufficient at confirmation time:

- Payment is marked `PAID`
- Fulfilment is marked `CANCELLED`
- A status note is recorded for manual handling (refund/adjustment)

## 7. HTTP routes

### 7.1 Storefront

- `GET /products` — product grid, search, pagination
- `GET /products/:id` — product detail
- `GET /cart` — cart view
- `POST /cart/add` — add items
- `POST /cart/update` — update qty
- `POST /cart/clear` — clear cart

### 7.2 Checkout & orders

- `GET /checkout` — checkout form
- `POST /checkout` — create order
- `GET /orders/:id` — order detail
- `GET /orders/:id/confirmation` — order confirmation
- `GET /orders/history` — user order history (requires login)

Offline transfer:

- `GET /orders/:id/offline-transfer`
- `POST /orders/:id/offline-transfer` — upload slip

### 7.3 Authentication

- `GET /login`, `POST /login`
- `GET /register`, `POST /register`
- `POST /logout`
- `GET /account`
- `POST /account/profile`
- `POST /account/password`

### 7.4 Admin

All admin routes require allowlisted admin session:

- `GET /admin/products`
- `GET /admin/products/new`
- `POST /admin/products/new`
- `GET /admin/products/:id/edit`
- `POST /admin/products/:id/edit`
- `GET /admin/orders`
- `GET /admin/slips`
- `POST /admin/slips/:orderId/approve`
- `POST /admin/slips/:orderId/reject`

### 7.5 Payments (Fiuu)

- `ALL /payment/return`
- `POST /payment/callback`
- `GET /payment/cancel`

## 8. Fiuu integration details

### 8.1 Hosted payment request fields

The request builder posts fields including:

- `merchant_id`, `amount`, `orderid`
- Billing fields: `bill_name`, `bill_email`, `bill_mobile`, `bill_desc`
- `currency`
- `returnurl`, `callbackurl`, `cancelurl`
- `vcode`

### 8.2 vcode checksum

Extended vcode:

- `vcode = md5(amount + merchantID + orderID + verify_key + currency)`

### 8.3 skey verification (callback/return)

- `pre_skey = md5(tranID + orderid + status + domain + amount + currency)`
- `skey = md5(paydate + domain + pre_skey + appcode + secret_key)`

The system verifies `skey` before marking orders paid.

### 8.4 Idempotency

- Each callback/return is recorded in `payment_events`
- Duplicate provider transaction IDs are ignored

## 9. Upload handling

Uploads are handled with multer and processed by sharp:

- Product images: stored under `storage/uploads/products/` as WebP
- Bank slips: stored under `storage/uploads/slips/` as WebP

Controls:

- File size limited by `UPLOAD_MAX_MB`
- Re-encoding strips metadata and normalizes format

## 10. Security controls

- Helmet with CSP `frame-ancestors` (iframe embedding)
- Rate limiting
- HttpOnly cookies
- Session store in SQLite
- Zod validation for request payloads

## 11. Operations

### 11.1 Seed demo data

- `npm run seed -- --reset`

Creates:

- Promo code: `WELCOME10` (10% off)
- Demo products

### 11.2 Create a user (for admin allowlist)

- `npm run create-admin -- --username admin --email admin@example.com --password "StrongPass123!"`

Then allowlist in `.env`:

- `ADMIN_USERNAMES=admin` or `ADMIN_EMAILS=admin@example.com`

## 12. Troubleshooting

- **App fails on boot**: ensure `SESSION_SECRET` is set.
- **Online payment option missing**: Fiuu is not configured. Set `FIUU_*` env vars.
- **Uploads not visible**: ensure `storage/uploads` is writable; `/uploads` is served statically.

## 13. References

- Payment gateway behavior and signature formulas were implemented based on the bundled Fiuu merchant spec PDF in the repository.
- Checkout/payment flow diagram: see `docs/flow.md`.
