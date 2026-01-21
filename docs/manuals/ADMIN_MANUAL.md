# Visolux E‑Commerce — Admin Manual

**Audience:** Admin users (store operations staff)

**Purpose:** This document explains how to operate the Visolux storefront + admin console safely in production.

---

## 1) Quick start

### 1.1 Admin access
Admin rights are controlled by allowlists in the server `.env`:

- `ADMIN_USERNAMES` (comma-separated)
- `ADMIN_EMAILS` (comma-separated)

Create your first admin user:

- Run: `npm run create-admin -- --username admin --email admin@example.com --password "StrongPass123!"`
- Add the username/email into the allowlist.

### 1.2 Admin pages
- Products: `/admin/products`
- Orders: `/admin/orders`
- Categories + home layout: `/admin/categories`
- Settings (branding/shipping/promos/pages): `/admin/settings`
- Notifications: `/admin/notifications`
- Sales reports: `/admin/reports/sales`

---

## 2) How the system works (flow)

### 2.1 High-level order lifecycle
The app creates an order first, then confirms payment later.

- Customer browses products and adds items to cart.
- Customer checks out.
- The system creates:
  - `orders`
  - `order_items`
  - `order_status_history`

Stock is **deducted only when payment is confirmed**.

### 2.2 Offline bank transfer flow
1. Customer chooses **Offline transfer** at checkout.
2. Order is created with `payment_status=AWAITING_VERIFICATION`.
3. Customer uploads a payment slip.
4. Admin approves or rejects the slip.
5. If approved:
   - order becomes `PAID`
   - stock is deducted

### 2.3 Online payment (Fiuu) flow
1. Customer chooses **Online payment**.
2. Order is created with `payment_status=PENDING`.
3. Customer is redirected to Fiuu hosted payment.
4. Fiuu will:
   - call `/payment/callback` (server-to-server)
   - redirect customer back via `/payment/return`

Important: callbacks/returns can happen more than once; processing is idempotent.

---

## 3) Daily operations

### 3.1 Products (create/update)
Where: `/admin/products`

- Keep names short and clear.
- Ensure price is correct (minimum RM 1.00).
- Set stock. If stock becomes 0, the product becomes “out of stock”.
- Use **Visibility** to hide from storefront without deleting.
- Use **Archive** when you no longer sell the item.

**Images**
- Use JPG/PNG/WEBP.
- Uploads are re-encoded and optimized by the system.

### 3.2 Categories and home layout
Where: `/admin/categories`

- Categories appear on the home page.
- Keep `slug` stable (changing slugs can break links).
- Category sections (markdown content) appear on category product listing pages.

### 3.3 Orders management
Where: `/admin/orders`

- Track `payment_status` and `fulfilment_status`.
- Only ship when payment is confirmed.

**Statuses you will see**
- `AWAITING_VERIFICATION`: waiting for slip review (offline transfer)
- `PENDING`: waiting for gateway confirmation (online)
- `PAID`: paid and ready for fulfilment processing
- `FAILED`: payment failed or rejected
- `REFUNDED` / `PARTIALLY_REFUNDED`: refunds recorded

### 3.4 Slip verification (offline transfer)
Where: Admin slip queue (linked from admin screens)

- **Approve** only if amount + reference look correct.
- **Reject** and include a clear rejection reason for the customer.

### 3.5 Refunds
Refunds are initiated from admin order screens.

Cautions:
- Refunds for **FPX online** are blocked by business rules.
- Avoid over-refunding; always double-check remaining refundable amount/quantity.

### 3.6 Notifications
Where: `/admin/notifications`

- Notifications are created for operational events (new orders, payment confirmations, etc.).
- Use notifications as a “to-do” list for the admin team.

---

## 4) Site settings

Where: `/admin/settings`

### 4.1 Branding
- Upload the header logo.
- The same logo is used as the browser tab icon (favicon).

### 4.2 Shipping fees
The app supports courier fees by Malaysian region (West/East). Update these in Settings.

### 4.3 Promos
Promos are managed in Settings.

Guidelines:
- Avoid overlapping promos unless you understand how discounts apply.
- Test a promo on a small basket first.

### 4.4 Footer pages
Settings also includes:
- Technician support URL
- Footer copyright

Site pages like Privacy/Terms/How-to-Order can be edited via admin tools.

---

## 5) Cautions & best practices

### 5.1 Never use admin accounts for shopping
Admin accounts cannot place orders or use carts.

### 5.2 Security
- Use a strong `SESSION_SECRET`.
- Don’t share admin credentials.
- Restrict `IFRAME_ANCESTORS` to trusted embed parents only.

### 5.3 Operational safety
- Make sure you have backups (SQLite DB + uploads).
- After deployments, check:
  - Home page loads
  - Checkout works
  - `/healthz` returns ok

### 5.4 What to do when something looks wrong
- Check `/admin/notifications`.
- Check server logs (PM2 logs) for errors.
- If payment is marked paid but fulfilment cancelled (stock issue), coordinate a refund or stock adjustment.

---

## 6) Troubleshooting

### 6.1 Common issues
- Product missing from storefront: check `visibility`, `archived`, category visibility.
- Customer cannot pay online: FIUU may not be configured or gateway issues.
- Slip upload fails: file too large or invalid type.

### 6.2 Health check
- `/healthz` returns `200` if the app + DB are OK.

---

## 7) Change management

- For content changes (pages, branding), prefer doing it during low-traffic periods.
- For price/stock updates, always double-check before saving.
