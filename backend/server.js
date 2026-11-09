const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { createStore } = require('./storage');
const { createPostgresStore } = require('./postgres-storage');
const { seedUsers, seedProducts, demoPaymentAccounts } = require('./seed');
const market = require('./marketplace');
const moderation = require('./moderation');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const persistenceEnabled = NODE_ENV !== 'test' && process.env.SHOPVERSE_DISABLE_PERSISTENCE !== 'true';
const demoDataEnabled = NODE_ENV === 'development' || NODE_ENV === 'test';
const databaseUrl = process.env.DATABASE_URL;
const dataFilePath = process.env.SHOPVERSE_DATA_FILE || path.join(__dirname, 'data', 'shopverse.sqlite');
const legacyDataFilePath = process.env.SHOPVERSE_LEGACY_DATA_FILE || path.join(__dirname, 'data', 'shopverse.json');
const frontendDir = path.join(__dirname, '..', 'frontend');

if (persistenceEnabled && isProduction && !databaseUrl) {
  throw new Error('DATABASE_URL is required in production to prevent losing data on restarts or deployments.');
}

const store = persistenceEnabled
  ? databaseUrl ? createPostgresStore(databaseUrl) : createStore(dataFilePath, legacyDataFilePath)
  : null;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_THEME = '#4f46e5';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const LOW_STOCK_THRESHOLD = 3;
const MIN_PASSWORD_LENGTH = 8;
const googleAuthClient = new OAuth2Client();

// Marketplace commission taken from each seller payout (percent of item value).
// Defaults to 0 so the marketplace is free for sellers at launch.
const COMMISSION_PERCENT = Math.min(Math.max(Number(process.env.SHOPVERSE_COMMISSION_PERCENT) || 0, 0), 50);

// Shops must be verified by an admin before buyers can see or buy their products.
// Set SHOPVERSE_REQUIRE_VERIFICATION=false to let unverified shops sell.
const REQUIRE_VERIFICATION = process.env.SHOPVERSE_REQUIRE_VERIFICATION !== 'false';

// Accounts customers pay into for protected (escrow) payments.
const PAYMENT_ACCOUNTS = {
  accountName: process.env.SHOPVERSE_PAY_ACCOUNT_NAME || (demoDataEnabled ? demoPaymentAccounts.accountName : ''),
  mtn_mobile_money: process.env.SHOPVERSE_PAY_MTN || (demoDataEnabled ? demoPaymentAccounts.mtn : ''),
  airtel_money: process.env.SHOPVERSE_PAY_AIRTEL || (demoDataEnabled ? demoPaymentAccounts.airtel : ''),
  zamtel_money: process.env.SHOPVERSE_PAY_ZAMTEL || (demoDataEnabled ? demoPaymentAccounts.zamtel : ''),
  bank_transfer: process.env.SHOPVERSE_PAY_BANK || (demoDataEnabled ? demoPaymentAccounts.bank : '')
};

// People with these emails get the admin dashboard (in addition to accounts with the admin role).
const ADMIN_EMAILS = String(process.env.SHOPVERSE_ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const ROLES = ['customer', 'shop_owner'];
const COURIER_ESCALATION_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_STATUSES = ['none', 'pending', 'verified', 'rejected'];
const ORDER_FLOW = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
const ORDER_STATUSES = [...ORDER_FLOW, 'cancelled'];
const FINAL_STATUSES = ['delivered', 'cancelled'];
const PAYMENT_METHODS = [
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
  'bank_transfer',
  'cash_on_delivery'
];

// ---------------------------------------------------------------------------
// In-memory state (persisted as a whole snapshot after each write)
// ---------------------------------------------------------------------------

const users = [];
const products = [];
const carts = {};
const orders = [];
const productReviews = [];
const notifications = [];
const sessions = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new HttpError(status, message);
};

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch(next);
};

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const nowIso = () => new Date().toISOString();
const shortId = (id) => String(id).slice(0, 8).toUpperCase();
const formatZmw = (value) => `ZMW ${roundMoney(value).toFixed(2)}`;
// Customers quote this when paying so ShopVerse can match the money to the order.
const paymentReference = (orderId) => `SV-${shortId(orderId)}`;

const text = (value, { field, max, required = false, fallback = '' }) => {
  const result = String(value ?? '').trim();
  if (!result) {
    if (required) fail(400, `${field} is required.`);
    return fallback;
  }
  if (result.length > max) fail(400, `${field} must be ${max} characters or fewer.`);
  return result;
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const normalizeEmail = (value) => {
  const email = String(value || '').trim().toLowerCase();
  if (!isValidEmail(email) || email.length > 254) fail(400, 'Please provide a valid email address.');
  return email;
};

const isHexColor = (value) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || ''));

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

const passwordMatches = (password, storedPassword) => {
  const [algorithm, salt, storedHash] = String(storedPassword || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !storedHash) return false;
  const candidateHash = crypto.scryptSync(String(password), salt, 64);
  const expectedHash = Buffer.from(storedHash, 'hex');
  return candidateHash.length === expectedHash.length && crypto.timingSafeEqual(candidateHash, expectedHash);
};

const validatePassword = (password) => {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) fail(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  if (value.length > 200) fail(400, 'Password is too long.');
  return value;
};

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([a-z0-9+/]+={0,2})$/i;

// Returns a stored image value, null to clear it, or undefined to leave it unchanged.
const parseImageInput = (value) => {
  if (value === undefined) return undefined;
  const image = String(value ?? '').trim();
  if (!image) return null;

  const dataMatch = DATA_URL_PATTERN.exec(image);
  if (dataMatch) {
    if (Math.floor(dataMatch[2].length * 0.75) > MAX_IMAGE_BYTES) fail(413, 'Images must be 5 MB or smaller.');
    return image;
  }

  try {
    const url = new URL(image);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch (error) {
    // fall through
  }
  return fail(400, 'Images must be a PNG, JPEG, GIF or WebP upload, or an http(s) link.');
};

// Large base64 images are served from /media so list responses stay small and cacheable.
const imageVersions = new Map();
const imageVersion = (value) => {
  let version = imageVersions.get(value);
  if (!version) {
    if (imageVersions.size > 5000) imageVersions.clear();
    version = sha256(value).slice(0, 12);
    imageVersions.set(value, version);
  }
  return version;
};
const publicImageUrl = (value, mediaPath) => {
  if (!value) return null;
  return value.startsWith('data:') ? `${mediaPath}?v=${imageVersion(value)}` : value;
};

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per client IP)
// ---------------------------------------------------------------------------

const createRateLimiter = ({ windowMs, max, message }) => {
  const hits = new Map();
  return {
    check(key) {
      const entry = hits.get(key);
      if (entry && entry.resetAt > Date.now() && entry.count >= max) {
        fail(429, message);
      }
    },
    hit(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        entry.count += 1;
      }
      if (hits.size > 10000) {
        for (const [entryKey, value] of hits) if (value.resetAt <= now) hits.delete(entryKey);
      }
    },
    reset(key) {
      hits.delete(key);
    },
    clear() {
      hits.clear();
    }
  };
};

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.'
});
const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many accounts created from this network. Please try again later.'
});
const passwordResetLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many password recovery requests. Please wait and try again.'
});
const passwordResetEmailLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many password recovery requests for this email. Please try again later.'
});

// ---------------------------------------------------------------------------
// State lifecycle
// ---------------------------------------------------------------------------

const resetAppState = () => {
  users.length = 0;
  products.length = 0;
  sessions.clear();
  Object.keys(carts).forEach((key) => delete carts[key]);
  orders.length = 0;
  productReviews.length = 0;
  notifications.length = 0;
  loginLimiter.clear();
  registerLimiter.clear();
  passwordResetLimiter.clear();
  passwordResetEmailLimiter.clear();

  if (demoDataEnabled) {
    seedUsers.forEach((user) => users.push({ ...structuredClone(user), password: hashPassword(user.password) }));
    seedProducts.forEach((product) => products.push(structuredClone(product)));
  }
};

const persistAppState = () => {
  if (!store) return Promise.resolve();
  return store.save({ users, products, carts, orders, productReviews, notifications, sessions: [...sessions] });
};

const normalizeShopProductOrders = () => {
  users.filter((user) => user.role === 'shop_owner').forEach((shop) => {
    getShopProducts(shop.id).forEach((product, index) => {
      if (!Number.isInteger(product.sortOrder) || product.sortOrder < 0) product.sortOrder = index;
    });
  });
};

// Orders created before per-shop fulfilment tracking get one status per shop.
const normalizeOrders = () => {
  orders.forEach((order) => {
    if (!order.shopStatuses || typeof order.shopStatuses !== 'object') {
      const legacyStatus = ORDER_STATUSES.includes(order.status) ? order.status : 'pending';
      order.shopStatuses = {};
      order.items.forEach((item) => {
        order.shopStatuses[item.shopId] = legacyStatus;
      });
    }
    // Orders placed before protected payments existed were settled directly with the shop.
    if (!order.payment) {
      order.payment = {
        method: order.paymentMethod,
        reference: paymentReference(order.id),
        protected: false,
        status: order.paymentStatus || 'pending'
      };
    }
    if (!order.fulfilment) {
      order.fulfilment = {};
      Object.keys(order.shopStatuses).forEach((shopId) => {
        order.fulfilment[shopId] = { method: 'delivery', deliveryFee: 0 };
      });
    }
    order.status = deriveOrderStatus(order);
  });
};

const restoreAppState = async () => {
  if (store && store.initialize) await store.initialize();

  const savedState = store ? await store.load() : null;
  if (!savedState || !Array.isArray(savedState.users) || savedState.users.length === 0) {
    resetAppState();
    normalizeShopProductOrders();
    await persistAppState();
    return;
  }

  users.push(...savedState.users);
  products.push(...(savedState.products || []));
  Object.assign(carts, savedState.carts || {});
  orders.push(...(savedState.orders || []));
  productReviews.push(...(savedState.productReviews || []));
  notifications.push(...(savedState.notifications || []));
  normalizeShopProductOrders();
  normalizeOrders();
  for (const [tokenHash, session] of savedState.sessions || []) {
    if (session.expiresAt > Date.now() && users.some((user) => user.id === session.userId)) {
      sessions.set(tokenHash, session);
    }
  }
};

// ---------------------------------------------------------------------------
// Domain queries
// ---------------------------------------------------------------------------

const getUserById = (id) => users.find((user) => user.id === id);
const getUserByEmail = (email) => {
  const target = String(email || '').trim().toLowerCase();
  return users.find((user) => String(user.email).toLowerCase() === target);
};
const getShopById = (shopId) => users.find((user) => user.id === shopId && user.role === 'shop_owner');
const getProductById = (productId) => products.find((entry) => entry.id === productId);

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
  .reduce((next, product) => Math.max(next, (Number.isInteger(product.sortOrder) ? product.sortOrder : 0) + 1), 0);

const getProductReviewList = (productId) => productReviews
  .filter((entry) => entry.productId === productId)
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

const ratingSummary = (reviews) => {
  const reviewCount = reviews.length;
  const average = reviewCount ? reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviewCount : 0;
  return { reviewCount, averageRating: Number(average.toFixed(1)) };
};

const hasPurchased = (customerId, productId) => orders.some((order) =>
  order.customerId === customerId &&
  order.items.some((item) => item.productId === productId && order.shopStatuses[item.shopId] !== 'cancelled'));

const deriveOrderStatus = (order) => {
  const active = Object.values(order.shopStatuses || {}).filter((status) => status !== 'cancelled');
  if (!active.length) return 'cancelled';
  return active.reduce((lowest, status) => (ORDER_FLOW.indexOf(status) < ORDER_FLOW.indexOf(lowest) ? status : lowest));
};

// ---------------------------------------------------------------------------
// Serializers (what the API exposes)
// ---------------------------------------------------------------------------

const isAdmin = (user) => Boolean(user) && (user.role === 'admin' || ADMIN_EMAILS.includes(String(user.email).toLowerCase()));
const isVerifiedShop = (shop) => Boolean(shop && shop.verification && shop.verification.status === 'verified');

// Only verified shops are visible to buyers and can sell. Their products must also pass
// the prohibited-items check (this also hides anything listed before the check existed).
const isListedShop = (shop) => Boolean(shop) && !shop.suspended && (!REQUIRE_VERIFICATION || isVerifiedShop(shop)) &&
  !moderation.findProhibited(shop.shopName, shop.shopDescription);
const prohibitedTermIn = (product) => moderation.findProhibited(product.name, product.description, product.category);
const isListedProduct = (product) => Boolean(product) && isListedShop(getShopById(product.shopId)) && !prohibitedTermIn(product);

// Why a seller's shop or product is hidden from buyers (null when it is visible).
const hiddenReason = (shop, product = null) => {
  if (shop && shop.suspended) return 'suspended';
  if (product && prohibitedTermIn(product)) return 'prohibited';
  if (shop && moderation.findProhibited(shop.shopName, shop.shopDescription)) return 'prohibited';
  if (REQUIRE_VERIFICATION && !isVerifiedShop(shop)) return 'unverified';
  return null;
};

