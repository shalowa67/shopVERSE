process.env.NODE_ENV = 'test';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createStore } = require('../backend/storage');

const { app, resetAppState } = require('../backend/server');
const { handleSessionError, loadDashboard } = require('../frontend/src/main.js');

beforeEach(() => {
  resetAppState();
});

test('stale session tokens are cleared and user is forced back to login', () => {
  const storage = {
    values: { 'shopverse-user': '{"id":"123"}', 'shopverse-token': 'stale-token' },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
    },
    setItem(key, value) {
      this.values[key] = String(value);
    },
    removeItem(key) {
      delete this.values[key];
    }
  };

  let reloadCalled = false;
  const result = handleSessionError(new Error('Invalid session token.'), storage, () => {
    reloadCalled = true;
  });

  assert.equal(result, true);
  assert.equal(storage.getItem('shopverse-user'), null);
  assert.equal(storage.getItem('shopverse-token'), null);
  assert.equal(reloadCalled, true);
});

test('stale session errors are handled without triggering an alert loop', async () => {
  const storage = {
    values: { 'shopverse-user': '{"id":"123"}', 'shopverse-token': 'stale-token' },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
    },
    setItem(key, value) {
      this.values[key] = String(value);
    },
    removeItem(key) {
      delete this.values[key];
    }
  };

  const oldLocalStorage = global.localStorage;
  const oldAlert = global.alert;
  const oldWindow = global.window;
  const oldFetch = global.fetch;

  let reloadCalled = false;
  let alertCalled = false;

  try {
    global.localStorage = storage;
    global.alert = () => {
      alertCalled = true;
    };
    global.window = {
      location: {
        reload: () => {
          reloadCalled = true;
        }
      }
    };

    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: 'Invalid session token.' })
    });

    await loadDashboard();

    assert.equal(alertCalled, false);
    assert.equal(storage.getItem('shopverse-user'), null);
    assert.equal(storage.getItem('shopverse-token'), null);
    assert.equal(reloadCalled, true);
  } finally {
    global.localStorage = oldLocalStorage;
    global.alert = oldAlert;
    global.window = oldWindow;
    global.fetch = oldFetch;
  }
});

async function request(path, options = {}) {
  const server = app.listen(0);
  const { port } = await new Promise((resolve) => server.once('listening', () => resolve(server.address())));

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
    const text = await response.text();
    return { response, text, port };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('customer login and checkout flow works', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@shopverse.com', password: '123456' })
  });

  assert.equal(login.response.status, 200, 'login should succeed');
  const loginData = JSON.parse(login.text);
  assert.equal(loginData.user.role, 'customer');

  const products = await request('/api/products');
  const productList = JSON.parse(products.text);
  assert.ok(productList.products.length > 0, 'products should be available');

  const addToCart = await request('/api/cart/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginData.token}`
    },
    body: JSON.stringify({ productId: productList.products[0].id, quantity: 1 })
  });

  assert.equal(addToCart.response.status, 200, 'cart add should succeed');

  const placeOrder = await request('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginData.token}`
    },
    body: JSON.stringify({ shippingAddress: '10 Main Street, Lagos, Nigeria' })
  });

  assert.equal(placeOrder.response.status, 201, 'order should be created');
  const order = JSON.parse(placeOrder.text);
  assert.equal(order.success, true);
  assert.ok(order.order.total >= 0);
});

test('shop owners can update and delete their products', async () => {
  const ownerLogin = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@shopverse.com', password: '123456' })
  });

  const ownerData = JSON.parse(ownerLogin.text);
  assert.equal(ownerLogin.response.status, 200);

  const productsResponse = await request('/api/my-products', {
    headers: { Authorization: `Bearer ${ownerData.token}` }
  });

  assert.equal(productsResponse.response.status, 200);
  const owningProducts = JSON.parse(productsResponse.text);
  assert.ok(owningProducts.products.length > 0);

  const productToUpdate = owningProducts.products[0];
  const updateResponse = await request(`/api/products/${productToUpdate.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerData.token}`
    },
    body: JSON.stringify({ name: 'Updated item', price: 15.5, stock: 7, description: 'Updated value' })
  });

  assert.equal(updateResponse.response.status, 200, 'product update should succeed');

  const deleteResponse = await request(`/api/products/${productToUpdate.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerData.token}` }
  });

  assert.equal(deleteResponse.response.status, 200, 'product delete should succeed');
});

