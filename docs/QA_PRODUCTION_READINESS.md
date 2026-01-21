# Visolux E‑Commerce – QA & Production Readiness Report (2026‑01‑21)

## Executive summary
This repo is a Node.js + Express + EJS ecommerce app with SQLite persistence, session auth, admin console, checkout (offline transfer + FIUU online gateway), refunds (FIUU), promos, and content-managed site pages.

**Status:** **Not ready** for production release *as-is*.

**Why not ready:**
- **No automated test suite** (unit/integration) for core money/checkout/refund flows; CI only smoke-boots.
- **Operational readiness gaps**: no documented/implemented **DB + uploads backup strategy** and restore drill; no monitoring/alerting guidance.
- **Security hardening gaps** remain (see Issues section), though one critical escalation issue has been fixed.

This report includes a full flow review, issue list, test plan, and a release checklist.

---

## 1) Application structure (high-level)
- **Runtime**: `src/server.js` boots DB, creates Express app from `src/app.js`.
- **Web**: Express 5, server-side EJS templates in `views/`, static assets in `public/`.
- **Persistence**: SQLite via `better-sqlite3`; schema in `src/db/schema.sql` + lightweight migrations in `src/db/db.js`.
- **Auth**: session-based auth via `express-session` with `connect-sqlite3` store.
- **Admin**: admin routes under `/admin` with allowlist-based admin role.
- **Payments**: FIUU hosted payment request/return/callback, refund API + refund notify callback.
- **Uploads**: `multer` to `storage/uploads/tmp`, then `sharp` (via `imageService`) optimizes and saves images.
- **Security middleware**: `helmet` CSP + custom CSRF token + origin checks + optional global rate limit.

---

## 2) Core features & flows (success/failure/edges)

### Browsing / catalog
**Routes:** `GET /`, `GET /products`, `GET /products/:id`
- **Success:** categories display, products list supports filters, product detail renders.
- **Failure:** invalid product id → 400; missing/unlisted product/category → 404.
- **Edge cases:**
  - Price filter parse errors should not crash (currently safely parses to cents).
  - Search `q` is capped, but LIKE queries can still be slow for large catalogs.

### Cart
**Routes:** `GET /cart`, `POST /cart/add`, `POST /cart/update`, `POST /cart/remove` (see `src/routes/shop.js`)
- **Success:** add/update/remove items updates session cart and totals.
- **Failure:** adding unavailable product → flash error.
- **Edge cases:**
  - Quantity bounds: add clamps to 1..99; hydrate clamps to 999.
  - Stock is **not reserved** at cart time (normal), but must be validated at payment/fulfilment.

### Checkout
**Routes:** `GET /checkout`, `POST /checkout/promo-check`, `POST /checkout`
- **Success:** places order, clears cart, then:
  - offline transfer → redirects to offline transfer instruction page
  - online payment → redirects to FIUU (GET or auto-submit page)
- **Failure:**
  - empty cart → redirect
  - FIUU not configured but online selected → order is marked failed/cancelled
- **Edge cases:**
  - Client price tampering: totals are recomputed server-side from DB products (good)
  - Shipping fee depends on state; ensure state is validated.

### Offline transfer (slip upload)
**Routes:** under `/orders/:id/offline-transfer` and upload endpoints in `src/routes/orders.js`.
- **Success:** upload slip image, admin verifies/rejects.
- **Failure:** invalid image type/size → error.
- **Edge cases:**
  - Ensure temp files are deleted even on failure.
  - Ensure uploaded slip is not publicly enumerable.

### Online payment (FIUU)
**Routes:** `GET|POST /payment/return`, `POST /payment/callback`
- **Success:** signature verified; amount/currency checked; idempotency via payment events; order marked paid; stock deducted; confirmation page shown.
- **Failure:** signature mismatch / amount mismatch / currency mismatch → reject.
- **Edge cases:**
  - Duplicate callbacks: handled by payment event repo.
  - Paid but stock insufficient: app marks fulfilment cancelled and requires manual handling.

