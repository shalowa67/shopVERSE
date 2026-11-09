# ShopVerse features

How the marketplace works for buyers, sellers and admins. For the reasons behind
these features, see the [growth strategy](STRATEGY.md). For day-to-day admin work,
see the [operations handbook](OPERATIONS.md).

## Sign-in and password recovery

Customers and sellers can sign in with email and password or Google. Google ID
tokens are verified by the ShopVerse server; a first-time Google sign-in creates a
customer account. An existing account can be connected to Google only when the
verified Google email matches its account email. Seller accounts are created using
the seller registration form.

On **Forgot your password?**, ShopVerse emails a single-use reset link that expires
after 30 minutes. Successful resets revoke all active sessions. Requests do not
reveal whether an email address has an account.

Google sign-in requires `GOOGLE_CLIENT_ID`. Password recovery requires Resend's
`RESEND_API_KEY`, a verified `RESEND_FROM_EMAIL`, and the canonical
`SHOPVERSE_PUBLIC_URL`. See the [operations handbook](OPERATIONS.md#account-sign-in-and-password-recovery).

## Protected payments

Buyers pay **ShopVerse**, not the seller. ShopVerse holds the money until the buyer
has their order.

### The flow

1. **Order.** At checkout the buyer chooses MTN MoMo, Airtel Money, Zamtel Kwacha
   or bank transfer. The order gets a payment reference such as `SV-2B7277F1`.
2. **Pay.** On **My orders**, the buyer sees the exact amount, the ShopVerse account
   number to pay and the reference to quote. After paying, they enter the
   transaction ID from their confirmation SMS and tap **I've paid**.
3. **Confirm.** An admin checks the ShopVerse account statement and taps
   **Money received**. The seller is told "Payment secured: ship now".
4. **Deliver.** The seller ships and updates the order status. When they mark it
   **delivered**, the buyer is asked to confirm.
5. **Release.** The payout becomes ready when either:
   - the buyer taps **I received it**, or
   - 3 days pass after the seller marked it delivered with no problem reported.
  For courier deliveries, the buyer selects the company at checkout. A company
  courier login submits the delivery receipt/reference and the eight-digit code
  issued to the buyer after the seller marks the shipment as shipped. The code
  expires after 30 minutes. A ShopVerse admin must review and approve the receipt.
  Customer confirmation and automatic release are disabled for these deliveries.
  This is an in-app confirmation workflow, not a live courier API integration.
6. **Pay out.** The admin sends the seller their money (minus any commission) and
   taps **Mark as paid**.

### When something goes wrong

- **Buyer cancels before the shop confirms:** if they already paid, a refund is
  due and the admin sees it under **Refunds due**.
- **Seller cancels their part:** the same refund process applies to that shop's
  share.
- **Buyer reports a problem** with **Report a problem** on a shipped or delivered
  order: the seller's payout is frozen (**On hold**) until an admin resolves it by
  either **paying the seller** or **refunding the buyer**.
- **Payment not found:** the admin taps **Not found** and the buyer is asked to
  check their transaction ID and submit it again.

### Payment states

What the seller sees on each order in the studio:

| State | Meaning |
|---|---|
| Waiting for payment | The buyer hasn't paid yet. Don't ship. |
| Payment secured | ShopVerse holds the money. Ship now. |
| On hold: problem reported | The buyer reported a problem; ShopVerse is reviewing it. |
| Payout ready | The buyer has the order; ShopVerse is about to pay the seller. |
| Paid out | ShopVerse has sent the seller their money. |
| Refund due / Refunded | Cancelled after payment; the buyer is being or has been refunded. |
| Cash on delivery | Not protected; the seller collects cash from the buyer. |

### Commission

`SHOPVERSE_COMMISSION_PERCENT` (default `0`) is deducted from the item value of
each payout. Delivery fees always go to the seller in full. Sellers see the
commission line on each order.

### Card payments

Cards are not offered at checkout yet, because card payments cannot be checked by
hand. They return when an online payment provider is connected (see the
[roadmap](STRATEGY.md#roadmap-after-launch)).

## Delivery and pickup

Each seller sets the following in **Studio → Shop profile → Delivery & pickup**:

- **Delivery on or off**, and a **delivery fee** (0 means free).
- **Free delivery over** an order amount (optional).
- **Where they deliver**, as free text, e.g. "Lusaka same day; other towns by bus
  parcel".
- **Pickup**: buyers can collect from the shop for free.

At checkout the buyer picks **delivery** or **pickup** for each shop in their cart.
For delivery, the buyer also selects a courier company activated by an admin.
Fees and the total update instantly. A delivery address is only required when at
least one shop is delivering. The shop's terms also appear on its storefront, shop
card and product pages.

Admins create courier logins under **Admin → Delivery companies**, then verify and
activate each account. Only companies with an active account appear at checkout.
Courier accounts can only see deliveries assigned to their company. After the seller
marks an order shipped, the customer sees a time-limited delivery code in **My
orders**. The courier must enter that code with the receipt/reference. The receipt
appears under **Admin → Payments → Courier delivery receipts**. Admin approval
makes a protected payout eligible for the existing manual payout process.
Courier deliveries never use the customer-confirmation or automatic three-day
release path. Shipments still unconfirmed after seven days appear in an admin
exception queue; only resolve one after independently confirming receipt with the
customer, and record the investigation in the required note.

## Verified sellers

**Only verified shops can sell.** A new shop can set up its profile and add products
straight away, but buyers can't see it or buy from it until an admin verifies it.
While unverified, the shop and its products are left out of:

- search, the home page and shop listings
- product pages and storefronts, which return "not found" to everyone except the
  owner and admins
- carts and checkout
- the sitemap and link previews

The seller sees a notice in their studio, and a "Preview: buyers can't see this"
banner on their own storefront. If an admin later removes the badge, the shop is
hidden again and its items can no longer be ordered.

To turn this off, set `SHOPVERSE_REQUIRE_VERIFICATION=false`.

### How verification works

1. **Request.** A seller opens **Studio → Shop profile → Seller verification** and
   submits their business name, NRC or PACRA number and WhatsApp number.
2. **Review.** Admins are notified. The request appears first on **Admin →
   Sellers**, with the details to check.
3. **Decide.** The admin taps **Verify** or **Reject** (with a reason that is sent to
   the seller). A verified badge can also be removed later.
4. **Badge.** Verified shops show **✓ Verified** on their storefront, shop cards,
   product cards, product pages, checkout and link previews.

## Prohibited items: illegal drugs

ShopVerse refuses any product or shop that advertises illegal drugs. The check runs
when a seller:

- creates or edits a product (name, description and category)
- registers a shop or edits its name or description

Refused items are never saved. The seller sees a message explaining why, and every
admin gets a notification naming the account and the term that was found.

**What it catches:** cocaine, heroin, methamphetamine/meth, marijuana, cannabis, weed,
dagga, ganja, chamba, bhang, kush, hashish, mandrax, fentanyl, ketamine, MDMA, LSD,
THC, opium, magic mushrooms/psilocybin and pre-rolls. It also catches common
disguises such as `c0caine`, `w33d` and `c o c a i n e`.

**What it allows:** ordinary items whose names contain those letters, such as
"seaweed", "weed killer", "heroine costume", "methylated spirits" and "Coke 2L".

Anything listed before the check existed is hidden automatically and marked
**Blocked** in the seller's inventory. The terms live in
[`backend/moderation.js`](../backend/moderation.js). Admins should still report
anything suspicious that slips through, and remove the seller's verified badge.

## WhatsApp and sharing

- **Rich link previews:** shared product and shop links show the item's photo,
  name, price and seller in WhatsApp, Facebook and X.
- **Share buttons** on every product and storefront: the phone's share sheet, a
  direct WhatsApp share, and copy link.
- **Chat with the seller:** sellers add a WhatsApp number, and buyers get **Ask the
  seller** on products, **Chat on WhatsApp** on storefronts, and **Message shop**
  on their orders.
- **Message the customer:** sellers get a one-tap WhatsApp link on each order.
- **Share & grow tab** in the studio:
  - the seller's shop link with a copy button
  - a ready-made WhatsApp status message
  - one-tap sharing for in-stock products
  - a checklist of what drives first sales

## Admin dashboard

Open it at `/admin`. It is available to accounts with the admin role, or whose email
is in `SHOPVERSE_ADMIN_EMAILS`.

| Tab | What's there |
|---|---|
| **Overview** | Growth metrics (active sellers, verified sellers, orders this week vs last, completion rate, repeat buyers, sales, money held, commission) and a **Needs your attention** list |
| **Sellers** | Every seller with their contact, products, orders and disputes. Pending verification requests are listed first. |
| **Payments** | Work queues: payments to confirm, disputes, payouts ready, refunds due, money held, and unpaid orders |

## API reference (new endpoints)

| Method & path | Who | What |
|---|---|---|
| `GET /api/payment-info` | Anyone | The accounts buyers pay into, and the protection period |
| `GET /api/couriers` | Anyone | Courier companies available at checkout |
| `POST /api/orders/:id/shops/:shopId/delivery-code` | Customer | Issue a 30-minute delivery code after the shop marks the courier shipment shipped |
| `POST /api/orders/:id/payment` | Customer | Submit the transaction ID (`{ transactionId }`) |
| `POST /api/orders/:id/confirm` | Customer | Confirm receipt for non-courier deliveries (`{ shopId? }`) |
| `POST /api/orders/:id/dispute` | Customer | Report a problem (`{ shopId, reason }`); freezes the payout |
| `GET /api/courier/deliveries` | Courier | List shipped orders assigned to the courier's company |
| `POST /api/courier/orders/:id/shops/:shopId/delivered` | Active courier | Submit delivery receipt and customer code (`{ receiptReference, recipientCode }`) |
| `POST /api/me/verification` | Shop owner | Request verification (`{ businessName, idNumber, phone, note? }`) |
| `PATCH /api/me` | Shop owner | Also accepts `shopPhone` and `delivery: { enabled, fee, freeOver, areas, pickup }` |
| `POST /api/orders` | Customer | Also accepts `fulfilment: { [shopId]: 'delivery' \| 'pickup' }` |
| `GET /api/admin/overview` | Admin | Growth metrics |
| `GET /api/admin/sellers` | Admin | Sellers with verification details |
| `POST /api/admin/sellers/:shopId/verification` | Admin | `{ status: 'verified' \| 'rejected' \| 'none', note? }` |
| `POST /api/admin/sellers/:shopId/suspend` | Admin | Hide the shop and freeze its listings (`{ reason? }`) |
| `POST /api/admin/sellers/:shopId/unsuspend` | Admin | Lift a suspension |
| `DELETE /api/admin/sellers/:shopId` | Admin | Permanently delete the shop and seller account (`{ confirmName }`); refused while orders are unsettled |
| `GET /api/admin/payments` | Admin | Payment and payout work queues |
| `GET /api/admin/couriers` | Admin | Courier companies and logins |
| `POST /api/admin/couriers` | Admin | Create a courier login (`{ name, email, password, courierCompany }`) |
| `PATCH /api/admin/couriers/:courierId` | Admin | Activate or disable a courier (`{ active: boolean }`) |
| `POST /api/admin/orders/:id/shops/:shopId/delivery-approval` | Admin | Approve a courier delivery receipt |
| `POST /api/admin/orders/:id/shops/:shopId/delivery-exception` | Admin | Resolve an overdue courier delivery after seven days (`{ note }`); records an audit event |
| `POST /api/admin/orders/:id/payment` | Admin | `{ action: 'confirm' \| 'reject', note? }` |
| `POST /api/admin/orders/:id/shops/:shopId/payout` | Admin | Mark a payout as sent (`{ reference? }`) |
| `POST /api/admin/orders/:id/shops/:shopId/refund` | Admin | Mark a refund as sent |
| `POST /api/admin/orders/:id/shops/:shopId/resolve` | Admin | Settle a dispute (`{ resolution: 'release' \| 'refund', note? }`) |

The business rules for delivery fees, payout states and metrics live in
[`backend/marketplace.js`](../backend/marketplace.js). They are covered by
[`tests/growth.test.js`](../tests/growth.test.js).