// Public pages normally hide unlisted shops; the shop's owner and admins can still see them.
const viewerOf = (req) => {
  const token = readToken(req);
  const session = token ? sessions.get(sha256(token)) : null;
  return session && session.expiresAt > Date.now() ? getUserById(session.userId) : null;
};
const canSeeUnlisted = (req, shopId) => {
  const viewer = viewerOf(req);
  return Boolean(viewer) && (viewer.id === shopId || isAdmin(viewer));
};

const reportProhibitedAttempt = (user, term, what) => {
  users.filter(isAdmin).forEach((admin) => {
    createNotification(admin.id, 'review', `Blocked: ${user.shopName || user.name} (${user.email}) tried to post ${what} mentioning "${term}".`);
  });
};
const verificationOf = (user) => ({ status: 'none', ...(user.verification || {}) });

const sanitizeUser = (user) => {
  const result = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isAdmin: isAdmin(user),
    shopName: user.shopName || null,
    shopDescription: user.shopDescription || null,
    shopLocation: user.shopLocation || null,
    shopProfileImage: publicImageUrl(user.shopProfileImage, `/media/shops/${user.id}/avatar`),
    shopBannerImage: publicImageUrl(user.shopBannerImage, `/media/shops/${user.id}/banner`),
    shopThemeColor: user.shopThemeColor || DEFAULT_THEME,
    createdAt: user.createdAt || null
  };
  if (user.role === 'shop_owner') {
    const verification = verificationOf(user);
    Object.assign(result, {
      shopPhone: user.shopPhone || null,
      suspended: user.suspended ? { at: user.suspended.at, reason: user.suspended.reason || null } : null,
      delivery: market.deliveryOf(user),
      verification: {
        status: verification.status,
        businessName: verification.businessName || null,
        idNumber: verification.idNumber || null,
        note: verification.note || null,
        reviewNote: verification.reviewNote || null,
        submittedAt: verification.submittedAt || null,
        reviewedAt: verification.reviewedAt || null
      }
    });
  }
  if (user.role === 'courier') {
    result.courierCompany = user.courierCompany;
    result.courierActive = Boolean(user.courierActive);
  }
  return result;
};

// Public, buyer-facing view of a shop's contact and delivery terms.
const shopTerms = (shop) => ({
  verified: isVerifiedShop(shop),
  whatsapp: market.phoneDigits(shop.shopPhone),
  delivery: market.deliveryOf(shop)
});

const serializeProduct = (product, { includeReviews = false } = {}) => {
  const reviews = getProductReviewList(product.id);
  const shop = getShopById(product.shopId);
  const result = {
    id: product.id,
    shopId: product.shopId,
    shopName: shop ? shop.shopName : 'Unknown shop',
    shopLocation: shop ? shop.shopLocation || null : null,
    shopThemeColor: shop ? shop.shopThemeColor || DEFAULT_THEME : DEFAULT_THEME,
    shopVerified: isVerifiedShop(shop),
    listed: isListedProduct(product),
    hiddenReason: hiddenReason(shop, product),
    name: product.name,
    description: product.description || '',
    category: product.category || 'Other',
    price: product.price,
    stock: product.stock,
    inStock: product.stock > 0,
    lowStock: product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD,
    image: publicImageUrl(product.image, `/media/products/${product.id}`),
    sortOrder: product.sortOrder,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt || product.createdAt,
    ...ratingSummary(reviews)
  };
  if (includeReviews) {
    result.reviews = reviews.slice(0, 50);
    if (shop) result.shop = shopTerms(shop);
  }
  return result;
};

const serializeShop = (shop, { includeProducts = false, includeHidden = false } = {}) => {
  // Buyers only see products that are allowed to be sold; the owner sees everything.
  const shopProducts = getShopProducts(shop.id).filter((product) => includeHidden || !prohibitedTermIn(product));
  const reviews = productReviews.filter((review) => shopProducts.some((product) => product.id === review.productId));
  const categoryCounts = {};
  shopProducts.forEach((product) => {
    const category = product.category || 'Other';
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  const result = {
    id: shop.id,
    name: shop.shopName,
    description: shop.shopDescription,
    owner: shop.name,
    location: shop.shopLocation || 'Location not set',
    profileImage: publicImageUrl(shop.shopProfileImage, `/media/shops/${shop.id}/avatar`),
    bannerImage: publicImageUrl(shop.shopBannerImage, `/media/shops/${shop.id}/banner`),
    themeColor: shop.shopThemeColor || DEFAULT_THEME,
    productCount: shopProducts.length,
    listed: isListedShop(shop),
    hiddenReason: hiddenReason(shop),
    categories: Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([name]) => name),
    createdAt: shop.createdAt || null,
    ...shopTerms(shop),
    ...ratingSummary(reviews)
  };
  if (includeProducts) result.products = shopProducts.map((product) => serializeProduct(product));
  return result;
};

const getCartView = (userId) => {
  const cart = carts[userId] || { items: [] };
  const items = cart.items
    .map((item) => {
      const product = getProductById(item.productId);
      if (!product) return null;
      const shop = getShopById(product.shopId);
      return {
        productId: item.productId,
        quantity: item.quantity,
        productName: product.name,
        price: product.price,
        stock: product.stock,
        image: publicImageUrl(product.image, `/media/products/${product.id}`),
        available: product.stock >= item.quantity && isListedProduct(product),
        lineTotal: roundMoney(product.price * item.quantity),
        shopId: product.shopId,
        shopName: shop ? shop.shopName : 'Unknown shop'
      };
    })
    .filter(Boolean);

  // Group by shop so checkout can show each shop's delivery options and fee.
  const shops = [];
  items.forEach((item) => {
    let group = shops.find((entry) => entry.shopId === item.shopId);
    if (!group) {
      const shop = getShopById(item.shopId);
      group = {
        shopId: item.shopId,
        shopName: item.shopName,
        verified: isVerifiedShop(shop),
        location: shop ? shop.shopLocation || null : null,
        delivery: market.deliveryOf(shop),
        subtotal: 0
      };
      shops.push(group);
    }
    group.subtotal = roundMoney(group.subtotal + item.lineTotal);
  });
  shops.forEach((group) => {
    group.deliveryFee = market.deliveryFeeFor(group.delivery, group.subtotal);
    group.defaultMethod = market.chooseMethod(group.delivery, 'delivery');
  });

  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const deliveryTotal = roundMoney(shops.reduce((sum, group) => sum + (group.defaultMethod === 'delivery' ? group.deliveryFee : 0), 0));
  return {
    items,
    shops,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    deliveryTotal,
    total: roundMoney(subtotal + deliveryTotal)
  };
};

const paymentInstructions = (order) => {
  const payment = order.payment || {};
  if (!payment.protected || !['pending', 'submitted'].includes(payment.status)) return null;
  const account = PAYMENT_ACCOUNTS[payment.method] || '';
  return {
    reference: payment.reference,
    amount: order.total,
    accountName: PAYMENT_ACCOUNTS.accountName || 'ShopVerse',
    account: account || null,
    // Without a configured account (e.g. card), ShopVerse contacts the customer instead.
    contactFirst: !account
  };
};

const shopNameIn = (order, shopId) => (order.items.find((item) => item.shopId === shopId) || {}).shopName || 'Unknown shop';

const serializeCustomerOrder = (order) => {
  const status = deriveOrderStatus(order);
  const payment = order.payment || {};
  return {
    ...order,
    fulfilment: Object.fromEntries(Object.entries(order.fulfilment || {}).map(([shopId, entry]) => {
      const { deliveryCodeHash, deliveryCodeExpiresAt, ...customerEntry } = entry;
      return [shopId, customerEntry];
    })),
    status,
    paymentInstructions: paymentInstructions(order),
    canCancel: Object.values(order.shopStatuses).every((entry) => entry === 'pending' || entry === 'cancelled') && status !== 'cancelled',
    canSubmitPayment: Boolean(payment.protected) && payment.status === 'pending' && status !== 'cancelled',
    fulfillments: Object.entries(order.shopStatuses).map(([shopId, shopStatus]) => {
      const fulfilment = order.fulfilment[shopId] || {};
      const shop = getShopById(shopId);
      return {
        shopId,
        shopName: shopNameIn(order, shopId),
        status: shopStatus,
        method: fulfilment.method || 'delivery',
        deliveryFee: fulfilment.deliveryFee || 0,
        whatsapp: shop ? market.phoneDigits(shop.shopPhone) : null,
        pickupLocation: fulfilment.method === 'pickup' && shop ? shop.shopLocation : null,
        courierCompany: fulfilment.courierCompany || null,
        courierDeliveredAt: fulfilment.courierDeliveredAt || null,
        courierReceiptReference: fulfilment.courierReceiptReference || null,
        adminDeliveryApprovedAt: fulfilment.adminDeliveryApprovedAt || null,
        confirmedAt: fulfilment.confirmedAt || null,
        dispute: fulfilment.dispute || null,
        autoConfirmAt: market.autoReleaseAt(order, shopId),
        canConfirm: !fulfilment.courierCompany && ['shipped', 'delivered'].includes(shopStatus) && !fulfilment.confirmedAt && !(fulfilment.dispute && !fulfilment.dispute.resolvedAt),
        canDispute: ['shipped', 'delivered'].includes(shopStatus) && !fulfilment.confirmedAt && !fulfilment.dispute && !fulfilment.paidOutAt
      };
    })
  };
};

// A shop owner only sees their own lines of a multi-shop order, plus what they will be paid.
const serializeShopOrder = (order, shopId) => {
  const items = order.items.filter((item) => item.shopId === shopId);
  const fulfilment = order.fulfilment[shopId] || {};
  const amounts = market.shopPayoutAmounts(order, shopId, COMMISSION_PERCENT);
  return {
    id: order.id,
    customerName: order.customerName,
    items,
    itemsTotal: amounts.items,
    deliveryFee: amounts.deliveryFee,
    total: amounts.gross,
    status: order.shopStatuses[shopId] || 'pending',
    method: fulfilment.method || 'delivery',
    courierCompany: fulfilment.courierCompany || null,
    courierReceiptReference: fulfilment.courierReceiptReference || null,
    courierDeliveredAt: fulfilment.courierDeliveredAt || null,
    adminDeliveryApprovedAt: fulfilment.adminDeliveryApprovedAt || null,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentProtected: Boolean(order.payment && order.payment.protected),
    payout: {
      state: market.payoutState(order, shopId),
      commission: amounts.commission,
      net: amounts.net,
      autoReleaseAt: market.autoReleaseAt(order, shopId),
      paidOutAt: fulfilment.paidOutAt || null
    },
    customerConfirmedAt: fulfilment.confirmedAt || null,
    dispute: fulfilment.dispute || null,
    shippingAddress: fulfilment.method === 'pickup' ? null : order.shippingAddress,
    contactPhone: order.contactPhone || null,
    whatsapp: market.phoneDigits(order.contactPhone),
    note: order.note || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt
  };
};

const setPaymentStatus = (order, status) => {
  order.payment.status = status;
  order.paymentStatus = status;
  order.updatedAt = nowIso();
};

const createNotification = (userId, type, message) => {
  const notification = { id: crypto.randomUUID(), userId, type, message, read: false, createdAt: nowIso() };
  notifications.push(notification);
  return notification;
};

const recordDeliveryAudit = (fulfilment, action, actorId, details = {}) => {
  if (!Array.isArray(fulfilment.deliveryAudit)) fulfilment.deliveryAudit = [];
  fulfilment.deliveryAudit.push({ action, actorId, at: nowIso(), ...details });
};

const restockItems = (items) => {
  items.forEach((item) => {
    const product = getProductById(item.productId);
    if (product) product.stock += item.quantity;
  });
};

// ---------------------------------------------------------------------------
// Sessions & auth
// ---------------------------------------------------------------------------

const pruneSessions = () => {
  const now = Date.now();
  for (const [hash, session] of sessions) if (session.expiresAt <= now) sessions.delete(hash);
};

const createSession = (user) => {
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(sha256(token), { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
};

const readToken = (req) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  return match ? match[1] : '';
};

const authMiddleware = (req, res, next) => {
  const token = readToken(req);
  if (!token) return res.status(401).json({ success: false, message: 'Authentication required.' });

  const tokenHash = sha256(token);
  const session = sessions.get(tokenHash);
  const user = session && session.expiresAt > Date.now() ? getUserById(session.userId) : null;

  if (!user) {
    if (session) sessions.delete(tokenHash);
    return res.status(401).json({ success: false, message: 'Invalid session token.' });
  }

  req.user = user;
  req.sessionHash = tokenHash;
  next();
};

const requireRole = (role, message) => (req, res, next) => {
  if (req.user.role !== role) return res.status(403).json({ success: false, message });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: 'Only ShopVerse admins can do this.' });
  next();
};