test('shop search and cart quantity updates work', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@shopverse.com', password: '123456' })
  });

  const customer = JSON.parse(login.text);
  assert.equal(login.response.status, 200);

  const filteredShops = await request('/api/shops?search=Aisha');
  const shopResults = JSON.parse(filteredShops.text);
  assert.equal(filteredShops.response.status, 200);
  assert.ok(shopResults.shops.some((shop) => shop.name.toLowerCase().includes('aisha')));

  const ownerLogin = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@shopverse.com', password: '123456' })
  });

  const owner = JSON.parse(ownerLogin.text);
  const uniqueProduct = {
    name: `Quantity Test Product ${Date.now()}`,
    description: 'Temporary product for cart quantity validation.',
    price: 15.5,
    stock: 10
  };

  const createdProduct = await request('/api/products', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${owner.token}`
    },
    body: JSON.stringify(uniqueProduct)
  });

  const createdProductData = JSON.parse(createdProduct.text);
  assert.equal(createdProduct.response.status, 201, 'temporary product should be created');

  const add = await request('/api/cart/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({ productId: createdProductData.product.id, quantity: 1 })
  });

  assert.equal(add.response.status, 200, 'temporary product should be added to cart');

  const update = await request('/api/cart/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({ productId: createdProductData.product.id, quantity: 3 })
  });

  assert.equal(update.response.status, 200, 'cart quantity update should succeed');
  const updatedCart = JSON.parse(update.text);
  assert.equal(updatedCart.cart.items[0].quantity, 3);
});

test('shop owners can set a visible location for customers', async () => {
  const registerResponse = await request('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Maya Adebayo',
      email: 'maya@shopverse.com',
      password: '123456',
      role: 'shop_owner',
      shopName: 'Maya Market',
      shopDescription: 'Fresh local goods and everyday essentials.',
      shopLocation: 'Lagos, Nigeria'
    })
  });

  assert.equal(registerResponse.response.status, 201, 'shop owner registration should succeed');
  const registeredOwner = JSON.parse(registerResponse.text);
  assert.equal(registeredOwner.user.shopLocation, 'Lagos, Nigeria');

  const shopsResponse = await request('/api/shops');
  const shopData = JSON.parse(shopsResponse.text);
  const foundShop = shopData.shops.find((shop) => shop.name === 'Maya Market');

  assert.ok(foundShop, 'shop should be listed publicly');
  assert.equal(foundShop.location, 'Lagos, Nigeria');
});

test('customers receive status updates and shipping details for orders', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@shopverse.com', password: '123456' })
  });

  const customer = JSON.parse(login.text);
  assert.equal(login.response.status, 200);

  const products = await request('/api/products');
  const productList = JSON.parse(products.text);
  const productId = productList.products[0].id;

  const addToCart = await request('/api/cart/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({ productId, quantity: 1 })
  });

  assert.equal(addToCart.response.status, 200);

  const order = await request('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({
      shippingAddress: '12 Market Street, Lagos, Nigeria'
    })
  });

  assert.equal(order.response.status, 201, 'order should be created with a delivery address');
  const orderData = JSON.parse(order.text);
  assert.equal(orderData.order.status, 'pending');
  assert.equal(orderData.order.shippingAddress, '12 Market Street, Lagos, Nigeria');

  const ownerLogin = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@shopverse.com', password: '123456' })
  });

  const owner = JSON.parse(ownerLogin.text);
  const updateStatus = await request(`/api/orders/${orderData.order.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${owner.token}`
    },
    body: JSON.stringify({ status: 'shipped' })
  });

  assert.equal(updateStatus.response.status, 200, 'order status update should succeed');
  const updatedOrder = JSON.parse(updateStatus.text);
  assert.equal(updatedOrder.order.status, 'shipped');

  const customerOrders = await request('/api/my-orders', {
    headers: { Authorization: `Bearer ${customer.token}` }
  });

  const customerOrderList = JSON.parse(customerOrders.text);
  const savedOrder = customerOrderList.orders.find((item) => item.id === orderData.order.id);
  assert.ok(savedOrder, 'customer should see the order in their history');
  assert.equal(savedOrder.shippingAddress, '12 Market Street, Lagos, Nigeria');
  assert.equal(savedOrder.status, 'shipped');
});

test('orders remain unpaid and customers receive accurate notifications', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@shopverse.com', password: '123456' })
  });

  const customer = JSON.parse(login.text);
  assert.equal(login.response.status, 200);

  const products = await request('/api/products');
  const productList = JSON.parse(products.text);
  const productId = productList.products[0].id;

  const addToCart = await request('/api/cart/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({ productId, quantity: 1 })
  });

  assert.equal(addToCart.response.status, 200);

  const order = await request('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({
      shippingAddress: '7 Unity Road, Abuja, Nigeria',
      paymentMethod: 'card'
    })
  });

  assert.equal(order.response.status, 201, 'order should be created with payment confirmation');
  const orderData = JSON.parse(order.text);
  assert.equal(orderData.order.paymentStatus, 'pending');

  const notifications = await request('/api/notifications', {
    headers: { Authorization: `Bearer ${customer.token}` }
  });

  assert.equal(notifications.response.status, 200, 'notifications should be available');
  const notificationData = JSON.parse(notifications.text);
  assert.ok(notificationData.notifications.some((item) => item.type === 'order' && item.message.includes('Payment is pending.')));
});

test('Zambian payment methods can be selected without falsely settling orders', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@shopverse.com', password: '123456' })
  });

  const customer = JSON.parse(login.text);
  assert.equal(login.response.status, 200);

  const products = await request('/api/products');
  const productList = JSON.parse(products.text);

  const addToCart = await request('/api/cart/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({ productId: productList.products[0].id, quantity: 1 })
  });

  assert.equal(addToCart.response.status, 200);

  const zambiaCardOrder = await request('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({
      shippingAddress: 'Plot 12, Woodlands, Lusaka',
      paymentMethod: 'zanaco_card'
    })
  });

  assert.equal(zambiaCardOrder.response.status, 201, 'card payment selection should be accepted');
  const cardOrder = JSON.parse(zambiaCardOrder.text);
  assert.equal(cardOrder.order.paymentMethod, 'zanaco_card');
  assert.equal(cardOrder.order.paymentStatus, 'pending');
  assert.equal('cardNumber' in cardOrder.order, false, 'card details must not be stored');

  const cartAfterCardOrder = await request('/api/cart', {
    headers: { Authorization: `Bearer ${customer.token}` }
  });
  assert.equal(cartAfterCardOrder.response.status, 200);
  assert.deepEqual(JSON.parse(cartAfterCardOrder.text).cart.items, [], 'successful checkout should clear the cart');

  const secondAddToCart = await request('/api/cart/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({ productId: productList.products[0].id, quantity: 1 })
  });
  assert.equal(secondAddToCart.response.status, 200);

  const mobileMoneyOrder = await request('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({
      shippingAddress: 'Lusaka Central, Zambia',
      paymentMethod: 'mtn_mobile_money'
    })
  });

  assert.equal(mobileMoneyOrder.response.status, 201, 'mobile money orders should be accepted');
  const momoOrder = JSON.parse(mobileMoneyOrder.text);
  assert.equal(momoOrder.order.paymentMethod, 'mtn_mobile_money');
  assert.equal(momoOrder.order.paymentStatus, 'pending');
});

test('customers can leave product reviews', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@shopverse.com', password: '123456' })
  });

  const customer = JSON.parse(login.text);
  assert.equal(login.response.status, 200);

  const review = await request('/api/products/prod-1/reviews', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`
    },
    body: JSON.stringify({ rating: 5, comment: 'Great quality and fast delivery.' })
  });

  assert.equal(review.response.status, 201, 'review should be created');
  const reviewData = JSON.parse(review.text);
  assert.equal(reviewData.review.rating, 5);

  const products = await request('/api/products');
  const productList = JSON.parse(products.text);
  const product = productList.products.find((entry) => entry.id === 'prod-1');

  assert.ok(product, 'product should still exist');
  assert.equal(product.averageRating, 5);
  assert.ok(product.reviewCount >= 1);
});

