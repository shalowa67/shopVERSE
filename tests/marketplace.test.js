process.env.NODE_ENV = 'test';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { app, products, resetAppState } = require('../backend/server');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  resetAppState();
});

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

const login = async (email) => (await api('/api/login', { method: 'POST', body: { email, password: '123456' } })).data.token;
const customerToken = () => login('customer@shopverse.com');
const ownerToken = () => login('owner@shopverse.com');
const techOwnerToken = () => login('chanda@shopverse.com');
const stockOf = (id) => products.find((product) => product.id === id).stock;

test('a failed checkout does not deduct stock for any item', async () => {
  const customer = await customerToken();
  const owner = await ownerToken();

  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-1', quantity: 2 } });
  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-2', quantity: 3 } });

  // The owner lowers stock below what is in the customer's cart.
  await api('/api/products/prod-2', { method: 'PUT', token: owner, body: { name: 'Cotton Tote Bag', price: 18.5, stock: 1 } });
  const before = stockOf('prod-1');

  const order = await api('/api/orders', { method: 'POST', token: customer, body: { shippingAddress: 'Plot 1, Lusaka' } });
  assert.equal(order.status, 400);
  assert.equal(stockOf('prod-1'), before, 'stock for the valid line must be untouched');
  assert.equal(stockOf('prod-2'), 1);
});

test('cart rejects non-integer and non-numeric quantities', async () => {
  const customer = await customerToken();
  for (const quantity of ['abc', 1.5, -1, 0]) {
    const result = await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-1', quantity } });
    assert.equal(result.status, 400, `quantity ${JSON.stringify(quantity)} should be rejected`);
  }
  const cart = await api('/api/cart', { token: customer });
  assert.deepEqual(cart.data.cart.items, []);
});

test('registration only accepts known roles and strong-enough passwords', async () => {
  const admin = await api('/api/register', {
    method: 'POST',
    body: { name: 'Mallory', email: 'mallory@example.com', password: 'long-password', role: 'admin' }
  });
  assert.equal(admin.status, 400);

  const weak = await api('/api/register', {
    method: 'POST',
    body: { name: 'Weak', email: 'weak@example.com', password: '123', role: 'customer' }
  });
  assert.equal(weak.status, 400);

  const ok = await api('/api/register', {
    method: 'POST',
    body: { name: 'Mixed Case', email: 'Mixed.Case@Example.com', password: 'long-password', role: 'customer' }
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.email, 'mixed.case@example.com');
});

test('changing email to one already in use is rejected', async () => {
  const customer = await customerToken();
  const result = await api('/api/me', { method: 'PATCH', token: customer, body: { email: 'OWNER@shopverse.com' } });
  assert.equal(result.status, 409);
});

test('multi-shop orders keep a separate status and private view per shop', async () => {
  const customer = await customerToken();
  const owner = await ownerToken();
  const tech = await techOwnerToken();

  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-1', quantity: 1 } });
  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-7', quantity: 2 } });
  const placed = await api('/api/orders', {
    method: 'POST',
    token: customer,
    body: { shippingAddress: 'Plot 1, Lusaka', paymentMethod: 'airtel_money', contactPhone: '+260 97 1234567' }
  });
  assert.equal(placed.status, 201);
  const orderId = placed.data.order.id;

  const ownerView = (await api('/api/shop-orders', { token: owner })).data.orders.find((order) => order.id === orderId);
  assert.deepEqual(ownerView.items.map((item) => item.productId), ['prod-1'], 'owners only see their own lines');
  assert.equal(ownerView.total, 24.99);

  const shipped = await api(`/api/orders/${orderId}/status`, { method: 'PATCH', token: owner, body: { status: 'shipped' } });
  assert.equal(shipped.status, 200);
  assert.equal(shipped.data.order.status, 'shipped');

  const techView = (await api('/api/shop-orders', { token: tech })).data.orders.find((order) => order.id === orderId);
  assert.equal(techView.status, 'pending', "one shop's update must not change another shop's fulfilment");

  const customerView = (await api('/api/my-orders', { token: customer })).data.orders.find((order) => order.id === orderId);
  assert.equal(customerView.status, 'pending', 'overall status follows the least-advanced shop');
  assert.equal(customerView.fulfillments.length, 2);
});

test('order status changes are validated', async () => {
  const customer = await customerToken();
  const owner = await ownerToken();
  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-1', quantity: 1 } });
  const { data } = await api('/api/orders', { method: 'POST', token: customer, body: { shippingAddress: 'Plot 1, Lusaka' } });

  const invalid = await api(`/api/orders/${data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'teleported' } });
  assert.equal(invalid.status, 400);

  await api(`/api/orders/${data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'delivered' } });
  const afterDelivery = await api(`/api/orders/${data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'pending' } });
  assert.equal(afterDelivery.status, 409);
});

test('customers can cancel pending orders and stock is returned', async () => {
  const customer = await customerToken();
  const owner = await ownerToken();
  const initial = stockOf('prod-1');

  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-1', quantity: 3 } });
  const first = await api('/api/orders', { method: 'POST', token: customer, body: { shippingAddress: 'Plot 1, Lusaka' } });
  assert.equal(stockOf('prod-1'), initial - 3);

  const cancelled = await api(`/api/orders/${first.data.order.id}/cancel`, { method: 'POST', token: customer });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.order.status, 'cancelled');
  assert.equal(stockOf('prod-1'), initial);

  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-1', quantity: 1 } });
  const second = await api('/api/orders', { method: 'POST', token: customer, body: { shippingAddress: 'Plot 1, Lusaka' } });
  await api(`/api/orders/${second.data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'confirmed' } });
  const late = await api(`/api/orders/${second.data.order.id}/cancel`, { method: 'POST', token: customer });
  assert.equal(late.status, 409, 'confirmed orders cannot be cancelled by the customer');
});