const isDemoAccountBlocked = (user) => !demoDataEnabled && seedUsers.some((seed) => seed.id === (user && user.id));

const ready = restoreAppState();

// ---------------------------------------------------------------------------
// App & middleware
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client https://accounts.google.com/gsi/; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https: http:; " +
    "connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Search engines: robots.txt points crawlers at the sitemap, which lists every shop and
// product so Google finds new listings without waiting to stumble on them.
const siteBase = (req) => `${req.protocol}://${req.get('host')}`;
const xmlEscape = (value) => String(value).replace(/[<>&'"]/g, (character) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
})[character]);

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /studio',
    'Disallow: /admin',
    'Disallow: /account',
    'Disallow: /orders',
    'Disallow: /checkout',
    '',
    `Sitemap: ${siteBase(req)}/sitemap.xml`,
    ''
  ].join('\n'));
});

app.get('/sitemap.xml', (req, res) => {
  const base = siteBase(req);
  const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
  const entries = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/products', priority: '0.9', changefreq: 'daily' },
    { loc: '/shops', priority: '0.8', changefreq: 'daily' },
    { loc: '/install', priority: '0.4', changefreq: 'monthly' }
  ];
  users.filter((user) => user.role === 'shop_owner' && isListedShop(user)).forEach((shop) => {
    entries.push({ loc: `/shops/${encodeURIComponent(shop.id)}`, priority: '0.7', changefreq: 'weekly', lastmod: day(shop.createdAt) });
  });
  products.filter(isListedProduct).forEach((product) => {
    entries.push({
      loc: `/products/${encodeURIComponent(product.id)}`,
      priority: '0.6',
      changefreq: 'weekly',
      lastmod: day(product.updatedAt || product.createdAt)
    });
  });

  const body = entries.map((entry) => [
    '  <url>',
    `    <loc>${xmlEscape(base + entry.loc)}</loc>`,
    entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : null,
    `    <changefreq>${entry.changefreq}</changefreq>`,
    `    <priority>${entry.priority}</priority>`,
    '  </url>'
  ].filter(Boolean).join('\n')).join('\n');

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

// Digital Asset Links: proves the Android app (android/) belongs to this site so it opens
// full-screen without a browser address bar. Contains only the public key fingerprint.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/json').sendFile(path.join(__dirname, 'assetlinks.json'));
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(frontendDir, {
  index: false,
  maxAge: isProduction ? '7d' : 0,
  setHeaders(res, filePath) {
    // The page, service worker and manifest must always be revalidated so updates reach installed apps.
    if (/\.(html|webmanifest)$/.test(filePath) || filePath.endsWith(`${path.sep}sw.js`)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
  }
}));

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'ShopVerse API is running.', demo: demoDataEnabled });
});

app.get('/api/stats', (req, res) => {
  const shopIds = new Set(users.filter((user) => user.role === 'shop_owner' && isListedShop(user)).map((user) => user.id));
  const listed = products.filter(isListedProduct);
  res.json({
    success: true,
    stats: {
      shops: shopIds.size,
      products: listed.length,
      categories: new Set(listed.map((product) => product.category || 'Other')).size,
      orders: orders.length
    }
  });
});

app.get('/api/categories', (req, res) => {
  const counts = {};
  products.forEach((product) => {
    if (!isListedProduct(product)) return;
    const category = product.category || 'Other';
    counts[category] = (counts[category] || 0) + 1;
  });
  const categories = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  res.json({ success: true, categories });
});

app.get('/api/shops', (req, res) => {
  const searchTerm = String(req.query.search || '').trim().toLowerCase();
  const shops = users
    .filter((user) => user.role === 'shop_owner' && isListedShop(user))
    .map((shop) => serializeShop(shop))
    .filter((shop) => {
      if (!searchTerm) return true;
      const haystack = [shop.name, shop.description, shop.location, shop.owner, ...shop.categories].join(' ').toLowerCase();
      return haystack.includes(searchTerm);
    })
    .sort((a, b) => b.productCount - a.productCount || String(a.name).localeCompare(String(b.name)));

  res.json({ success: true, shops });
});

app.get('/api/shops/:shopId', (req, res) => {
  const shop = getShopById(req.params.shopId);
  const ownerView = Boolean(shop) && canSeeUnlisted(req, shop.id);
  if (!shop || (!isListedShop(shop) && !ownerView)) {
    return res.status(404).json({ success: false, message: 'Shop not found.' });
  }
  res.json({ success: true, shop: serializeShop(shop, { includeProducts: true, includeHidden: ownerView }) });
});

const PRODUCT_SORTS = {
  featured: (a, b) => (b.averageRating * Math.log2(b.reviewCount + 1)) - (a.averageRating * Math.log2(a.reviewCount + 1)) ||
    Number(b.inStock) - Number(a.inStock) || new Date(b.createdAt) - new Date(a.createdAt),
  newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  price_asc: (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
  rating: (a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount
};

app.get('/api/products', (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim().toLowerCase();
  const shopId = String(req.query.shopId || '').trim();
  const inStockOnly = req.query.inStock === 'true';
  // Without an explicit sort the catalogue keeps its natural (insertion) order.
  const sortKey = PRODUCT_SORTS[req.query.sort] ? req.query.sort : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const matches = products
    .filter(isListedProduct)
    .map((product) => serializeProduct(product))
    .filter((product) => {
      if (shopId && product.shopId !== shopId) return false;
      if (category && product.category.toLowerCase() !== category) return false;
      if (inStockOnly && !product.inStock) return false;
      if (search) {
        const haystack = [product.name, product.description, product.category, product.shopName].join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  if (sortKey) matches.sort(PRODUCT_SORTS[sortKey]);

  res.json({ success: true, total: matches.length, products: matches.slice(offset, offset + limit) });
});

app.get('/api/products/:productId', (req, res) => {
  const product = getProductById(req.params.productId);
  if (!product || !getShopById(product.shopId) || (!isListedProduct(product) && !canSeeUnlisted(req, product.shopId))) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }
  res.json({ success: true, product: serializeProduct(product, { includeReviews: true }) });
});

app.get('/api/products/:productId/reviews', (req, res) => {
  const product = getProductById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
  res.json({ success: true, reviews: getProductReviewList(product.id) });
});

const sendDataUrl = (res, value) => {
  const match = value && DATA_URL_PATTERN.exec(value);
  if (!match) return false;
  res.setHeader('Content-Type', match[1].toLowerCase().replace('jpg', 'jpeg'));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(match[2], 'base64'));
  return true;
};

app.get('/media/products/:productId', (req, res) => {
  const product = getProductById(req.params.productId);
  if (!sendDataUrl(res, product && product.image)) res.status(404).end();
});

app.get('/media/shops/:shopId/:kind(avatar|banner)', (req, res) => {
  const shop = getShopById(req.params.shopId);
  const value = shop && (req.params.kind === 'avatar' ? shop.shopProfileImage : shop.shopBannerImage);
  if (!sendDataUrl(res, value)) res.status(404).end();
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const shopFieldsFromBody = (body, { requireCore, existing = null }) => {
  const fields = {};
  if (requireCore || body.shopName !== undefined) {
    fields.shopName = text(body.shopName, { field: 'Shop name', max: 80, required: true });
  }
  if (body.shopDescription !== undefined || requireCore) {
    fields.shopDescription = text(body.shopDescription, { field: 'Shop description', max: 600, fallback: 'Welcome to my shop.' });
  }
  if (requireCore || body.shopLocation !== undefined) {
    fields.shopLocation = text(body.shopLocation, {
      field: 'Shop location',
      max: 120,
      required: true
    });
  }
  const profileImage = parseImageInput(body.shopProfileImage);
  if (profileImage !== undefined) fields.shopProfileImage = profileImage;
  const bannerImage = parseImageInput(body.shopBannerImage);
  if (bannerImage !== undefined) fields.shopBannerImage = bannerImage;
  if (body.shopThemeColor !== undefined || requireCore) {
    const color = String(body.shopThemeColor || DEFAULT_THEME).trim();
    if (!isHexColor(color)) fail(400, 'Theme colour must be a hex value such as #4f46e5.');
    fields.shopThemeColor = color;
  }
  if (body.shopPhone !== undefined) {
    const raw = String(body.shopPhone || '').trim();
    if (raw && !market.phoneDigits(raw)) fail(400, 'Please enter a valid WhatsApp number, e.g. 0971234567.');
    fields.shopPhone = raw ? market.formatPhone(raw) : null;
  }
  if (body.delivery !== undefined) {
    fields.delivery = market.parseDelivery(body.delivery, existing && existing.delivery, fail);
  }
  return fields;
};

app.post('/api/register', asyncRoute(async (req, res) => {
  registerLimiter.check(req.ip);
  const body = req.body || {};

  if (!body.name || !body.email || !body.password || !body.role) {
    fail(400, 'Name, email, password, and role are required.');
  }
  if (!ROLES.includes(body.role)) fail(400, 'Account type must be customer or shop owner.');

  const name = text(body.name, { field: 'Name', max: 80, required: true });
  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  if (getUserByEmail(email)) fail(409, 'An account with that email already exists.');

  if (body.role === 'shop_owner') {
    if (!String(body.shopName || '').trim()) fail(400, 'Shop owners must provide a shop name.');
    if (!String(body.shopLocation || '').trim()) fail(400, 'Shop owners must provide a shop location so customers can find them.');
    const term = moderation.findProhibited(body.shopName, body.shopDescription);
    if (term) {
      reportProhibitedAttempt({ name, email, shopName: String(body.shopName) }, term, 'a new shop');
      await persistAppState();
      fail(400, moderation.PROHIBITED_MESSAGE(term));
    }
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    password: hashPassword(password),
    role: body.role,
    createdAt: nowIso(),
    ...(body.role === 'shop_owner' ? shopFieldsFromBody(body, { requireCore: true }) : {})
  };

  users.push(user);
  registerLimiter.hit(req.ip);
  const token = createSession(user);
  await persistAppState();
  res.status(201).json({ success: true, token, user: sanitizeUser(user) });
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) fail(400, 'Email and password are required.');
  if (!isValidEmail(email)) fail(400, 'Please provide a valid email address.');

  loginLimiter.check(req.ip);
  const user = getUserByEmail(email);

  if (!user || isDemoAccountBlocked(user) || !passwordMatches(password, user.password)) {
    loginLimiter.hit(req.ip);
    fail(401, 'Invalid email or password.');
  }

  loginLimiter.reset(req.ip);
  const token = createSession(user);
  await persistAppState();
  res.json({ success: true, token, user: sanitizeUser(user) });
}));

app.get('/api/auth/config', (req, res) => {
  res.json({ success: true, googleClientId: String(process.env.GOOGLE_CLIENT_ID || '').trim() || null });
});

app.post('/api/auth/google', asyncRoute(async (req, res) => {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) fail(503, 'Google sign-in is not configured.');
  const credential = String((req.body || {}).credential || '');
  if (!credential || credential.length > 12000) fail(400, 'A valid Google credential is required.');

  loginLimiter.check(req.ip);
  let payload;
  try {
    const ticket = await googleAuthClient.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch (error) {
    console.warn('Google ID token verification failed:', error.name);
    loginLimiter.hit(req.ip);
    if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code) ||
        (error.response && error.response.status >= 500)) {
      fail(503, 'Google sign-in is temporarily unavailable. Please try again.');
    }
    fail(401, 'Google sign-in could not be verified.');
  }
  if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) {
    loginLimiter.hit(req.ip);
    fail(401, 'Use a Google account with a verified email address.');
  }

  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    loginLimiter.hit(req.ip);
    fail(401, 'This Google account could not be signed in.');
  }
  let user = getUserByEmail(email);
  if (user && (isDemoAccountBlocked(user) || (user.googleSub && user.googleSub !== payload.sub))) {
    loginLimiter.hit(req.ip);
    fail(401, 'This Google account could not be signed in.');
  }
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      name: text(payload.name || email.split('@')[0], { field: 'Name', max: 80, required: true }),
      email,
      password: null,
      role: 'customer',
      googleSub: payload.sub,
      googleEmailVerifiedAt: nowIso(),
      createdAt: nowIso()
    };
    users.push(user);
  } else if (!user.googleSub) {
    user.googleSub = payload.sub;
    user.googleEmailVerifiedAt = nowIso();
  }

  loginLimiter.reset(req.ip);
  const token = createSession(user);
  await persistAppState();
  res.json({ success: true, token, user: sanitizeUser(user) });
}));

const passwordResetConfig = () => {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
  const publicUrl = String(process.env.SHOPVERSE_PUBLIC_URL || '').trim();
  if (!apiKey || !from || !publicUrl) fail(503, 'Password recovery is not configured. Please contact ShopVerse support.');

  let base;
  try {
    base = new URL(publicUrl);
  } catch (error) {
    fail(503, 'Password recovery is not configured. Please contact ShopVerse support.');
  }
  if (!['https:', 'http:'].includes(base.protocol) ||
      (isProduction && base.protocol !== 'https:') || base.username || base.password) {
    fail(503, 'Password recovery is not configured. Please contact ShopVerse support.');
  }
  return { apiKey, from, base };
};