### Refunds
**Admin endpoints** in `src/routes/admin.js` call `refundService`.
- **Success:** refund request recorded; async notify callback later confirms status.
- **Failure:** gateway errors recorded as FAILED attempt.
- **Edge cases:**
  - **FPX ONLINE refunds are blocked** by business rule.
  - Prevent over-refunding: service checks remaining qty/amount.

### User account
**Routes:** register/login/logout/account/password reset.
- **Success:** session regeneration on login/register, hashed password reset tokens.
- **Failure:** invalid credentials; invalid/expired reset tokens.
- **Edge cases:**
  - Login brute force (now rate-limited).

### Admin console
**Routes:** `/admin/*` with `requireAdmin`.
- Products CRUD, orders management, settings/pages editor, notifications.
- **Edge cases:**
  - Large data sets may need pagination and indexes.

### “AI agent integration”
No AI routes/services were found in the current codebase. If AI features are planned, add a separate route/service and apply strict validation + rate limiting + output safety.

---

## 3) Security / correctness audit (issues found)

### Critical
1) **Admin privilege escalation via mutable email/username allowlist**
- **Risk:** if admin rights are determined from email/username allowlists, a normal user can attempt to match allowlisted values through registration or profile email change.
- **Fix applied:** registration now rejects allowlisted username/email; profile update blocks non-admin users from switching to allowlisted email and keeps `isAdmin` sticky.
- **Recommendation:** move admin role to a DB column (e.g., `users.is_admin`) and manage via admin tooling.

### High
2) **No comprehensive automated tests for money-critical flows**
- **Risk:** regressions in checkout totals, promo calculations, refund allocation can silently break production.
- **Recommendation:** add Jest/Vitest + Supertest integration tests; see Automated Test Plan.

3) **Backups/restore not implemented/documented**
- **Risk:** SQLite DB and uploads are single points of failure.
- **Recommendation:** nightly backups + offsite storage + quarterly restore drill.

### Medium
4) **CSP includes `'unsafe-inline'`**
- **Risk:** reduces XSS mitigation strength.
- **Recommendation:** migrate inline scripts to external files, remove unsafe-inline where possible.

5) **Uploads rely on `mimetype`**
- **Risk:** content-type spoofing is possible.
- **Recommendation:** verify file headers (magic bytes) and always process via `sharp` before saving; ensure tmp is cleaned.

6) **Operational observability is minimal**
- **Risk:** no request IDs, limited structured event logs.
- **Recommendation:** add request-id middleware and include it in logs; add health endpoint.

---

## 4) Logging verification (Phase 3)

### Implemented
- **Structured JSON logs** using `pino`.
- Express error handler logs `err`, HTTP status, method, url, ip.
- Process-level crash logs: `unhandledRejection`, `uncaughtException` logged as `fatal`.
- Critical events now logged:
  - login success/failure
  - checkout online-pay not configured
  - payment confirmed/pending/failed
  - refund blocked for FPX
  - refund requested / refund request failed

### Sensitive-data controls
- Logger redacts cookies, auth headers, tokens/secrets and common password fields.
- Client responses in production do **not** include stack traces.

### Log storage & rotation
- PM2 writes logs to `storage/logs/pm2-out.log` and `storage/logs/pm2-error.log`.
- Deploy workflow installs/configures `pm2-logrotate` to rotate those logs.
- Optional app-managed file logs can be enabled with `LOG_TO_FILE=true` (not enabled by default).

**Acceptance criteria:**
- Errors/critical events appear as JSON lines in PM2 logs.
- Log files rotate and do not grow unbounded.

---

## 5) Manual test plan (Phase 5)

### A. Smoke tests (post-deploy)
1. **App boots**
- Steps: `pm2 restart visolux`; load `/`.
- Expected: HTTP 200 home page, no 5xx, PM2 logs show startup.

2. **Static assets**
- Steps: load `/public/css/app.css` and a product image.
- Expected: 200, correct caching headers.

3. **DB read/write**
- Steps: register a user; place offline order.
- Expected: user row + order rows created.

4. **Payment callbacks are reachable**
- Steps: confirm `/payment/return` and `/payment/callback` reachable (via FIUU sandbox).
- Expected: confirmation page; callback 200 OK.

### B. Authentication
1. Register valid user
- Expected: account created, session established, redirected to `/`.

