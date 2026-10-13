const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createStore } = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const persistenceEnabled = process.env.NODE_ENV !== 'test' && process.env.SHOPVERSE_DISABLE_PERSISTENCE !== 'true';
const demoDataEnabled = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
const dataFilePath = process.env.SHOPVERSE_DATA_FILE || path.join(__dirname, 'data', 'shopverse.sqlite');
const legacyDataFilePath = process.env.SHOPVERSE_LEGACY_DATA_FILE || path.join(__dirname, 'data', 'shopverse.json');
const store = persistenceEnabled ? createStore(dataFilePath, legacyDataFilePath) : null;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const users = [];
const products = [];
const carts = {};
const orders = [];
const productReviews = [];
const notifications = [];
const sessions = new Map();

const seedUsers = [
  {
    id: 'shop-owner-demo',
    name: 'Aisha Hassan',
    email: 'owner@shopverse.com',
    password: '123456',
    role: 'shop_owner',
    shopName: 'Aisha Essentials',
    shopDescription: 'Handpicked home and lifestyle goods for everyday living.',
    shopLocation: 'Kano, Nigeria'
  },
  {
    id: 'customer-demo',
    name: 'Daniel Smith',
    email: 'customer@shopverse.com',
    password: '123456',
    role: 'customer'
  }
];

const seedProducts = [
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

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

const passwordMatches = (password, storedPassword) => {
  const [algorithm, salt, storedHash] = String(storedPassword || '').split('$');

  if (algorithm !== 'scrypt' || !salt || !storedHash) {
    return false;
  }

  const candidateHash = crypto.scryptSync(password, salt, 64);
  const expectedHash = Buffer.from(storedHash, 'hex');
  return candidateHash.length === expectedHash.length && crypto.timingSafeEqual(candidateHash, expectedHash);
};

const resetAppState = () => {
  users.length = 0;
  products.length = 0;
  sessions.clear();
  Object.keys(carts).forEach((cartKey) => delete carts[cartKey]);
  orders.length = 0;
  productReviews.length = 0;
  notifications.length = 0;

  if (demoDataEnabled) {
    seedUsers.forEach((user) => users.push({ ...user, password: hashPassword(user.password) }));
    seedProducts.forEach((product) => products.push({ ...product }));
  }
};

const persistAppState = () => {
  if (!store) {
    return;
  }

  store.save({ users, products, carts, orders, productReviews, notifications });
};

const restoreAppState = () => {
  const savedState = store ? store.load() : null;

  if (!savedState || savedState.users.length === 0) {
    resetAppState();
    persistAppState();
    return;
  }

  users.push(...savedState.users);
  products.push(...savedState.products);
  Object.assign(carts, savedState.carts);
  orders.push(...savedState.orders);
  productReviews.push(...savedState.productReviews);
  notifications.push(...savedState.notifications);
};

restoreAppState();

const getProductById = (productId) => products.find((entry) => entry.id === productId);
const getShopById = (shopId) => users.find((user) => user.id === shopId && user.role === 'shop_owner');

const getShopProducts = (shopId) => products
  .filter((product) => product.shopId === shopId)
  .map((product, index) => ({ product, index }))
  .sort((a, b) => {
    const orderA = Number.isInteger(a.product.sortOrder) ? a.product.sortOrder : a.index;
    const orderB = Number.isInteger(b.product.sortOrder) ? b.product.sortOrder : b.index;
    return orderA - orderB || a.index - b.index;
  })
  .map(({ product }) => product);

const getNextShopProductOrder = (shopId) => getShopProducts(shopId)
  .reduce((nextOrder, product) => Math.max(nextOrder, product.sortOrder + 1), 0);

users
  .filter((user) => user.role === 'shop_owner')
  .forEach((shop) => {
    getShopProducts(shop.id).forEach((product, index) => {
      if (!Number.isInteger(product.sortOrder) || product.sortOrder < 0) {
        product.sortOrder = index;
      }
    });
  });

const getProductReviewList = (productId) => productReviews
  .filter((entry) => entry.productId === productId)
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

const addProductMeta = (product) => {
  const reviews = getProductReviewList(product.id);
  const reviewCount = reviews.length;
  const averageRating = reviewCount > 0
    ? reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviewCount
    : 0;

  return {
    ...product,
    reviews,
    reviewCount,
    averageRating: Number(averageRating.toFixed(1))
  };
};

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  shopName: user.shopName || null,
  shopDescription: user.shopDescription || null,
  shopLocation: user.shopLocation || null,
  shopProfileImage: user.shopProfileImage || null,
  shopBannerImage: user.shopBannerImage || null,
  shopThemeColor: user.shopThemeColor || '#4f46e5'
});