const sendPasswordResetEmail = async (email, token, config) => {
  const link = new URL('/reset-password', config.base);
  link.searchParams.set('token', token);
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: config.from,
        to: [email],
        subject: 'Reset your ShopVerse password',
        text: `Use this one-time link to reset your ShopVerse password. It expires in 30 minutes: ${link.href}`,
        html: `<p>We received a request to reset your ShopVerse password.</p><p><a href="${escapeAttr(link.href)}">Reset your password</a></p><p>This one-time link expires in 30 minutes. If you did not request a reset, you can ignore this email.</p>`
      }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    console.error('Password-reset email delivery failed:', error.message);
    fail(503, 'Password recovery email could not be sent. Please try again later.');
  }
  if (!response.ok) {
    console.error('Resend rejected a password-reset email with status', response.status);
    fail(503, 'Password recovery email could not be sent. Please try again later.');
  }
};

app.post('/api/forgot-password', asyncRoute(async (req, res) => {
  passwordResetLimiter.check(req.ip);
  passwordResetLimiter.hit(req.ip);
  const email = normalizeEmail((req.body || {}).email);
  if (!isValidEmail(email)) fail(400, 'Please enter a valid email address.');
  passwordResetEmailLimiter.check(email);
  passwordResetEmailLimiter.hit(email);
  const config = passwordResetConfig();
  const user = getUserByEmail(email);

  if (user && !isDemoAccountBlocked(user)) {
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = sha256(token);
    user.passwordResetExpiresAt = Date.now() + 30 * 60 * 1000;
    await persistAppState();
    await sendPasswordResetEmail(email, token, config);
  }
  res.json({
    success: true,
    message: 'If an account exists for that email, a password reset link will be sent shortly.'
  });
}));

app.post('/api/reset-password', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const token = String(body.token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) fail(400, 'This password reset link is invalid or has expired.');
  const tokenHash = sha256(token);
  const user = users.find((entry) => {
    if (!entry.passwordResetTokenHash || !Number.isFinite(entry.passwordResetExpiresAt) ||
        entry.passwordResetExpiresAt <= Date.now()) return false;
    const expected = Buffer.from(entry.passwordResetTokenHash, 'hex');
    const actual = Buffer.from(tokenHash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  });
  if (!user) fail(400, 'This password reset link is invalid or has expired.');

  user.password = hashPassword(validatePassword(body.newPassword));
  delete user.passwordResetTokenHash;
  delete user.passwordResetExpiresAt;
  for (const [hash, session] of sessions) if (session.userId === user.id) sessions.delete(hash);
  await persistAppState();
  res.json({ success: true, message: 'Your password has been reset. Please sign in with your new password.' });
}));

app.post('/api/logout', authMiddleware, asyncRoute(async (req, res) => {
  sessions.delete(req.sessionHash);
  await persistAppState();
  res.json({ success: true });
}));

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: sanitizeUser(req.user) });
});

app.patch('/api/me', authMiddleware, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const updates = {};

  if (body.name !== undefined) updates.name = text(body.name, { field: 'Name', max: 80, required: true });
  if (body.email !== undefined && String(body.email).trim()) {
    const email = normalizeEmail(body.email);
    const existing = getUserByEmail(email);
    if (existing && existing.id !== req.user.id) fail(409, 'An account with that email already exists.');
    updates.email = email;
  }
  if (req.user.role === 'shop_owner') {
    Object.assign(updates, shopFieldsFromBody(body, { requireCore: false, existing: req.user }));
    const term = moderation.findProhibited(updates.shopName, updates.shopDescription);
    if (term) {
      reportProhibitedAttempt(req.user, term, 'a shop profile');
      await persistAppState();
      fail(400, moderation.PROHIBITED_MESSAGE(term));
    }
  }

  // Validate everything first, then apply, so a bad field never leaves a half-updated profile.
  Object.assign(req.user, updates);
  await persistAppState();
  res.json({ success: true, user: sanitizeUser(req.user) });
}));

app.post('/api/me/password', authMiddleware, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!passwordMatches(currentPassword || '', req.user.password)) fail(400, 'Your current password is incorrect.');
  req.user.password = hashPassword(validatePassword(newPassword));

  // Sign out every other device.
  for (const [hash, session] of sessions) {
    if (session.userId === req.user.id && hash !== req.sessionHash) sessions.delete(hash);
  }
  await persistAppState();
  res.json({ success: true, message: 'Password updated.' });
}));

// Sellers ask to be verified; a ShopVerse admin reviews the details and approves or rejects.
app.post('/api/me/verification', authMiddleware,
  requireRole('shop_owner', 'Only shop owners can request verification.'),
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    rejectIfSuspended(req.user);
    const current = verificationOf(req.user);
    if (current.status === 'verified') fail(409, 'Your shop is already verified.');

    const businessName = text(body.businessName, { field: 'Business name', max: 120, required: true });
    const idNumber = text(body.idNumber, { field: 'NRC or PACRA number', max: 40, required: true });
    const note = text(body.note, { field: 'Note', max: 500 });
    const phone = String(body.phone || req.user.shopPhone || '').trim();
    if (!market.phoneDigits(phone)) fail(400, 'Add a WhatsApp number so ShopVerse can contact you.');

    req.user.shopPhone = market.formatPhone(phone);
    req.user.verification = { status: 'pending', businessName, idNumber, note: note || null, submittedAt: nowIso() };
    users.filter(isAdmin).forEach((admin) => {
      createNotification(admin.id, 'review', `${req.user.shopName} requested seller verification.`);
    });

    await persistAppState();
    res.json({ success: true, user: sanitizeUser(req.user) });
  }));

// Public payment details shown at checkout and on unpaid orders.
app.get('/api/payment-info', (req, res) => {
  res.json({
    success: true,
    payment: {
      accountName: PAYMENT_ACCOUNTS.accountName || 'ShopVerse',
      accounts: {
        mtn_mobile_money: PAYMENT_ACCOUNTS.mtn_mobile_money || null,
        airtel_money: PAYMENT_ACCOUNTS.airtel_money || null,
        zamtel_money: PAYMENT_ACCOUNTS.zamtel_money || null,
        bank_transfer: PAYMENT_ACCOUNTS.bank_transfer || null
      },
      protectionDays: Math.round(market.PAYOUT_WINDOW_MS / (24 * 60 * 60 * 1000)),
      commissionPercent: COMMISSION_PERCENT
    }
  });
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

app.post('/api/products/:productId/reviews', authMiddleware,
  requireRole('customer', 'Only customers can leave product reviews.'),
  asyncRoute(async (req, res) => {
    const product = getProductById(req.params.productId);
    if (!product) fail(404, 'Product not found.');

    const { rating, comment } = req.body || {};
    const parsedRating = Number(rating);
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      fail(400, 'Rating must be a whole number from 1 to 5.');
    }
    const body = text(comment, { field: 'Review', max: 1000 });

    // One review per customer per product: a second submission updates the first.
    const existing = productReviews.find((review) => review.productId === product.id && review.customerId === req.user.id);
    const review = existing || { id: crypto.randomUUID(), productId: product.id, customerId: req.user.id, createdAt: nowIso() };
    Object.assign(review, {
      customerName: req.user.name,
      rating: parsedRating,
      comment: body || 'No comment provided.',
      verifiedPurchase: hasPurchased(req.user.id, product.id),
      updatedAt: nowIso()
    });
    if (!existing) {
      productReviews.push(review);
      createNotification(product.shopId, 'review', `${req.user.name} rated ${product.name} ${parsedRating}/5.`);
    }

    await persistAppState();
    res.status(existing ? 200 : 201).json({ success: true, review });
  }));

// ---------------------------------------------------------------------------
// Shop owner catalogue
// ---------------------------------------------------------------------------

const productFieldsFromBody = (body, existing) => {
  const { name, description, category, price, stock, image } = body;
  if (!name || price === undefined || price === '' || stock === undefined || stock === '') {
    fail(400, 'Product name, price, and stock are required.');
  }

  const parsedPrice = Number(price);
  const parsedStock = Number(stock);
  if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 10000000) {
    fail(400, 'Product price must be a valid non-negative number.');
  }
  if (!Number.isInteger(parsedStock) || parsedStock < 0 || parsedStock > 1000000) {
    fail(400, 'Product stock must be a valid non-negative whole number.');
  }

  const normalizedCategory = String(category ?? (existing && existing.category) ?? 'Other').trim();
  if (!normalizedCategory || normalizedCategory.length > 40) {
    fail(400, 'Product category must be between 1 and 40 characters.');
  }

  const fields = {
    name: text(name, { field: 'Product name', max: 120, required: true }),
    description: text(description ?? (existing && existing.description), { field: 'Description', max: 2000 }),
    category: normalizedCategory,
    price: roundMoney(parsedPrice),
    stock: parsedStock
  };
  const parsedImage = parseImageInput(image);
  if (parsedImage !== undefined) fields.image = parsedImage;
  return fields;
};

const rejectIfSuspended = (user) => {
  if (user.suspended) {
    fail(403, `Your shop has been suspended by ShopVerse${user.suspended.reason ? `: ${user.suspended.reason}` : ''}. Contact ShopVerse support.`);
  }
};

// Refuses product text that advertises illegal drugs, and tells the admins.
const rejectProhibitedProduct = async (req, fields) => {
  rejectIfSuspended(req.user);
  const term = moderation.findProhibited(fields.name, fields.description, fields.category);
  if (!term) return;
  reportProhibitedAttempt(req.user, term, `a product ("${String(fields.name).slice(0, 60)}")`);
  await persistAppState();
  fail(400, moderation.PROHIBITED_MESSAGE(term));
};

const requireOwnedProduct = (req) => {
  const product = getProductById(req.params.productId);
  if (!product) fail(404, 'Product not found.');
  if (product.shopId !== req.user.id) fail(403, 'You can only manage your own products.');
  return product;
};

app.post('/api/products', authMiddleware,
  requireRole('shop_owner', 'Only shop owners can add products.'),
  asyncRoute(async (req, res) => {
    const fields = productFieldsFromBody(req.body || {}, null);
    await rejectProhibitedProduct(req, fields);
    const product = {
      id: crypto.randomUUID(),
      shopId: req.user.id,
      image: null,
      ...fields,
      sortOrder: getNextShopProductOrder(req.user.id),
      createdAt: nowIso()
    };
    products.push(product);
    await persistAppState();
    res.status(201).json({ success: true, product: serializeProduct(product) });
  }));

app.put('/api/products/:productId', authMiddleware,
  requireRole('shop_owner', 'Only shop owners can update products.'),
  asyncRoute(async (req, res) => {
    const product = requireOwnedProduct(req);
    const fields = productFieldsFromBody(req.body || {}, product);
    await rejectProhibitedProduct(req, fields);
    Object.assign(product, fields, { updatedAt: nowIso() });
    await persistAppState();
    res.json({ success: true, product: serializeProduct(product) });
  }));

app.delete('/api/products/:productId', authMiddleware,
  requireRole('shop_owner', 'Only shop owners can delete products.'),
  asyncRoute(async (req, res) => {
    const product = requireOwnedProduct(req);
    products.splice(products.indexOf(product), 1);
    Object.values(carts).forEach((cart) => {
      cart.items = (cart.items || []).filter((item) => item.productId !== product.id);
    });
    for (let index = productReviews.length - 1; index >= 0; index -= 1) {
      if (productReviews[index].productId === product.id) productReviews.splice(index, 1);
    }
    await persistAppState();
    res.json({ success: true, message: 'Product deleted successfully.' });
  }));

app.get('/api/my-products', authMiddleware,
  requireRole('shop_owner', 'Only shop owners can view this list.'),
  (req, res) => {
    res.json({ success: true, products: getShopProducts(req.user.id).map((product) => serializeProduct(product)) });
  });

app.put('/api/my-products/order', authMiddleware,
  requireRole('shop_owner', 'Only shop owners can reorder products.'),
  asyncRoute(async (req, res) => {
    const { productIds } = req.body || {};
    const shopProducts = getShopProducts(req.user.id);
    const ownedIds = new Set(shopProducts.map((product) => product.id));

    if (
      !Array.isArray(productIds) ||
      productIds.length !== shopProducts.length ||
      new Set(productIds).size !== shopProducts.length ||
      productIds.some((id) => typeof id !== 'string' || !ownedIds.has(id))
    ) {
      fail(400, 'Order must contain each of your products exactly once.');
    }

    productIds.forEach((id, sortOrder) => {
      getProductById(id).sortOrder = sortOrder;
    });
    await persistAppState();
    res.json({ success: true, products: getShopProducts(req.user.id).map((product) => serializeProduct(product)) });
  }));

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