test('shop owners can upload product images and customize their shop profile', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@shopverse.com', password: '123456' })
  });

  assert.equal(login.response.status, 200, 'owner login should succeed');
  const owner = JSON.parse(login.text);

  const productImage = 'data:image/png;base64,AAAA';
  const createProduct = await request('/api/products', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${owner.token}`
    },
    body: JSON.stringify({
      name: 'Candle Collection',
      description: 'Warm scented candles made in small batches.',
      price: 29.95,
      stock: 8,
      image: productImage
    })
  });

  assert.equal(createProduct.response.status, 201, 'product with image should be created');
  const createdProduct = JSON.parse(createProduct.text);
  assert.equal(createdProduct.product.image, productImage);

  const profileUpdate = await request('/api/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${owner.token}`
    },
    body: JSON.stringify({
      shopName: 'Aisha Essentials Studio',
      shopDescription: 'Handmade essentials for a calmer, more beautiful home.',
      shopLocation: 'Abuja, Nigeria',
      shopProfileImage: 'https://images.example.com/profile.png',
      shopBannerImage: 'https://images.example.com/banner.png',
      shopThemeColor: '#7c3aed'
    })
  });

  assert.equal(profileUpdate.response.status, 200, 'shop profile update should succeed');
  const profile = JSON.parse(profileUpdate.text);
  assert.equal(profile.user.shopName, 'Aisha Essentials Studio');
  assert.equal(profile.user.shopThemeColor, '#7c3aed');

  const refreshedUser = await request('/api/me', {
    headers: { Authorization: `Bearer ${owner.token}` }
  });
  const profileData = JSON.parse(refreshedUser.text);
  assert.equal(profileData.user.shopProfileImage, 'https://images.example.com/profile.png');
  assert.equal(profileData.user.shopBannerImage, 'https://images.example.com/banner.png');
});

