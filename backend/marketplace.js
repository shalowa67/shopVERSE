// Business rules for delivery, protected payments (escrow), seller payouts and
// marketplace metrics. Pure functions: callers pass in the data they operate on.

const DAY_MS = 24 * 60 * 60 * 1000;

// After a seller marks an order delivered, the customer has this long to confirm or
// report a problem before the seller's payout is released automatically.
const PAYOUT_WINDOW_MS = 3 * DAY_MS;
const ACTIVE_SELLER_MIN_PRODUCTS = 5;

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

// ---------------------------------------------------------------------------
// Phone numbers (Zambian format by default)
// ---------------------------------------------------------------------------

// Returns digits in international format without "+", e.g. "260971234567", or null.
const phoneDigits = (value) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `260${digits.slice(1)}`;
  if (digits.length === 9 && /^[79]/.test(digits)) digits = `260${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
};

const formatPhone = (value) => {
  const digits = phoneDigits(value);
  if (!digits) return null;
  if (digits.startsWith('260') && digits.length === 12) {
    return `+260 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return `+${digits}`;
};

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

const DEFAULT_DELIVERY = Object.freeze({ enabled: true, fee: 0, freeOver: null, areas: '', pickup: false });

const deliveryOf = (shop) => ({ ...DEFAULT_DELIVERY, ...((shop && shop.delivery) || {}) });

// Validates delivery settings from a request body, merging over the current ones.
const parseDelivery = (input, current, fail) => {
  const next = { ...deliveryOf({ delivery: current }) };
  if (!input || typeof input !== 'object') fail(400, 'Delivery settings must be an object.');

  if (input.enabled !== undefined) next.enabled = Boolean(input.enabled);
  if (input.pickup !== undefined) next.pickup = Boolean(input.pickup);
  if (input.fee !== undefined) {
    const fee = Number(input.fee === '' ? 0 : input.fee);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100000) fail(400, 'Delivery fee must be a number of zero or more.');
    next.fee = roundMoney(fee);
  }
  if (input.freeOver !== undefined) {
    if (input.freeOver === null || input.freeOver === '') {
      next.freeOver = null;
    } else {
      const freeOver = Number(input.freeOver);
      if (!Number.isFinite(freeOver) || freeOver <= 0) fail(400, 'Free delivery threshold must be a positive amount.');
      next.freeOver = roundMoney(freeOver);
    }
  }
  if (input.areas !== undefined) {
    const areas = String(input.areas || '').trim();
    if (areas.length > 200) fail(400, 'Delivery areas must be 200 characters or fewer.');
    next.areas = areas;
  }
  if (!next.enabled && !next.pickup) fail(400, 'Offer at least one option: delivery or pickup.');
  return next;
};

const deliveryFeeFor = (delivery, itemsSubtotal) => {
  if (!delivery.enabled) return 0;
  if (delivery.freeOver && itemsSubtotal >= delivery.freeOver) return 0;
  return roundMoney(delivery.fee);
};

// Which fulfilment method to use for a shop, honouring the customer's choice when allowed.
const chooseMethod = (delivery, requested) => {
  if (requested === 'pickup' && delivery.pickup) return 'pickup';
  if (requested === 'delivery' && delivery.enabled) return 'delivery';
  return delivery.enabled ? 'delivery' : 'pickup';
};

// ---------------------------------------------------------------------------
// Protected payments and payouts
// ---------------------------------------------------------------------------

// Cash on delivery is paid to the seller directly; everything else is paid to ShopVerse
// and held until the customer has received their order.
const isProtectedMethod = (method) => method !== 'cash_on_delivery';

const shopItemsSubtotal = (order, shopId) => roundMoney(order.items
  .filter((item) => item.shopId === shopId)
  .reduce((sum, item) => sum + item.price * item.quantity, 0));

const shopPayoutAmounts = (order, shopId, commissionPercent) => {
  const items = shopItemsSubtotal(order, shopId);
  const fulfilment = (order.fulfilment && order.fulfilment[shopId]) || {};
  const deliveryFee = roundMoney(fulfilment.deliveryFee || 0);
  const commission = roundMoney((items * (Number(commissionPercent) || 0)) / 100);
  return { items, deliveryFee, gross: roundMoney(items + deliveryFee), commission, net: roundMoney(items + deliveryFee - commission) };
};

// The state of the money for one shop's part of an order.
const payoutState = (order, shopId, now = Date.now()) => {
  const payment = order.payment || {};
  const status = order.shopStatuses[shopId];
  const fulfilment = (order.fulfilment && order.fulfilment[shopId]) || {};

  if (!payment.protected) return 'not_applicable';
  if (status === 'cancelled') {
    if (fulfilment.refundedAt) return 'refunded';
    // Money may have reached ShopVerse if it was confirmed, or the customer said they paid.
    return payment.confirmedAt || ['submitted', 'refund_due'].includes(payment.status) ? 'refund_due' : 'cancelled';
  }
  if (payment.status === 'pending' || payment.status === 'submitted') return 'awaiting_payment';
  if (fulfilment.paidOutAt) return 'paid';
  if (fulfilment.dispute && !fulfilment.dispute.resolvedAt) return 'on_hold';
  if (fulfilment.courierCompany) {
    const disputeReleased = fulfilment.dispute && fulfilment.dispute.resolution === 'release';
    return disputeReleased || (fulfilment.courierDeliveredAt && fulfilment.adminDeliveryApprovedAt) ? 'ready' : 'held';
  }
  if (status === 'delivered') {
    const confirmed = Boolean(fulfilment.confirmedAt) ||
      (fulfilment.dispute && fulfilment.dispute.resolution === 'release') ||
      (fulfilment.deliveredAt && now - new Date(fulfilment.deliveredAt).getTime() >= PAYOUT_WINDOW_MS);
    if (confirmed) return 'ready';
  }
  return 'held';
};

