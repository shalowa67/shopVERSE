const test = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../backend/server');

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
    }
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
