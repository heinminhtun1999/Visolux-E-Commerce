# Visolux E-Commerce (Embedded / iframe-ready)

Server-rendered Node.js + Express + SQLite e-commerce app designed to be embedded inside an iframe (no global header/footer). Includes:

- Storefront: product listing, search, pagination, cart
- Checkout: guest checkout + logged-in checkout
- Payments:
  - Offline bank transfer slip upload + admin approval
  - Fiuu Hosted Payment Page (return/callback/cancel + signature verification + idempotency)
- Admin: product CRUD + order list + slip verification queue

## Requirements

- Node.js 18+ recommended
- Windows/macOS/Linux

## Quick start

1) Install dependencies

- `npm install`

2) Create your env file

- Copy `.env.example` to `.env`
- Set at least:
  - `SESSION_SECRET` (required)
  - `APP_BASE_URL` (recommended)

3) Seed demo data

- `npm run seed -- --reset`

4) Run

- `npm run dev`
- Open `http://localhost:3000/products`

## Admin access

Admin rights are determined by allowlists:

- `ADMIN_USERNAMES` (comma-separated)
- `ADMIN_EMAILS` (comma-separated)

Create an initial user:

- `npm run create-admin -- --username admin --email admin@example.com --password "StrongPass123!"`

Then set one of these in `.env`:

- `ADMIN_USERNAMES=admin`
- or `ADMIN_EMAILS=admin@example.com`

Admin pages:

- `/admin/products`
- `/admin/orders`
- `/admin/notifications`

## Iframe embedding

This app is intended to be embedded. CSP uses `frame-ancestors` (not `X-Frame-Options`).

Configure allowed parents (space-separated):

- `IFRAME_ANCESTORS="'self' https://partner.example.com"`

Important: Fiuu/bank pages should not be loaded inside an iframe. The checkout uses a form post with `target="_top"` so the gateway opens in the top window.

## Payments

### Offline transfer

- Customer places an order with `OFFLINE_TRANSFER`.
- Customer uploads a bank slip.
- Admin approves/rejects the slip.
- Approval marks the order as paid and deducts stock atomically.

### Fiuu Hosted Payment Page

Online payment stays disabled until Fiuu settings are provided.

Minimal required env vars:

- `FIUU_MERCHANT_ID`
- `FIUU_VERIFY_KEY`
- `FIUU_SECRET_KEY`
- `FIUU_GATEWAY_URL`

Optional:

- `FIUU_PAYMENT_METHOD` (if omitted, Fiuu can show all available channels)

`FIUU_GATEWAY_URL` formats supported:

- Domain base + payment method:
  - `FIUU_GATEWAY_URL=https://sandbox-payment.fiuu.com`
  - `FIUU_PAYMENT_METHOD=fpx` (optional example)
- Full template:
  - `FIUU_GATEWAY_URL=https://sandbox-payment.fiuu.com/RMS/pay/{MerchantID}/{Payment_Method}`

To allow all channels, prefer:

- `FIUU_GATEWAY_URL=https://sandbox-payment.fiuu.com/RMS/pay/{MerchantID}`
- leave `FIUU_PAYMENT_METHOD` unset

Return/callback endpoints:

- `FIUU_RETURN_URL=/payment/return`
- `FIUU_CALLBACK_URL=/payment/callback`
- `FIUU_CANCEL_URL=/payment/cancel`

Flow diagram: see [docs/flow.md](docs/flow.md)

## Production checklist

- Set `SECURE_COOKIES=true` behind HTTPS
- Set `APP_BASE_URL` to your public HTTPS origin
- Restrict `IFRAME_ANCESTORS` to only trusted parents
- Set strong `SESSION_SECRET`
- Configure Fiuu env vars (and test sandbox end-to-end)

## Deploy to Hostinger VPS (GitHub Actions)

This repo includes:

- CI workflow: `.github/workflows/ci.yml`
- Deploy workflow: `.github/workflows/deploy-hostinger-vps.yml`

### 1) VPS one-time setup (Ubuntu)

Install Node.js (20 LTS) and PM2:

- `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -`
- `sudo apt-get install -y nodejs`
- `sudo npm i -g pm2`

Create an app folder (example):

- `sudo mkdir -p /var/www/visolux/app`
- `sudo chown -R $USER:$USER /var/www/visolux`

Create your production env file on the VPS:

- `cd /var/www/visolux/app`
- `cp .env.example .env`
- Edit `.env` and set at least:
  - `NODE_ENV=production`
  - `PORT=3000`
  - `SESSION_SECRET=...`
  - `APP_BASE_URL=https://your-domain.com`
  - `TRUST_PROXY=1`
  - `SECURE_COOKIES=true`

### 2) GitHub repo secrets

In GitHub → Settings → Secrets and variables → Actions, add:

- `VPS_HOST` (your VPS IP/hostname)
- `VPS_USER` (ssh user)
- `VPS_PORT` (usually `22`)
- `VPS_PATH` (example `/var/www/visolux`)
- `VPS_SSH_KEY` (private key that can SSH into the VPS)

### 3) Nginx reverse proxy (recommended)

Example server block (adjust domain + SSL):

```
server {
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### 4) Deploy

Push to `main`. The workflow will rsync the code to the VPS and run:

- `npm ci --omit=dev`
- `pm2 startOrReload ecosystem.config.cjs --env production`


## Scripts

- `npm run dev` – dev server (nodemon)
- `npm start` – production start
- `npm run seed -- --reset` – reset and seed demo products + promo
- `npm run create-admin -- --username ... --email ... --password ...` – create a user
- `npm run extract-fiuu` – extract key info from the bundled Fiuu PDF
