// Tests for delivery, protected payments (escrow), seller verification, admin tools
// and link previews.
process.env.NODE_ENV = 'test';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { app, orders, resetAppState } = require('../backend/server');
const market = require('../backend/marketplace');

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
const tokens = async () => ({
  customer: await login('customer@shopverse.com'),
  owner: await login('owner@shopverse.com'),
  tech: await login('chanda@shopverse.com'),
  beauty: await login('natasha@shopverse.com'),
  admin: await login('admin@shopverse.com')
});

const placeOrder = async (token, cart, body = {}) => {
  for (const [productId, quantity] of cart) {
    const added = await api('/api/cart/add', { method: 'POST', token, body: { productId, quantity } });
    assert.equal(added.status, 200, `adding ${productId} should succeed`);
  }
  const placed = await api('/api/orders', {
    method: 'POST',
    token,
    body: { shippingAddress: 'Plot 5, Kabulonga, Lusaka', paymentMethod: 'mtn_mobile_money', contactPhone: '0971234567', ...body }
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  return placed.data.order;
};

test('phone numbers are normalised to the Zambian international format', () => {
  assert.equal(market.phoneDigits('0971 234 567'), '260971234567');
  assert.equal(market.phoneDigits('+260 97 123 4567'), '260971234567');
  assert.equal(market.phoneDigits('971234567'), '260971234567');
  assert.equal(market.formatPhone('0971234567'), '+260 97 123 4567');
  assert.equal(market.phoneDigits('12'), null);
});

test('delivery fees are added per shop, with free delivery over a threshold', async () => {
  const { customer, admin } = await tokens();
  await api('/api/admin/sellers/shop-owner-demo-3/verification', { method: 'POST', token: admin, body: { status: 'verified' } });
  // Copperbelt Tech: K50 delivery, free over K1000. Amber & Oud: K35, free over K500.
  const order = await placeOrder(customer, [['prod-7', 1], ['prod-9', 1]]);
  assert.equal(order.itemsTotal, 289 + 145);
  assert.equal(order.deliveryTotal, 50 + 35);
  assert.equal(order.total, 289 + 145 + 85);

  const bigOrder = await placeOrder(customer, [['prod-6', 1]]);
  assert.equal(bigOrder.deliveryTotal, 0, 'orders over the free-delivery threshold ship free');
});

test('pickup removes the delivery fee and does not need an address', async () => {
  const { customer } = await tokens();
  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-7', quantity: 1 } });

  const cart = await api('/api/cart', { token: customer });
  assert.equal(cart.data.cart.shops[0].deliveryFee, 50);
  assert.equal(cart.data.cart.total, 339);

  const placed = await api('/api/orders', {
    method: 'POST',
    token: customer,
    body: { paymentMethod: 'cash_on_delivery', fulfilment: { 'shop-owner-demo-2': 'pickup' } }
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  assert.equal(placed.data.order.total, 289);
  assert.equal(placed.data.order.fulfillments[0].method, 'pickup');
  assert.equal(placed.data.order.shippingAddress, null);
});

test('sellers can set a WhatsApp number and delivery terms; invalid terms are rejected', async () => {
  const { owner } = await tokens();
  const updated = await api('/api/me', {
    method: 'PATCH',
    token: owner,
    body: { shopPhone: '0977 123 456', delivery: { enabled: true, fee: 25, freeOver: 300, areas: 'Lusaka', pickup: true } }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.user.shopPhone, '+260 97 712 3456');
  assert.equal(updated.data.user.delivery.fee, 25);

  const shop = await api('/api/shops/shop-owner-demo');
  assert.equal(shop.data.shop.whatsapp, '260977123456');
  assert.equal(shop.data.shop.delivery.freeOver, 300);

  const neither = await api('/api/me', { method: 'PATCH', token: owner, body: { delivery: { enabled: false, pickup: false } } });
  assert.equal(neither.status, 400);
  const badPhone = await api('/api/me', { method: 'PATCH', token: owner, body: { shopPhone: '12' } });
  assert.equal(badPhone.status, 400);
});

test('protected payment: money is held until the customer confirms, then paid out', async () => {
  const { customer, owner, admin } = await tokens();
  const order = await placeOrder(customer, [['prod-1', 2]]);
  assert.equal(order.payment.protected, true);
  assert.equal(order.paymentInstructions.reference, order.payment.reference);
  assert.match(order.payment.reference, /^SV-[0-9A-F]{8}$/);

  const shopView = async () => (await api('/api/shop-orders', { token: owner })).data.orders.find((entry) => entry.id === order.id);
  assert.equal((await shopView()).payout.state, 'awaiting_payment');

  const submitted = await api(`/api/orders/${order.id}/payment`, { method: 'POST', token: customer, body: { transactionId: 'MP240101.1234.A56789' } });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.order.paymentStatus, 'submitted');

  const queue = await api('/api/admin/payments', { token: admin });
  assert.ok(queue.data.toConfirm.some((entry) => entry.orderId === order.id));

  const confirmed = await api(`/api/admin/orders/${order.id}/payment`, { method: 'POST', token: admin, body: { action: 'confirm' } });
  assert.equal(confirmed.status, 200);
  assert.equal((await shopView()).payout.state, 'held');

  const early = await api(`/api/admin/orders/${order.id}/shops/shop-owner-demo/payout`, { method: 'POST', token: admin, body: {} });
  assert.equal(early.status, 409, 'cannot pay out before the customer has the items');

  await api(`/api/orders/${order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'shipped' } });
  const receipt = await api(`/api/orders/${order.id}/confirm`, { method: 'POST', token: customer, body: {} });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.data.order.status, 'delivered');
  assert.equal((await shopView()).payout.state, 'ready');

  const paid = await api(`/api/admin/orders/${order.id}/shops/shop-owner-demo/payout`, { method: 'POST', token: admin, body: { reference: 'MTN-OUT-1' } });
  assert.equal(paid.status, 200);
  assert.equal((await shopView()).payout.state, 'paid');
  assert.equal((await shopView()).payout.net, 49.98);
});

test('payouts release automatically if the customer stays silent after delivery', async () => {
  const { customer, owner, admin } = await tokens();
  const order = await placeOrder(customer, [['prod-1', 1]]);
  await api(`/api/admin/orders/${order.id}/payment`, { method: 'POST', token: admin, body: { action: 'confirm' } });
  await api(`/api/orders/${order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'delivered' } });

  const stored = orders.find((entry) => entry.id === order.id);
  assert.equal(market.payoutState(stored, 'shop-owner-demo'), 'held', 'still inside the protection window');
  const later = new Date(stored.fulfilment['shop-owner-demo'].deliveredAt).getTime() + market.PAYOUT_WINDOW_MS + 1000;
  assert.equal(market.payoutState(stored, 'shop-owner-demo', later), 'ready');
});

test('a reported problem freezes the payout until an admin resolves it', async () => {
  const { customer, owner, admin } = await tokens();
  const order = await placeOrder(customer, [['prod-1', 1]]);
  await api(`/api/admin/orders/${order.id}/payment`, { method: 'POST', token: admin, body: { action: 'confirm' } });
  await api(`/api/orders/${order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'delivered' } });

  const dispute = await api(`/api/orders/${order.id}/dispute`, {
    method: 'POST',
    token: customer,
    body: { shopId: 'shop-owner-demo', reason: 'One mug arrived broken.' }
  });
  assert.equal(dispute.status, 200);

  const payments = await api('/api/admin/payments', { token: admin });
  assert.ok(payments.data.disputes.some((entry) => entry.orderId === order.id));

  const resolved = await api(`/api/admin/orders/${order.id}/shops/shop-owner-demo/resolve`, {
    method: 'POST',
    token: admin,
    body: { resolution: 'refund', note: 'Seller agreed to refund.' }
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.data.entry.payoutState, 'refund_due');

  const refunded = await api(`/api/admin/orders/${order.id}/shops/shop-owner-demo/refund`, { method: 'POST', token: admin, body: {} });
  assert.equal(refunded.status, 200);
  assert.equal(refunded.data.entry.payoutState, 'refunded');
  assert.equal(refunded.data.entry.paymentStatus, 'refunded');
});

test('cancelling a paid order makes a refund due', async () => {
  const { customer, admin } = await tokens();
  const order = await placeOrder(customer, [['prod-1', 1]]);
  await api(`/api/admin/orders/${order.id}/payment`, { method: 'POST', token: admin, body: { action: 'confirm' } });

  const cancelled = await api(`/api/orders/${order.id}/cancel`, { method: 'POST', token: customer });
  assert.equal(cancelled.data.order.paymentStatus, 'refund_due');
  const payments = await api('/api/admin/payments', { token: admin });
  assert.ok(payments.data.refunds.some((entry) => entry.orderId === order.id));
});

test('admins can reject a payment that did not arrive', async () => {
  const { customer, admin } = await tokens();
  const order = await placeOrder(customer, [['prod-1', 1]]);
  await api(`/api/orders/${order.id}/payment`, { method: 'POST', token: customer, body: { transactionId: 'WRONG-ID' } });
  const rejected = await api(`/api/admin/orders/${order.id}/payment`, { method: 'POST', token: admin, body: { action: 'reject', note: 'No matching transaction.' } });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.entry.paymentStatus, 'pending');
});

test('cash on delivery is not held by ShopVerse', async () => {
  const { customer, owner } = await tokens();
  const order = await placeOrder(customer, [['prod-1', 1]], { paymentMethod: 'cash_on_delivery' });
  assert.equal(order.payment.protected, false);
  assert.equal(order.paymentInstructions, null);
  const view = (await api('/api/shop-orders', { token: owner })).data.orders.find((entry) => entry.id === order.id);
  assert.equal(view.payout.state, 'not_applicable');
});

test('seller verification: request, admin approval, badge on shop and products', async () => {
  const { beauty, admin, customer } = await tokens();
  const missing = await api('/api/me/verification', { method: 'POST', token: beauty, body: { businessName: 'Amber & Oud' } });
  assert.equal(missing.status, 400, 'an NRC or PACRA number is required');

  const requested = await api('/api/me/verification', {
    method: 'POST',
    token: beauty,
    body: { businessName: 'Amber & Oud Ltd', idNumber: '120034567', phone: '0955000003' }
  });
  assert.equal(requested.status, 200);
  assert.equal(requested.data.user.verification.status, 'pending');

  const forbidden = await api('/api/admin/sellers', { token: customer });
  assert.equal(forbidden.status, 403, 'customers cannot use admin tools');

  const sellers = await api('/api/admin/sellers', { token: admin });
  assert.equal(sellers.data.sellers[0].verification.status, 'pending', 'pending requests are listed first');

  const approved = await api('/api/admin/sellers/shop-owner-demo-3/verification', { method: 'POST', token: admin, body: { status: 'verified' } });
  assert.equal(approved.status, 200);

  const shop = await api('/api/shops/shop-owner-demo-3');
  assert.equal(shop.data.shop.verified, true);
  const product = await api('/api/products/prod-8');
  assert.equal(product.data.product.shopVerified, true);
  assert.equal(product.data.product.shop.whatsapp, '260955000003');
});

test('admin overview reports the growth metrics', async () => {
  const { customer, owner, admin } = await tokens();
  const first = await placeOrder(customer, [['prod-1', 1]]);
  await placeOrder(customer, [['prod-2', 1]]);
  await api(`/api/orders/${first.id}/status`, { method: 'PATCH', token: owner, body: { status: 'delivered' } });

  const { data } = await api('/api/admin/overview', { token: admin });
  const metrics = data.metrics;
  assert.equal(metrics.sellers, 3);
  assert.equal(metrics.verifiedSellers, 2);
  assert.equal(metrics.pendingVerifications, 1);
  assert.equal(metrics.ordersThisWeek, 2);
  assert.equal(metrics.repeatBuyerRate, 100, 'the one buyer ordered twice');
  assert.equal(metrics.completionRate, 100);
});

test('search engines get a robots.txt and a sitemap of every shop and product', async () => {
  const robots = await fetch(`${baseUrl}/robots.txt`);
  assert.match(robots.headers.get('content-type'), /text\/plain/);
  const robotsText = await robots.text();
  assert.match(robotsText, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  assert.match(robotsText, /Disallow: \/admin/);

  const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
  assert.match(sitemap.headers.get('content-type'), /application\/xml/);
  const xml = await sitemap.text();
  assert.match(xml, /<loc>http:\/\/127\.0\.0\.1:\d+\/products\/prod-5<\/loc>/);
  assert.match(xml, /<loc>http:\/\/127\.0\.0\.1:\d+\/shops\/shop-owner-demo-2<\/loc>/);
  assert.equal((xml.match(/<url>/g) || []).length, 4 + 2 + 7, 'fixed pages + 2 verified shops + their 7 products');
  assert.doesNotMatch(xml, /shop-owner-demo-3|prod-8/, 'unverified shops are not advertised');
  assert.doesNotMatch(xml, /\/admin|\/studio/);
});

test('only verified shops are visible to buyers and can sell', async () => {
  const { customer, beauty, admin } = await tokens();

  const shops = (await api('/api/shops')).data.shops.map((shop) => shop.id);
  assert.ok(!shops.includes('shop-owner-demo-3'), 'the unverified shop is not listed');
  assert.equal((await api('/api/shops/shop-owner-demo-3')).status, 404, 'buyers cannot open it');
  assert.equal((await api('/api/products/prod-8')).status, 404);
  assert.ok(!(await api('/api/products')).data.products.some((product) => product.id === 'prod-8'));
  const add = await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-8', quantity: 1 } });
  assert.equal(add.status, 404, 'cannot be bought');

  const ownView = await api('/api/shops/shop-owner-demo-3', { token: beauty });
  assert.equal(ownView.status, 200, 'the owner can still preview their own shop');
  assert.equal(ownView.data.shop.listed, false);
  assert.equal(ownView.data.shop.hiddenReason, 'unverified');
  assert.equal((await api('/api/shops/shop-owner-demo-3', { token: admin })).status, 200, 'admins can review it');
  assert.equal((await api('/api/dashboard', { token: beauty })).data.stats.listed, false);

  await api('/api/admin/sellers/shop-owner-demo-3/verification', { method: 'POST', token: admin, body: { status: 'verified' } });
  assert.equal((await api('/api/shops/shop-owner-demo-3')).status, 200, 'visible once verified');
  const added = await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-8', quantity: 1 } });
  assert.equal(added.status, 200);

  // Removing the badge hides the shop again, and checkout refuses its items.
  await api('/api/admin/sellers/shop-owner-demo-3/verification', { method: 'POST', token: admin, body: { status: 'none', note: 'Test' } });
  const order = await api('/api/orders', { method: 'POST', token: customer, body: { shippingAddress: 'Plot 5, Lusaka', paymentMethod: 'cash_on_delivery' } });
  assert.equal(order.status, 404);
  assert.match(order.data.message, /no longer available/);
});

test('admins can suspend and unsuspend a shop', async () => {
  const { owner, admin, customer } = await tokens();
  await api('/api/cart/add', { method: 'POST', token: customer, body: { productId: 'prod-1', quantity: 1 } });

  const forbidden = await api('/api/admin/sellers/shop-owner-demo/suspend', { method: 'POST', token: owner, body: {} });
  assert.equal(forbidden.status, 403, 'sellers cannot suspend shops');

  const suspended = await api('/api/admin/sellers/shop-owner-demo/suspend', { method: 'POST', token: admin, body: { reason: 'Under review' } });
  assert.equal(suspended.status, 200);
  assert.equal((await api('/api/shops/shop-owner-demo')).status, 404, 'hidden from buyers');
  assert.equal((await api('/api/products/prod-1')).status, 404);
  assert.deepEqual((await api('/api/cart', { token: customer })).data.cart.items, [], 'removed from carts');

  const add = await api('/api/products', { method: 'POST', token: owner, body: { name: 'New mug', price: 10, stock: 1 } });
  assert.equal(add.status, 403, 'a suspended seller cannot add products');
  assert.match(add.data.message, /Under review/);
  const preview = await api('/api/shops/shop-owner-demo', { token: owner });
  assert.equal(preview.data.shop.hiddenReason, 'suspended');

  const restored = await api('/api/admin/sellers/shop-owner-demo/unsuspend', { method: 'POST', token: admin });
  assert.equal(restored.status, 200);
  assert.equal((await api('/api/shops/shop-owner-demo')).status, 200, 'visible again');
});

test('admins can delete a shop once its orders are settled', async () => {
  const { customer, owner, admin } = await tokens();
  const order = await placeOrder(customer, [['prod-1', 1]], { paymentMethod: 'cash_on_delivery' });

  const wrongName = await api('/api/admin/sellers/shop-owner-demo', { method: 'DELETE', token: admin, body: { confirmName: 'Wrong' } });
  assert.equal(wrongName.status, 400, 'the shop name must be typed to confirm');

  const blocked = await api('/api/admin/sellers/shop-owner-demo', { method: 'DELETE', token: admin, body: { confirmName: 'Aisha Essentials' } });
  assert.equal(blocked.status, 409, 'cannot delete while an order is open');
  assert.match(blocked.data.message, /1 unsettled order/);

  await api(`/api/orders/${order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'delivered' } });
  const deleted = await api('/api/admin/sellers/shop-owner-demo', { method: 'DELETE', token: admin, body: { confirmName: 'Aisha Essentials' } });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.deleted.products, 3);

  assert.equal((await api('/api/shops/shop-owner-demo')).status, 404);
  assert.equal((await api('/api/me', { token: owner })).status, 401, "the seller's sessions are ended");
  const login = await api('/api/login', { method: 'POST', body: { email: 'owner@shopverse.com', password: '123456' } });
  assert.equal(login.status, 401, 'the account no longer exists');
  const history = (await api('/api/my-orders', { token: customer })).data.orders.find((entry) => entry.id === order.id);
  assert.ok(history, "the customer's order history is kept");
  assert.equal(history.items[0].shopName, 'Aisha Essentials');
});

test('listings and shops that advertise illegal drugs are refused and reported', async () => {
  const { owner, admin } = await tokens();

  for (const listing of [
    { name: 'Premium cocaine', price: 100, stock: 1 },
    { name: 'Fresh W33D 5g', price: 100, stock: 1 },
    { name: 'Party pack', description: 'Best dagga in Lusaka', price: 100, stock: 1 },
    { name: 'Tablets', category: 'Mandrax', price: 100, stock: 1 }
  ]) {
    const result = await api('/api/products', { method: 'POST', token: owner, body: listing });
    assert.equal(result.status, 400, `${JSON.stringify(listing)} should be refused`);
    assert.match(result.data.message, /Illegal drugs cannot be sold or advertised/);
  }

  const allowed = await api('/api/products', { method: 'POST', token: owner, body: { name: 'Weed killer 1L', category: 'Home & living', price: 80, stock: 4 } });
  assert.equal(allowed.status, 201, 'garden weed killer is fine');
  const seaweed = await api('/api/products', { method: 'POST', token: owner, body: { name: 'Seaweed snacks', price: 20, stock: 4 } });
  assert.equal(seaweed.status, 201);

  const edit = await api('/api/products/prod-1', { method: 'PUT', token: owner, body: { name: 'Mug set', description: 'comes with free ganja', price: 10, stock: 1 } });
  assert.equal(edit.status, 400, 'editing a product to add drugs is refused too');

  const profile = await api('/api/me', { method: 'PATCH', token: owner, body: { shopDescription: 'We sell cannabis and more' } });
  assert.equal(profile.status, 400);

  const shopSignup = await api('/api/register', {
    method: 'POST',
    body: { name: 'Bad Actor', email: 'bad@example.com', password: 'long-password', role: 'shop_owner', shopName: 'Kush Corner', shopLocation: 'Lusaka' }
  });
  assert.equal(shopSignup.status, 400, 'a shop cannot be named after a drug');

  const alerts = (await api('/api/notifications', { token: admin })).data.notifications.filter((item) => item.message.startsWith('Blocked:'));
  assert.ok(alerts.length >= 7, `admins are told about each attempt (got ${alerts.length})`);
  assert.ok(alerts.some((item) => item.message.includes('owner@shopverse.com')));
});

test('shared product and shop links get their own preview tags', async () => {
  const productPage = await (await fetch(`${baseUrl}/products/prod-5`)).text();
  assert.match(productPage, /<title>Smartphone 128GB · ZMW 3299\.00 \| ShopVerse<\/title>/);
  assert.match(productPage, /<meta property="og:title" content="Smartphone 128GB · ZMW 3299\.00 \| ShopVerse"/);
  assert.match(productPage, /<meta property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/icons\/icon-512\.png"/);
  assert.match(productPage, /Verified seller/);

  const shopPage = await (await fetch(`${baseUrl}/shops/shop-owner-demo-2`)).text();
  assert.match(shopPage, /<meta property="og:title" content="Copperbelt Tech ✓ \| Shop on ShopVerse"/);

  const unknown = await (await fetch(`${baseUrl}/products/nope`)).text();
  assert.match(unknown, /<title>ShopVerse — Shop independent stores across Zambia<\/title>/);
});