test('registered accounts persist across server restarts', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shopverse-data-'));
  const dataFile = path.join(dataDirectory, 'shopverse.sqlite');
  const probeServer = net.createServer();
  await new Promise((resolve) => probeServer.listen(0, '127.0.0.1', resolve));
  const port = probeServer.address().port;
  await new Promise((resolve) => probeServer.close(resolve));

  const startServer = () => spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      SHOPVERSE_DATA_FILE: dataFile,
      SHOPVERSE_LEGACY_DATA_FILE: path.join(dataDirectory, 'missing-legacy.json')
    },
    stdio: 'ignore'
  });

  const waitForServer = async (child) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error('Persistent test server exited before becoming ready.');
      }

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) return;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    throw new Error('Persistent test server did not become ready.');
  };

  const stopServer = async (child) => {
    if (child.exitCode !== null) return;
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await stopped;
  };

  let server;

  try {
    server = startServer();
    await waitForServer(server);

    const registerResponse = await fetch(`http://127.0.0.1:${port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Persistent Customer',
        email: 'persistent@shopverse.test',
        password: 'test-password-123',
        role: 'customer'
      })
    });
    assert.equal(registerResponse.status, 201);
    await stopServer(server);

    const database = new DatabaseSync(dataFile);
    const persistedUser = JSON.parse(database.prepare('SELECT data FROM users WHERE id = ?').get(JSON.parse(await registerResponse.text()).user.id).data);
    database.close();
    assert.match(persistedUser.password, /^scrypt\$/);
    assert.notEqual(persistedUser.password, 'test-password-123');

    server = startServer();
    await waitForServer(server);
    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'persistent@shopverse.test', password: 'test-password-123' })
    });
    assert.equal(loginResponse.status, 200, 'registered account should remain available after restart');
  } finally {
    if (server) await stopServer(server);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('legacy JSON marketplace data imports into SQLite', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shopverse-migration-'));
  const databasePath = path.join(dataDirectory, 'shopverse.sqlite');
  const legacyFilePath = path.join(dataDirectory, 'shopverse.json');
  const legacyState = {
    users: [{ id: 'user-1', name: 'Legacy User', password: 'scrypt$salt$hash' }],
    products: [{ id: 'product-1', name: 'Legacy Product' }],
    carts: { 'user-1': { items: [{ productId: 'product-1', quantity: 2 }] } },
    orders: [{ id: 'order-1', customerId: 'user-1' }],
    productReviews: [{ id: 'review-1', productId: 'product-1' }],
    notifications: [{ id: 'notification-1', userId: 'user-1' }]
  };
  fs.writeFileSync(legacyFilePath, JSON.stringify(legacyState));

  try {
    const store = createStore(databasePath, legacyFilePath);
    assert.deepEqual(store.load(), legacyState);
    store.close();
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