const parseQuantity = (value, { allowZero }) => {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < (allowZero ? 0 : 1) || quantity > 999) {
    fail(400, allowZero ? 'Quantity must be a whole number of zero or more.' : 'Quantity must be a whole number greater than zero.');
  }
  return quantity;
};

const customerOnly = (message) => [authMiddleware, requireRole('customer', message)];

app.get('/api/cart', ...customerOnly('Only customers can use the cart.'), (req, res) => {
  res.json({ success: true, cart: getCartView(req.user.id) });
});

app.post('/api/cart/add', ...customerOnly('Only customers can add products to cart.'), asyncRoute(async (req, res) => {
  const { productId, quantity = 1 } = req.body || {};
  const product = getProductById(productId);
  if (!product || !isListedProduct(product)) fail(404, 'This product is not available.');
  const requested = parseQuantity(quantity, { allowZero: false });
  if (product.stock <= 0) fail(400, 'This product is sold out.');

  const cart = carts[req.user.id] || (carts[req.user.id] = { items: [] });
  const current = cart.items.find((item) => item.productId === productId);
  const nextQuantity = (current ? current.quantity : 0) + requested;
  if (nextQuantity > product.stock) {
    fail(400, `Not enough stock available for this product. Only ${product.stock} left.`);
  }

  if (current) current.quantity = nextQuantity;
  else cart.items.push({ productId, quantity: requested });

  await persistAppState();
  res.json({ success: true, cart: getCartView(req.user.id) });
}));

app.post('/api/cart/update', ...customerOnly('Only customers can manage the cart.'), asyncRoute(async (req, res) => {
  const { productId, quantity } = req.body || {};
  const cart = carts[req.user.id];
  const item = cart && cart.items.find((entry) => entry.productId === productId);
  if (!item) fail(404, 'Item not found in cart.');
  const product = getProductById(productId);
  if (!product) fail(404, 'Product not found.');

  const nextQuantity = parseQuantity(quantity, { allowZero: true });
  if (nextQuantity === 0) {
    cart.items = cart.items.filter((entry) => entry.productId !== productId);
  } else {
    if (nextQuantity > product.stock) fail(400, `Not enough stock available for this product. Only ${product.stock} left.`);
    item.quantity = nextQuantity;
  }

  await persistAppState();
  res.json({ success: true, cart: getCartView(req.user.id) });
}));

app.post('/api/cart/remove', ...customerOnly('Only customers can manage the cart.'), asyncRoute(async (req, res) => {
  const { productId } = req.body || {};
  const cart = carts[req.user.id];
  if (cart) {
    cart.items = cart.items.filter((item) => item.productId !== productId);
    await persistAppState();
  }
  res.json({ success: true, cart: getCartView(req.user.id) });
}));

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