test('a customer has one review per product; a resubmission updates it', async () => {
  const customer = await customerToken();
  await api('/api/products/prod-1/reviews', { method: 'POST', token: customer, body: { rating: 2, comment: 'Meh' } });
  const second = await api('/api/products/prod-1/reviews', { method: 'POST', token: customer, body: { rating: 5, comment: 'Grew on me' } });
  assert.equal(second.status, 200);

  const { data } = await api('/api/products/prod-1');
  assert.equal(data.product.reviewCount, 1);
  assert.equal(data.product.averageRating, 5);
  assert.equal(data.product.reviews[0].verifiedPurchase, false);
});

test('logout revokes the session token', async () => {
  const customer = await customerToken();
  assert.equal((await api('/api/logout', { method: 'POST', token: customer })).status, 200);
  assert.equal((await api('/api/me', { token: customer })).status, 401);
});

test('password change requires the current password and signs out other sessions', async () => {
  const first = await customerToken();
  const second = await customerToken();

  const wrong = await api('/api/me/password', { method: 'POST', token: first, body: { currentPassword: 'nope', newPassword: 'brand-new-pass' } });
  assert.equal(wrong.status, 400);

  const ok = await api('/api/me/password', { method: 'POST', token: first, body: { currentPassword: '123456', newPassword: 'brand-new-pass' } });
  assert.equal(ok.status, 200);
  assert.equal((await api('/api/me', { token: first })).status, 200, 'the current session stays signed in');
  assert.equal((await api('/api/me', { token: second })).status, 401, 'other sessions are revoked');
});

test('repeated failed logins are rate limited', async () => {
  let last;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    last = await api('/api/login', { method: 'POST', body: { email: 'customer@shopverse.com', password: 'wrong' } });
  }
  assert.equal(last.status, 429);
});

test('unknown API routes return JSON 404s and pages fall back to the app shell', async () => {
  const missing = await api('/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.data.success, false);

  const page = await fetch(`${baseUrl}/shops/anything`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.ok(page.headers.get('content-security-policy'));
});

test('the app is installable: manifest, icons and service worker are served', async () => {
  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((entry) => entry.sizes === '192x192'));
  assert.ok(manifest.icons.some((entry) => entry.sizes === '512x512'));

  for (const entry of manifest.icons) {
    const iconResponse = await fetch(`${baseUrl}${entry.src}`);
    assert.equal(iconResponse.status, 200, `${entry.src} should exist`);
    assert.equal(iconResponse.headers.get('content-type'), 'image/png');
  }

  const worker = await fetch(`${baseUrl}/sw.js`);
  assert.equal(worker.status, 200);
  assert.equal(worker.headers.get('cache-control'), 'no-cache', 'service worker updates must never be cached');

  const page = await (await fetch(`${baseUrl}/install`)).text();
  assert.match(page, /rel="manifest"/);

  const assetLinks = await fetch(`${baseUrl}/.well-known/assetlinks.json`);
  assert.equal(assetLinks.status, 200);
  assert.match(assetLinks.headers.get('content-type'), /application\/json/);
  const [statement] = await assetLinks.json();
  assert.equal(statement.target.package_name, 'com.shopverse.app');
  assert.equal(statement.target.sha256_cert_fingerprints.length, 1);
});

test('products can be searched, filtered by category and sorted', async () => {
  // The beauty shop is unverified in the demo data, so its products are hidden until approved.
  const hidden = await api('/api/products?category=beauty%20%26%20skincare');
  assert.equal(hidden.data.total, 0);
  const admin = await login('admin@shopverse.com');
  await api('/api/admin/sellers/shop-owner-demo-3/verification', { method: 'POST', token: admin, body: { status: 'verified' } });

  const beauty = await api('/api/products?category=beauty%20%26%20skincare');
  assert.equal(beauty.data.total, 2);
  assert.ok(beauty.data.products.every((product) => product.category === 'Beauty & skincare'));

  const search = await api('/api/products?search=parfum');
  assert.deepEqual(search.data.products.map((product) => product.id), ['prod-8']);

  const cheapest = await api('/api/products?sort=price_asc&limit=1');
  assert.equal(cheapest.data.products[0].id, 'prod-2');
  assert.equal('reviews' in cheapest.data.products[0], false, 'list responses stay lightweight');

  const categories = await api('/api/categories');
  assert.ok(categories.data.categories.some((category) => category.name === 'Phones'));
});