const normalizeImageValue = (value) => {
  const image = String(value || '').trim();

  if (!image) {
    return null;
  }

  if (/^data:image\//i.test(image) || /^https?:\/\//i.test(image)) {
    return image;
  }

  return null;
};

const createNotification = (userId, type, message) => {
  const notification = {
    id: crypto.randomUUID(),
    userId,
    type,
    message,
    read: false,
    createdAt: new Date().toISOString()
  };

  notifications.push(notification);
  return notification;
};

const getUserByEmail = (email) => users.find((user) => user.email.toLowerCase() === email.toLowerCase());
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  const token = match ? match[1] : '';

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  const userId = sessions.get(token);
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid session token.' });
  }

  req.user = user;
  next();
};

const createSession = (user) => {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  return token;
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

const validOrderStatuses = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
const validPaymentMethods = [
  'card',
  'visa',
  'mastercard',
  'zambia_credit_card',
  'zanaco_card',
  'standard_chartered_card',
  'mtn_mobile_money',
  'airtel_money',
  'zamtel_money',
  'wallet',
  'bank_transfer'
];

const normalizeOrderStatus = (status) => {
  const value = String(status || 'pending').trim().toLowerCase();
  return validOrderStatuses.includes(value) ? value : 'pending';
};

const isCardPayment = (paymentMethod) => ['card', 'visa', 'mastercard', 'zambia_credit_card', 'zanaco_card', 'standard_chartered_card'].includes(paymentMethod);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'ShopVerse API is running.' });
});

