# ShopVerse operations handbook

For the people who run ShopVerse day to day: confirming payments, paying sellers,
handling refunds and disputes, and verifying sellers. All of it happens in the
**admin dashboard** at `/admin`.

## One-time setup

Set these environment variables on the web service (on Render: **Environment**),
then redeploy.

| Variable | Example | Purpose |
|---|---|---|
| `SHOPVERSE_ADMIN_EMAILS` | `you@example.com,partner@example.com` | Accounts that get the admin dashboard. Register these as normal accounts first. |
| `SHOPVERSE_PAY_ACCOUNT_NAME` | `ShopVerse Ltd` | The account name buyers see when paying |
| `SHOPVERSE_PAY_MTN` | `096 123 4567` | MTN MoMo number buyers pay into |
| `SHOPVERSE_PAY_AIRTEL` | `097 123 4567` | Airtel Money number |
| `SHOPVERSE_PAY_ZAMTEL` | `095 123 4567` | Zamtel Kwacha number |
| `SHOPVERSE_PAY_BANK` | `Zanaco · Acc 0123456789 · Cairo Rd` | Bank transfer details |
| `SHOPVERSE_COMMISSION_PERCENT` | `0` | Commission on item value. Keep at 0 for launch. |

**Use dedicated business accounts** for the payment numbers, kept separate from
personal money, so every statement line belongs to an order.

If a payment number is not set, buyers who choose that method are told ShopVerse
will contact them with payment details.

## Daily routine

Open **Admin → Overview**. The **Needs your attention** box lists everything
waiting. Work through **Admin → Payments** from top to bottom.

### 1. Payments to confirm (at least twice a day)

Each card shows the reference (e.g. `SV-2B7277F1`), the amount, the method and the
buyer's transaction ID.

1. Open the MoMo / Airtel / bank statement for the ShopVerse account.
2. Find a payment with **the same amount** and the **reference or transaction ID**.
3. If it's there, tap **Money received**. The seller is told to ship.
4. If it's not there, tap **Not found** and add a short note. The buyer is asked to
   check and resubmit.

Never confirm a payment you cannot see on the statement.

### 2. Courier delivery receipts (before seller payouts)

Create courier logins under **Admin → Delivery companies**. Add the company name
and create a separate login for each courier staff member. Share temporary passwords
through a secure channel. Adding a company makes it selectable by customers at
checkout; it does not connect to that company's external system.

When a courier submits a delivery receipt, open **Admin → Payments → Courier
delivery receipts**. Match the company and receipt/reference against the courier's
proof, then tap **Approve delivery**. This confirmation is required before a courier
delivery's protected seller payout can become ready. Courier deliveries do not
auto-release after three days, and customers cannot confirm them on the courier's
behalf.

### 3. Disputes (same day)

A buyer reported a problem. The seller's money is frozen until you decide.

1. Read the buyer's reason on the card.
2. Contact both sides. The seller's WhatsApp is on the card; the buyer's phone is on
   the order. Ask for photos if items are damaged or wrong.
3. Decide:
   - **Pay the seller** if the order was delivered as described.
   - **Refund the customer** if it never arrived, or was damaged or not as
     described. Arrange the return of goods with the seller where it makes sense.
4. Add a short note. Both sides are notified.

### 4. Payouts ready (daily, or on fixed payout days)

The buyer has their order and the money can go to the seller.

1. Send the **amount shown** (after commission) to the seller's number, by MoMo or
   bank.
2. Tap **Mark as paid** and paste your transfer reference.

Sellers trust ShopVerse when payouts are fast. Aim for the same day, or tell sellers
your fixed payout days (e.g. Tuesdays and Fridays).

### 5. Refunds due (same day)

An order was cancelled after the buyer paid.

1. Send the amount back to the buyer's number.
2. Tap **Mark as refunded**. The buyer is notified.

## Verifying sellers

**Only verified shops can sell.** Until you verify a shop, buyers can't see it or buy
from it, so check the Sellers tab daily: new sellers are waiting on you to go live.

Requests appear first on **Admin → Sellers** with the business name, NRC or PACRA
number and a note. Before tapping **Verify**:

- [ ] **Call or WhatsApp** the seller on the number given. A real person answers.
- [ ] The **name matches** their NRC, or the business matches its PACRA
      registration.
- [ ] The **shop looks real**: real product photos, sensible prices, a plausible
      location.
- [ ] Ideally, **visit the shop** or see a video call of the stock (at least for the
      first sellers).

If anything doesn't check out, tap **Reject** and say why. The seller can fix it and
apply again. Use **Remove badge** if a verified seller later breaks the rules (for
example, repeated disputes lost).

## Suspending or deleting a shop

Both are on **Admin → Sellers**, on each seller's card.

**Suspend** is the first step for any problem: complaints, suspected scams, blocked
drug listings, or a seller who stops responding. It can be undone.
- The shop and its products are hidden from buyers immediately, and its items are
  removed from customers' carts.
- The seller can still sign in to see and finish existing orders, but can't add or
  edit products or request verification.
- The seller is notified with the reason you give.
- **Unsuspend** reverses it. A verified shop becomes visible again.

**Delete** is permanent. It removes the shop, all its products and reviews, and the
seller's account (they are signed out and can no longer log in).
- You must type the shop's exact name to confirm.
- It is **refused while the shop has unsettled orders**: orders not yet delivered or
  cancelled, or money still held, ready to pay out or due as a refund. This stops
  customers' money from being left in limbo. Suspend the shop, settle those orders
  on the **Payments** tab, then delete.
- Customers keep their past orders in **My orders**.

## Blocked listings (illegal drugs)

When a seller tries to post a product or shop that mentions illegal drugs, it is
refused and you get a notification starting with **"Blocked:"** naming the account.
When you see one:

1. Open **Admin → Sellers** and find the shop.
2. If it looks deliberate, tap **Suspend** (or **Delete** for repeat offenders). The
   shop is hidden from buyers immediately.
3. Keep a note of the account. Repeated attempts are a reason to refuse future
   verification.

## Weekly review

Every week, look at the **Overview** numbers and compare them with the targets in the
[growth strategy](STRATEGY.md#what-we-measure):

- **Active sellers** growing? If not, onboard more.
- **Completion rate** below 90%? Talk to the sellers with cancellations or disputes
  (the dispute count is on the Sellers tab).
- **Repeat buyers** rising? That's the clearest sign the trust promise is working.

## Testing locally

With `NODE_ENV=development`, demo data includes an admin account:

| Role | Email | Password |
|---|---|---|
| Admin | admin@shopverse.com | 123456 |
| Customer | customer@shopverse.com | 123456 |
| Shop owner (verified) | owner@shopverse.com | 123456 |
| Shop owner (pending verification) | natasha@shopverse.com | 123456 |

Demo data is only created for an **empty** database. If your local database was
created before these features, delete the `backend/data/` folder and restart
`npm run dev` to recreate it. This erases local test data only.