app.post('/api/orders', ...customerOnly('Only customers can place orders.'), asyncRoute(async (req, res) => {
  const cart = carts[req.user.id];
  if (!cart || cart.items.length === 0) fail(400, 'Your cart is empty.');

  const body = req.body || {};
  const requestedMethods = body.fulfilment && typeof body.fulfilment === 'object' ? body.fulfilment : {};
  const shippingAddress = text(body.shippingAddress, { field: 'Delivery address', max: 300 });
  const contactPhone = text(body.contactPhone, { field: 'Phone number', max: 30 });
  if (contactPhone && !/^[+\d][\d\s()-]{5,}$/.test(contactPhone)) fail(400, 'Please provide a valid phone number.');
  const note = text(body.note, { field: 'Order note', max: 500 });
  const paymentMethod = String(body.paymentMethod || 'card').trim().toLowerCase();
  if (!PAYMENT_METHODS.includes(paymentMethod)) fail(400, 'Please choose a valid payment method.');

  // Validate the whole cart before touching stock so a failure never leaves partial deductions.
  const lines = cart.items.map((item) => {
    const product = getProductById(item.productId);
    if (!product || !isListedProduct(product)) {
      fail(404, `${product ? product.name : 'An item in your cart'} is no longer available. Please remove it and try again.`);
    }
    if (item.quantity > product.stock) {
      fail(400, product.stock > 0
        ? `Not enough stock for ${product.name}. Only ${product.stock} left.`
        : `${product.name} has sold out. Please remove it from your cart.`);
    }
    return { item, product };
  });

  // Work out delivery or pickup and the delivery fee for each shop in the cart.
  const fulfilment = {};
  lines.forEach(({ item, product }) => {
    const entry = fulfilment[product.shopId] || (fulfilment[product.shopId] = { itemsSubtotal: 0 });
    entry.itemsSubtotal += product.price * item.quantity;
  });
  Object.entries(fulfilment).forEach(([shopId, entry]) => {
    const delivery = market.deliveryOf(getShopById(shopId));
    const requested = requestedMethods[shopId];
    entry.method = market.chooseMethod(delivery, requested && typeof requested === 'object' ? requested.method : requested);
    entry.deliveryFee = entry.method === 'delivery' ? market.deliveryFeeFor(delivery, entry.itemsSubtotal) : 0;
    if (entry.method === 'delivery') {
      const courierCompany = text(requestedMethods[shopId] && requestedMethods[shopId].courierCompany, { field: 'Courier company', max: 80 });
      if (courierCompany && !getCourierCompanies().includes(courierCompany)) fail(400, 'Please choose an available delivery company.');
      if (courierCompany) {
        entry.courierCompany = courierCompany;
        recordDeliveryAudit(entry, 'courier_assigned', req.user.id, { courierCompany });
      }
    }
    delete entry.itemsSubtotal;
  });
  const needsAddress = Object.values(fulfilment).some((entry) => entry.method === 'delivery');
  if (needsAddress && !shippingAddress) fail(400, 'A delivery address is required before placing an order.');

  const items = lines.map(({ item, product }) => {
    product.stock -= item.quantity;
    const shop = getShopById(product.shopId);
    return {
      productId: product.id,
      productName: product.name,
      shopId: product.shopId,
      shopName: shop ? shop.shopName : 'Unknown shop',
      price: product.price,
      quantity: item.quantity
    };
  });

  const shopStatuses = {};
  items.forEach((item) => {
    shopStatuses[item.shopId] = 'pending';
  });

  const orderId = crypto.randomUUID();
  const itemsTotal = roundMoney(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const deliveryTotal = roundMoney(Object.values(fulfilment).reduce((sum, entry) => sum + entry.deliveryFee, 0));
  const isProtected = market.isProtectedMethod(paymentMethod);
  const order = {
    id: orderId,
    customerId: req.user.id,
    customerName: req.user.name,
    items,
    itemsTotal,
    deliveryTotal,
    total: roundMoney(itemsTotal + deliveryTotal),
    status: 'pending',
    shopStatuses,
    fulfilment,
    paymentMethod,
    paymentStatus: 'pending',
    payment: {
      method: paymentMethod,
      reference: paymentReference(orderId),
      protected: isProtected,
      status: 'pending'
    },
    shippingAddress: needsAddress ? shippingAddress : null,
    contactPhone: contactPhone || null,
    note: note || null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  orders.push(order);
  carts[req.user.id] = { items: [] };

  createNotification(
    req.user.id,
    'order',
    isProtected
      ? `Order #${shortId(order.id)} placed. Payment is pending. Pay ${formatZmw(order.total)} with reference ${order.payment.reference}.`
      : `Order #${shortId(order.id)} placed. Payment is pending. Pay the shop on delivery.`
  );
  Object.keys(shopStatuses).forEach((shopId) => {
    const shopItems = items.filter((item) => item.shopId === shopId);
    const units = shopItems.reduce((sum, item) => sum + item.quantity, 0);
    const value = shopItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    createNotification(shopId, 'sale', `New order #${shortId(order.id)}: ${units} item${units === 1 ? '' : 's'} (${formatZmw(value)}).`);
  });

  await persistAppState();
  res.status(201).json({ success: true, order: serializeCustomerOrder(order) });
}));

app.get('/api/my-orders', ...customerOnly('Only customers can view their orders.'), (req, res) => {
  const result = orders
    .filter((order) => order.customerId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(serializeCustomerOrder);
  res.json({ success: true, orders: result });
});

app.post('/api/orders/:orderId/cancel', ...customerOnly('Only customers can cancel their orders.'), asyncRoute(async (req, res) => {
  const order = orders.find((entry) => entry.id === req.params.orderId && entry.customerId === req.user.id);
  if (!order) fail(404, 'Order not found.');
  if (!serializeCustomerOrder(order).canCancel) {
    fail(409, 'This order is already being processed and can no longer be cancelled. Please contact the shop.');
  }

  Object.keys(order.shopStatuses).forEach((shopId) => {
    if (order.shopStatuses[shopId] === 'cancelled') return;
    order.shopStatuses[shopId] = 'cancelled';
    restockItems(order.items.filter((item) => item.shopId === shopId));
    createNotification(shopId, 'status', `Order #${shortId(order.id)} was cancelled by the customer.`);
  });
  order.status = 'cancelled';
  // Money already sent to ShopVerse is refunded by an admin.
  if (order.payment.protected) {
    setPaymentStatus(order, ['held', 'submitted'].includes(order.payment.status) ? 'refund_due' : 'cancelled');
  }
  order.updatedAt = nowIso();

  await persistAppState();
  res.json({ success: true, order: serializeCustomerOrder(order) });
}));

const findCustomerOrder = (req) => {
  const order = orders.find((entry) => entry.id === req.params.orderId && entry.customerId === req.user.id);
  if (!order) fail(404, 'Order not found.');
  return order;
};

app.post('/api/orders/:orderId/shops/:shopId/delivery-code', ...customerOnly('Only customers can request their delivery code.'), asyncRoute(async (req, res) => {
  const order = findCustomerOrder(req);
  const fulfilment = requireShopInOrder(order, req.params.shopId);
  if (!fulfilment.courierCompany) fail(400, 'This order does not use a courier delivery.');
  if (order.shopStatuses[req.params.shopId] === 'cancelled' || fulfilment.courierDeliveredAt) fail(409, 'A delivery code is not available for this order.');
  if (order.shopStatuses[req.params.shopId] !== 'shipped') fail(409, 'A delivery code is available after the seller marks the order shipped.');

  const deliveryCode = String(crypto.randomInt(10000000, 100000000));
  fulfilment.deliveryCodeHash = sha256(deliveryCode);
  fulfilment.deliveryCodeExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  order.updatedAt = nowIso();
  await persistAppState();
  res.json({ success: true, deliveryCode, expiresAt: fulfilment.deliveryCodeExpiresAt });
}));

const getCourierCompanies = () => [...new Set(
  users.filter((user) => user.role === 'courier' && user.courierActive).map((user) => user.courierCompany)
)].sort((a, b) => a.localeCompare(b));

app.get('/api/couriers', (req, res) => {
  res.json({ success: true, companies: getCourierCompanies() });
});

// The customer tells ShopVerse they have paid and gives the mobile money / bank transaction ID.
app.post('/api/orders/:orderId/payment', ...customerOnly('Only customers can pay for orders.'), asyncRoute(async (req, res) => {
  const order = findCustomerOrder(req);
  if (!order.payment.protected) fail(400, 'This order is paid to the shop on delivery.');
  if (order.payment.status !== 'pending') fail(409, 'Payment for this order has already been submitted.');
  if (deriveOrderStatus(order) === 'cancelled') fail(409, 'This order was cancelled.');

  const transactionId = text((req.body || {}).transactionId, { field: 'Transaction ID', max: 60, required: true });
  order.payment.transactionId = transactionId;
  order.payment.submittedAt = nowIso();
  setPaymentStatus(order, 'submitted');

  users.filter(isAdmin).forEach((admin) => {
    createNotification(admin.id, 'order', `Payment submitted for order #${shortId(order.id)} (${order.payment.reference}, ${formatZmw(order.total)}).`);
  });
  await persistAppState();
  res.json({ success: true, order: serializeCustomerOrder(order) });
}));

const requireShopInOrder = (order, shopId) => {
  if (!order.shopStatuses[shopId]) fail(404, 'That shop is not part of this order.');
  return order.fulfilment[shopId] || (order.fulfilment[shopId] = { method: 'delivery', deliveryFee: 0 });
};

// The customer confirms they received a shop's items, which releases that shop's payout.
app.post('/api/orders/:orderId/confirm', ...customerOnly('Only customers can confirm delivery.'), asyncRoute(async (req, res) => {
  const order = findCustomerOrder(req);
  const shopIds = (req.body && req.body.shopId) ? [String(req.body.shopId)] : Object.keys(order.shopStatuses);
  let confirmed = 0;

  shopIds.forEach((shopId) => {
    const fulfilment = requireShopInOrder(order, shopId);
    if (fulfilment.courierCompany) fail(403, 'The assigned courier must confirm delivery. ShopVerse will review their receipt before payout.');
    const status = order.shopStatuses[shopId];
    if (!['shipped', 'delivered'].includes(status) || fulfilment.confirmedAt) return;
    if (fulfilment.dispute && !fulfilment.dispute.resolvedAt) return;
    order.shopStatuses[shopId] = 'delivered';
    fulfilment.deliveredAt = fulfilment.deliveredAt || nowIso();
    fulfilment.confirmedAt = nowIso();
    confirmed += 1;
    createNotification(shopId, 'sale', `${order.customerName} confirmed receiving order #${shortId(order.id)}.${
      order.payment.protected ? ' Your payout is being released.' : ''}`);
  });
  if (!confirmed) fail(409, 'There is nothing to confirm yet. Wait until the shop has shipped your order.');

  order.status = deriveOrderStatus(order);
  order.updatedAt = nowIso();
  await persistAppState();
  res.json({ success: true, order: serializeCustomerOrder(order) });
}));

// The customer reports a problem; the shop's payout is frozen until an admin resolves it.
app.post('/api/orders/:orderId/dispute', ...customerOnly('Only customers can report a problem.'), asyncRoute(async (req, res) => {
  const order = findCustomerOrder(req);
  const shopId = String((req.body && req.body.shopId) || Object.keys(order.shopStatuses)[0]);
  const fulfilment = requireShopInOrder(order, shopId);
  if (!['shipped', 'delivered'].includes(order.shopStatuses[shopId])) fail(409, 'You can report a problem once the shop has shipped your order.');
  if (fulfilment.confirmedAt) fail(409, 'You already confirmed receiving this order.');
  if (fulfilment.paidOutAt) fail(409, 'The shop has already been paid for this order. Please contact ShopVerse support.');
  if (fulfilment.dispute) fail(409, 'A problem has already been reported for this order.');

  const reason = text((req.body || {}).reason, { field: 'Problem description', max: 1000, required: true });
  fulfilment.dispute = { reason, openedAt: nowIso() };
  order.updatedAt = nowIso();

  createNotification(shopId, 'status', `${order.customerName} reported a problem with order #${shortId(order.id)}. Payment is on hold while ShopVerse reviews it.`);
  users.filter(isAdmin).forEach((admin) => {
    createNotification(admin.id, 'status', `Dispute opened on order #${shortId(order.id)} with ${shopNameIn(order, shopId)}.`);
  });
  await persistAppState();
  res.json({ success: true, order: serializeCustomerOrder(order) });
}));

app.get('/api/shop-orders', authMiddleware, requireRole('shop_owner', 'Only shop owners can view orders.'), (req, res) => {
  const result = orders
    .filter((order) => order.items.some((item) => item.shopId === req.user.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((order) => serializeShopOrder(order, req.user.id));
  res.json({ success: true, orders: result });
});

app.patch('/api/orders/:orderId/status', authMiddleware,
  requireRole('shop_owner', 'Only shop owners can update order status.'),
  asyncRoute(async (req, res) => {
    const order = orders.find((entry) => entry.id === req.params.orderId);
    if (!order) fail(404, 'Order not found.');
    if (!order.items.some((item) => item.shopId === req.user.id)) fail(403, 'You can only update orders for your shop.');

    const status = String((req.body && req.body.status) || '').trim().toLowerCase();
    if (!ORDER_STATUSES.includes(status)) fail(400, `Status must be one of: ${ORDER_STATUSES.join(', ')}.`);

    const current = order.shopStatuses[req.user.id];
    const fulfilment = requireShopInOrder(order, req.user.id);
    if (status === 'delivered' && fulfilment.courierCompany) fail(403, 'The assigned courier must confirm delivery for this order.');
    if (current !== status) {
      if (FINAL_STATUSES.includes(current)) fail(409, `This order is already ${current} and cannot be changed.`);

      order.shopStatuses[req.user.id] = status;
      if (status === 'cancelled') restockItems(order.items.filter((item) => item.shopId === req.user.id));
      if (status === 'delivered') fulfilment.deliveredAt = nowIso();
      if (status === 'shipped') {
        fulfilment.shippedAt = fulfilment.shippedAt || nowIso();
        if (fulfilment.courierCompany) recordDeliveryAudit(fulfilment, 'seller_shipped', req.user.id);
      }
      order.status = deriveOrderStatus(order);
      order.updatedAt = nowIso();

      const multiShop = Object.keys(order.shopStatuses).length > 1;
      let message = multiShop
        ? `${req.user.shopName} marked its part of order #${shortId(order.id)} as ${status}.`
        : `Your order #${shortId(order.id)} is now ${status}.`;
      if (status === 'delivered' && order.payment.protected) {
        const days = Math.round(market.PAYOUT_WINDOW_MS / (24 * 60 * 60 * 1000));
        message += ` Please confirm you received it, or report a problem within ${days} days.`;
      }
      if (status === 'shipped' && fulfilment.courierCompany) {
        const courierUsers = users.filter((user) => user.role === 'courier' && user.courierCompany === fulfilment.courierCompany);
        courierUsers.forEach((courier) => createNotification(courier.id, 'delivery', `Order #${shortId(order.id)} from ${shopNameIn(order, req.user.id)} is ready for delivery confirmation.`));
      }
      if (status === 'cancelled' && order.payment.confirmedAt) message += ' ShopVerse will refund your payment for these items.';
      createNotification(order.customerId, 'status', message);
      await persistAppState();
    }

    res.json({ success: true, order: serializeShopOrder(order, req.user.id) });
  }));

// ---------------------------------------------------------------------------
// Notifications & dashboard
// ---------------------------------------------------------------------------

app.get('/api/notifications', authMiddleware, (req, res) => {
  const mine = notifications
    .filter((notification) => notification.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({
    success: true,
    unreadCount: mine.filter((notification) => !notification.read).length,
    notifications: mine.slice(0, 50)
  });
});

app.post('/api/notifications/read-all', authMiddleware, asyncRoute(async (req, res) => {
  let changed = false;
  notifications.forEach((notification) => {
    if (notification.userId === req.user.id && !notification.read) {
      notification.read = true;
      changed = true;
    }
  });
  if (changed) await persistAppState();
  res.json({ success: true, unreadCount: 0 });
}));

app.get('/api/dashboard', authMiddleware, (req, res) => {
  const base = {
    role: req.user.role,
    totalShops: users.filter((user) => user.role === 'shop_owner').length,
    totalOrders: orders.length
  };

  if (req.user.role === 'shop_owner') {
    const shopProducts = products.filter((product) => product.shopId === req.user.id);
    const shopOrders = orders
      .filter((order) => order.items.some((item) => item.shopId === req.user.id))
      .map((order) => serializeShopOrder(order, req.user.id));
    const reviews = productReviews.filter((review) => shopProducts.some((product) => product.id === review.productId));
    const { averageRating, reviewCount } = ratingSummary(reviews);

    return res.json({
      success: true,
      stats: {
        ...base,
        shopProductCount: shopProducts.length,
        shopOrderCount: shopOrders.length,
        openOrderCount: shopOrders.filter((order) => !FINAL_STATUSES.includes(order.status)).length,
        revenue: roundMoney(shopOrders.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + order.total, 0)),
        lowStockCount: shopProducts.filter((product) => product.stock <= LOW_STOCK_THRESHOLD).length,
        averageRating,
        reviewCount,
        // Money in protected payments, by stage.
        payoutHeld: roundMoney(shopOrders.filter((order) => ['held', 'on_hold'].includes(order.payout.state)).reduce((sum, order) => sum + order.payout.net, 0)),
        payoutReady: roundMoney(shopOrders.filter((order) => order.payout.state === 'ready').reduce((sum, order) => sum + order.payout.net, 0)),
        payoutPaid: roundMoney(shopOrders.filter((order) => order.payout.state === 'paid').reduce((sum, order) => sum + order.payout.net, 0)),
        verification: verificationOf(req.user).status,
        // Whether buyers can see and buy from this shop yet, and how many products are blocked.
        listed: isListedShop(req.user),
        suspended: req.user.suspended ? { at: req.user.suspended.at, reason: req.user.suspended.reason || null } : null,
        requireVerification: REQUIRE_VERIFICATION,
        blockedProductCount: shopProducts.filter((product) => prohibitedTermIn(product)).length
      }
    });
  }

  const myOrders = orders.filter((order) => order.customerId === req.user.id);
  return res.json({
    success: true,
    stats: {
      ...base,
      userOrderCount: myOrders.length,
      activeOrderCount: myOrders.filter((order) => !FINAL_STATUSES.includes(deriveOrderStatus(order))).length,
      totalSpent: roundMoney(myOrders.filter((order) => deriveOrderStatus(order) !== 'cancelled').reduce((sum, order) => sum + order.total, 0)),
      cartCount: getCartView(req.user.id).itemCount
    }
  });
});

// ---------------------------------------------------------------------------
// Admin: verification, protected payments, payouts, disputes, metrics
// ---------------------------------------------------------------------------

const adminOnly = [authMiddleware, requireAdmin];
const courierOnly = [
  authMiddleware,
  requireRole('courier', 'Only registered delivery companies can confirm delivery.'),
  (req, res, next) => req.user.courierActive
    ? next()
    : res.status(403).json({ success: false, message: 'This courier account is awaiting activation or has been disabled.' })
];

const adminOrderEntry = (order, shopId = null) => {
  const entry = {
    orderId: order.id,
    reference: order.payment.reference,
    customerName: order.customerName,
    customerPhone: order.contactPhone || null,
    method: order.paymentMethod,
    paymentStatus: order.payment.status,
    transactionId: order.payment.transactionId || null,
    submittedAt: order.payment.submittedAt || null,
    amount: order.total,
    createdAt: order.createdAt
  };
  if (shopId) {
    const shop = getShopById(shopId);
    const amounts = market.shopPayoutAmounts(order, shopId, COMMISSION_PERCENT);
    Object.assign(entry, {
      shopId,
      shopName: shopNameIn(order, shopId),
      shopPhone: shop ? shop.shopPhone || null : null,
      status: order.shopStatuses[shopId],
      payoutState: market.payoutState(order, shopId),
      amount: amounts.gross,
      commission: amounts.commission,
      net: amounts.net,
      dispute: (order.fulfilment[shopId] || {}).dispute || null
    });
    const fulfilment = order.fulfilment[shopId] || {};
    Object.assign(entry, {
      courierCompany: fulfilment.courierCompany || null,
      courierDeliveredAt: fulfilment.courierDeliveredAt || null,
      courierReceiptReference: fulfilment.courierReceiptReference || null,
      adminDeliveryApprovedAt: fulfilment.adminDeliveryApprovedAt || null,
      adminDeliveryOverrideAt: fulfilment.adminDeliveryOverrideAt || null,
      deliveryAudit: fulfilment.deliveryAudit || []
    });
  }
  return entry;
};

const findOrder = (orderId) => {
  const order = orders.find((entry) => entry.id === orderId);
  if (!order) fail(404, 'Order not found.');
  return order;
};

app.get('/api/admin/overview', ...adminOnly, (req, res) => {
  res.json({ success: true, metrics: market.marketplaceMetrics({ users, products, orders, commissionPercent: COMMISSION_PERCENT }) });
});

app.get('/api/admin/couriers', ...adminOnly, (req, res) => {
  const couriers = users.filter((user) => user.role === 'courier').map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    courierCompany: user.courierCompany,
    courierActive: Boolean(user.courierActive)
  }));
  res.json({ success: true, companies: getCourierCompanies(), couriers });
});

app.post('/api/admin/couriers', ...adminOnly, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = text(body.name, { field: 'Name', max: 80, required: true });
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) fail(400, 'Please provide a valid email address.');
  const password = validatePassword(body.password);
  const courierCompany = text(body.courierCompany, { field: 'Courier company', max: 80, required: true });
  if (getUserByEmail(email)) fail(409, 'An account with that email already exists.');

  const courier = {
    id: crypto.randomUUID(),
    name,
    email,
    password: hashPassword(password),
    role: 'courier',
    courierCompany,
    courierActive: false,
    createdAt: nowIso()
  };
  users.push(courier);
  await persistAppState();
  res.status(201).json({ success: true, courier: sanitizeUser(courier) });
}));

app.patch('/api/admin/couriers/:courierId', ...adminOnly, asyncRoute(async (req, res) => {
  const courier = users.find((user) => user.id === req.params.courierId && user.role === 'courier');
  if (!courier) fail(404, 'Courier account not found.');
  const active = (req.body || {}).active;
  if (typeof active !== 'boolean') fail(400, 'Active must be true or false.');
  courier.courierActive = active;
  if (!active) {
    for (const [hash, session] of sessions) if (session.userId === courier.id) sessions.delete(hash);
  }
  await persistAppState();
  res.json({ success: true, courier: sanitizeUser(courier) });
}));

