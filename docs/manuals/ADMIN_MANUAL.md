# Visolux Store — Admin User Manual

**For:** Store admins and staff (non‑technical)

This manual explains what you can do in the Admin area, how the store works day‑to‑day, and what to be careful about.

---

## 1) What this system does

Visolux Store lets you:
- Manage products (add/edit price, stock, photos)
- Organize products into categories
- Receive orders from customers
- Confirm payments (online or bank transfer slip)
- Prepare and fulfil orders (pack/ship)
- Manage promotions (discount codes)
- Update branding (logo) and basic site pages

---

## 2) Important concepts (simple terms)

### Order status (what it means)
Every order has two types of statuses:

1) **Payment status** (money side)
- **Pending**: customer started payment, not confirmed yet
- **Awaiting verification**: customer chose bank transfer and uploaded a slip (waiting for admin to approve)
- **Paid**: payment confirmed
- **Failed**: payment failed / cancelled
- **Partially refunded / Refunded**: money has been returned to customer (partly or fully)

2) **Fulfilment status** (shipping side)
- **New**: order just created
- **Processing**: you’re preparing the order
- **Shipped**: you shipped it
- **Completed**: finished
- **Cancelled**: cannot fulfil (example: stock problem)

### Stock (inventory)
- **Stock** is how many items you have.
- If stock is **0**, the product becomes **out of stock**.

### Online vs Offline payment
- **Online**: customer pays through the payment gateway (Fiuu).
- **Offline transfer**: customer transfers money and uploads a bank slip. Admin must approve/reject the slip.

---

## 3) How an order works (Flow)

### 3.1 Online payment flow (Fiuu)
1. Customer places an order and chooses **Online payment**.
2. Customer is sent to the payment page.
3. When the gateway confirms payment, the order becomes **Paid**.
4. Then you can process and ship.

### 3.2 Bank transfer (slip) flow
1. Customer places an order and chooses **Offline transfer**.
2. Order becomes **Awaiting verification**.
3. Customer uploads a bank slip.
4. Admin reviews the slip:
   - Approve → order becomes **Paid**
   - Reject → customer must re-upload / pay correctly

**Important:** Stock is deducted only when payment is confirmed.

---

## 4) Where to do things (Admin menu)

Main admin pages:
- **Products:** `/admin/products`
- **Orders:** `/admin/orders`
- **Categories & home layout:** `/admin/categories`
- **Shipping (zones / weight-based):** `/admin/site/shipping-zones`
- **Settings (logo, promos, pages, legacy shipping link):** `/admin/settings`
- **Notifications:** `/admin/notifications`
- **Contact messages:** `/admin/contact-messages`
- **Sales report:** `/admin/reports/sales`

---

## 5) Products (add / edit)

### 5.1 Add a new product
1. Go to **Admin → Products**
2. Click **New product**
3. Fill in:
   - Name
   - Description
   - Category
   - Price
   - Stock
4. Upload an image (optional but recommended)
5. Save

### 5.2 Edit a product
Use this for price changes, stock updates, and photo changes.

### 5.3 Hide vs Archive (don’t delete)
- **Hide (visibility off):** temporarily not shown on the store
- **Archive:** item is discontinued; also prevents stock deduction

**Tip:** Archive old items instead of deleting.

---

## 6) Categories (store organization)

### 6.1 Categories
Categories control how products are grouped on the home page and filter lists.

**Be careful:** Don’t frequently change category “slug” (it can break links).

### 6.2 Category sections (extra content)
Some categories can show extra content (text blocks) on the product listing page.

Use this for:
- Short notes
- Delivery info
- Simple promotions

---

## 7) Orders (day‑to‑day workflow)

### 7.1 What to do when a new order arrives
1. Open **Admin → Orders**
2. Open the order
3. Check:
   - Payment status
   - Customer details (name/phone/address)
   - Items and quantities

### 7.2 When payment is **Paid**
1. Set fulfilment to **Processing**
2. Pack items
3. Ship items
4. Set fulfilment to **Shipped**
5. When completed, set to **Completed**

### 7.3 Offline transfer: verify slips
When you see **Awaiting verification**:
1. Open the order and view the slip
2. Check the slip details match the order
3. Choose:
   - **Approve**: only if you are confident the payment is correct
   - **Reject**: add a clear reason (example: wrong amount / unclear slip)

---

## 8) Refunds (when needed)

Refunds are used when:
- Customer paid but item is unavailable
- Customer cancelled after payment
- Shipping adjustments

Note:
- When a refund is confirmed by the payment provider, the customer can be notified by email.

**Cautions:**
- Do not refund more than the order total.
- Some payment channels (example: FPX) may not allow refunds by policy.
- If you are unsure, check with a supervisor before refunding.

---

## 9) Promotions (discount codes)

Where: **Admin → Settings → Promos**

Best practices:
- Create a promo with a clear name and dates (if needed)
- Test the promo on a small order before announcing it
- Avoid running many overlapping promos

---

## 10) Shipping zones (by state or zip code)

Where: **Admin → Shipping** (`/admin/site/shipping-zones`)

Shipping is calculated by **total cart weight** and the delivery address.

### 10.1 Match by sub-regions (states)
- Choose **By sub-regions**.
- Select one or more states.

### 10.2 Match by zip codes
- Choose **By zip codes**.
- Enter one zip code per line, or comma-separated.
- Prefix patterns like `88*` are supported.

### 10.3 Weight rates
Each zone supports:
- **First**: set weight (kg) + amount (RM)
- **Every additional**: per (kg) + add (RM)
- Optional: **“kg and above” range** (calculate by amount per set kg)

### 10.4 How the system calculates shipping
1) The system sums all product weights in the cart.
2) It selects the first shipping zone that matches the delivery address.
3) If total weight is within the **First** weight, shipping = First amount.
4) If total weight exceeds First, shipping adds **Every additional** steps.
5) If the optional **range** is enabled and the weight is at/above the configured threshold, shipping is calculated as:

   shipping = ceil(totalWeight / perSetKg) × amountPerSet

Important:
- If no zone matches the address, checkout will show **shipping not available**.

---

## 11) Branding and site pages

### 10.1 Logo
Where: **Admin → Settings → Branding**

- Upload your logo.
- The same logo is used for the browser tab icon.

### 10.2 Basic pages
The store includes basic pages like Privacy/Terms/How to Order.
Update them in admin settings.

---

## 12) Contact messages

Where: `/admin/contact-messages`

- Opening a message will mark it as **Read**.
- Use filters (**New / Read / All**) to find messages.
- Use **Delete** only if you want to permanently remove the message.

---

## 13) Notifications

Where: `/admin/notifications`

Notifications are reminders for important events.
- Check this page daily.
- Clear items after handling.

---

## 14) Common problems (Troubleshooting)

### The product does not show on the store
Check:
- Visibility is on
- Not archived
- Category is visible
- Stock is not zero (if you want it to show as available)

### Customer says they paid but order is still pending
- Online: payment confirmation can take a short time.
- Refresh the order page and check notifications.

### Slip upload issues
- Ask customer to upload a clearer image.
- Ensure image is not too large.

---

## 15) Safety rules (must follow)

- Never share admin passwords.
- Don’t use admin accounts to shop.
- Double-check price changes before saving.
- Approve slips only when you are sure.
- Keep backups (DB + uploads) and verify after deployments.
