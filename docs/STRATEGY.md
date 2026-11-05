# ShopVerse growth strategy

## Positioning

**ShopVerse is the safe way to buy from small sellers.**

Many Zambian shoppers already buy from sellers on WhatsApp, Facebook and Instagram,
but every purchase is a risk: no proof the seller is real, payment up front, and
no one to turn to when an order never arrives. ShopVerse removes that risk. We do
not try to beat large retailers on price; we win on **trust**.

> Pay safely. The seller only gets paid when you receive your item.

That single promise is the message for every advert, poster and conversation.

## The three problems we solve

| Buyer's worry | What ShopVerse does | Where it lives in the product |
|---|---|---|
| "Will this seller scam me?" | **Verified sellers.** ShopVerse checks each seller's NRC or PACRA details before giving them the ✓ Verified badge. Real reviews from buyers. | Seller verification ([Features](FEATURES.md#verified-sellers)) |
| "I don't want to pay before I see it." | **Protected payment.** The buyer pays ShopVerse. We hold the money and release it to the seller only after the buyer confirms delivery, or 3 days after delivery if they report no problem. | Protected payments ([Features](FEATURES.md#protected-payments)) |
| "How will it reach me?" | **Clear delivery terms.** Every shop shows its delivery fee, free-delivery threshold, delivery areas and pickup option before checkout. | Delivery settings ([Features](FEATURES.md#delivery-and-pickup)) |

## How we grow: sellers bring the buyers

A marketplace has a chicken-and-egg problem: buyers come for sellers, and sellers
come for buyers. We solve it from the **seller side**, because every seller
already has customers.

- **Every storefront link is the seller's own website.** Sellers share it on their
  WhatsApp status, Facebook page and Instagram bio. Shared links show the product
  photo, name and price, so every seller markets ShopVerse to their own customers
  for free.
- **The Share & grow tab** in the seller studio gives sellers a copyable shop link,
  a ready-made WhatsApp status message, one-tap product sharing and a checklist of
  what drives first sales.
- **Free for sellers at launch.** There are no listing fees. Once trust and volume
  are established, ShopVerse takes a small commission (about 3–5%) only on completed
  sales: sellers pay only when they earn. Set it with `SHOPVERSE_COMMISSION_PERCENT`.

## Launch plan

### Month 1: one city, a few categories, hand-picked sellers
- **Focus:** Lusaka, in two or three categories where scams are common and items
  cost more: **phones and electronics**, **fashion**, and **beauty**.
- **Onboard the first 30–50 sellers personally.** Visit them, set up their shop with
  them, photograph their products, verify them, and show them how to share their
  link. This is the most important work of the first month.
- **Run every payment by hand** through the admin dashboard (see
  [Operations](OPERATIONS.md)). Speed and honesty here build the reputation.

### Months 2–3: let the network grow
- **Seller referrals:** "bring a seller, get a month of free promotion".
- **Campus ambassadors** at UNZA, CBU and Mulungushi, each with their own shop link.
- **Social proof:** share real buyer reviews and success stories on social media.
- **Expand categories** only once the first ones have regular weekly orders.

### Months 4–6: automate and expand
- **Automatic payments:** connect a mobile-money payment provider, so payments are
  confirmed without an admin.
- **Order alerts by SMS or WhatsApp**, so sellers never miss an order.
- **Second city:** expand to Kitwe and Ndola (the Copperbelt), using the same
  playbook.
- **Turn on commission** once sellers see steady sales.

## What we measure

These are on the admin dashboard's **Overview** tab. Review them every week.

| Metric | Why it matters | Early target |
|---|---|---|
| **Active sellers** (5+ products listed) | Supply. Empty shops don't sell. | 30 by end of month 1 |
| **Verified sellers** | Trust. Our main promise. | Every active seller |
| **Orders this week** (vs last week) | Demand and growth. | Growing every week |
| **Completion rate** (delivered vs cancelled) | Whether sellers fulfil reliably. | Above 90% |
| **Repeat buyers** (ordered 2+ times) | The real sign buyers trust us. | Above 25% |
| **Sales, last 30 days** | Money moving through the platform. | Growing every month |

## Roadmap after launch

| Priority | Item | Needs |
|---|---|---|
| 1 | Automatic mobile-money payments | An account with a payment provider that supports MTN MoMo and Airtel Money in Zambia. Compare fees, settlement times and API support. |
| 2 | SMS / WhatsApp order alerts | An SMS provider, or the WhatsApp Business API |
| 3 | Seller payouts by mobile money from the dashboard | The same payment provider, using payout or disbursement APIs |
| 4 | Promoted listings (paid placement) | Volume first; a second revenue stream |
| 5 | Courier partnerships and delivery tracking | Agreements with local couriers or bus-parcel services |
| 6 | Card payments | The payment provider above, with card acceptance |