app.get('/api/admin/sellers', ...adminOnly, (req, res) => {
  const statusRank = { pending: 0, none: 1, rejected: 2, verified: 3 };
  const sellers = users
    .filter((user) => user.role === 'shop_owner')
    .map((user) => {
      const shopOrders = orders.filter((order) => order.shopStatuses[user.id]);
      return {
        ...sanitizeUser(user),
        productCount: products.filter((product) => product.shopId === user.id).length,
        orderCount: shopOrders.length,
        deliveredCount: shopOrders.filter((order) => order.shopStatuses[user.id] === 'delivered').length,
        disputeCount: shopOrders.filter((order) => (order.fulfilment[user.id] || {}).dispute).length,
        unsettledCount: unsettledOrdersFor(user.id).length,
        listed: isListedShop(user)
      };
    })
    .sort((a, b) => statusRank[a.verification.status] - statusRank[b.verification.status] ||
      new Date(b.verification.submittedAt || 0) - new Date(a.verification.submittedAt || 0));
  res.json({ success: true, sellers });
});

app.post('/api/admin/sellers/:shopId/verification', ...adminOnly, asyncRoute(async (req, res) => {
  const shop = getShopById(req.params.shopId);
  if (!shop) fail(404, 'Seller not found.');
  const status = String((req.body && req.body.status) || '');
  if (!['verified', 'rejected', 'none'].includes(status) || !VERIFICATION_STATUSES.includes(status)) {
    fail(400, 'Status must be verified, rejected or none.');
  }
  const reviewNote = text((req.body || {}).note, { field: 'Note', max: 500 });
  shop.verification = { ...verificationOf(shop), status, reviewNote: reviewNote || null, reviewedAt: nowIso() };

  const messages = {
    verified: 'Your shop is now verified. The ✓ Verified badge appears on your storefront and products.',
    rejected: `Your verification request was not approved.${reviewNote ? ` Reason: ${reviewNote}` : ''} You can update your details and apply again.`,
    none: 'Your shop verification was removed. Contact ShopVerse support for details.'
  };
  createNotification(shop.id, 'review', messages[status]);
  await persistAppState();
  res.json({ success: true, seller: sanitizeUser(shop) });
}));

// Orders a shop still has obligations on: not yet finished, or money not yet settled.
const unsettledOrdersFor = (shopId) => orders.filter((order) => {
  const status = order.shopStatuses[shopId];
  if (!status) return false;
  return !FINAL_STATUSES.includes(status) ||
    ['held', 'ready', 'on_hold', 'refund_due'].includes(market.payoutState(order, shopId));
});

const requireSeller = (shopId) => {
  const shop = getShopById(shopId);
  if (!shop) fail(404, 'Seller not found.');
  return shop;
};

// Suspend: hide the shop from buyers at once and stop the seller adding or editing products.
app.post('/api/admin/sellers/:shopId/suspend', ...adminOnly, asyncRoute(async (req, res) => {
  const shop = requireSeller(req.params.shopId);
  const reason = text((req.body || {}).reason, { field: 'Reason', max: 300 });
  shop.suspended = { at: nowIso(), by: req.user.id, reason: reason || null };
  Object.values(carts).forEach((cart) => {
    cart.items = (cart.items || []).filter((item) => (getProductById(item.productId) || {}).shopId !== shop.id);
  });
  createNotification(shop.id, 'status', `Your shop has been suspended by ShopVerse${reason ? `: ${reason}` : '.'} Buyers can't see it. Contact ShopVerse support.`);
  await persistAppState();
  res.json({ success: true, seller: sanitizeUser(shop) });
}));

app.post('/api/admin/sellers/:shopId/unsuspend', ...adminOnly, asyncRoute(async (req, res) => {
  const shop = requireSeller(req.params.shopId);
  if (!shop.suspended) fail(409, 'This shop is not suspended.');
  delete shop.suspended;
  createNotification(shop.id, 'status', `Your shop is no longer suspended.${isVerifiedShop(shop) || !REQUIRE_VERIFICATION ? ' It is visible to buyers again.' : ' Request verification to start selling.'}`);
  await persistAppState();
  res.json({ success: true, seller: sanitizeUser(shop) });
}));

// Delete: permanently remove the shop, its products and the seller's account. Past orders
// stay in customers' history. Refused while the shop still has unsettled orders.
app.delete('/api/admin/sellers/:shopId', ...adminOnly, asyncRoute(async (req, res) => {
  const shop = requireSeller(req.params.shopId);
  if (String((req.body || {}).confirmName || '').trim() !== shop.shopName) {
    fail(400, 'Type the shop name exactly to confirm deleting it.');
  }
  const unsettled = unsettledOrdersFor(shop.id);
  if (unsettled.length) {
    fail(409, `${shop.shopName} still has ${unsettled.length} unsettled order${unsettled.length === 1 ? '' : 's'} (open, or money not yet paid out or refunded). Suspend the shop, settle ${unsettled.length === 1 ? 'it' : 'them'} on the Payments tab, then delete.`);
  }

  const productIds = new Set(products.filter((product) => product.shopId === shop.id).map((product) => product.id));
  for (let index = products.length - 1; index >= 0; index -= 1) {
    if (productIds.has(products[index].id)) products.splice(index, 1);
  }
  for (let index = productReviews.length - 1; index >= 0; index -= 1) {
    if (productIds.has(productReviews[index].productId)) productReviews.splice(index, 1);
  }
  Object.values(carts).forEach((cart) => {
    cart.items = (cart.items || []).filter((item) => !productIds.has(item.productId));
  });
  delete carts[shop.id];
  for (let index = notifications.length - 1; index >= 0; index -= 1) {
    if (notifications[index].userId === shop.id) notifications.splice(index, 1);
  }
  for (const [hash, session] of sessions) if (session.userId === shop.id) sessions.delete(hash);
  users.splice(users.indexOf(shop), 1);

  await persistAppState();
  res.json({ success: true, deleted: { id: shop.id, shopName: shop.shopName, products: productIds.size } });
}));

app.get('/api/admin/payments', ...adminOnly, (req, res) => {
  const newestFirst = (a, b) => new Date(b.submittedAt || b.createdAt) - new Date(a.submittedAt || a.createdAt);
  const toConfirm = orders.filter((order) => order.payment.protected && order.payment.status === 'submitted')
    .map((order) => adminOrderEntry(order)).sort(newestFirst);
  const awaiting = orders.filter((order) => order.payment.protected && order.payment.status === 'pending' && deriveOrderStatus(order) !== 'cancelled')
    .map((order) => adminOrderEntry(order)).sort(newestFirst);

  const byState = { ready: [], refund_due: [], on_hold: [], held: [] };
  const deliveryConfirmations = [];
  orders.forEach((order) => Object.keys(order.shopStatuses).forEach((shopId) => {
    const state = market.payoutState(order, shopId);
    if (byState[state]) byState[state].push(adminOrderEntry(order, shopId));
    const fulfilment = order.fulfilment[shopId] || {};
    if (fulfilment.courierDeliveredAt && !fulfilment.adminDeliveryApprovedAt && !(fulfilment.dispute && !fulfilment.dispute.resolvedAt)) {
      deliveryConfirmations.push(adminOrderEntry(order, shopId));
    }
  }));
  const deliveryEscalations = [];
  orders.forEach((order) => Object.keys(order.shopStatuses).forEach((shopId) => {
    const fulfilment = order.fulfilment[shopId] || {};
    const overdue = fulfilment.shippedAt && Date.now() - new Date(fulfilment.shippedAt).getTime() >= COURIER_ESCALATION_MS;
    if (fulfilment.courierCompany && overdue && !fulfilment.courierDeliveredAt && !fulfilment.adminDeliveryOverrideAt &&
      !(fulfilment.dispute && !fulfilment.dispute.resolvedAt) && market.payoutState(order, shopId) === 'held') {
      deliveryEscalations.push(adminOrderEntry(order, shopId));
    }
  }));

  res.json({
    success: true,
    toConfirm,
    awaiting,
    payouts: byState.ready.sort(newestFirst),
    refunds: byState.refund_due.sort(newestFirst),
    disputes: byState.on_hold.sort(newestFirst),
    held: byState.held.sort(newestFirst),
    deliveryConfirmations: deliveryConfirmations.sort(newestFirst),
    deliveryEscalations: deliveryEscalations.sort(newestFirst)
  });
});

app.get('/api/courier/deliveries', ...courierOnly, (req, res) => {
  const deliveries = [];
  orders.forEach((order) => Object.keys(order.shopStatuses).forEach((shopId) => {
    const fulfilment = order.fulfilment[shopId] || {};
    if (fulfilment.courierCompany !== req.user.courierCompany || order.shopStatuses[shopId] !== 'shipped' || fulfilment.courierDeliveredAt) return;
    deliveries.push({
      orderId: order.id,
      shopId,
      reference: order.payment.reference,
      courierCompany: fulfilment.courierCompany,
      customerName: order.customerName,
      customerPhone: order.contactPhone || null,
      shippingAddress: order.shippingAddress,
      shopName: shopNameIn(order, shopId),
      items: order.items.filter((item) => item.shopId === shopId),
      createdAt: order.createdAt
    });
  }));
  res.json({ success: true, deliveries });
});

app.post('/api/courier/orders/:orderId/shops/:shopId/delivered', ...courierOnly, asyncRoute(async (req, res) => {
  const order = findOrder(req.params.orderId);
  const fulfilment = requireShopInOrder(order, req.params.shopId);
  if (fulfilment.courierCompany !== req.user.courierCompany) fail(403, 'This delivery is not assigned to your company.');
  if (order.shopStatuses[req.params.shopId] !== 'shipped') fail(409, 'The seller must mark this order shipped before delivery can be confirmed.');
  if (fulfilment.courierDeliveredAt) fail(409, 'This delivery has already been confirmed by the courier.');
  if (fulfilment.dispute && !fulfilment.dispute.resolvedAt) fail(409, 'This order is on hold while ShopVerse reviews a customer report.');

  const receiptReference = text((req.body || {}).receiptReference, { field: 'Courier receipt/reference', max: 80, required: true });
  const recipientCode = String((req.body || {}).recipientCode || '').trim();
  if (!/^\d{8}$/.test(recipientCode)) fail(400, 'Enter the customer delivery code shown in their ShopVerse order.');
  if (!fulfilment.deliveryCodeHash || !fulfilment.deliveryCodeExpiresAt || Date.now() > new Date(fulfilment.deliveryCodeExpiresAt).getTime()) {
    fail(409, 'The customer delivery code has expired. Ask the customer to refresh it in ShopVerse.');
  }
  const actualHash = Buffer.from(sha256(recipientCode), 'hex');
  const expectedHash = Buffer.from(fulfilment.deliveryCodeHash, 'hex');
  if (!crypto.timingSafeEqual(actualHash, expectedHash)) fail(403, 'The customer delivery code does not match. Do not mark this package delivered.');
  fulfilment.courierDeliveredAt = nowIso();
  fulfilment.courierReceiptReference = receiptReference;
  recordDeliveryAudit(fulfilment, 'courier_reported_delivery', req.user.id, { receiptReference });
  fulfilment.deliveredAt = fulfilment.courierDeliveredAt;
  order.shopStatuses[req.params.shopId] = 'delivered';
  order.status = deriveOrderStatus(order);
  order.updatedAt = nowIso();
  createNotification(order.customerId, 'status', `${fulfilment.courierCompany} reported order #${shortId(order.id)} delivered. ShopVerse will review the receipt before releasing payment.`);
  users.filter(isAdmin).forEach((admin) => createNotification(admin.id, 'delivery', `Courier receipt needs review for order #${shortId(order.id)} (${receiptReference}).`));
  await persistAppState();
  res.json({ success: true, delivery: adminOrderEntry(order, req.params.shopId) });
}));

app.post('/api/admin/orders/:orderId/shops/:shopId/delivery-approval', ...adminOnly, asyncRoute(async (req, res) => {
  const order = findOrder(req.params.orderId);
  const fulfilment = requireShopInOrder(order, req.params.shopId);
  if (!fulfilment.courierCompany || !fulfilment.courierDeliveredAt) fail(409, 'There is no courier delivery receipt waiting for review.');
  if (fulfilment.dispute && !fulfilment.dispute.resolvedAt) fail(409, 'Resolve the open customer report before approving delivery.');
  if (fulfilment.adminDeliveryApprovedAt) fail(409, 'This courier delivery has already been approved.');

  fulfilment.adminDeliveryApprovedAt = nowIso();
  fulfilment.adminDeliveryApprovedBy = req.user.id;
  recordDeliveryAudit(fulfilment, 'admin_approved_courier_receipt', req.user.id, { receiptReference: fulfilment.courierReceiptReference });
  createNotification(order.customerId, 'status', `ShopVerse verified the ${fulfilment.courierCompany} delivery receipt for order #${shortId(order.id)}.`);
  const shop = getShopById(req.params.shopId);
  if (shop) createNotification(shop.id, 'sale', `ShopVerse approved the ${fulfilment.courierCompany} delivery receipt for order #${shortId(order.id)}. Payout is ready.`);
  await persistAppState();
  res.json({ success: true, entry: adminOrderEntry(order, req.params.shopId) });
}));

