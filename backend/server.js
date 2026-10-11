const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const users = [
  {
    id: 'shop-owner-demo',
    name: 'Aisha Hassan',
    email: 'owner@shopverse.com',
    password: '123456',
    role: 'shop_owner',
    shopName: 'Aisha Essentials',
    shopDescription: 'andpicked home and lifestyle goods for everyday livingH.'
  },
  {
    id: 'customer-demo',
    name: 'Daniel Smith',
    email: 'customer@shopverse.com',
    password: '123456',
    role: 'customer'
  }
];

const products = [
  {
    id: 'prod-1',
    shopId: 'shop-owner-demo',
    name: 'Ceramic Mug Set',
    description: 'A set of artisanal mugs for tea and coffee lovers.',
    price: 24.99,
    stock: 18,
    createdAt: new Date().toISOString()
  },
  {
    id: 'prod-2',
    shopId: 'shop-owner-demo',
    name: 'Cotton Tote Bag',
    description: 'Breathable and durable tote for everyday errands.',
    price: 18.5,
    stock: 12,
    createdAt: new Date().toISOString()
  },
  {
    id: 'prod-3',
    shopId: 'shop-owner-demo',
    name: 'Desk Organizer',
    description: 'Compact organizer for work essentials and stationery.',
    price: 32.0,
    stock: 9,
    createdAt: new Date().toISOString()
  }
];

const carts = {};
const orders = [];

const getProductById = (productId) => products.find((entry) => entry.id === productId);
const getShopById = (shopId) => users.find((user) => user.id === shopId && user.role === 'shop_owner');

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  shopName: user.shopName || null,
  shopDescription: user.shopDescription || null
});

const getUserByEmail = (email) => users.find((user) => user.email.toLowerCase() === email.toLowerCase());
const getShopProducts = (shopId) => products.filter((product) => product.shopId === shopId);

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  const user = users.find((entry) => entry.id === token);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid session token.' });
  }

  req.user = user;
  next();
};

const getCartItems = (userId) => {
  const customerCart = carts[userId] || { items: [] };
  return customerCart.items.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    return {
      ...item,
      productName: product ? product.name : 'Unknown product',
      price: product ? product.price : 0,
      shopId: product ? product.shopId : null,
      shopName: users.find((u) => u.id === (product ? product.shopId : null))?.shopName || 'Unknown shop'
    };
  });
};

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'ShopVerse API is running.' });
});

app.post('/api/register', (req, res) => {
  const { name, email, password, role, shopName, shopDescription } = req.body || {};

  if (!name || !email || !password || !role) {
    return res.status(400).json({ success: false, message: 'Name, email, password, and role are required.' });
  }

  if (getUserByEmail(email)) {
    return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
  }

  if (role === 'shop_owner' && !shopName) {
    return res.status(400).json({ success: false, message: 'Shop owners must provide a shop name.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    password,
    role,
    shopName: role === 'shop_owner' ? shopName : null,
    shopDescription: role === 'shop_owner' ? shopDescription || 'Welcome to my shop.' : null
  };

  users.push(user);
  const token = user.id;

  res.status(201).json({ success: true, token, user: sanitizeUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const user = getUserByEmail(email);

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  res.json({ success: true, token: user.id, user: sanitizeUser(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: sanitizeUser(req.user) });
});

app.get('/api/shops', (req, res) => {
  const shops = users
    .filter((user) => user.role === 'shop_owner')
    .map((shop) => ({
      id: shop.id,
      name: shop.shopName,
      description: shop.shopDescription,
      owner: shop.name,
      productCount: getShopProducts(shop.id).length
    }));

  res.json({ success: true, shops });
});

app.get('/api/shops/:shopId', (req, res) => {
  const shop = users.find((user) => user.id === req.params.shopId && user.role === 'shop_owner');

  if (!shop) {
    return res.status(404).json({ success: false, message: 'Shop not found.' });
  }

  res.json({
    success: true,
    shop: {
      id: shop.id,
      name: shop.shopName,
      description: shop.shopDescription,
      owner: shop.name,
      products: getShopProducts(shop.id)
    }
  });
});

app.get('/api/products', (req, res) => {
  const productList = products.map((product) => {
    const shop = users.find((user) => user.id === product.shopId);
    return {
      ...product,
      shopName: shop ? shop.shopName : 'Unknown shop'
    };
  });

  res.json({ success: true, products: productList });
});

app.post('/api/products', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can add products.' });
  }

  const { name, description, price, stock } = req.body || {};

  if (!name || !price || !stock) {
    return res.status(400).json({ success: false, message: 'Product name, price, and stock are required.' });
  }

  const product = {
    id: crypto.randomUUID(),
    shopId: req.user.id,
    name,
    description: description || '',
    price: Number(price),
    stock: Number(stock),
    createdAt: new Date().toISOString()
  };

  products.push(product);
  res.status(201).json({ success: true, product });
});

app.get('/api/my-products', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can view this list.' });
  }

  res.json({ success: true, products: getShopProducts(req.user.id) });
});

app.get('/api/cart', authMiddleware, (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Only customers can use the cart.' });
  }

  const items = getCartItems(req.user.id);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  res.json({ success: true, cart: { items, subtotal } });
});