app.post('/api/register', (req, res) => {
  const {
    name,
    email,
    password,
    role,
    shopName,
    shopDescription,
    shopLocation,
    shopProfileImage,
    shopBannerImage,
    shopThemeColor
  } = req.body || {};

  if (!name || !email || !password || !role) {
    return res.status(400).json({ success: false, message: 'Name, email, password, and role are required.' });
  }

  if (getUserByEmail(email)) {
    return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
  }

  if (role === 'shop_owner' && !shopName) {
    return res.status(400).json({ success: false, message: 'Shop owners must provide a shop name.' });
  }

  if (role === 'shop_owner' && !shopLocation) {
    return res.status(400).json({ success: false, message: 'Shop owners must provide a shop location so customers can find them.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    password,
    role,
    shopName: role === 'shop_owner' ? shopName : null,
    shopDescription: role === 'shop_owner' ? shopDescription || 'Welcome to my shop.' : null,
    shopLocation: role === 'shop_owner' ? shopLocation : null,
    shopProfileImage: role === 'shop_owner' ? normalizeImageValue(shopProfileImage) : null,
    shopBannerImage: role === 'shop_owner' ? normalizeImageValue(shopBannerImage) : null,
    shopThemeColor: role === 'shop_owner' ? (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(String(shopThemeColor || '#4f46e5')) ? String(shopThemeColor) : '#4f46e5') : '#4f46e5'
  };

  users.push(user);
  user.password = hashPassword(user.password);
  const token = createSession(user);
  persistAppState();

  res.status(201).json({ success: true, token, user: sanitizeUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const user = getUserByEmail(email);

  const isProductionDemoAccount = !demoDataEnabled &&
    seedUsers.some((seedUser) => seedUser.id === (user && user.id));

  if (!user || isProductionDemoAccount || !passwordMatches(password, user.password)) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  res.json({ success: true, token: createSession(user), user: sanitizeUser(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: sanitizeUser(req.user) });
});

app.patch('/api/me', authMiddleware, (req, res) => {
  const updates = req.body || {};

  if (req.user.role === 'shop_owner') {
    if (updates.shopName !== undefined) {
      const nextShopName = String(updates.shopName || '').trim();
      if (!nextShopName) {
        return res.status(400).json({ success: false, message: 'Shop name cannot be empty.' });
      }
      req.user.shopName = nextShopName;
    }

    if (updates.shopDescription !== undefined) {
      req.user.shopDescription = String(updates.shopDescription || '').trim() || 'Welcome to my shop.';
    }

    if (updates.shopLocation !== undefined) {
      req.user.shopLocation = String(updates.shopLocation || '').trim() || null;
    }

    if (updates.shopProfileImage !== undefined) {
      req.user.shopProfileImage = normalizeImageValue(updates.shopProfileImage) || null;
    }

    if (updates.shopBannerImage !== undefined) {
      req.user.shopBannerImage = normalizeImageValue(updates.shopBannerImage) || null;
    }

    if (updates.shopThemeColor !== undefined) {
      const nextTheme = String(updates.shopThemeColor || '#4f46e5').trim();
      req.user.shopThemeColor = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(nextTheme) ? nextTheme : '#4f46e5';
    }
  }

  if (updates.name !== undefined && String(updates.name || '').trim()) {
    req.user.name = String(updates.name).trim();
  }

  if (updates.email !== undefined && String(updates.email || '').trim()) {
    req.user.email = String(updates.email).trim();
  }

  persistAppState();
  res.json({ success: true, user: sanitizeUser(req.user) });
});

app.get('/api/shops', (req, res) => {
  const searchTerm = String(req.query.search || '').trim().toLowerCase();

  const shops = users
    .filter((user) => user.role === 'shop_owner')
    .filter((shop) => {
      if (!searchTerm) {
        return true;
      }

      const searchableText = [shop.shopName, shop.shopDescription, shop.shopLocation, shop.name].join(' ').toLowerCase();
      return searchableText.includes(searchTerm);
    })
    .map((shop) => ({
      id: shop.id,
      name: shop.shopName,
      description: shop.shopDescription,
      owner: shop.name,
      location: shop.shopLocation || 'Location not set',
      profileImage: shop.shopProfileImage || null,
      bannerImage: shop.shopBannerImage || null,
      themeColor: shop.shopThemeColor || '#4f46e5',
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
      location: shop.shopLocation || 'Location not set',
      profileImage: shop.shopProfileImage || null,
      bannerImage: shop.shopBannerImage || null,
      themeColor: shop.shopThemeColor || '#4f46e5',
      products: getShopProducts(shop.id).map(addProductMeta)
    }
  });
});

app.get('/api/products', (req, res) => {
  const productList = products.map((product) => {
    const shop = users.find((user) => user.id === product.shopId);
    return {
      ...addProductMeta(product),
      shopName: shop ? shop.shopName : 'Unknown shop'
    };
  });

  res.json({ success: true, products: productList });
});

app.get('/api/products/:productId/reviews', (req, res) => {
  const product = getProductById(req.params.productId);

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }

  res.json({ success: true, reviews: getProductReviewList(product.id) });
});

app.post('/api/products/:productId/reviews', authMiddleware, (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Only customers can leave product reviews.' });
  }

  const product = getProductById(req.params.productId);

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }

  const { rating, comment } = req.body || {};
  const parsedRating = Number(rating);

  if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be a whole number from 1 to 5.' });
  }

  const review = {
    id: crypto.randomUUID(),
    productId: product.id,
    customerId: req.user.id,
    customerName: req.user.name,
    rating: parsedRating,
    comment: String(comment || '').trim() || 'No comment provided.',
    createdAt: new Date().toISOString()
  };

  productReviews.push(review);
  persistAppState();
  res.status(201).json({ success: true, review });
});

app.post('/api/products', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can add products.' });
  }

  const { name, description, price, stock, image } = req.body || {};

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
    image: normalizeImageValue(image) || null,
    sortOrder: getNextShopProductOrder(req.user.id),
    createdAt: new Date().toISOString()
  };

  products.push(product);
  persistAppState();
  res.status(201).json({ success: true, product });
});

app.get('/api/my-products', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can view this list.' });
  }

  res.json({ success: true, products: getShopProducts(req.user.id).map(addProductMeta) });
});

app.put('/api/my-products/order', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can reorder products.' });
  }

  const { productIds } = req.body || {};
  const shopProducts = getShopProducts(req.user.id);
  const shopProductIds = new Set(shopProducts.map((product) => product.id));

  if (
    !Array.isArray(productIds) ||
    productIds.length !== shopProducts.length ||
    new Set(productIds).size !== shopProducts.length ||
    productIds.some((productId) => typeof productId !== 'string' || !shopProductIds.has(productId))
  ) {
    return res.status(400).json({ success: false, message: 'Order must contain each of your products exactly once.' });
  }

  productIds.forEach((productId, sortOrder) => {
    getProductById(productId).sortOrder = sortOrder;
  });

  persistAppState();
  res.json({ success: true, products: getShopProducts(req.user.id).map(addProductMeta) });
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

  persistAppState();
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
  persistAppState();
  res.json({ success: true, cart });
});