// When the payout will be released automatically (seller marked delivered, customer silent).
const autoReleaseAt = (order, shopId) => {
  const fulfilment = (order.fulfilment && order.fulfilment[shopId]) || {};
  if (fulfilment.courierCompany || !fulfilment.deliveredAt || fulfilment.confirmedAt) return null;
  return new Date(new Date(fulfilment.deliveredAt).getTime() + PAYOUT_WINDOW_MS).toISOString();
};

// ---------------------------------------------------------------------------
// Metrics for the admin dashboard
// ---------------------------------------------------------------------------

const marketplaceMetrics = ({ users, products, orders, commissionPercent, now = Date.now() }) => {
  const sellers = users.filter((user) => user.role === 'shop_owner');
  const productCounts = {};
  products.forEach((product) => {
    productCounts[product.shopId] = (productCounts[product.shopId] || 0) + 1;
  });

  const since = (days) => now - days * DAY_MS;
  const createdMs = (order) => new Date(order.createdAt).getTime();
  const liveOrders = orders.filter((order) => Object.values(order.shopStatuses).some((status) => status !== 'cancelled'));

  let delivered = 0;
  let cancelled = 0;
  orders.forEach((order) => Object.values(order.shopStatuses).forEach((status) => {
    if (status === 'delivered') delivered += 1;
    if (status === 'cancelled') cancelled += 1;
  }));

  const ordersPerCustomer = {};
  liveOrders.forEach((order) => {
    ordersPerCustomer[order.customerId] = (ordersPerCustomer[order.customerId] || 0) + 1;
  });
  const buyers = Object.values(ordersPerCustomer);

  let payoutsReadyCount = 0;
  let payoutsReadyAmount = 0;
  let heldAmount = 0;
  let commissionEarned = 0;
  let refundsDue = 0;
  let disputesOpen = 0;
  orders.forEach((order) => Object.keys(order.shopStatuses).forEach((shopId) => {
    const state = payoutState(order, shopId, now);
    const { net, commission } = shopPayoutAmounts(order, shopId, commissionPercent);
    if (state === 'ready') {
      payoutsReadyCount += 1;
      payoutsReadyAmount += net;
    }
    if (state === 'held' || state === 'on_hold' || state === 'ready') heldAmount += net + commission;
    if (state === 'paid') commissionEarned += commission;
    if (state === 'refund_due') refundsDue += 1;
    if (state === 'on_hold') disputesOpen += 1;
  }));

  const salesSince = (days) => roundMoney(liveOrders
    .filter((order) => createdMs(order) >= since(days))
    .reduce((sum, order) => sum + order.total, 0));

  return {
    sellers: sellers.length,
    activeSellers: sellers.filter((seller) => (productCounts[seller.id] || 0) >= ACTIVE_SELLER_MIN_PRODUCTS).length,
    verifiedSellers: sellers.filter((seller) => seller.verification && seller.verification.status === 'verified').length,
    pendingVerifications: sellers.filter((seller) => seller.verification && seller.verification.status === 'pending').length,
    customers: users.filter((user) => user.role === 'customer').length,
    products: products.length,
    ordersThisWeek: orders.filter((order) => createdMs(order) >= since(7)).length,
    ordersLastWeek: orders.filter((order) => createdMs(order) >= since(14) && createdMs(order) < since(7)).length,
    completionRate: delivered + cancelled ? Math.round((delivered / (delivered + cancelled)) * 100) : null,
    repeatBuyerRate: buyers.length ? Math.round((buyers.filter((count) => count >= 2).length / buyers.length) * 100) : null,
    sales30Days: salesSince(30),
    salesAllTime: roundMoney(liveOrders.reduce((sum, order) => sum + order.total, 0)),
    paymentsToConfirm: orders.filter((order) => order.payment && order.payment.status === 'submitted').length,
    refundsDue,
    disputesOpen,
    payoutsReadyCount,
    payoutsReadyAmount: roundMoney(payoutsReadyAmount),
    heldAmount: roundMoney(heldAmount),
    commissionEarned: roundMoney(commissionEarned),
    commissionPercent: Number(commissionPercent) || 0
  };
};

module.exports = {
  PAYOUT_WINDOW_MS,
  ACTIVE_SELLER_MIN_PRODUCTS,
  DEFAULT_DELIVERY,
  roundMoney,
  phoneDigits,
  formatPhone,
  deliveryOf,
  parseDelivery,
  deliveryFeeFor,
  chooseMethod,
  isProtectedMethod,
  shopItemsSubtotal,
  shopPayoutAmounts,
  payoutState,
  autoReleaseAt,
  marketplaceMetrics
};