app.post('/api/cart/add', authMiddleware, (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Only customers can add products to cart.' });
  }

  const { productId, quantity = 1 } = req.body || {};
  const product = products.find((entry) => entry.id === productId);

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }

  const requestedQuantity = Number(quantity);

  if (requestedQuantity <= 0) {
    return res.status(400).json({ success: false, message: 'Quantity must be greater than zero.' });
  }

  if (!carts[req.user.id]) {
    carts[req.user.id] = { items: [] };
  }

  const currentItem = carts[req.user.id].items.find((item) => item.productId === productId);
  const currentQuantity = currentItem ? currentItem.quantity : 0;

  if (currentQuantity + requestedQuantity > product.stock) {
    return res.status(400).json({ success: false, message: 'Not enough stock available for this product.' });
  }

  if (currentItem) {
    currentItem.quantity += requestedQuantity;
  } else {
    carts[req.user.id].items.push({ productId, quantity: requestedQuantity });
  }

  res.json({ success: true, cart: carts[req.user.id] });
});

app.post('/api/cart/remove', authMiddleware, (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Only customers can manage the cart.' });
  }

  const { productId } = req.body || {};
  const cart = carts[req.user.id];

  if (!cart) {
    return res.json({ success: true, cart: { items: [] } });
  }

  cart.items = cart.items.filter((item) => item.productId !== productId);
  res.json({ success: true, cart });
});

app.post('/api/orders', authMiddleware, (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Only customers can place orders.' });
  }

  const cart = carts[req.user.id];

  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ success: false, message: 'Your cart is empty.' });
  }

  const preparedItems = [];

  for (const item of cart.items) {
    const product = products.find((entry) => entry.id === item.productId);

    if (!product) {
      return res.status(404).json({ success: false, message: `Product ${item.productId} is no longer available.` });
    }

    if (item.quantity > product.stock) {
      return res.status(400).json({ success: false, message: `Not enough stock for ${product.name}.` });
    }

    product.stock -= item.quantity;
    preparedItems.push({
      productId: product.id,
      productName: product.name,
      shopId: product.shopId,
      shopName: users.find((user) => user.id === product.shopId)?.shopName || 'Unknown shop',
      price: product.price,
      quantity: item.quantity
    });
  }

  const total = preparedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const order = {
    id: crypto.randomUUID(),
    customerId: req.user.id,
    customerName: req.user.name,
    items: preparedItems,
    total,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  orders.push(order);
  carts[req.user.id] = { items: [] };

  res.status(201).json({ success: true, order });
});

app.get('/api/my-orders', authMiddleware, (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Only customers can view their orders.' });
  }

  const customerOrders = orders.filter((order) => order.customerId === req.user.id);
  res.json({ success: true, orders: customerOrders });
});

app.get('/api/shop-orders', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can view orders.' });
  }

  const shopOrders = orders.filter((order) =>
    order.items.some((item) => item.shopId === req.user.id)
  );

  res.json({ success: true, orders: shopOrders });
});

app.get('/api/dashboard', authMiddleware, (req, res) => {
  const shopProductCount = products.filter((item) => item.shopId === req.user.id).length;
  const userOrderCount = orders.filter((order) => order.customerId === req.user.id).length;

  res.json({
    success: true,
    stats: {
      role: req.user.role,
      shopProductCount,
      userOrderCount,
      totalShops: users.filter((user) => user.role === 'shop_owner').length,
      totalOrders: orders.length
    }
  });
});

app.put('/api/products/:productId', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can update products.' });
  }

  const product = getProductById(req.params.productId);

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }

  if (product.shopId !== req.user.id) {
    return res.status(403).json({ success: false, message: 'You can only edit your own products.' });
  }

  const { name, description, price, stock } = req.body || {};

  if (!name || price === undefined || stock === undefined) {
    return res.status(400).json({ success: false, message: 'Product name, price, and stock are required.' });
  }

  product.name = String(name);
  product.description = description ?? product.description;
  product.price = Number(price);
  product.stock = Number(stock);

  res.json({ success: true, product });
});

app.delete('/api/products/:productId', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can delete products.' });
  }

  const productIndex = products.findIndex((entry) => entry.id === req.params.productId);

  if (productIndex === -1) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }

  const product = products[productIndex];

  if (product.shopId !== req.user.id) {
    return res.status(403).json({ success: false, message: 'You can only delete your own products.' });
  }

  products.splice(productIndex, 1);

  Object.values(carts).forEach((cart) => {
    cart.items = (cart.items || []).filter((item) => item.productId !== product.id);
  });

  res.json({ success: true, message: 'Product deleted successfully.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ShopVerse app listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, users, products, carts, orders };
