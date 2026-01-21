# Checkout & payment flows

## Overview

The system creates the order first, then confirms payment (online) or waits for slip verification (offline). Stock is deducted atomically only when payment is confirmed.

## Storefront → Cart → Checkout

```mermaid
flowchart TD
  A[Browse /products] --> B[Add to cart]
  B --> C[/cart]
  C --> D[/checkout]
  D -->|Place order| E[Create order + items + status history]
```

## Offline bank transfer

```mermaid
sequenceDiagram
  participant U as User
  participant S as Server
  participant A as Admin
  participant DB as SQLite

  U->>S: POST /checkout (OFFLINE_TRANSFER)
  S->>DB: create orders + order_items + status history
  S-->>U: Redirect /orders/:id/offline-transfer
  U->>S: POST /orders/:id/offline-transfer (upload slip)
  S->>DB: upsert offline_bank_transfers (verified=0)
  A->>S: POST /admin/slips/:id/approve
  S->>DB: mark PAID + deduct stock (transaction)
  S-->>A: Redirect /admin/slips
```

## Fiuu hosted payment page

```mermaid
sequenceDiagram
  participant U as User
  participant S as Server
  participant G as Fiuu Gateway
  participant DB as SQLite

  U->>S: POST /checkout (ONLINE)
  S->>DB: create orders + order_items + status history
  S-->>U: Render auto-post form (target=_top)
  U->>G: POST Hosted Payment Page

  par Gateway callback (server-to-server)
    G->>S: POST /payment/callback
    S->>DB: insert payment_events (idempotency)
    S->>DB: if status=00, mark PAID + deduct stock (transaction)
    S-->>G: 200 OK
  and User return redirect
    G-->>U: Redirect to /payment/return
    U->>S: GET/POST /payment/return
    S->>DB: insert payment_events (idempotency)
    S->>DB: if status=00, mark PAID + deduct stock (transaction)
    S-->>U: Redirect /orders/:id/confirmation
  end
```

## Notes

- Payment callbacks can arrive before user return; processing is idempotent.
- Replay protection is implemented via `payment_events` with a uniqueness constraint on `(provider, provider_txn_id)`.
- If a payment succeeds but stock is insufficient at confirmation time, payment is marked `PAID` but fulfilment is cancelled with a status note for manual handling.