app.post('/api/admin/orders/:orderId/shops/:shopId/delivery-exception', ...adminOnly, asyncRoute(async (req, res) => {
  const order = findOrder(req.params.orderId);
  const fulfilment = requireShopInOrder(order, req.params.shopId);
  const shippedAt = fulfilment.shippedAt && new Date(fulfilment.shippedAt).getTime();
  if (!fulfilment.courierCompany || order.shopStatuses[req.params.shopId] !== 'shipped' || !shippedAt ||
      Date.now() - shippedAt < COURIER_ESCALATION_MS) fail(409, 'This courier delivery is not eligible for overdue review yet.');
  if (fulfilment.courierDeliveredAt || fulfilment.adminDeliveryOverrideAt) fail(409, 'This delivery already has a courier report or admin resolution.');
  if (market.payoutState(order, req.params.shopId) !== 'held') fail(409, 'This delivery does not have a protected payout on hold.');
  if (fulfilment.dispute && !fulfilment.dispute.resolvedAt) fail(409, 'Resolve the open customer report before handling this delivery.');

  const note = text((req.body || {}).note, { field: 'Resolution note', max: 500, required: true });
  fulfilment.adminDeliveryOverrideAt = nowIso();
  fulfilment.adminDeliveryOverrideBy = req.user.id;
  fulfilment.adminDeliveryOverrideNote = note;
  fulfilment.deliveredAt = fulfilment.adminDeliveryOverrideAt;
  order.shopStatuses[req.params.shopId] = 'delivered';
  order.status = deriveOrderStatus(order);
  recordDeliveryAudit(fulfilment, 'admin_overdue_delivery_exception', req.user.id, { note });
  order.updatedAt = nowIso();
  createNotification(order.customerId, 'status', `ShopVerse reviewed the overdue courier delivery for order #${shortId(order.id)}.${note ? ` ${note}` : ''}`);
  const shop = getShopById(req.params.shopId);
  if (shop) createNotification(shop.id, 'sale', `ShopVerse resolved the overdue courier delivery for order #${shortId(order.id)}. Review the delivery audit before payout.`);
  await persistAppState();
  res.json({ success: true, entry: adminOrderEntry(order, req.params.shopId) });
}));

// Confirm (or reject) that a customer's payment reached ShopVerse's account.
app.post('/api/admin/orders/:orderId/payment', ...adminOnly, asyncRoute(async (req, res) => {
  const order = findOrder(req.params.orderId);
  const action = String((req.body && req.body.action) || '');
  if (!order.payment.protected) fail(400, 'This order is paid to the shop on delivery.');

  if (action === 'confirm') {
    if (!['pending', 'submitted'].includes(order.payment.status)) fail(409, `Payment is already ${order.payment.status}.`);
    order.payment.confirmedAt = nowIso();
    order.payment.confirmedBy = req.user.id;
    setPaymentStatus(order, deriveOrderStatus(order) === 'cancelled' ? 'refund_due' : 'held');
    createNotification(order.customerId, 'order', `We received your payment for order #${shortId(order.id)}. It is protected until you receive your items.`);
    Object.keys(order.shopStatuses).forEach((shopId) => {
      if (order.shopStatuses[shopId] !== 'cancelled') {
        createNotification(shopId, 'sale', `Payment secured for order #${shortId(order.id)}. You can ship it now.`);
      }
    });
  } else if (action === 'reject') {
    if (order.payment.status !== 'submitted') fail(409, 'Only submitted payments can be rejected.');
    const reason = text((req.body || {}).note, { field: 'Reason', max: 300 });
    order.payment.rejectedAt = nowIso();
    order.payment.transactionId = null;
    setPaymentStatus(order, 'pending');
    createNotification(order.customerId, 'order', `We could not find your payment for order #${shortId(order.id)} (${order.payment.reference}).${
      reason ? ` ${reason}` : ''} Please check the transaction ID and submit it again.`);
  } else {
    fail(400, 'Action must be confirm or reject.');
  }

  await persistAppState();
  res.json({ success: true, entry: adminOrderEntry(order) });
}));

// Record that ShopVerse sent a seller their money.
app.post('/api/admin/orders/:orderId/shops/:shopId/payout', ...adminOnly, asyncRoute(async (req, res) => {
  const order = findOrder(req.params.orderId);
  const fulfilment = requireShopInOrder(order, req.params.shopId);
  const state = market.payoutState(order, req.params.shopId);
  if (state !== 'ready') fail(409, `This payout is not ready to be paid (it is ${state.replace(/_/g, ' ')}).`);

  fulfilment.paidOutAt = nowIso();
  fulfilment.payoutReference = text((req.body || {}).reference, { field: 'Payout reference', max: 60 }) || null;
  const { net } = market.shopPayoutAmounts(order, req.params.shopId, COMMISSION_PERCENT);
  createNotification(req.params.shopId, 'sale', `ShopVerse sent you ${formatZmw(net)} for order #${shortId(order.id)}.`);

  await persistAppState();
  res.json({ success: true, entry: adminOrderEntry(order, req.params.shopId) });
}));

// Record that ShopVerse refunded the customer for a shop's cancelled part of an order.
app.post('/api/admin/orders/:orderId/shops/:shopId/refund', ...adminOnly, asyncRoute(async (req, res) => {
  const order = findOrder(req.params.orderId);
  const fulfilment = requireShopInOrder(order, req.params.shopId);
  if (market.payoutState(order, req.params.shopId) !== 'refund_due') fail(409, 'No refund is due for this part of the order.');

  fulfilment.refundedAt = nowIso();
  const { gross } = market.shopPayoutAmounts(order, req.params.shopId, COMMISSION_PERCENT);
  const everythingRefunded = Object.keys(order.shopStatuses).every((shopId) =>
    order.shopStatuses[shopId] !== 'cancelled' ? false : Boolean((order.fulfilment[shopId] || {}).refundedAt));
  if (everythingRefunded) setPaymentStatus(order, 'refunded');
  createNotification(order.customerId, 'order', `ShopVerse refunded ${formatZmw(gross)} for order #${shortId(order.id)}.`);

  await persistAppState();
  res.json({ success: true, entry: adminOrderEntry(order, req.params.shopId) });
}));

// Settle a reported problem: release the money to the seller, or refund the customer.
app.post('/api/admin/orders/:orderId/shops/:shopId/resolve', ...adminOnly, asyncRoute(async (req, res) => {
  const order = findOrder(req.params.orderId);
  const shopId = req.params.shopId;
  const fulfilment = requireShopInOrder(order, shopId);
  if (!fulfilment.dispute || fulfilment.dispute.resolvedAt) fail(409, 'There is no open dispute for this part of the order.');

  const resolution = String((req.body && req.body.resolution) || '');
  if (!['release', 'refund'].includes(resolution)) fail(400, 'Resolution must be release or refund.');
  const note = text((req.body || {}).note, { field: 'Note', max: 500 });
  Object.assign(fulfilment.dispute, { resolvedAt: nowIso(), resolution, note: note || null });

  if (resolution === 'release') {
    order.shopStatuses[shopId] = 'delivered';
    fulfilment.deliveredAt = fulfilment.deliveredAt || nowIso();
    createNotification(order.customerId, 'status', `ShopVerse reviewed your report on order #${shortId(order.id)} and released payment to ${shopNameIn(order, shopId)}.${note ? ` ${note}` : ''}`);
    createNotification(shopId, 'sale', `The problem reported on order #${shortId(order.id)} was resolved in your favour. Your payout is released.`);
  } else {
    order.shopStatuses[shopId] = 'cancelled';
    createNotification(order.customerId, 'status', `ShopVerse reviewed your report on order #${shortId(order.id)}. You will be refunded.${note ? ` ${note}` : ''}`);
    createNotification(shopId, 'status', `The problem reported on order #${shortId(order.id)} was resolved with a refund to the customer.${note ? ` ${note}` : ''}`);
  }
  order.status = deriveOrderStatus(order);
  order.updatedAt = nowIso();

  await persistAppState();
  res.json({ success: true, entry: adminOrderEntry(order, shopId) });
}));

// ---------------------------------------------------------------------------
// Fallbacks & errors
// ---------------------------------------------------------------------------

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API route not found.' });
});

// Pages get link-preview tags (WhatsApp, Facebook, X) for the product or shop being shared.
let shellTemplate = null;
const readShell = () => {
  if (!shellTemplate || !isProduction) shellTemplate = fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf8');
  return shellTemplate;
};

const escapeAttr = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const shorten = (value, max) => {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const pagePreview = (req) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const absolute = (url) => (url && url.startsWith('/') ? `${base}${url}` : url);
  const fallbackImage = `${base}/icons/icon-512.png`;
  const productMatch = /^\/products\/([^/]+)\/?$/.exec(req.path);
  const shopMatch = /^\/shops\/([^/]+)\/?$/.exec(req.path);

  if (productMatch) {
    const product = getProductById(decodeURIComponent(productMatch[1]));
    const shop = product && getShopById(product.shopId);
    if (product && shop && isListedProduct(product)) {
      const shopImage = publicImageUrl(shop.shopBannerImage, `/media/shops/${shop.id}/banner`);
      return {
        title: `${product.name} · ${formatZmw(product.price)} | ShopVerse`,
        description: shorten(`${product.stock > 0 ? 'In stock' : 'Sold out'} at ${shop.shopName}${isVerifiedShop(shop) ? ' ✓ Verified seller' : ''}. ${product.description}`, 200),
        image: absolute(publicImageUrl(product.image, `/media/products/${product.id}`) || shopImage) || fallbackImage,
        url: `${base}${req.path}`
      };
    }
  }
  if (shopMatch) {
    const shop = getShopById(decodeURIComponent(shopMatch[1]));
    if (shop && isListedShop(shop)) {
      const count = getShopProducts(shop.id).filter(isListedProduct).length;
      return {
        title: `${shop.shopName}${isVerifiedShop(shop) ? ' ✓' : ''} | Shop on ShopVerse`,
        description: shorten(`${shop.shopDescription || ''} ${count} product${count === 1 ? '' : 's'} · ${shop.shopLocation || 'Zambia'}. Pay safely with mobile money.`, 200),
        image: absolute(publicImageUrl(shop.shopProfileImage, `/media/shops/${shop.id}/avatar`) ||
          publicImageUrl(shop.shopBannerImage, `/media/shops/${shop.id}/banner`)) || fallbackImage,
        url: `${base}${req.path}`
      };
    }
  }
  return { image: fallbackImage, url: `${base}${req.path === '/' ? '/' : req.path}` };
};

// Google Search Console ownership check: set GOOGLE_SITE_VERIFICATION to the code from the
// "HTML tag" method (only the content value, e.g. "abc123..."), then redeploy.
const GOOGLE_SITE_VERIFICATION = String(process.env.GOOGLE_SITE_VERIFICATION || '')
  .trim()
  .replace(/^.*content="([^"]+)".*$/s, '$1');

const renderShell = (req) => {
  const preview = pagePreview(req);
  let html = readShell();
  if (GOOGLE_SITE_VERIFICATION) {
    html = html.replace('</head>', `    <meta name="google-site-verification" content="${escapeAttr(GOOGLE_SITE_VERIFICATION)}" />\n  </head>`);
  }
  const setMeta = (attr, key, value) => {
    if (!value) return;
    const pattern = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
    html = html.replace(pattern, `$1${escapeAttr(value).replace(/\$/g, '$$$$')}$2`);
  };
  if (preview.title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(preview.title).replace(/\$/g, '$$$$')}</title>`);
  setMeta('name', 'description', preview.description);
  setMeta('property', 'og:title', preview.title);
  setMeta('property', 'og:description', preview.description);
  setMeta('property', 'og:image', preview.image);
  setMeta('property', 'og:url', preview.url);
  setMeta('name', 'twitter:title', preview.title);
  setMeta('name', 'twitter:description', preview.description);
  setMeta('name', 'twitter:image', preview.image);
  return html;
};

app.get(/^\/(?!media\/).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderShell(req));
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request is too large. Please use an image under 5 MB.' });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Request body must contain valid JSON.' });
  }
  console.error('Unhandled error:', error);
  return res.status(500).json({ success: false, message: 'Something went wrong on our side. Please try again.' });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

if (require.main === module) {
  ready
    .then(() => {
      const server = app.listen(PORT, () => {
        console.log(`ShopVerse listening on http://localhost:${PORT} (${NODE_ENV})`);
      });

      const shutdown = (signal) => {
        console.log(`${signal} received, shutting down.`);
        server.close(async () => {
          if (store && store.close) await store.close();
          process.exit(0);
        });
        setTimeout(() => process.exit(1), 10000).unref();
      };
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    })
    .catch(async (error) => {
      console.error('ShopVerse could not restore persistent data:', error);
      if (store && store.close) await store.close();
      process.exitCode = 1;
    });
}

module.exports = { app, users, products, carts, orders, productReviews, notifications, resetAppState, ready };