app.post('/api/cart/update', authMiddleware, (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Only customers can manage the cart.' });
  }

  const { productId, quantity } = req.body || {};
  const cart = carts[req.user.id];

  if (!cart) {
    return res.json({ success: true, cart: { items: [] } });
  }

  const item = cart.items.find((entry) => entry.productId === productId);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found in cart.' });
  }

  const product = getProductById(productId);
  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }

  const nextQuantity = Number(quantity);
  if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
    return res.status(400).json({ success: false, message: 'Quantity must be zero or greater.' });
  }

  if (nextQuantity === 0) {
    cart.items = cart.items.filter((entry) => entry.productId !== productId);
    persistAppState();
    return res.json({ success: true, cart });
  }

  if (nextQuantity > product.stock) {
    return res.status(400).json({ success: false, message: 'Not enough stock available for this product.' });
  }

  item.quantity = nextQuantity;
  persistAppState();
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

  const { shippingAddress, paymentMethod } = req.body || {};
  const normalizedAddress = String(shippingAddress || '').trim();
  const normalizedPaymentMethod = String(paymentMethod || 'card').trim().toLowerCase();

  if (!normalizedAddress) {
    return res.status(400).json({ success: false, message: 'A delivery address is required before placing an order.' });
  }

  if (!validPaymentMethods.includes(normalizedPaymentMethod)) {
    return res.status(400).json({ success: false, message: 'Please choose a valid payment method.' });
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
    paymentMethod: normalizedPaymentMethod,
    paymentStatus: 'pending',
    shippingAddress: normalizedAddress,
    createdAt: new Date().toISOString()
  };

  orders.push(order);
  carts[req.user.id] = { items: [] };

  createNotification(req.user.id, 'order', `Order #${order.id.slice(0, 8)} placed. Payment is pending.`);
  preparedItems.forEach((item) => {
    createNotification(item.shopId, 'sale', `New order received for ${item.productName}.`);
  });

  persistAppState();
  res.status(201).json({ success: true, order });
});

app.patch('/api/orders/:orderId/status', authMiddleware, (req, res) => {
  if (req.user.role !== 'shop_owner') {
    return res.status(403).json({ success: false, message: 'Only shop owners can update order status.' });
  }

  const order = orders.find((entry) => entry.id === req.params.orderId);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }

  const status = normalizeOrderStatus(req.body?.status);
  const orderBelongsToShop = order.items.some((item) => item.shopId === req.user.id);

  if (!orderBelongsToShop) {
    return res.status(403).json({ success: false, message: 'You can only update orders for your shop.' });
  }

  order.status = status;
  createNotification(order.customerId, 'status', `Your order #${order.id.slice(0, 8)} is now ${status}.`);
  persistAppState();
  res.json({ success: true, order });
});

app.get('/api/my-orders', authMiddleware, (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Only customers can view their orders.' });
  }

  const customerOrders = orders.filter((order) => order.customerId === req.user.id);
  res.json({ success: true, orders: customerOrders });
});

app.get('/api/notifications', authMiddleware, (req, res) => {
  const userNotifications = notifications
    .filter((notification) => notification.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ success: true, notifications: userNotifications });
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
  const shopOrderCount = orders.filter((order) =>
    order.items.some((item) => item.shopId === req.user.id)
  ).length;
  const userOrderCount = orders.filter((order) => order.customerId === req.user.id).length;

  res.json({
    success: true,
    stats: {
      role: req.user.role,
      shopProductCount,
      shopOrderCount,
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

  const { name, description, price, stock, image } = req.body || {};

  if (!name || price === undefined || stock === undefined) {
    return res.status(400).json({ success: false, message: 'Product name, price, and stock are required.' });
  }

  product.name = String(name);
  product.description = description ?? product.description;
  product.price = Number(price);
  product.stock = Number(stock);
  product.image = normalizeImageValue(image) ?? product.image ?? null;

  persistAppState();
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

  persistAppState();
  res.json({ success: true, message: 'Product deleted successfully.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request is too large. Please use an image under 7 MB.' });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Request body must contain valid JSON.' });
  }

  return next(error);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ShopVerse app listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, users, products, carts, orders, productReviews, resetAppState };
