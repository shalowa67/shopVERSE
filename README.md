# ShopVerse

ShopVerse is a multi-vendor marketplace for independent shops. Customers browse
every shop at once, fill one cart and check out with mobile money, card, bank
transfer or cash on delivery. Sellers get a branded storefront, inventory
management and order fulfilment tools.

## Features

**For customers**
- Marketplace-wide product search, category filters, sorting and an in-stock filter
- Shareable product and storefront pages (`/products/:id`, `/shops/:id`)
- One cart across many shops, a checkout with delivery details and payment choice
- Order tracking with per-shop shipment status, plus free cancellation until a shop confirms
- Reviews (one per product, marked "Verified purchase" when bought) and notifications

**For sellers**
- Seller studio with revenue, open orders, rating and low-stock KPIs
- Product editor with image upload (images are downscaled in the browser before upload)
- Drag-and-drop ordering of the storefront catalogue
- Order management: each shop sees and updates only its own lines of an order
- Storefront branding (logo, banner, brand colour) with a live preview

**Platform**
- Scrypt password hashing, hashed session tokens, logout, password change that
  signs out other devices
- Login and registration rate limiting, security headers (CSP, HSTS in production,
  frame and MIME protections)
- Uploaded images are served from `/media/...` with long-lived cache headers, so
  list responses stay small
- SQLite persistence locally, PostgreSQL in production

## Getting started

Requires Node.js 22.5 or newer (for the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:3000
```

With `NODE_ENV=development` the app seeds demo shops and products. The sign-in
page shows one-click demo logins:

| Role       | Email                    | Password |
|------------|--------------------------|----------|
| Customer   | customer@shopverse.com   | 123456   |
| Shop owner | owner@shopverse.com      | 123456   |

Demo accounts are created only when `NODE_ENV` is `development` or `test`, and
they cannot sign in in any other environment.

## Scripts

| Command         | What it does                                  |
|-----------------|-----------------------------------------------|
| `npm start`     | Run the server                                |
| `npm run dev`   | Run with auto-restart on file changes         |
| `npm test`      | Run the API and frontend test suites          |
| `npm run check` | Syntax-check the server and browser code      |

## Project layout

```
backend/
  server.js            Express app: API routes, auth, validation, security headers
  seed.js              Development/test demo data
  storage.js           SQLite snapshot store (local development)
  postgres-storage.js  PostgreSQL snapshot store (production)
frontend/
  index.html           App shell, SEO and social meta tags
  styles.css           Design system and all component styles
  src/main.js          Single-page app (router, views, cart, checkout, studio)
tests/
  smoke.test.js        End-to-end API flows and frontend helpers
  marketplace.test.js  Business-rule regression tests
```

## Deployment (Render)

1. Create a PostgreSQL database and set the web service's `DATABASE_URL` to its
   internal connection URL.
2. Set `NODE_ENV=production`.
3. Build command `npm install`, start command `npm start`.

Production startup fails without `DATABASE_URL`, because Render's free web services
do not keep files between deployments. Data already lost from an ephemeral SQLite
file cannot be recovered, so restore a backup before deploying if you have one.

## Payments

Payment providers are not connected yet. Orders are recorded with the customer's
chosen method and `paymentStatus: "pending"`, and the shop arranges payment
directly. Card details are never collected or stored.