2. Register duplicate username/email
- Expected: blocked; flash error.

3. Login invalid password
- Expected: blocked; flash error; logs `login_failed`.

4. Login brute force
- Steps: 25 attempts in 15 min.
- Expected: rate limited; flash error.

5. Forgot password enumeration
- Steps: reset for existing and non-existing identifiers.
- Expected: same success flash; no account leak.

6. Reset password invalid token
- Expected: redirect to forgot password with error.

### C. Cart
1. Add item from product page
- Expected: cart count increases; cart total correct.

2. Update quantity to 0
- Expected: item removed.

3. Add archived/unavailable product
- Expected: blocked.

### D. Checkout + promos
1. Promo check (valid code)
- Expected: JSON ok true; discount reflects promo rules.

2. Promo check (invalid/expired)
- Expected: JSON ok false.

3. Checkout offline transfer
- Expected: order created with `payment_status=AWAITING_VERIFICATION`.

4. Checkout online pay when FIUU not configured
- Expected: order marked failed/cancelled; log `checkout_online_payment_not_configured`.

### E. FIUU online payment
1. Successful payment return
- Expected: order paid, stock deducted; admin notification created; log `payment_confirmed`.

2. Duplicate callback
- Expected: idempotent; no double stock deduction.

3. Amount mismatch
- Expected: rejected; no paid status.

4. Stock insufficient after payment
- Expected: payment marked paid; fulfilment cancelled; log `payment_paid_but_stock_insufficient`.

### F. Refunds
1. Refund item within remaining qty
- Expected: refund record PENDING; later notify updates.

2. Refund over remaining qty/amount
- Expected: blocked with 400.

3. Refund FPX online order
- Expected: blocked; log `refund_blocked_fpx`.

### G. Admin
1. Admin cannot be gained by email change
- Steps: non-admin changes email to allowlisted admin email.
- Expected: blocked.

2. Product CRUD
- Expected: create/edit/archive affects public listings.

3. Settings editor XSS
- Steps: save page content with script tags.
- Expected: scripts removed by sanitization.

---

## 6) Automated test plan (recommended)

### Unit tests
- `promoService.applyPromoToTotal()`
- `shippingService.getCourierFeeCentsForState()`
- `orderService.placeOrder()` totals correctness
- `refundService` allocation/remaining amount checks
- `fiuu.verifySkey()` signature variations

### Integration tests (Supertest)
- Auth: register/login/logout, reset password
- Cart: add/update/remove
- Checkout: offline + online (mock FIUU)
- Admin: requireAdmin protection on `/admin/*`

---

## 7) Deployment readiness (Phase 6)

### CI/CD
- GitHub Actions CI performs install + smoke app creation.
- Deploy workflow uses rsync + `npm ci --omit=dev` and PM2 reload.

### VPS requirements
- Node 20 LTS recommended for consistency with CI.
- Nginx reverse proxy + HTTPS (Certbot).
- `TRUST_PROXY=1`, `SECURE_COOKIES=true`.

### State management
- SQLite DB and uploads are excluded from deploy sync (correct).
- **Add backups**:
  - `storage/data/app.db`
  - `storage/data/sessions.db` (optional)
  - `storage/uploads/products` and `storage/uploads/site`

---

## 8) Final release checklist (Phase 7)

### Security
- [ ] `SECURE_COOKIES=true`, HTTPS enabled
- [ ] `TRUST_PROXY=1` behind Nginx
- [ ] Login rate limit enabled (done)
- [ ] Admin role is not user-controllable (mitigated; migrate to DB flag recommended)
- [ ] CSP reviewed; remove `'unsafe-inline'` where possible

### Reliability
- [ ] PM2 log rotation enabled
- [ ] DB backup job configured + tested restore
- [ ] Health check endpoint and basic monitoring

### Performance
- [ ] Validate indexes for order lists and filters
- [ ] Consider pagination limits on all admin lists

### QA
- [ ] Run smoke tests post-deploy
- [ ] Run manual regression suite for checkout/payment/refund
- [ ] Add automated tests for money-critical logic

---

## Final statement
**Not ready** for production release until backups + minimal automated tests (money-critical paths) are in place and the remaining medium/high security hardening items are addressed.
