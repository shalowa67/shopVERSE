/* ShopVerse single-page app.
 * Plain browser JavaScript, no build step. Functions that do not touch the DOM are
 * exported at the bottom so they can be unit-tested under Node.
 */

const isBrowser = typeof document !== 'undefined';

const userSessionKey = 'shopverse-user';
const tokenKey = 'shopverse-token';
const addressKey = 'shopverse-last-delivery';

const ORDER_FLOW = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
const ORDER_STATUSES = [...ORDER_FLOW, 'cancelled'];
const THEME_PRESETS = ['#4f46e5', '#0e7490', '#059669', '#b45309', '#be123c', '#7c3aed', '#0f172a'];
const CATEGORY_SUGGESTIONS = [
  'Phones', 'Laptops', 'Electronics', 'Accessories', 'Perfumes', 'Beauty & skincare', 'Fashion',
  'Home & living', 'Food & groceries', 'Books & stationery', 'Sports & outdoors', 'Toys & games', 'Other'
];
const PAYMENT_GROUPS = [
  {
    title: 'Mobile money',
    options: [
      { value: 'mtn_mobile_money', label: 'MTN MoMo', hint: 'Pay from your MTN wallet', badge: 'MTN' },
      { value: 'airtel_money', label: 'Airtel Money', hint: 'Pay from your Airtel wallet', badge: 'AIR' },
      { value: 'zamtel_money', label: 'Zamtel Kwacha', hint: 'Pay from your Zamtel wallet', badge: 'ZAM' }
    ]
  },
  {
    title: 'Other',
    options: [
      { value: 'bank_transfer', label: 'Bank transfer', hint: 'Protected by ShopVerse', badge: 'EFT' },
      { value: 'cash_on_delivery', label: 'Cash on delivery', hint: 'Pay the shop when it arrives', badge: 'COD' }
    ]
  }
];
// Card payments need an online payment provider; until one is connected they are not offered.
const PAYMENT_LABELS = Object.fromEntries(
  PAYMENT_GROUPS.flatMap((group) => group.options.map((option) => [option.value, option.label]))
    .concat([
      ['card', 'Card'], ['visa', 'Visa'], ['mastercard', 'Mastercard'], ['zanaco_card', 'Zanaco card'],
      ['zambia_credit_card', 'Zambian card'], ['wallet', 'Wallet'], ['standard_chartered_card', 'Standard Chartered card']
    ])
);
const PROTECTION_DAYS = 3;
const DEFAULT_COURIER_COMPANIES = ['Platinum', 'Mercury'];

const PAYOUT_LABELS = {
  awaiting_payment: { label: 'Waiting for payment', tone: 'warning', hint: "Don't ship yet: the customer hasn't paid." },
  held: { label: 'Payment secured', tone: 'success', hint: 'ShopVerse holds the money. Ship now; you are paid once the customer receives it.' },
  on_hold: { label: 'On hold: problem reported', tone: 'danger', hint: 'ShopVerse is reviewing a problem the customer reported.' },
  ready: { label: 'Payout ready', tone: 'brand', hint: 'ShopVerse will send your money shortly.' },
  paid: { label: 'Paid out', tone: 'success', hint: 'ShopVerse has sent you this money.' },
  refund_due: { label: 'Refund due', tone: 'warning', hint: 'The customer is being refunded.' },
  refunded: { label: 'Refunded', tone: '', hint: 'The customer was refunded.' },
  cancelled: { label: 'Cancelled', tone: '', hint: '' },
  not_applicable: { label: 'Cash on delivery', tone: '', hint: 'Collect payment from the customer on delivery.' }
};

const PAYMENT_STATUS_LABELS = {
  pending: 'Awaiting payment',
  submitted: 'Checking your payment',
  held: 'Paid · protected',
  refund_due: 'Refund in progress',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  pay_on_delivery: 'Pay on delivery'
};

const state = {
  user: null,
  courierCompanies: DEFAULT_COURIER_COMPANIES,
  cart: { items: [], itemCount: 0, subtotal: 0 },
  unread: 0,
  demo: false,
  renderId: 0,
  redirectAfterLogin: null,
  studio: null,
  shopView: null
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);
const h = escapeHtml;

const safeImageUrl = (value) => {
  const image = String(value || '').trim();

  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(image)) {
    return image;
  }

  if (/^\/media\/[\w/-]+(?:\?v=[0-9a-f]+)?$/i.test(image)) {
    return image;
  }

  try {
    const url = new URL(image);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch (error) {
    return '';
  }
};

const safeColor = (value) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || '').trim()) ? String(value).trim() : '#4f46e5');
const cssUrl = (url) => `url("${url.replace(/["'()\\\s]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}")`;

const moneyFormatter = new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW' });
const formatMoney = (value) => moneyFormatter.format(Number(value || 0));
const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortId = (id) => String(id).slice(0, 8).toUpperCase();
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const timeAgo = (iso) => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const units = [[86400 * 7, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return count > 4 && name === 'week' ? formatDate(iso) : `${plural(count, name)} ago`;
    }
  }
  return formatDate(iso);
};

const initials = (text) => String(text || '?')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0])
  .join('')
  .toUpperCase() || '?';

const starString = (rating) => {
  const rounded = Math.round(Number(rating) || 0);
  return `<span class="stars" aria-hidden="true">${'★'.repeat(rounded)}<span class="off">${'★'.repeat(5 - rounded)}</span></span>`;
};

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

const defaultStorage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error) {
    return null;
  }
};

function saveSession(user, token, storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.setItem(userSessionKey, JSON.stringify(user));
    if (token) storage.setItem(tokenKey, token);
  } catch (error) {
    // Storage may be full or blocked; the session still works for this page view.
  }
}

function clearSession(storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(userSessionKey);
    storage.removeItem(tokenKey);
  } catch (error) {
    // ignore
  }
}

function getStoredUser(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const stored = storage.getItem(userSessionKey);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    return null;
  }
}

function getStoredToken(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    return storage.getItem(tokenKey);
  } catch (error) {
    return null;
  }
}

function handleSessionError(error, storage = defaultStorage(), onReload = () => {
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    window.location.reload();
  }
}) {
  const message = error && error.message ? String(error.message).toLowerCase() : '';
  const shouldReset = message.includes('invalid session token') || message.includes('authentication required');

  if (!shouldReset) return false;

  clearSession(storage);
  onReload();
  return true;
}

function reportApiError(error) {
  if (error && error.sessionHandled) return;
  if (!handleSessionError(error)) {
    toast(error && error.message ? error.message : 'Something went wrong.', 'error');
  }
}

async function apiRequest(path, options = {}) {
  const token = getStoredToken();
  const headers = { ...(options.headers || {}) };
  let body = options.body;

  if (body !== undefined && typeof body !== 'string') body = JSON.stringify(body);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, { method: options.method || 'GET', headers, body });
  } catch (networkError) {
    throw new Error('We could not reach ShopVerse. Check your connection and try again.');
  }

  const rawText = await response.text();
  let result = {};
  if (rawText) {
    try {
      result = JSON.parse(rawText);
    } catch (error) {
      throw new Error('The server returned an invalid response. Please try again.');
    }
  }

  if (!response.ok) {
    const error = new Error(result.message || 'Request failed.');
    error.status = response.status;
    if (token && handleSessionError(error)) error.sessionHandled = true;
    throw error;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cart: '<path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
  bag: '<path d="M6 7h12l1 13H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  truck: '<path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  store: '<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11z"/><path d="M5 13v7h14v-7"/>',
  pin: '<path d="M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  box: '<path d="m3 7 9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  wallet: '<path d="M3 7h18v12H3z"/><path d="M16 13h2"/><path d="M3 7l13-4v4"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  star: '<path d="m12 3 2.8 5.9 6.2.8-4.6 4.3 1.2 6.2L12 17.3 6.4 20.2l1.2-6.2L3 9.7l6.2-.8z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v8h14v-8"/>',
  device: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
  whatsapp: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1z"/><path d="M9 8.8c0 3 2.6 6.2 6 6.4l1-1.4-1.9-1-1 .8a4 4 0 0 1-2.1-2.1l.8-1-1-1.9z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'
};

const icon = (name, className = 'icon') => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------------------------------------------------------------------------
// Shared markup
// ---------------------------------------------------------------------------

const canBuy = () => !state.user || state.user.role === 'customer';

// Where each kind of account lands after signing in.
const homePathFor = (user) => {
  if (user && user.role === 'admin') return '/admin';
  if (user && user.role === 'courier') return '/courier';
  if (user && user.role === 'shop_owner') return '/studio';
  return '/';
};

const verifiedBadge = (verified, { compact = false } = {}) => (verified
  ? `<span class="verified-badge" title="Verified seller: ShopVerse checked this seller's identity">${icon('check')}${compact ? '' : ' Verified'}</span>`
  : '');

// Links -----------------------------------------------------------------------

const absoluteUrl = (path) => (isBrowser ? new URL(path, location.origin).href : path);
const whatsappShareUrl = (message) => `https://wa.me/?text=${encodeURIComponent(message)}`;
const whatsappChatUrl = (digits, message = '') => (digits
  ? `https://wa.me/${encodeURIComponent(digits)}${message ? `?text=${encodeURIComponent(message)}` : ''}`
  : '');

const shareButtons = ({ path, title, text }) => `
  <div class="share-row">
    <button type="button" class="button button-outline button-sm" data-action="share" data-path="${h(path)}" data-title="${h(title)}" data-text="${h(text)}">${icon('share')} Share</button>
    <a class="button button-whatsapp button-sm" href="${h(whatsappShareUrl(`${text} ${absoluteUrl(path)}`))}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
    <button type="button" class="icon-button" data-action="copy-link" data-path="${h(path)}" aria-label="Copy link" title="Copy link">${icon('link')}</button>
  </div>`;

const deliverySummary = (delivery) => {
  if (!delivery) return '';
  const parts = [];
  if (delivery.enabled) {
    parts.push(delivery.fee > 0 ? `Delivery ${formatMoney(delivery.fee)}` : 'Free delivery');
    if (delivery.fee > 0 && delivery.freeOver) parts.push(`free over ${formatMoney(delivery.freeOver)}`);
  }
  if (delivery.pickup) parts.push(delivery.enabled ? 'or free pickup' : 'Pickup only');
  return parts.join(', ');
};

const mediaMarkup = (image, name, alt = '') => {
  const url = safeImageUrl(image);
  return url
    ? `<img src="${h(url)}" alt="${h(alt)}" loading="lazy" decoding="async" />`
    : `<div class="placeholder-art" aria-hidden="true">${h(initials(name))}</div>`;
};

const avatarMarkup = (image, name) => {
  const url = safeImageUrl(image);
  return url ? `<img src="${h(url)}" alt="" loading="lazy" />` : h(initials(name).slice(0, 1));
};

const ratingMarkup = (rating, count, { compact = false } = {}) => (count
  ? `<span class="rating">${starString(rating)} <strong>${Number(rating).toFixed(1)}</strong>${compact ? '' : ` <span>(${count})</span>`}</span>`
  : '<span class="rating">No reviews yet</span>');

const stockBadge = (product) => {
  if (!product.inStock) return '<span class="badge badge-dark">Sold out</span>';
  if (product.lowStock) return `<span class="badge badge-warning">Only ${h(product.stock)} left</span>`;
  return '';
};

const productCard = (product) => `
  <article class="product-card fade-up" style="--accent-c: ${safeColor(product.shopThemeColor)}">
    <a class="product-media" href="/products/${encodeURIComponent(product.id)}" tabindex="-1" aria-hidden="true">
      ${mediaMarkup(product.image, product.name)}
      <div class="product-badges">${stockBadge(product)}</div>
    </a>
    <div class="product-body">
      <a class="product-shop" href="/shops/${encodeURIComponent(product.shopId)}">${h(product.shopName)} ${verifiedBadge(product.shopVerified, { compact: true })}</a>
      <h3 class="product-title"><a href="/products/${encodeURIComponent(product.id)}">${h(product.name)}</a></h3>
      ${ratingMarkup(product.averageRating, product.reviewCount)}
      <div class="product-foot">
        <span class="price">${formatMoney(product.price)}</span>
        ${canBuy() ? `<button type="button" class="button button-outline button-xs add-button" data-action="add-to-cart" data-id="${h(product.id)}" ${product.inStock ? '' : 'disabled'}>${icon('plus')} Add</button>` : ''}
      </div>
    </div>
  </article>`;

const shopCard = (shop) => {
  const banner = safeImageUrl(shop.bannerImage);
  return `
  <article class="shop-card fade-up" style="--accent-c: ${safeColor(shop.themeColor)}">
    <div class="shop-banner" ${banner ? `style="background-image: ${h(cssUrl(banner))}"` : ''}></div>
    <div class="shop-body">
      <div class="shop-avatar">${avatarMarkup(shop.profileImage, shop.name)}</div>
      <div>
        <h3><a href="/shops/${encodeURIComponent(shop.id)}">${h(shop.name)}</a> ${verifiedBadge(shop.verified)}</h3>
        <div class="meta-row" style="margin-top: 4px">
          <span>${icon('pin')} ${h(shop.location)}</span>
          ${shop.delivery ? `<span>${icon('truck')} ${h(deliverySummary(shop.delivery))}</span>` : ''}
        </div>
      </div>
      <p>${h(shop.description || 'Independent seller on ShopVerse.')}</p>
      <div class="meta-row shop-foot">
        <span>${icon('box')} ${plural(shop.productCount, 'product')}</span>
        ${shop.reviewCount ? ratingMarkup(shop.averageRating, shop.reviewCount, { compact: true }) : ''}
        ${shop.categories && shop.categories[0] ? `<span class="badge">${h(shop.categories[0])}</span>` : ''}
      </div>
    </div>
  </article>`;
};

const skeletonCards = (count) => Array.from({ length: count }, () => `
  <div class="skeleton-card">
    <div class="skeleton media"></div>
    <div class="lines"><div class="skeleton line short"></div><div class="skeleton line"></div><div class="skeleton line short"></div></div>
  </div>`).join('');

const emptyState = ({ iconName = 'box', title, text = '', action = '' }) => `
  <div class="empty-state">
    <div class="empty-icon">${icon(iconName)}</div>
    <h3>${h(title)}</h3>
    ${text ? `<p>${h(text)}</p>` : ''}
    ${action}
  </div>`;

const statusPill = (status) => `<span class="status-pill status-${h(status)}">${h(status)}</span>`;

const loader = '<div class="page-loader"><div class="spinner" role="status" aria-label="Loading"></div></div>';

// ---------------------------------------------------------------------------
// DOM utilities
// ---------------------------------------------------------------------------

const $ = (selector, root = isBrowser ? document : null) => (root ? root.querySelector(selector) : null);
const $$ = (selector, root = isBrowser ? document : null) => (root ? [...root.querySelectorAll(selector)] : []);

const setView = (html) => {
  const view = $('#view');
  if (view) view.innerHTML = html;
};

const setTitle = (title) => {
  if (isBrowser) document.title = title ? `${title} · ShopVerse` : 'ShopVerse — Shop independent stores across Zambia';
};

const debounce = (fn, wait = 250) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

const setBusy = (button, busy) => {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
};

function toast(message, type = 'info', action = null) {
  const region = $('#toastRegion');
  if (!region) return;
  const element = document.createElement('div');
  element.className = `toast toast-${type}`;
  element.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'success' ? 'checkCircle' : 'info')}<span>${h(message)}</span>${
    action ? `<button type="button" data-action="${h(action.action)}">${h(action.label)}</button>` : ''}`;
  region.appendChild(element);
  while (region.children.length > 3) region.firstElementChild.remove();
  setTimeout(() => {
    element.classList.add('leaving');
    setTimeout(() => element.remove(), 220);
  }, type === 'error' ? 5500 : 3500);
}

// Modal stack -----------------------------------------------------------------

const modalStack = [];

function openModal({ title, subtitle = '', body, foot = '', size = '', onClose }) {
  const root = $('#modalRoot');
  const previousFocus = document.activeElement;
  const element = document.createElement('div');
  element.className = 'modal';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-label', title);
  element.innerHTML = `
    <div class="modal-backdrop" data-modal-close></div>
    <div class="modal-card ${size}" tabindex="-1">
      <div class="modal-head">
        <div><h2>${h(title)}</h2>${subtitle ? `<p>${h(subtitle)}</p>` : ''}</div>
        <button type="button" class="icon-button" data-modal-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  root.appendChild(element);
  document.body.classList.add('no-scroll');

  const modal = {
    element,
    close() {
      const index = modalStack.indexOf(modal);
      if (index === -1) return;
      modalStack.splice(index, 1);
      element.remove();
      if (!modalStack.length && $('#cartDrawer').hidden) document.body.classList.remove('no-scroll');
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      if (onClose) onClose();
    }
  };
  element.addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) modal.close();
  });
  modalStack.push(modal);
  const focusTarget = element.querySelector('.modal-body input[type=text], .modal-body textarea') ||
    element.querySelector('.modal-foot .button-primary, .modal-foot .button-danger');
  setTimeout(() => (focusTarget || element.querySelector('.modal-card')).focus(), 30);
  return modal;
}

function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      size: 'narrow',
      body: `<p class="muted">${h(message)}</p>`,
      foot: `<button type="button" class="button button-outline" data-modal-close>Cancel</button>
             <button type="button" class="button ${danger ? 'button-danger' : 'button-primary'}" data-confirm>${h(confirmLabel)}</button>`,
      onClose: () => {
        if (!answered) resolve(false);
      }
    });
    modal.element.querySelector('[data-confirm]').addEventListener('click', () => {
      answered = true;
      modal.close();
      resolve(true);
    });
  });
}

// ---------------------------------------------------------------------------
// Images: downscale before upload so stored images stay small
// ---------------------------------------------------------------------------

async function imageFileToDataUrl(file, maxDimension = 1600) {
  if (!file || !file.size) return null;
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) {
    throw new Error('Please choose a PNG, JPEG, GIF or WebP image.');
  }

  const readAsDataUrl = () => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(file);
  });

  if (file.type === 'image/gif') {
    if (file.size > 5 * 1024 * 1024) throw new Error('GIFs must be 5 MB or smaller.');
    return readAsDataUrl();
  }

  const source = await readAsDataUrl();
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The selected image could not be opened.'));
    img.src = source;
  });

  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

  let result = canvas.toDataURL('image/webp', 0.86);
  if (!result.startsWith('data:image/webp')) {
    result = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86);
  }
  return result.length < source.length ? result : source;
}

// ---------------------------------------------------------------------------
// Account data & chrome (header, badges)
// ---------------------------------------------------------------------------

async function loadCart() {
  if (!state.user || state.user.role !== 'customer') {
    state.cart = { items: [], itemCount: 0, subtotal: 0 };
    return;
  }
  const result = await apiRequest('/api/cart');
  state.cart = result.cart;
}

async function loadUnreadCount() {
  if (!state.user) return;
  const result = await apiRequest('/api/notifications');
  state.unread = result.unreadCount || 0;
}

// Refreshes everything tied to the signed-in account. Exported for tests as loadDashboard.
async function loadDashboard() {
  try {
    const { user } = await apiRequest('/api/me');
    state.user = user;
    saveSession(user, null);
    await Promise.all([loadCart(), loadUnreadCount()]);
    renderChrome();
  } catch (error) {
    reportApiError(error);
  }
}

function renderChrome() {
  if (!isBrowser) return;
  const role = state.user ? state.user.role : 'guest';

  $$('[data-auth]').forEach((element) => {
    element.hidden = element.dataset.auth !== role;
  });
  $$('[data-admin]').forEach((element) => {
    element.hidden = !(state.user && state.user.isAdmin);
  });

  $('#cartButton').hidden = !(role === 'guest' || role === 'customer');
  $('#notificationsButton').hidden = !state.user;

  const cartBadge = $('#cartBadge');
  cartBadge.hidden = !state.cart.itemCount;
  cartBadge.textContent = state.cart.itemCount > 99 ? '99+' : String(state.cart.itemCount);

  const bellBadge = $('#notificationsBadge');
  bellBadge.hidden = !state.unread;
  bellBadge.textContent = state.unread > 99 ? '99+' : String(state.unread);

  const accountArea = $('#accountArea');
  const existing = $('#accountButton');
  if (state.user) {
    if (existing) existing.remove();
    const avatarImage = state.user.role === 'shop_owner' ? state.user.shopProfileImage : null;
    accountArea.insertAdjacentHTML('beforeend', `
      <button type="button" class="avatar-button" id="accountButton" data-action="toggle-account-menu" aria-haspopup="true" aria-expanded="false">
        <span class="avatar">${avatarMarkup(avatarImage, state.user.name)}</span>
        <span class="avatar-name">${h(state.user.name.split(' ')[0])}</span>
      </button>`);
  } else if (existing) {
    existing.remove();
  }
}

function updateNavActive(pathname) {
  const section = pathname.split('/')[1] || 'home';
  $$('[data-nav]').forEach((link) => link.classList.toggle('active', link.dataset.nav === section));
  const headerInput = $('#headerSearch input');
  if (headerInput && section !== 'products') headerInput.value = '';
}

// Popovers --------------------------------------------------------------------

function closePopovers() {
  if (!isBrowser) return;
  const notifications = $('#notificationsPopover');
  if (notifications) notifications.hidden = true;
  $('#notificationsButton')?.setAttribute('aria-expanded', 'false');
  $('#accountMenu')?.remove();
  $('#accountButton')?.setAttribute('aria-expanded', 'false');
}

function toggleAccountMenu() {
  if ($('#accountMenu')) {
    closePopovers();
    return;
  }
  closePopovers();
  const isOwner = state.user.role === 'shop_owner';
  const menu = document.createElement('div');
  menu.id = 'accountMenu';
  menu.className = 'popover account-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="account-menu-head">
      <strong>${h(state.user.name)}</strong>
      <span>${h(state.user.email)}</span>
    </div>
    ${isOwner
      ? `<a href="/studio" role="menuitem">${icon('chart')} Seller studio</a>
         <a href="/shops/${encodeURIComponent(state.user.id)}" role="menuitem">${icon('store')} View my storefront</a>`
      : state.user.role === 'customer' ? `<a href="/orders" role="menuitem">${icon('receipt')} My orders</a>`
        : state.user.role === 'courier' ? `<a href="/courier" role="menuitem">${icon('truck')} Delivery portal</a>` : ''}
    ${state.user.isAdmin ? `<a href="/admin" role="menuitem">${icon('shield')} Admin dashboard</a>` : ''}
    <a href="/account" role="menuitem">${icon('settings')} Account settings</a>
    <button type="button" role="menuitem" data-action="logout">${icon('logout')} Sign out</button>`;
  $('#siteHeader').appendChild(menu);
  $('#accountButton').setAttribute('aria-expanded', 'true');
}

async function toggleNotifications() {
  const popover = $('#notificationsPopover');
  if (!popover.hidden) {
    closePopovers();
    return;
  }
  closePopovers();
  popover.hidden = false;
  $('#notificationsButton').setAttribute('aria-expanded', 'true');
  popover.innerHTML = `<div class="popover-head"><h3>Notifications</h3></div><div class="popover-body">${loader}</div>`;

  try {
    const { notifications, unreadCount } = await apiRequest('/api/notifications');
    const iconFor = { sale: 'bag', order: 'receipt', status: 'truck', review: 'star' };
    popover.innerHTML = `
      <div class="popover-head">
        <h3>Notifications</h3>
        ${unreadCount ? `<span class="badge badge-brand">${unreadCount} new</span>` : ''}
      </div>
      <div class="popover-body">
        ${notifications.length ? notifications.map((item) => `
          <div class="notif-item ${item.read ? '' : 'unread'}">
            <div class="notif-icon ${h(item.type)}">${icon(iconFor[item.type] || 'bell')}</div>
            <div>
              <div class="notif-text">${h(item.message)}</div>
              <div class="notif-time">${h(timeAgo(item.createdAt))}</div>
            </div>
          </div>`).join('') : emptyState({ iconName: 'bell', title: 'You are all caught up', text: 'Order updates and sales will appear here.' }).replace('empty-state', 'empty-state empty-compact')}
      </div>`;

    if (unreadCount) {
      await apiRequest('/api/notifications/read-all', { method: 'POST' });
      state.unread = 0;
      renderChrome();
    }
  } catch (error) {
    popover.hidden = true;
    reportApiError(error);
  }
}

// Cart drawer -----------------------------------------------------------------

function openCart() {
  closePopovers();
  $('#cartDrawer').hidden = false;
  $('#drawerBackdrop').hidden = false;
  document.body.classList.add('no-scroll');
  renderCartDrawer();
  setTimeout(() => $('#cartDrawer .icon-button').focus(), 30);
  if (state.user) loadCart().then(renderCartDrawer).catch(reportApiError);
}

function closeCart() {
  $('#cartDrawer').hidden = true;
  $('#drawerBackdrop').hidden = true;
  if (!modalStack.length) document.body.classList.remove('no-scroll');
}

function renderCartDrawer() {
  const body = $('#cartDrawerBody');
  const foot = $('#cartDrawerFoot');
  if (!body) return;
  $('#cartDrawerTitle').textContent = state.cart.itemCount ? `Your cart (${state.cart.itemCount})` : 'Your cart';

  if (!state.user) {
    body.innerHTML = emptyState({
      iconName: 'cart',
      title: 'Sign in to start your cart',
      text: 'Create a free account to save items, check out and track deliveries.',
      action: '<a href="/login" class="button button-primary" data-action="close-drawer">Sign in</a>'
    }).replace('empty-state', 'empty-state empty-compact');
    foot.innerHTML = '';
    return;
  }

  if (!state.cart.items.length) {
    body.innerHTML = emptyState({
      iconName: 'cart',
      title: 'Your cart is empty',
      text: 'Browse independent shops and add something you love.',
      action: '<a href="/products" class="button button-primary" data-action="close-drawer">Start shopping</a>'
    }).replace('empty-state', 'empty-state empty-compact');
    foot.innerHTML = '';
    return;
  }

  const hasProblems = state.cart.items.some((item) => !item.available);
  body.innerHTML = state.cart.items.map((item) => `
    <div class="cart-line">
      <a class="thumb" href="/products/${encodeURIComponent(item.productId)}" data-action="close-drawer">${mediaMarkup(item.image, item.productName)}</a>
      <div>
        <a class="cart-line-title" href="/products/${encodeURIComponent(item.productId)}" data-action="close-drawer">${h(item.productName)}</a>
        <div class="cart-line-sub">${h(item.shopName)} · ${formatMoney(item.price)}</div>
        <div class="cart-line-controls">
          <div class="stepper stepper-sm">
            <button type="button" data-action="cart-dec" data-id="${h(item.productId)}" aria-label="Decrease quantity">${icon('minus')}</button>
            <output aria-label="Quantity">${h(item.quantity)}</output>
            <button type="button" data-action="cart-inc" data-id="${h(item.productId)}" aria-label="Increase quantity" ${item.quantity >= item.stock ? 'disabled' : ''}>${icon('plus')}</button>
          </div>
        </div>
        ${item.available ? '' : `<div class="line-warning">${item.stock ? `Only ${h(item.stock)} left — reduce the quantity` : 'Sold out — please remove'}</div>`}
      </div>
      <div class="cart-line-side">
        <strong>${formatMoney(item.lineTotal)}</strong>
        <button type="button" class="icon-button icon-button-sm" data-action="cart-remove" data-id="${h(item.productId)}" aria-label="Remove ${h(item.productName)}">${icon('trash')}</button>
      </div>
    </div>`).join('');

  foot.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><span>${formatMoney(state.cart.subtotal)}</span></div>
    <div class="summary-row"><span>Delivery</span><span>${state.cart.deliveryTotal ? formatMoney(state.cart.deliveryTotal) : 'Free'}</span></div>
    <div class="summary-row total"><span>Total</span><strong>${formatMoney(state.cart.total ?? state.cart.subtotal)}</strong></div>
    <p class="protect-line">${icon('lock')} Protected payment: the seller is paid only after you receive your order.</p>
    <a href="/checkout" class="button button-primary button-lg button-block" style="margin-top: 14px" data-action="close-drawer" ${hasProblems ? 'aria-disabled="true"' : ''}>
      Checkout ${icon('arrow')}
    </a>`;
}

async function addToCart(productId, quantity = 1) {
  if (!state.user) {
    state.redirectAfterLogin = location.pathname + location.search;
    toast('Sign in to add items to your cart.');
    navigate('/login');
    return false;
  }
  try {
    const result = await apiRequest('/api/cart/add', { method: 'POST', body: { productId, quantity } });
    state.cart = result.cart;
    renderChrome();
    toast('Added to your cart.', 'success', { label: 'View cart', action: 'open-cart' });
    return true;
  } catch (error) {
    reportApiError(error);
    return false;
  }
}

async function changeCartQuantity(productId, delta) {
  const item = state.cart.items.find((entry) => entry.productId === productId);
  if (!item) return;
  try {
    const result = await apiRequest('/api/cart/update', { method: 'POST', body: { productId, quantity: Math.max(0, item.quantity + delta) } });
    state.cart = result.cart;
    renderChrome();
    renderCartDrawer();
  } catch (error) {
    reportApiError(error);
  }
}

async function removeFromCart(productId) {
  try {
    const result = await apiRequest('/api/cart/remove', { method: 'POST', body: { productId } });
    state.cart = result.cart;
    renderChrome();
    renderCartDrawer();
  } catch (error) {
    reportApiError(error);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routes = [
  [/^\/$/, viewHome],
  [/^\/products\/?$/, viewProducts],
  [/^\/products\/([^/]+)$/, viewProduct],
  [/^\/shops\/?$/, viewShops],
  [/^\/shops\/([^/]+)$/, viewShop],
  [/^\/login\/?$/, (ctx) => viewAuth('login', ctx)],
  [/^\/register\/?$/, (ctx) => viewAuth('register', ctx)],
  [/^\/checkout\/?$/, viewCheckout],
  [/^\/orders\/?$/, viewOrders],
  [/^\/studio\/?$/, viewStudio],
  [/^\/account\/?$/, viewAccount],
  [/^\/install\/?$/, viewInstall],
  [/^\/admin\/?$/, viewAdmin]
  ,[/^\/courier\/?$/, viewCourier]
];

function navigate(url, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  render({ scroll: true });
}

async function render({ scroll = false } = {}) {
  const id = ++state.renderId;
  closePopovers();
  $('#mainNav').classList.remove('open');
  $('#menuToggle').setAttribute('aria-expanded', 'false');
  updateNavActive(location.pathname);
  if (scroll) window.scrollTo(0, 0);

  const query = new URLSearchParams(location.search);
  for (const [pattern, view] of routes) {
    const match = pattern.exec(location.pathname);
    if (match) {
      try {
        await view({ id, query, params: match.slice(1).map(decodeURIComponent) });
      } catch (error) {
        if (id !== state.renderId) return;
        if (error.status === 404) viewNotFound(error.message);
        else {
          reportApiError(error);
          setView(`<div class="container section">${emptyState({ iconName: 'alert', title: 'This page could not load', text: error.message, action: '<a href="/" class="button button-outline">Back to home</a>' })}</div>`);
        }
      }
      return;
    }
  }
  viewNotFound();
}

const stale = (id) => id !== state.renderId;

const requireRole = (role) => {
  if (!state.user) {
    state.redirectAfterLogin = location.pathname + location.search;
    navigate('/login', { replace: true });
    return false;
  }
  if (role && state.user.role !== role) {
    navigate(homePathFor(state.user), { replace: true });
    return false;
  }
  return true;
};

function viewNotFound(message) {
  setTitle('Page not found');
  setView(`<div class="container section">${emptyState({
    iconName: 'search',
    title: 'We could not find that page',
    text: message || 'The link may be broken, or the page may have been removed.',
    action: '<a href="/" class="button button-primary">Back to home</a>'
  })}</div>`);
}

// ---------------------------------------------------------------------------
// Views: home
// ---------------------------------------------------------------------------

async function viewHome({ id }) {
  setTitle('');
  const isOwner = state.user && state.user.role === 'shop_owner';

  setView(`
    <section class="hero">
      <div class="container hero-inner">
        <div class="hero-copy fade-up">
          <span class="hero-pill"><span>New</span> Pay with mobile money, card or cash on delivery</span>
          <h1>Shop independent stores, <em>all in one place.</em></h1>
          <p class="hero-lead">Discover phones, fashion, beauty and home goods from trusted local sellers. One cart, every shop, delivered to your door.</p>
          <form class="hero-search" data-form="search">
            <input type="search" name="q" placeholder="What are you looking for today?" aria-label="Search products" />
            <button type="submit" class="button button-primary">${icon('search')} Search</button>
          </form>
          <div class="hero-actions">
            ${isOwner
              ? '<a href="/studio" class="button button-dark">Go to your studio</a>'
              : '<a href="/products" class="button button-dark">Start shopping</a>'}
            ${state.user ? '' : '<span>or <a class="link" href="/register?role=shop_owner">open your shop for free</a></span>'}
          </div>
          <div class="hero-trust">
            <span>${icon('checkCircle')} Verified local sellers</span>
            <span>${icon('checkCircle')} Order tracking</span>
            <span>${icon('checkCircle')} Secure accounts</span>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="hero-card hero-card-main">
            <div class="hc-media">SV</div>
            <div class="hc-body">
              <div><div class="hc-title">Handpicked this week</div><div class="hc-sub">From shops near you</div></div>
              <div class="hc-price">New</div>
            </div>
          </div>
          <div class="hero-card hero-card-float one">
            <div class="hc-icon">${icon('truck')}</div>
            <div><div class="hc-title">Order shipped</div><div class="hc-sub">On its way to Lusaka</div></div>
          </div>
          <div class="hero-card hero-card-float two">
            <div class="hc-icon warm">${icon('star')}</div>
            <div><div class="hc-title">4.9 average rating</div><div class="hc-sub">From verified buyers</div></div>
          </div>
        </div>
      </div>
    </section>

    <div class="container"><div class="stats-strip" id="homeStats">
      ${['Independent shops', 'Products listed', 'Categories', 'Orders placed'].map((label) => `<div class="stat"><strong><span class="skeleton line short" style="display:block;height:28px;width:60px"></span></strong><span>${label}</span></div>`).join('')}
    </div></div>

    <section class="section">
      <div class="container">
        <div class="section-head"><div><h2>Shop by category</h2><p>Find exactly what you need, faster.</p></div><a class="link" href="/products">Browse all →</a></div>
        <div class="category-tiles" id="homeCategories"></div>
      </div>
    </section>

    <section class="section-tight">
      <div class="container">
        <div class="section-head"><div><h2>Trending now</h2><p>Popular picks from shops across the marketplace.</p></div><a class="link" href="/products?sort=featured">See more →</a></div>
        <div class="product-grid" id="homeProducts">${skeletonCards(8)}</div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head"><div><h2>Shops to discover</h2><p>Independent sellers you can trust.</p></div><a class="link" href="/shops">All shops →</a></div>
        <div class="shop-grid" id="homeShops">${skeletonCards(3)}</div>
      </div>
    </section>

    <section class="section-tight">
      <div class="container">
        <div class="section-head"><div><h2>How ShopVerse works</h2><p>From discovery to your doorstep in three steps.</p></div></div>
        <div class="steps">
          <div class="step"><div class="step-num">1</div><h3>Discover</h3><p>Search across every shop at once, or browse by category to find something new.</p></div>
          <div class="step"><div class="step-num">2</div><h3>Check out once</h3><p>Fill one cart from many shops and pay with MoMo, Airtel Money, card or cash on delivery.</p></div>
          <div class="step"><div class="step-num">3</div><h3>Track every order</h3><p>Each shop updates you as your order is confirmed, packed, shipped and delivered.</p></div>
        </div>
      </div>
    </section>

    ${isOwner ? '' : `
    <section class="section">
      <div class="container">
        <div class="cta-band">
          <div>
            <span class="eyebrow" style="color:#a5b4fc">For sellers</span>
            <h2>Turn your shop into an online store in minutes.</h2>
            <p>Create your storefront, list unlimited products and start receiving orders. No setup fees, no code.</p>
            <div class="button-row">
              <a href="/register?role=shop_owner" class="button button-primary button-lg">Open your shop</a>
              <a href="/shops" class="button button-outline button-lg">See live shops</a>
            </div>
          </div>
          <ul class="cta-list">
            <li>${icon('store')}<div><strong>Your own branded storefront</strong><span>Logo, banner, colours and a shareable link.</span></div></li>
            <li>${icon('box')}<div><strong>Simple inventory</strong><span>Add products, track stock and arrange your catalogue.</span></div></li>
            <li>${icon('chart')}<div><strong>Orders &amp; revenue at a glance</strong><span>Manage fulfilment and see what is selling.</span></div></li>
          </ul>
        </div>
      </div>
    </section>`}
  `);

  const [statsResult, categoriesResult, productsResult, shopsResult] = await Promise.all([
    apiRequest('/api/stats'),
    apiRequest('/api/categories'),
    apiRequest('/api/products?sort=featured&limit=8'),
    apiRequest('/api/shops')
  ]);
  if (stale(id)) return;

  const stats = statsResult.stats;
  $('#homeStats').innerHTML = [
    [stats.shops, 'Independent shops'],
    [stats.products, 'Products listed'],
    [stats.categories, 'Categories'],
    [stats.orders, 'Orders placed']
  ].map(([value, label]) => `<div class="stat"><strong>${h(Number(value).toLocaleString())}</strong><span>${label}</span></div>`).join('');

  $('#homeCategories').innerHTML = categoriesResult.categories.length
    ? categoriesResult.categories.slice(0, 12).map((category) => `
        <a class="category-tile" href="/products?category=${encodeURIComponent(category.name)}">
          <span class="ct-icon">${h(initials(category.name).slice(0, 1))}</span>
          <div><strong>${h(category.name)}</strong><span>${plural(category.count, 'item')}</span></div>
        </a>`).join('')
    : '<p class="muted">Categories will appear once shops add products.</p>';

  $('#homeProducts').innerHTML = productsResult.products.length
    ? productsResult.products.map(productCard).join('')
    : emptyState({ title: 'No products yet', text: 'Be the first seller to list something.', action: '<a href="/register?role=shop_owner" class="button button-primary">Open your shop</a>' });

  $('#homeShops').innerHTML = shopsResult.shops.length
    ? shopsResult.shops.slice(0, 6).map(shopCard).join('')
    : emptyState({ iconName: 'store', title: 'No shops yet', text: 'Open the first shop on ShopVerse.', action: '<a href="/register?role=shop_owner" class="button button-primary">Open your shop</a>' });
}

// ---------------------------------------------------------------------------
// Views: product catalogue
// ---------------------------------------------------------------------------

const productFilters = { search: '', category: '', sort: 'featured', inStock: false };

async function viewProducts({ id, query }) {
  Object.assign(productFilters, {
    search: query.get('search') || '',
    category: query.get('category') || '',
    sort: query.get('sort') || 'featured',
    inStock: query.get('inStock') === 'true'
  });
  setTitle(productFilters.category || (productFilters.search ? `Search: ${productFilters.search}` : 'Explore products'));
  const headerInput = $('#headerSearch input');
  if (headerInput) headerInput.value = productFilters.search;

  setView(`
    <div class="container">
      <div class="page-head">
        <h1>Explore products</h1>
        <p>Everything for sale across ShopVerse, from every independent shop.</p>
      </div>
      <div class="toolbar">
        <input type="search" class="search-input" data-filter="search" placeholder="Search products" value="${h(productFilters.search)}" aria-label="Search products" />
        <select data-filter="sort" aria-label="Sort products">
          ${[['featured', 'Featured'], ['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['rating', 'Top rated']]
            .map(([value, label]) => `<option value="${value}" ${productFilters.sort === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <label class="toggle"><input type="checkbox" data-filter="inStock" ${productFilters.inStock ? 'checked' : ''} /> In stock only</label>
      </div>
      <div class="chip-row" id="categoryChips" style="margin-bottom: 20px"></div>
      <div class="result-count" id="resultCount"></div>
      <div class="product-grid" id="productResults">${skeletonCards(8)}</div>
    </div>`);

  const { categories } = await apiRequest('/api/categories');
  if (stale(id)) return;
  renderCategoryChips(categories);
  await loadProductResults(id);
}

function renderCategoryChips(categories) {
  const chips = $('#categoryChips');
  if (!chips) return;
  chips.innerHTML = [`<button type="button" class="chip ${productFilters.category ? '' : 'active'}" data-action="set-category" data-category="">All</button>`]
    .concat(categories.map((category) => `
      <button type="button" class="chip ${productFilters.category.toLowerCase() === category.name.toLowerCase() ? 'active' : ''}" data-action="set-category" data-category="${h(category.name)}">
        ${h(category.name)} <small>${category.count}</small>
      </button>`))
    .join('');
}

async function loadProductResults(id = state.renderId) {
  const params = new URLSearchParams();
  if (productFilters.search) params.set('search', productFilters.search);
  if (productFilters.category) params.set('category', productFilters.category);
  if (productFilters.sort && productFilters.sort !== 'featured') params.set('sort', productFilters.sort);
  if (productFilters.inStock) params.set('inStock', 'true');
  const queryString = params.toString();
  history.replaceState({}, '', `/products${queryString ? `?${queryString}` : ''}`);

  params.set('sort', productFilters.sort || 'featured');
  const result = await apiRequest(`/api/products?${params.toString()}`);
  if (stale(id)) return;

  $('#resultCount').textContent = `${plural(result.total, 'product')}${productFilters.category ? ` in ${productFilters.category}` : ''}${productFilters.search ? ` matching “${productFilters.search}”` : ''}`;
  $('#productResults').innerHTML = result.products.length
    ? result.products.map(productCard).join('')
    : emptyState({ iconName: 'search', title: 'No products match your filters', text: 'Try a different search or category.', action: '<a href="/products" class="button button-outline">Clear filters</a>' });
}

// ---------------------------------------------------------------------------
// Views: product detail
// ---------------------------------------------------------------------------

async function viewProduct({ id, params }) {
  setView(loader);
  const { product } = await apiRequest(`/api/products/${encodeURIComponent(params[0])}`);
  const related = await apiRequest(`/api/products?shopId=${encodeURIComponent(product.shopId)}&limit=5`);
  if (stale(id)) return;
  setTitle(product.name);

  const isOwnProduct = state.user && state.user.id === product.shopId;
  const myReview = state.user && product.reviews.find((review) => review.customerId === state.user.id);
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: product.reviews.filter((review) => review.rating === stars).length }));
  const others = related.products.filter((item) => item.id !== product.id).slice(0, 4);

  let buyBox;
  if (isOwnProduct) {
    buyBox = `<a href="/studio" class="button button-dark button-lg">${icon('edit')} Manage in studio</a>`;
  } else if (!canBuy()) {
    buyBox = '<div class="notice">Shop owner accounts cannot place orders. Sign in with a customer account to buy.</div>';
  } else if (!product.inStock) {
    buyBox = '<button type="button" class="button button-outline button-lg" disabled>Sold out</button>';
  } else {
    buyBox = `
      <div class="stepper" data-stepper data-max="${h(product.stock)}">
        <button type="button" data-action="qty-dec" aria-label="Decrease quantity">${icon('minus')}</button>
        <input type="number" id="buyQty" value="1" min="1" max="${h(product.stock)}" aria-label="Quantity" />
        <button type="button" data-action="qty-inc" aria-label="Increase quantity">${icon('plus')}</button>
      </div>
      <button type="button" class="button button-primary button-lg" data-action="add-to-cart" data-id="${h(product.id)}" data-qty-input="#buyQty">${icon('cart')} Add to cart</button>`;
  }

  setView(`
    <div class="container">
      ${product.listed === false ? `<div class="notice notice-warning" style="margin-top:20px">${icon('alert')}<span><strong>Preview: buyers can't see this product.</strong> ${
        product.hiddenReason === 'suspended'
          ? 'The shop has been suspended by ShopVerse.'
          : product.hiddenReason === 'prohibited'
          ? 'It mentions a prohibited item. Illegal drugs cannot be sold or advertised on ShopVerse.'
          : "The shop isn't verified yet. Only verified shops can sell on ShopVerse."}</span></div>` : ''}
      <nav class="breadcrumb" aria-label="Breadcrumb" style="padding-top: 28px">
        <a href="/">Home</a><span>/</span>
        <a href="/products?category=${encodeURIComponent(product.category)}">${h(product.category)}</a><span>/</span>
        <span>${h(product.name)}</span>
      </nav>
      <div class="product-detail">
        <div class="pd-media" style="--accent-c: ${safeColor(product.shopThemeColor)}">${mediaMarkup(product.image, product.name, product.name)}</div>
        <div class="pd-info">
          <a class="pd-shop" href="/shops/${encodeURIComponent(product.shopId)}">
            <span class="avatar" style="background:${safeColor(product.shopThemeColor)}">${h(initials(product.shopName).slice(0, 1))}</span>
            ${h(product.shopName)} ${verifiedBadge(product.shopVerified)}
          </a>
          <h1>${h(product.name)}</h1>
          <div class="meta-row">
            ${ratingMarkup(product.averageRating, product.reviewCount)}
            <span class="badge badge-brand">${h(product.category)}</span>
          </div>
          <div class="pd-price-row">
            <span class="price price-lg">${formatMoney(product.price)}</span>
            ${product.inStock
              ? product.lowStock ? `<span class="badge badge-warning">Only ${h(product.stock)} left</span>` : '<span class="badge badge-success">In stock</span>'
              : '<span class="badge badge-danger">Sold out</span>'}
          </div>
          <div class="pd-buy">${buyBox}</div>
          <div class="pd-actions">
            ${shareButtons({
              path: `/products/${encodeURIComponent(product.id)}`,
              title: product.name,
              text: `${product.name} for ${formatMoney(product.price)} at ${product.shopName} on ShopVerse:`
            })}
            ${product.shop && product.shop.whatsapp && !isOwnProduct ? `
              <a class="button button-ghost button-sm" target="_blank" rel="noopener"
                 href="${h(whatsappChatUrl(product.shop.whatsapp, `Hi ${product.shopName}, I'm interested in "${product.name}" on ShopVerse: ${absoluteUrl(`/products/${encodeURIComponent(product.id)}`)}`))}">
                ${icon('whatsapp')} Ask the seller
              </a>` : ''}
          </div>
          <div class="pd-description">${h(product.description || 'The seller has not added a description yet.')}</div>
          <div class="pd-perks">
            <div>${icon('lock')} <span><strong>Protected payment.</strong> Pay ShopVerse by mobile money; the seller is paid only after you receive your order.</span></div>
            <div>${icon('truck')} ${product.shop && product.shop.delivery
              ? `${h(deliverySummary(product.shop.delivery))}${product.shop.delivery.areas ? ` · ${h(product.shop.delivery.areas)}` : ''}`
              : `Delivery arranged by ${h(product.shopName)}`}${product.shopLocation ? ` · ships from ${h(product.shopLocation)}` : ''}</div>
            <div>${icon('shield')} ${product.shopVerified ? 'Verified seller: ShopVerse has checked their identity' : 'Cancel free of charge until the shop confirms your order'}</div>
          </div>
        </div>
      </div>

      <section class="section" id="reviews">
        <div class="section-head"><div><h2>Customer reviews</h2></div></div>
        <div class="reviews-layout">
          <div class="card rating-summary">
            <div class="big">${product.reviewCount ? Number(product.averageRating).toFixed(1) : '–'}</div>
            <div style="margin-top: 6px">${starString(product.averageRating)}</div>
            <div class="muted" style="font-size: .85rem; margin-top: 4px">${plural(product.reviewCount, 'review')}</div>
            <div class="rating-bars">
              ${distribution.map(({ stars, count }) => `
                <div class="rating-bar"><span>${stars}</span><div class="track"><div class="fill" style="width:${product.reviewCount ? Math.round((count / product.reviewCount) * 100) : 0}%"></div></div><span>${count}</span></div>`).join('')}
            </div>
          </div>
          <div class="review-list">
            ${state.user && state.user.role === 'customer' ? `
              <form class="card card-pad" data-form="review" data-id="${h(product.id)}">
                <h3 style="font-size: 1rem; margin-bottom: 10px">${myReview ? 'Update your review' : 'Write a review'}</h3>
                <div class="star-input" role="radiogroup" aria-label="Rating">
                  ${[5, 4, 3, 2, 1].map((value) => `
                    <input type="radio" name="rating" id="star${value}" value="${value}" ${(myReview ? myReview.rating : 5) === value ? 'checked' : ''} />
                    <label for="star${value}" title="${value} star${value === 1 ? '' : 's'}">★</label>`).join('')}
                </div>
                <textarea name="comment" rows="3" maxlength="1000" placeholder="What did you like or dislike?" style="margin-top: 10px">${h(myReview && myReview.comment !== 'No comment provided.' ? myReview.comment : '')}</textarea>
                <div class="form-actions"><button type="submit" class="button button-primary button-sm">${myReview ? 'Update review' : 'Post review'}</button></div>
              </form>` : !state.user ? `<div class="notice">${icon('info')}<span><a class="link" href="/login">Sign in</a> to leave a review.</span></div>` : ''}
            ${product.reviews.length ? product.reviews.map((review) => `
              <div class="card review">
                <div class="review-head">
                  <div class="review-author">
                    <span class="avatar">${h(initials(review.customerName).slice(0, 1))}</span>
                    <div>${h(review.customerName)}<small>${h(timeAgo(review.updatedAt || review.createdAt))}</small></div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center">
                    ${review.verifiedPurchase ? `<span class="badge badge-success">${icon('check')} Verified purchase</span>` : ''}
                    ${starString(review.rating)}
                  </div>
                </div>
                <p>${h(review.comment)}</p>
              </div>`).join('') : '<p class="muted">No reviews yet. Be the first to share your thoughts.</p>'}
          </div>
        </div>
      </section>

      ${others.length ? `
        <section class="section-tight">
          <div class="section-head"><div><h2>More from ${h(product.shopName)}</h2></div><a class="link" href="/shops/${encodeURIComponent(product.shopId)}">Visit shop →</a></div>
          <div class="product-grid">${others.map(productCard).join('')}</div>
        </section>` : ''}
    </div>`);
}

// ---------------------------------------------------------------------------
// Views: shops
// ---------------------------------------------------------------------------

async function viewShops({ id, query }) {
  setTitle('Shops');
  const search = query.get('search') || '';
  setView(`
    <div class="container">
      <div class="page-head">
        <h1>Shops on ShopVerse</h1>
        <p>Meet the independent sellers behind the marketplace.</p>
      </div>
      <div class="toolbar">
        <input type="search" class="search-input" data-filter="shop-search" placeholder="Search shops by name, location or category" value="${h(search)}" aria-label="Search shops" />
      </div>
      <div class="result-count" id="resultCount"></div>
      <div class="shop-grid" id="shopResults">${skeletonCards(6)}</div>
    </div>`);
  await loadShopResults(search, id);
}

async function loadShopResults(search, id = state.renderId) {
  history.replaceState({}, '', `/shops${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  const { shops } = await apiRequest(`/api/shops${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  if (stale(id)) return;
  $('#resultCount').textContent = plural(shops.length, 'shop');
  $('#shopResults').innerHTML = shops.length
    ? shops.map(shopCard).join('')
    : emptyState({ iconName: 'store', title: 'No shops found', text: search ? 'Try a different search.' : 'No shops have opened yet.' });
}

async function viewShop({ id, params }) {
  setView(loader);
  const { shop } = await apiRequest(`/api/shops/${encodeURIComponent(params[0])}`);
  if (stale(id)) return;
  setTitle(shop.name);
  state.shopView = { shop, category: '', sort: 'custom' };

  const banner = safeImageUrl(shop.bannerImage);
  const isMine = state.user && state.user.id === shop.id;
  const hiddenNotice = shop.listed === false ? `
    <div class="container" style="padding-top:16px">
      <div class="notice notice-warning">${icon('alert')}<span><strong>Preview: buyers can't see this shop.</strong> ${
        shop.hiddenReason === 'suspended'
          ? 'It has been suspended by ShopVerse.'
          : shop.hiddenReason === 'prohibited'
          ? 'It mentions a prohibited item. Illegal drugs cannot be sold or advertised on ShopVerse.'
          : `Only verified shops are visible on ShopVerse.${isMine ? ' <a class="link" href="/studio?tab=profile#verification">Request verification</a>' : ''}`}</span></div>
    </div>` : '';

  setView(`
    ${hiddenNotice}
    <section class="storefront-hero" style="--accent-c: ${safeColor(shop.themeColor)}">
      <div class="storefront-banner" ${banner ? `style="background-image: ${h(cssUrl(banner))}"` : ''}></div>
      <div class="container storefront-info">
        <div class="shop-avatar">${avatarMarkup(shop.profileImage, shop.name)}</div>
        <div class="storefront-text">
          <h1>${h(shop.name)} ${verifiedBadge(shop.verified)}</h1>
          <p>${h(shop.description || '')}</p>
          <div class="meta-row">
            <span>${icon('pin')} ${h(shop.location)}</span>
            <span>${icon('user')} Run by ${h(shop.owner)}</span>
            <span>${icon('box')} ${plural(shop.productCount, 'product')}</span>
            <span>${icon('truck')} ${h(deliverySummary(shop.delivery))}</span>
            ${shop.reviewCount ? ratingMarkup(shop.averageRating, shop.reviewCount) : ''}
          </div>
          ${shop.delivery && shop.delivery.areas ? `<p class="muted" style="font-size:.85rem;margin-top:6px">Delivers to: ${h(shop.delivery.areas)}</p>` : ''}
        </div>
        <div class="storefront-actions">
          ${isMine ? `<a href="/studio?tab=profile" class="button button-outline button-sm">${icon('edit')} Edit storefront</a>` : ''}
          ${shop.whatsapp && !isMine ? `<a class="button button-whatsapp button-sm" target="_blank" rel="noopener" href="${h(whatsappChatUrl(shop.whatsapp, `Hi ${shop.name}, I found your shop on ShopVerse.`))}">${icon('whatsapp')} Chat on WhatsApp</a>` : ''}
          ${shareButtons({ path: `/shops/${encodeURIComponent(shop.id)}`, title: shop.name, text: `Check out ${shop.name} on ShopVerse:` })}
        </div>
      </div>
    </section>
    <div class="container section-tight">
      ${shop.products.length ? `
        <div class="toolbar">
          <div class="chip-row" style="flex:1" id="shopCategoryChips"></div>
          <select data-filter="shop-sort" aria-label="Sort products">
            <option value="custom">Shop's picks</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="rating">Top rated</option>
          </select>
        </div>
        <div class="product-grid" id="shopProducts"></div>` : emptyState({
          title: 'No products yet',
          text: isMine ? 'Add your first product so customers can start buying.' : 'This shop has not listed any products yet. Check back soon.',
          action: isMine ? '<a href="/studio" class="button button-primary">Add a product</a>' : ''
        })}
    </div>`);
  renderShopProducts();
}

function renderShopProducts() {
  const view = state.shopView;
  const grid = $('#shopProducts');
  if (!view || !grid) return;
  const categories = [...new Set(view.shop.products.map((product) => product.category))].sort((a, b) => a.localeCompare(b));
  $('#shopCategoryChips').innerHTML = [`<button type="button" class="chip ${view.category ? '' : 'active'}" data-action="shop-category" data-category="">All</button>`]
    .concat(categories.map((category) => `<button type="button" class="chip ${view.category === category ? 'active' : ''}" data-action="shop-category" data-category="${h(category)}">${h(category)}</button>`))
    .join('');

  const sorters = {
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    rating: (a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount
  };
  let list = view.shop.products.filter((product) => !view.category || product.category === view.category);
  if (sorters[view.sort]) list = [...list].sort(sorters[view.sort]);
  grid.innerHTML = list.map(productCard).join('');
}

// ---------------------------------------------------------------------------
// Views: auth
// ---------------------------------------------------------------------------

async function viewAuth(mode, { query }) {
  if (state.user) {
    navigate(homePathFor(state.user), { replace: true });
    return;
  }
  const isRegister = mode === 'register';
  const role = query.get('role') === 'shop_owner' ? 'shop_owner' : 'customer';
  setTitle(isRegister ? 'Create your account' : 'Sign in');

  setView(`
    <div class="auth-layout">
      <aside class="auth-aside">
        <div>
          <span class="eyebrow" style="color:#a5b4fc">${role === 'shop_owner' ? 'For sellers' : 'Welcome to ShopVerse'}</span>
          <h2 style="margin-top:12px">${role === 'shop_owner' ? 'Bring your shop online today.' : 'Every local shop, one easy checkout.'}</h2>
        </div>
        <ul class="cta-list">
          ${role === 'shop_owner' ? `
            <li>${icon('store')}<div><strong>A storefront that looks like you</strong><span>Add your logo, banner and brand colour.</span></div></li>
            <li>${icon('box')}<div><strong>Unlimited products</strong><span>List as much as you like, free.</span></div></li>
            <li>${icon('bell')}<div><strong>Instant order alerts</strong><span>Know the moment a customer buys.</span></div></li>` : `
            <li>${icon('search')}<div><strong>Search every shop at once</strong><span>Compare prices and reviews in seconds.</span></div></li>
            <li>${icon('wallet')}<div><strong>Pay your way</strong><span>MoMo, Airtel Money, card or cash on delivery.</span></div></li>
            <li>${icon('truck')}<div><strong>Track every delivery</strong><span>Live status updates from each shop.</span></div></li>`}
        </ul>
      </aside>
      <div class="auth-main">
        <div class="auth-card fade-up">
          <h1>${isRegister ? 'Create your account' : 'Welcome back'}</h1>
          <p>${isRegister ? 'It takes less than a minute. No card required.' : 'Sign in to continue to your account.'}</p>
          <div class="segmented" role="tablist">
            <a href="/login" class="${isRegister ? '' : 'active'}" role="tab" aria-selected="${!isRegister}">Sign in</a>
            <a href="/register${role === 'shop_owner' ? '?role=shop_owner' : ''}" class="${isRegister ? 'active' : ''}" role="tab" aria-selected="${isRegister}">Create account</a>
          </div>
          <form class="form-grid" data-form="${mode}" novalidate>
            <div class="form-error" id="authError" hidden></div>
            ${isRegister ? `
              <div class="field">
                <span class="field-label">I want to</span>
                <div class="option-grid" style="grid-template-columns: 1fr 1fr">
                  <label class="option-card large"><input type="radio" name="role" value="customer" data-change="role" ${role === 'customer' ? 'checked' : ''} />${icon('bag')}<div><strong>Shop</strong><small>Buy from local shops</small></div></label>
                  <label class="option-card large"><input type="radio" name="role" value="shop_owner" data-change="role" ${role === 'shop_owner' ? 'checked' : ''} />${icon('store')}<div><strong>Sell</strong><small>Open my own shop</small></div></label>
                </div>
              </div>
              <label class="field"><span>Full name</span><input type="text" name="name" autocomplete="name" maxlength="80" required /></label>` : ''}
            <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" placeholder="you@example.com" required /></label>
            <label class="field"><span>Password ${isRegister ? '<span class="hint">· at least 8 characters</span>' : ''}</span><div class="password-control"><input type="password" name="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="${isRegister ? 8 : 1}" required /><button type="button" class="password-toggle" data-action="toggle-password" aria-pressed="false">Show</button></div></label>
            ${isRegister ? `
              <div class="form-grid" id="shopFields" ${role === 'shop_owner' ? '' : 'hidden'}>
                <label class="field"><span>Shop name</span><input type="text" name="shopName" maxlength="80" placeholder="e.g. Lusaka Fresh Finds" /></label>
                <label class="field"><span>Location</span><input type="text" name="shopLocation" maxlength="120" placeholder="e.g. Kabulonga, Lusaka" /></label>
                <label class="field"><span>Short description <span class="hint">· optional</span></span><textarea name="shopDescription" rows="2" maxlength="600" placeholder="What do you sell?"></textarea></label>
              </div>` : ''}
            <button type="submit" class="button button-primary button-lg button-block">${isRegister ? 'Create account' : 'Sign in'}</button>
          </form>
          ${!isRegister && state.demo ? `
            <div class="demo-box">
              <strong>Demo mode.</strong> Try ShopVerse with a sample account:
              <div class="button-row">
                <button type="button" class="button button-outline button-sm" data-action="demo-login" data-email="customer@shopverse.com">${icon('bag')} Customer</button>
                <button type="button" class="button button-outline button-sm" data-action="demo-login" data-email="owner@shopverse.com">${icon('store')} Shop owner</button>
              </div>
            </div>` : ''}
          <p class="auth-switch">${isRegister ? 'Already have an account? <a class="link" href="/login">Sign in</a>' : 'New to ShopVerse? <a class="link" href="/register">Create a free account</a>'}</p>
        </div>
      </div>
    </div>`);
}

async function completeSignIn(result, { isNewShop = false } = {}) {
  saveSession(result.user, result.token);
  state.user = result.user;
  await Promise.all([loadCart(), loadUnreadCount()]).catch(() => {});
  renderChrome();
  const destination = isNewShop
    ? '/studio?welcome=1'
    : state.redirectAfterLogin || homePathFor(result.user);
  state.redirectAfterLogin = null;
  toast(`Welcome${isNewShop ? '' : ' back'}, ${result.user.name.split(' ')[0]}!`, 'success');
  navigate(destination, { replace: true });
}

async function submitAuth(form, mode) {
  const data = Object.fromEntries(new FormData(form).entries());
  const errorBox = $('#authError');
  const button = form.querySelector('[type=submit]');
  errorBox.hidden = true;

  try {
    setBusy(button, true);
    const result = mode === 'login'
      ? await apiRequest('/api/login', { method: 'POST', body: { email: data.email, password: data.password } })
      : await apiRequest('/api/register', { method: 'POST', body: data });
    await completeSignIn(result, { isNewShop: mode === 'register' && data.role === 'shop_owner' });
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    setBusy(button, false);
  }
}

async function logout() {
  closePopovers();
  try {
    await apiRequest('/api/logout', { method: 'POST' });
  } catch (error) {
    // The session may already be gone; sign out locally regardless.
  }
  clearSession();
  state.user = null;
  state.cart = { items: [], itemCount: 0, subtotal: 0 };
  state.unread = 0;
  renderChrome();
  toast('You have been signed out.');
  navigate('/');
}

// ---------------------------------------------------------------------------
// Views: checkout
// ---------------------------------------------------------------------------

const readRemembered = () => {
  try {
    return JSON.parse(defaultStorage()?.getItem(addressKey) || '{}');
  } catch (error) {
    return {};
  }
};

async function loadPaymentInfo() {
  if (!state.paymentInfo) {
    const { payment } = await apiRequest('/api/payment-info');
    state.paymentInfo = payment;
  }
  return state.paymentInfo;
}

const fulfilmentOptions = (shop) => {
  const options = [];
  if (shop.delivery.enabled) {
    options.push({
      value: 'delivery',
      label: 'Delivery',
      price: shop.deliveryFee > 0 ? formatMoney(shop.deliveryFee) : 'Free',
      hint: shop.delivery.areas || (shop.delivery.freeOver && shop.deliveryFee > 0 ? `Free over ${formatMoney(shop.delivery.freeOver)}` : 'To your address')
    });
  }
  if (shop.delivery.pickup) {
    options.push({ value: 'pickup', label: 'Pickup', price: 'Free', hint: `Collect from ${shop.location || 'the shop'}` });
  }
  return options;
};

// Recalculates delivery and total when the customer switches delivery/pickup.
function checkoutSelection(form) {
  const methods = {};
  let deliveryTotal = 0;
  state.cart.shops.forEach((shop) => {
    const field = form.elements[`fulfil-${shop.shopId}`];
    const method = (field && field.value) || shop.defaultMethod;
    const courierField = form.elements[`courier-${shop.shopId}`];
    methods[shop.shopId] = { method, courierCompany: method === 'delivery' && courierField ? courierField.value : '' };
    if (method === 'delivery') deliveryTotal += shop.deliveryFee;
  });
  const total = Math.round((state.cart.subtotal + deliveryTotal) * 100) / 100;
  return { methods, deliveryTotal, total, needsAddress: Object.values(methods).some((entry) => entry.method === 'delivery') };
}

function updateCheckoutSummary() {
  const form = $('form[data-form="checkout"]');
  if (!form) return;
  const selection = checkoutSelection(form);
  $('#sumDelivery').textContent = selection.deliveryTotal ? formatMoney(selection.deliveryTotal) : 'Free';
  $('#sumTotal').textContent = formatMoney(selection.total);
  $('#placeOrderTotal').textContent = formatMoney(selection.total);
  const addressField = $('#addressField');
  addressField.hidden = !selection.needsAddress;
  addressField.querySelector('textarea').required = selection.needsAddress;
  state.cart.shops.forEach((shop) => {
    const courierSelect = form.elements[`courier-${shop.shopId}`];
    const courierField = courierSelect && courierSelect.closest('.courier-select');
    if (!courierField) return;
    const needsCourier = selection.methods[shop.shopId].method === 'delivery';
    courierField.hidden = !needsCourier;
    courierSelect.required = needsCourier;
  });
  const method = (form.elements.paymentMethod && form.elements.paymentMethod.value) || '';
  $('#protectNotice').hidden = method === 'cash_on_delivery';
  $('#codNotice').hidden = method !== 'cash_on_delivery';
}

async function viewCheckout({ id }) {
  if (!requireRole('customer')) return;
  setTitle('Checkout');
  setView(loader);
  const [, paymentInfo, courierData] = await Promise.all([loadCart(), loadPaymentInfo(), apiRequest('/api/couriers')]);
  state.courierCompanies = courierData.companies || DEFAULT_COURIER_COMPANIES;
  if (stale(id)) return;
  renderChrome();

  if (!state.cart.items.length) {
    setView(`<div class="container section">${emptyState({ iconName: 'cart', title: 'Your cart is empty', text: 'Add some products before checking out.', action: '<a href="/products" class="button button-primary">Browse products</a>' })}</div>`);
    return;
  }

  const remembered = readRemembered();
  const problems = state.cart.items.filter((item) => !item.available);
  const shops = state.cart.shops;
  const days = paymentInfo.protectionDays || PROTECTION_DAYS;
  const offered = PAYMENT_GROUPS.flatMap((group) => group.options.map((option) => option.value));
  const selectedMethod = offered.includes(remembered.paymentMethod) ? remembered.paymentMethod : 'mtn_mobile_money';

  setView(`
    <div class="container">
      <div class="page-head"><h1>Checkout</h1><p>Review your order, choose delivery and pay safely.</p></div>
      <form class="checkout-layout section-tight" data-form="checkout" novalidate>
        <div>
          <section class="card card-pad checkout-section">
            <h2><span class="step-num">1</span> Delivery</h2>
            ${shops.map((shop) => {
              const options = fulfilmentOptions(shop);
              return `
                <div class="fulfil-shop">
                  <div class="fulfil-shop-head"><strong>${h(shop.shopName)}</strong> ${verifiedBadge(shop.verified)}<span class="muted">${formatMoney(shop.subtotal)}</span></div>
                  <div class="option-grid">
                    ${options.map((option) => `
                      <label class="option-card">
                        <input type="radio" name="fulfil-${h(shop.shopId)}" value="${option.value}" data-change="checkout-summary" ${shop.defaultMethod === option.value ? 'checked' : ''} />
                        <span class="oc-icon">${icon(option.value === 'pickup' ? 'store' : 'truck')}</span>
                        <div><strong>${option.label} · ${h(option.price)}</strong><small>${h(option.hint)}</small></div>
                      </label>`).join('')}
                  </div>
                    ${options.some((option) => option.value === 'delivery') ? `
                      <label class="field courier-select" style="margin-top:12px">
                        <span>Delivery company</span>
                        <select name="courier-${h(shop.shopId)}" data-change="checkout-summary" required>
                          <option value="">Choose a courier</option>
                          ${state.courierCompanies.map((company) => `<option value="${h(company)}">${h(company)}</option>`).join('')}
                        </select>
                      </label>` : ''}
                </div>`;
            }).join('')}
            <div class="form-grid two" style="margin-top: 18px">
              <label class="field"><span>Full name</span><input type="text" value="${h(state.user.name)}" disabled /></label>
              <label class="field"><span>Phone / WhatsApp</span><input type="tel" name="contactPhone" autocomplete="tel" placeholder="097 123 4567" value="${h(remembered.contactPhone || '')}" /></label>
              <label class="field full" id="addressField"><span>Delivery address</span><textarea name="shippingAddress" rows="3" maxlength="300" autocomplete="street-address" placeholder="House/plot number, street, area, town" required>${h(remembered.shippingAddress || '')}</textarea></label>
              <label class="field full"><span>Note for the seller <span class="hint">· optional</span></span><input type="text" name="note" maxlength="500" placeholder="e.g. Call when you arrive at the gate" /></label>
            </div>
          </section>
          <section class="card card-pad checkout-section">
            <h2><span class="step-num">2</span> Payment</h2>
            ${PAYMENT_GROUPS.map((group) => `
              <div class="option-group-title">${h(group.title)}</div>
              <div class="option-grid">
                ${group.options.map((option) => `
                  <label class="option-card">
                    <input type="radio" name="paymentMethod" value="${option.value}" data-change="checkout-summary" ${selectedMethod === option.value ? 'checked' : ''} />
                    <span class="oc-icon">${h(option.badge)}</span>
                    <div><strong>${h(option.label)}</strong><small>${h(option.hint)}</small></div>
                  </label>`).join('')}
              </div>`).join('')}
            <div class="protect-box" id="protectNotice" style="margin-top: 18px">
              <div class="protect-icon">${icon('lock')}</div>
              <div>
                <strong>Protected payment</strong>
                <p>You pay ShopVerse, not the seller. We hold the money and only pay the seller after you confirm you received your order. If something is wrong, report it within ${days} days and you get your money back.</p>
              </div>
            </div>
            <div class="notice" id="codNotice" style="margin-top: 18px" hidden>${icon('info')}<span>Pay the shop in cash when your order arrives. Cash on delivery is not covered by protected payment.</span></div>
          </section>
        </div>
        <aside class="card card-pad summary-card">
          <h2 style="font-size: 1.1rem">Order summary</h2>
          <div class="summary-items">
            ${state.cart.items.map((item) => `
              <div class="summary-item">
                <div class="thumb thumb-sm">${mediaMarkup(item.image, item.productName)}</div>
                <div class="si-text"><strong>${h(item.productName)}</strong><span>${h(item.quantity)} × ${formatMoney(item.price)} · ${h(item.shopName)}</span></div>
                <strong>${formatMoney(item.lineTotal)}</strong>
              </div>`).join('')}
          </div>
          <div class="summary-row"><span>Subtotal</span><span>${formatMoney(state.cart.subtotal)}</span></div>
          <div class="summary-row"><span>Delivery</span><span id="sumDelivery">${state.cart.deliveryTotal ? formatMoney(state.cart.deliveryTotal) : 'Free'}</span></div>
          <div class="summary-row total"><span>Total</span><strong id="sumTotal">${formatMoney(state.cart.total)}</strong></div>
          ${shops.length > 1 ? `<p class="muted" style="font-size:.8rem;margin-top:10px">Your order includes ${shops.length} shops. Each one sends its items separately.</p>` : ''}
          ${problems.length ? `<div class="notice notice-warning" style="margin-top:14px">${icon('alert')}<span>Some items are no longer available in the quantity you chose. <button type="button" class="link" data-action="open-cart">Update your cart</button>.</span></div>` : ''}
          <button type="submit" class="button button-primary button-lg button-block" style="margin-top: 16px" ${problems.length ? 'disabled' : ''}>Place order · <span id="placeOrderTotal">${formatMoney(state.cart.total)}</span></button>
          <p class="muted" style="font-size:.78rem;text-align:center;margin-top:10px">You can cancel free of charge until the shop confirms.</p>
        </aside>
      </form>
    </div>`);
  updateCheckoutSummary();
}

async function submitCheckout(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const selection = checkoutSelection(form);
  const missingCourier = state.cart.shops.find((shop) => selection.methods[shop.shopId].method === 'delivery' && !selection.methods[shop.shopId].courierCompany);
  if (missingCourier) {
    toast(`Choose a delivery company for ${missingCourier.shopName}.`, 'error');
    form.elements[`courier-${missingCourier.shopId}`].focus();
    return;
  }
  if (selection.needsAddress && !String(data.shippingAddress || '').trim()) {
    toast('Please enter a delivery address.', 'error');
    form.elements.shippingAddress.focus();
    return;
  }
  const button = form.querySelector('[type=submit]');
  try {
    setBusy(button, true);
    const { order } = await apiRequest('/api/orders', {
      method: 'POST',
      body: {
        shippingAddress: selection.needsAddress ? data.shippingAddress : '',
        contactPhone: data.contactPhone,
        note: data.note,
        paymentMethod: data.paymentMethod,
        fulfilment: selection.methods
      }
    });
    try {
      defaultStorage()?.setItem(addressKey, JSON.stringify({
        shippingAddress: data.shippingAddress,
        contactPhone: data.contactPhone,
        paymentMethod: data.paymentMethod
      }));
    } catch (error) {
      // Remembering the address is a convenience only.
    }
    state.cart = { items: [], shops: [], itemCount: 0, subtotal: 0, deliveryTotal: 0, total: 0 };
    loadUnreadCount().then(renderChrome).catch(() => {});
    renderChrome();
    navigate(`/orders?placed=${encodeURIComponent(order.id)}`, { replace: true });
  } catch (error) {
    reportApiError(error);
    setBusy(button, false);
  }
}

// ---------------------------------------------------------------------------
// Views: customer orders
// ---------------------------------------------------------------------------

const progressMarkup = (status) => (status === 'cancelled' ? '' : `
  <div class="progress" aria-label="Order progress: ${h(status)}">
    ${ORDER_FLOW.map((step, index) => `<div class="progress-step ${index <= ORDER_FLOW.indexOf(status) ? 'done' : ''}">${step}</div>`).join('')}
  </div>`);

const paymentBox = (order) => {
  const instructions = order.paymentInstructions;
  if (order.canSubmitPayment && instructions) {
    const methodLabel = PAYMENT_LABELS[order.paymentMethod] || 'mobile money';
    return `
      <div class="pay-box">
        <div class="pay-box-head">${icon('wallet')}<strong>Complete your payment</strong></div>
        ${instructions.contactFirst
          ? `<p>ShopVerse will contact you${order.contactPhone ? ` on ${h(order.contactPhone)}` : ''} with payment details for ${h(methodLabel)}.</p>`
          : `<ol class="pay-steps">
              <li>Send <strong>${formatMoney(instructions.amount)}</strong> by ${h(methodLabel)} to <strong>${h(instructions.account)}</strong> (${h(instructions.accountName)}).</li>
              <li>Use reference <strong class="pay-ref">${h(instructions.reference)}</strong>.</li>
              <li>Enter the transaction ID from your confirmation message below.</li>
            </ol>`}
        <form class="pay-form" data-form="submit-payment" data-id="${h(order.id)}">
          <input type="text" name="transactionId" maxlength="60" placeholder="Transaction ID, e.g. MP240101.1234.A56789" aria-label="Transaction ID" required />
          <button type="submit" class="button button-primary button-sm">I've paid</button>
        </form>
        <p class="muted" style="font-size:.8rem">${icon('lock')} Your money is held by ShopVerse and only released to the seller after you receive your order.</p>
      </div>`;
  }
  if (order.paymentStatus === 'submitted') {
    return `<div class="notice">${icon('info')}<span>We're checking your payment${order.payment && order.payment.transactionId ? ` (transaction ${h(order.payment.transactionId)})` : ''}. You'll get a notification once it's confirmed.</span></div>`;
  }
  if (order.paymentStatus === 'held') {
    return `<div class="notice notice-success">${icon('lock')}<span><strong>Payment protected.</strong> ShopVerse is holding your money. The seller is paid after you confirm you received your order.</span></div>`;
  }
  if (order.paymentStatus === 'refund_due') {
    return `<div class="notice notice-warning">${icon('info')}<span>Your refund is being processed. ShopVerse will send the money back to you.</span></div>`;
  }
  return '';
};

const shipmentMarkup = (order, entry) => {
  const resolvedText = entry.dispute && entry.dispute.resolvedAt
    ? entry.dispute.resolution === 'refund' ? 'ShopVerse resolved your report with a refund.' : 'ShopVerse reviewed your report and released payment to the seller.'
    : '';
  return `
    <div class="shipment">
      <div class="shipment-head">
        <div><strong>${h(entry.shopName)}</strong>
          <span class="muted">${entry.method === 'pickup'
            ? `Pickup${entry.pickupLocation ? ` at ${h(entry.pickupLocation)}` : ''}`
            : `Delivery${entry.deliveryFee ? ` · ${formatMoney(entry.deliveryFee)}` : ' · free'}`}</span>
        </div>
        ${statusPill(entry.status)}
      </div>
      ${entry.dispute && !entry.dispute.resolvedAt ? `<p class="shipment-note warn">${icon('flag')} You reported a problem. Payment is on hold while ShopVerse reviews it.</p>` : ''}
      ${resolvedText ? `<p class="shipment-note">${h(resolvedText)}</p>` : ''}
      ${entry.courierCompany ? `<p class="shipment-note">${h(entry.courierCompany)}${entry.courierReceiptReference ? ` receipt ${h(entry.courierReceiptReference)}` : ''}${entry.courierDeliveredAt ? entry.adminDeliveryApprovedAt ? ' · receipt verified by ShopVerse' : ' · delivery reported, awaiting ShopVerse review' : ' · awaiting courier delivery confirmation'}</p>` : ''}
      ${entry.confirmedAt ? `<p class="shipment-note ok">${icon('checkCircle')} You confirmed receiving this on ${h(formatDate(entry.confirmedAt))}.</p>` : ''}
      ${entry.canConfirm && entry.autoConfirmAt && order.payment && order.payment.protected
        ? `<p class="shipment-note">Not received? Report it before ${h(formatDate(entry.autoConfirmAt))}, when payment is released automatically.</p>` : ''}
      <div class="shipment-actions">
        ${entry.canConfirm ? `<button type="button" class="button button-primary button-xs" data-action="confirm-receipt" data-id="${h(order.id)}" data-shop="${h(entry.shopId)}">${icon('check')} I received it</button>` : ''}
        ${entry.canDispute ? `<button type="button" class="button button-ghost button-xs" data-action="open-dispute" data-id="${h(order.id)}" data-shop="${h(entry.shopId)}" data-shop-name="${h(entry.shopName)}">${icon('flag')} Report a problem</button>` : ''}
        ${entry.whatsapp ? `<a class="button button-ghost button-xs" target="_blank" rel="noopener" href="${h(whatsappChatUrl(entry.whatsapp, `Hi ${entry.shopName}, about my ShopVerse order #${shortId(order.id)}`))}">${icon('whatsapp')} Message shop</a>` : ''}
      </div>
    </div>`;
};

async function viewOrders({ id, query }) {
  if (state.user && state.user.role === 'shop_owner') {
    navigate('/studio?tab=orders', { replace: true });
    return;
  }
  if (state.user && state.user.role === 'admin') {
    navigate('/admin?tab=payments', { replace: true });
    return;
  }
  if (!requireRole('customer')) return;
  setTitle('My orders');
  setView(loader);
  const { orders } = await apiRequest('/api/my-orders');
  if (stale(id)) return;
  const placed = query.get('placed');
  const placedOrder = placed && orders.find((order) => order.id === placed);

  setView(`
    <div class="container">
      <div class="page-head"><h1>My orders</h1><p>Pay, track deliveries and confirm when your items arrive.</p></div>
      ${placed ? `<div class="notice notice-success fade-up" style="margin: 16px 0 4px">${icon('checkCircle')}<span><strong>Thank you! Your order #${h(shortId(placed))} has been placed.</strong> ${
        placedOrder && placedOrder.canSubmitPayment ? 'Complete your payment below so the shop can send it.' : 'The shop will be in touch to arrange delivery.'}</span></div>` : ''}
      <div class="order-list section-tight">
        ${orders.length ? orders.map((order) => `
          <article class="card order-card" id="order-${h(order.id)}">
            <div class="order-head">
              <div class="order-head-meta">
                <div><span>Order</span><strong>#${h(shortId(order.id))}</strong></div>
                <div><span>Placed</span><strong>${h(formatDate(order.createdAt))}</strong></div>
                <div><span>Total</span><strong>${formatMoney(order.total)}</strong></div>
                <div><span>Payment</span><strong>${h(PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod)} · ${h(PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus)}</strong></div>
              </div>
              ${statusPill(order.status)}
            </div>
            ${progressMarkup(order.status)}
            <div class="order-body">
              <div class="order-lines">
                ${paymentBox(order)}
                ${order.items.map((item) => `
                  <div class="order-line">
                    <div class="thumb thumb-sm"><div class="placeholder-art">${h(initials(item.productName))}</div></div>
                    <div class="ol-text"><a href="/products/${encodeURIComponent(item.productId)}"><strong>${h(item.productName)}</strong></a><span>${h(item.shopName)} · Qty ${h(item.quantity)}</span></div>
                    <strong>${formatMoney(item.price * item.quantity)}</strong>
                  </div>`).join('')}
                ${order.deliveryTotal ? `<div class="order-line order-line-fee"><div class="ol-text">Delivery</div><strong>${formatMoney(order.deliveryTotal)}</strong></div>` : ''}
              </div>
              <div class="order-aside">
                ${order.shippingAddress ? `<div><h4>Deliver to</h4><p>${h(order.shippingAddress)}${order.contactPhone ? `\n${h(order.contactPhone)}` : ''}</p></div>` : ''}
                <div><h4>${order.fulfillments.length > 1 ? 'Shipments' : 'Shipment'}</h4><div class="shipment-list">${order.fulfillments.map((entry) => shipmentMarkup(order, entry)).join('')}</div></div>
              </div>
            </div>
            ${order.canCancel ? `
              <div class="order-foot">
                <span class="muted" style="font-size:.85rem">You can cancel until the shop confirms your order.</span>
                <button type="button" class="button button-danger-ghost button-sm" data-action="cancel-order" data-id="${h(order.id)}">Cancel order</button>
              </div>` : ''}
          </article>`).join('') : emptyState({ iconName: 'receipt', title: 'No orders yet', text: 'When you place an order it will appear here so you can track it.', action: '<a href="/products" class="button button-primary">Start shopping</a>' })}
      </div>
    </div>`);

  if (placed) $(`#order-${CSS.escape(placed)}`)?.scrollIntoView({ block: 'start' });
}

async function viewCourier({ id }) {
  if (!requireRole('courier')) return;
  setTitle('Courier deliveries');
  setView(loader);
  const { deliveries } = await apiRequest('/api/courier/deliveries');
  if (stale(id)) return;
  setView(`
    <div class="container">
      <div class="page-head"><h1>${h(state.user.courierCompany)} deliveries</h1><p>Confirm delivery only after checking the recipient and obtaining the courier receipt reference.</p></div>
      <div class="order-list section-tight">
        ${deliveries.length ? deliveries.map((delivery) => `
          <article class="card order-card">
            <div class="order-head">
              <div class="order-head-meta">
                <div><span>Order</span><strong>#${h(shortId(delivery.orderId))}</strong></div>
                <div><span>Shop</span><strong>${h(delivery.shopName)}</strong></div>
                <div><span>Customer</span><strong>${h(delivery.customerName)}</strong></div>
              </div>
              ${statusPill('shipped')}
            </div>
            <div class="order-body">
              <div><h4>Delivery address</h4><p>${h(delivery.shippingAddress || 'No address provided')}${delivery.customerPhone ? `<br>${h(delivery.customerPhone)}` : ''}</p></div>
              <div><h4>Items</h4><p>${delivery.items.map((item) => `${h(item.quantity)} × ${h(item.productName)}`).join('<br>')}</p></div>
            </div>
            <div class="order-foot"><span class="muted">Payment ref ${h(delivery.reference)}</span><button type="button" class="button button-primary button-sm" data-action="courier-confirm" data-id="${h(delivery.orderId)}" data-shop="${h(delivery.shopId)}">${icon('check')} Submit delivery receipt</button></div>
          </article>`).join('') : emptyState({ iconName: 'truck', title: 'No deliveries awaiting confirmation', text: 'New assigned deliveries will appear here after the shop marks them shipped.' })}
      </div>
    </div>`);
}

async function submitCourierReceipt(orderId, shopId) {
  const receiptReference = await promptText({
    title: 'Submit courier delivery receipt',
    message: 'Enter the receipt or delivery reference issued when the customer received the package.',
    label: 'Courier receipt/reference',
    placeholder: 'e.g. delivery receipt number',
    confirmLabel: 'Submit receipt',
    required: true
  });
  if (!receiptReference) return;
  try {
    await apiRequest(`/api/courier/orders/${encodeURIComponent(orderId)}/shops/${encodeURIComponent(shopId)}/delivered`, {
      method: 'POST',
      body: { receiptReference }
    });
    toast('Receipt submitted for ShopVerse review.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
  }
}

async function submitPayment(form) {
  const button = form.querySelector('[type=submit]');
  try {
    setBusy(button, true);
    await apiRequest(`/api/orders/${encodeURIComponent(form.dataset.id)}/payment`, {
      method: 'POST',
      body: { transactionId: new FormData(form).get('transactionId') }
    });
    toast("Thanks! We're checking your payment and will notify you once it's confirmed.", 'success');
    render();
  } catch (error) {
    reportApiError(error);
    setBusy(button, false);
  }
}

async function confirmReceipt(orderId, shopId) {
  const confirmed = await confirmDialog({
    title: 'Did you receive your order?',
    message: 'Confirm only if you have your items and they are as described. ShopVerse will then release payment to the seller.',
    confirmLabel: 'Yes, I received it'
  });
  if (!confirmed) return;
  try {
    await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/confirm`, { method: 'POST', body: { shopId } });
    toast('Thanks for confirming! Enjoy your order.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
  }
}

function openDispute(orderId, shopId, shopName) {
  const modal = openModal({
    title: 'Report a problem',
    subtitle: `With your order from ${shopName}. Payment stays on hold while ShopVerse reviews it.`,
    body: `
      <form class="form-grid" data-form="dispute" id="disputeForm" data-id="${h(orderId)}" data-shop="${h(shopId)}">
        <label class="field"><span>What went wrong?</span>
          <textarea name="reason" rows="4" maxlength="1000" required placeholder="e.g. The item never arrived, or it arrived damaged / different from the photos."></textarea>
        </label>
        <p class="muted" style="font-size:.85rem">ShopVerse will contact you and the seller, usually within 1–2 working days.</p>
      </form>`,
    foot: `<button type="button" class="button button-outline" data-modal-close>Cancel</button>
           <button type="submit" form="disputeForm" class="button button-danger">Report problem</button>`
  });
  return modal;
}

async function submitDispute(form) {
  const reason = String(new FormData(form).get('reason') || '').trim();
  if (!reason) {
    toast('Please describe the problem.', 'error');
    return;
  }
  const button = $('.modal-foot .button-danger');
  try {
    setBusy(button, true);
    await apiRequest(`/api/orders/${encodeURIComponent(form.dataset.id)}/dispute`, {
      method: 'POST',
      body: { shopId: form.dataset.shop, reason }
    });
    modalStack[modalStack.length - 1]?.close();
    toast('Problem reported. Payment is on hold and ShopVerse will be in touch.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
    setBusy(button, false);
  }
}

// ---------------------------------------------------------------------------
// Views: seller studio
// ---------------------------------------------------------------------------

async function viewStudio({ id, query }) {
  if (!requireRole('shop_owner')) return;
  const tab = ['products', 'orders', 'profile', 'grow'].includes(query.get('tab')) ? query.get('tab') : 'products';
  setTitle('Seller studio');
  if (!state.studio) setView(loader);

  const [dashboard, productsResult, ordersResult] = await Promise.all([
    apiRequest('/api/dashboard'),
    apiRequest('/api/my-products'),
    apiRequest('/api/shop-orders')
  ]);
  if (stale(id)) return;
  state.studio = { stats: dashboard.stats, products: productsResult.products, orders: ordersResult.orders, orderFilter: 'open' };
  const { stats } = state.studio;
  const user = state.user;
  const openOrders = state.studio.orders.filter((order) => !['delivered', 'cancelled'].includes(order.status)).length;

  setView(`
    <div class="container">
      <div class="studio-head">
        <div class="studio-identity" style="--accent-c: ${safeColor(user.shopThemeColor)}">
          <div class="shop-avatar">${avatarMarkup(user.shopProfileImage, user.shopName)}</div>
          <div><span class="eyebrow">Seller studio</span><h1>${h(user.shopName)} ${verifiedBadge(stats.verification === 'verified')}</h1></div>
        </div>
        <div class="button-row">
          <a href="/shops/${encodeURIComponent(user.id)}" class="button button-outline">${icon('store')} View storefront</a>
          <button type="button" class="button button-primary" data-action="new-product">${icon('plus')} Add product</button>
        </div>
      </div>
      ${query.get('welcome') ? `<div class="notice notice-success" style="margin-bottom:20px">${icon('sparkle')}<span><strong>Your shop is created!</strong> Next: <a class="link" href="/studio?tab=profile#verification">request verification</a> and add your products. Your shop goes live for buyers once ShopVerse verifies it.</span></div>` : ''}
      ${stats.suspended ? `
        <div class="notice notice-warning" style="margin-bottom:20px">${icon('alert')}<span><strong>Your shop has been suspended by ShopVerse.</strong>${stats.suspended.reason ? ` Reason: ${h(stats.suspended.reason)}.` : ''} Buyers can't see it and you can't add or edit products. Contact ShopVerse support.</span></div>` : ''}
      ${!stats.suspended && !stats.listed && stats.requireVerification && stats.verification === 'pending' ? `
        <div class="notice" style="margin-bottom:20px">${icon('info')}<span><strong>Your shop is waiting for verification.</strong> Buyers can't see it yet. Keep adding products: they go live as soon as ShopVerse verifies you.</span></div>` : ''}
      ${!stats.suspended && !stats.listed && stats.requireVerification && stats.verification !== 'pending' && stats.verification !== 'verified' ? `
        <div class="notice notice-warning" style="margin-bottom:20px">${icon('alert')}<span><strong>Your shop is hidden from buyers until it is verified.</strong> Only verified shops can sell on ShopVerse. <a class="link" href="/studio?tab=profile#verification">Request verification</a></span></div>` : ''}
      ${stats.blockedProductCount ? `
        <div class="notice notice-warning" style="margin-bottom:20px">${icon('alert')}<span><strong>${plural(stats.blockedProductCount, 'product')} hidden for breaking the rules.</strong> Illegal drugs cannot be sold or advertised on ShopVerse. Edit or delete the products marked "Blocked".</span></div>` : ''}
      <div class="kpi-grid">
        <div class="card kpi"><span>${icon('wallet')} Sales</span><strong>${formatMoney(stats.revenue)}</strong></div>
        <div class="card kpi"><span>${icon('receipt')} Open orders</span><strong>${h(stats.openOrderCount)}</strong></div>
        <div class="card kpi"><span>${icon('box')} Products</span><strong>${h(stats.shopProductCount)}</strong></div>
        <div class="card kpi"><span>${icon('star')} Rating</span><strong>${stats.reviewCount ? `${Number(stats.averageRating).toFixed(1)}<small class="muted" style="font-size:.85rem;font-weight:500"> / ${stats.reviewCount}</small>` : '–'}</strong></div>
        <div class="card kpi ${stats.lowStockCount ? 'alert' : ''}"><span>${icon('alert')} Low stock</span><strong>${h(stats.lowStockCount)}</strong></div>
      </div>
      <nav class="tabs" aria-label="Studio sections">
        <a href="/studio?tab=products" class="${tab === 'products' ? 'active' : ''}">Products<span class="tab-count">${state.studio.products.length}</span></a>
        <a href="/studio?tab=orders" class="${tab === 'orders' ? 'active' : ''}">Orders${openOrders ? `<span class="tab-count">${openOrders}</span>` : ''}</a>
        <a href="/studio?tab=profile" class="${tab === 'profile' ? 'active' : ''}">Shop profile</a>
        <a href="/studio?tab=grow" class="${tab === 'grow' ? 'active' : ''}">Share &amp; grow</a>
      </nav>
      <div id="studioPanel"></div>
    </div>`);

  if (tab === 'products') renderInventory();
  if (tab === 'orders') renderStudioOrders();
  if (tab === 'profile') {
    renderProfileTab();
    if (location.hash === '#verification') $('#verification')?.scrollIntoView({ behavior: 'smooth' });
  }
  if (tab === 'grow') renderGrowTab();
}

// The seller's own customers are ShopVerse's best marketing: give them ready-made sharing.
function renderGrowTab() {
  const panel = $('#studioPanel');
  if (!panel) return;
  const user = state.user;
  const shopPath = `/shops/${encodeURIComponent(user.id)}`;
  const shopUrl = absoluteUrl(shopPath);
  const productCount = state.studio.products.length;
  const statusText = `🛍️ ${user.shopName} is now on ShopVerse!\nBrowse everything we sell and order online. Pay safely with MoMo or Airtel Money; you only pay the seller once you receive your order.\n👉 ${shopUrl}`;
  const topProducts = state.studio.products.filter((product) => product.inStock).slice(0, 6);

  panel.innerHTML = `
    <div class="grow-layout">
      <section class="card card-pad">
        <h2 style="font-size:1.1rem">Your shop link</h2>
        <p class="muted" style="font-size:.875rem;margin:4px 0 14px">Put this link everywhere your customers already are: your WhatsApp status, Facebook page, Instagram bio and business cards.</p>
        <div class="link-box">
          <input type="text" readonly value="${h(shopUrl)}" aria-label="Your shop link" />
          <button type="button" class="button button-outline button-sm" data-action="copy-link" data-path="${h(shopPath)}">${icon('link')} Copy</button>
        </div>
        <div class="button-row" style="margin-top: 14px">
          <a class="button button-whatsapp" target="_blank" rel="noopener" href="${h(whatsappShareUrl(statusText))}">${icon('whatsapp')} Share on WhatsApp</a>
          <a class="button button-outline" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shopUrl)}">Share on Facebook</a>
        </div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.1rem">Ready-made WhatsApp status</h2>
        <p class="muted" style="font-size:.875rem;margin:4px 0 14px">Copy this and post it as your status, or send it to your customer groups.</p>
        <textarea class="status-text" readonly rows="6" aria-label="Status message">${h(statusText)}</textarea>
        <div class="button-row" style="margin-top: 12px">
          <button type="button" class="button button-outline button-sm" data-action="copy-text" data-text="${h(statusText)}">${icon('link')} Copy message</button>
        </div>
      </section>

      <section class="card card-pad grow-wide">
        <h2 style="font-size:1.1rem">Share individual products</h2>
        <p class="muted" style="font-size:.875rem;margin:4px 0 14px">Each link shows the product photo, name and price in WhatsApp.</p>
        ${topProducts.length ? `<div class="share-products">${topProducts.map((product) => `
          <div class="share-product">
            <div class="thumb thumb-sm" style="--accent-c:${safeColor(user.shopThemeColor)}">${mediaMarkup(product.image, product.name)}</div>
            <div class="si-text"><strong>${h(product.name)}</strong><span>${formatMoney(product.price)}</span></div>
            <a class="icon-button" target="_blank" rel="noopener" aria-label="Share ${h(product.name)} on WhatsApp"
               href="${h(whatsappShareUrl(`${product.name}: ${formatMoney(product.price)} at ${user.shopName}. Order safely on ShopVerse: ${absoluteUrl(`/products/${encodeURIComponent(product.id)}`)}`))}">${icon('whatsapp')}</a>
          </div>`).join('')}</div>` : `<p class="muted">Add products in stock to share them here.</p>`}
      </section>

      <section class="card card-pad grow-wide">
        <h2 style="font-size:1.1rem">Tips to get your first sales</h2>
        <ul class="tips">
          <li class="${productCount >= 5 ? 'done' : ''}">${icon(productCount >= 5 ? 'checkCircle' : 'box')}<div><strong>List at least 5 products</strong><span>${productCount >= 5 ? 'Done!' : `You have ${productCount}. Shops with more choice sell more.`}</span></div></li>
          <li class="${user.shopProfileImage ? 'done' : ''}">${icon(user.shopProfileImage ? 'checkCircle' : 'image')}<div><strong>Add your logo and a banner</strong><span>Shops with photos look trustworthy.</span></div></li>
          <li class="${state.studio.stats.verification === 'verified' ? 'done' : ''}">${icon(state.studio.stats.verification === 'verified' ? 'checkCircle' : 'shield')}<div><strong>Get verified</strong><span>The ✓ badge tells buyers you're a real, checked business.</span></div></li>
          <li class="${user.shopPhone ? 'done' : ''}">${icon(user.shopPhone ? 'checkCircle' : 'whatsapp')}<div><strong>Add your WhatsApp number</strong><span>Buyers can ask questions before they order.</span></div></li>
          <li>${icon('repeat')}<div><strong>Ask happy customers for a review</strong><span>Reviews are the #1 reason new buyers trust a shop.</span></div></li>
        </ul>
      </section>
    </div>`;
}

function renderInventory() {
  const panel = $('#studioPanel');
  if (!panel) return;
  const items = state.studio.products;

  if (!items.length) {
    panel.innerHTML = emptyState({
      title: 'Add your first product',
      text: 'Products you add appear in your storefront and across the marketplace straight away.',
      action: `<button type="button" class="button button-primary" data-action="new-product">${icon('plus')} Add product</button>`
    });
    return;
  }

  panel.innerHTML = `
    <div class="panel-head">
      <div><h2>Inventory</h2><p>Drag rows or use the arrows to choose the order customers see.</p></div>
    </div>
    <div class="card table-card" id="inventoryList">
      <div class="inventory-row head"><span></span><span></span><span>Product</span><span class="col-category">Category</span><span class="col-price">Price</span><span class="col-stock">Stock</span><span></span></div>
      ${items.map((product, index) => `
        <div class="inventory-row" data-row-id="${h(product.id)}">
          <span class="drag-handle" draggable="true" title="Drag to reorder" aria-hidden="true">${icon('grip')}</span>
          <div class="thumb thumb-sm" style="--accent-c:${safeColor(state.user.shopThemeColor)}">${mediaMarkup(product.image, product.name)}</div>
          <div class="inventory-name">
            <strong><a href="/products/${encodeURIComponent(product.id)}">${h(product.name)}</a></strong>
            <span>${product.hiddenReason === 'prohibited'
              ? '<span class="badge badge-danger">Blocked: prohibited item</span>'
              : product.reviewCount ? `${Number(product.averageRating).toFixed(1)} ★ · ${plural(product.reviewCount, 'review')}` : 'No reviews yet'}</span>
            <span class="mobile-meta">${formatMoney(product.price)} · ${h(product.stock)} in stock</span>
          </div>
          <span class="col-category"><span class="badge">${h(product.category)}</span></span>
          <strong class="col-price">${formatMoney(product.price)}</strong>
          <span class="col-stock">${product.stock === 0 ? '<span class="badge badge-danger">Sold out</span>' : product.lowStock ? `<span class="badge badge-warning">${h(product.stock)} left</span>` : h(product.stock)}</span>
          <div class="row-actions">
            <button type="button" class="icon-button icon-button-sm" data-action="move-product" data-id="${h(product.id)}" data-dir="-1" aria-label="Move ${h(product.name)} up" ${index === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button type="button" class="icon-button icon-button-sm" data-action="move-product" data-id="${h(product.id)}" data-dir="1" aria-label="Move ${h(product.name)} down" ${index === items.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
            <button type="button" class="icon-button icon-button-sm" data-action="edit-product" data-id="${h(product.id)}" aria-label="Edit ${h(product.name)}">${icon('edit')}</button>
            <button type="button" class="icon-button icon-button-sm" data-action="delete-product" data-id="${h(product.id)}" aria-label="Delete ${h(product.name)}">${icon('trash')}</button>
          </div>
        </div>`).join('')}
    </div>`;
  wireInventoryDrag();
}

function wireInventoryDrag() {
  const list = $('#inventoryList');
  if (!list) return;
  let dragging = null;

  list.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.inventory-row');
    if (!row) return;
    dragging = row;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.rowId);
    event.dataTransfer.setDragImage(row, 20, 20);
  });

  list.addEventListener('dragover', (event) => {
    const row = event.target.closest('.inventory-row:not(.head)');
    if (!dragging || !row || row === dragging) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    list.insertBefore(dragging, event.clientY < rect.top + rect.height / 2 ? row : row.nextSibling);
  });

  list.addEventListener('dragend', () => {
    if (!dragging) return;
    dragging.classList.remove('is-dragging');
    dragging = null;
    const ids = $$('.inventory-row[data-row-id]', list).map((row) => row.dataset.rowId);
    if (ids.join() !== state.studio.products.map((product) => product.id).join()) saveProductOrder(ids);
  });
}

async function saveProductOrder(ids) {
  const previous = state.studio.products;
  try {
    const result = await apiRequest('/api/my-products/order', { method: 'PUT', body: { productIds: ids } });
    state.studio.products = result.products;
    renderInventory();
    toast('Storefront order saved.', 'success');
  } catch (error) {
    state.studio.products = previous;
    renderInventory();
    reportApiError(error);
  }
}

function openProductEditor(productId) {
  const product = productId ? state.studio.products.find((item) => item.id === productId) : null;
  const image = product && safeImageUrl(product.image);
  const modal = openModal({
    title: product ? 'Edit product' : 'Add a product',
    subtitle: product ? 'Changes go live immediately.' : 'It will appear in your storefront straight away.',
    size: 'wide',
    body: `
      <form class="product-editor" data-form="product" id="productEditorForm" data-id="${h(productId || '')}" novalidate>
        <div class="field">
          <span class="field-label">Photo</span>
          <div class="image-drop" id="editorImagePreview" style="--accent-c:${safeColor(state.user.shopThemeColor)}">${image ? `<img src="${h(image)}" alt="" />` : `<div class="placeholder-art">${icon('image')}</div>`}</div>
          <input type="file" name="imageFile" accept="image/png,image/jpeg,image/gif,image/webp" data-change="preview-image" data-target="#editorImagePreview" />
          ${image ? '<label class="toggle" style="font-size:.8rem"><input type="checkbox" name="removeImage" /> Remove current photo</label>' : ''}
        </div>
        <div class="form-grid two">
          <label class="field full"><span>Product name</span><input type="text" name="name" maxlength="120" required value="${h(product ? product.name : '')}" placeholder="e.g. Handwoven basket" /></label>
          <label class="field"><span>Price (ZMW)</span><input type="number" name="price" min="0" step="0.01" required value="${h(product ? product.price : '')}" placeholder="0.00" /></label>
          <label class="field"><span>Stock</span><input type="number" name="stock" min="0" step="1" required value="${h(product ? product.stock : '')}" placeholder="Quantity available" /></label>
          <label class="field full"><span>Category</span>
            <input type="text" name="category" list="categorySuggestions" maxlength="40" required value="${h(product ? product.category : '')}" placeholder="Choose or type a category" />
            <datalist id="categorySuggestions">${CATEGORY_SUGGESTIONS.map((category) => `<option value="${h(category)}"></option>`).join('')}</datalist>
          </label>
          <label class="field full"><span>Description</span><textarea name="description" rows="4" maxlength="2000" placeholder="Materials, size, what's included…">${h(product ? product.description : '')}</textarea></label>
          <p class="muted full" style="font-size:.8rem">${icon('shield')} Illegal drugs (including cocaine, weed/dagga, heroin and mandrax) cannot be sold or advertised on ShopVerse. Such listings are refused and reported to ShopVerse admins.</p>
        </div>
      </form>`,
    foot: `<button type="button" class="button button-outline" data-modal-close>Cancel</button>
           <button type="submit" form="productEditorForm" class="button button-primary">${product ? 'Save changes' : 'Add product'}</button>`
  });
  return modal;
}

async function submitProduct(form) {
  const productId = form.dataset.id;
  const data = new FormData(form);
  const button = $('.modal-foot .button-primary');
  const payload = {
    name: data.get('name'),
    category: data.get('category'),
    description: data.get('description'),
    price: data.get('price') === '' ? undefined : Number(data.get('price')),
    stock: data.get('stock') === '' ? undefined : Number(data.get('stock'))
  };

  try {
    setBusy(button, true);
    const file = data.get('imageFile');
    if (file && file.size) payload.image = await imageFileToDataUrl(file, 1600);
    else if (data.get('removeImage')) payload.image = null;

    await apiRequest(productId ? `/api/products/${encodeURIComponent(productId)}` : '/api/products', {
      method: productId ? 'PUT' : 'POST',
      body: payload
    });
    modalStack[modalStack.length - 1]?.close();
    toast(productId ? 'Product updated.' : 'Product added to your shop.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
    setBusy(button, false);
  }
}

async function deleteProduct(productId) {
  const product = state.studio.products.find((item) => item.id === productId);
  if (!product) return;
  const confirmed = await confirmDialog({
    title: 'Delete this product?',
    message: `"${product.name}" will be removed from your shop and from customers' carts. Past orders are not affected.`,
    confirmLabel: 'Delete product',
    danger: true
  });
  if (!confirmed) return;
  try {
    await apiRequest(`/api/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
    toast('Product deleted.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
  }
}

function renderStudioOrders() {
  const panel = $('#studioPanel');
  if (!panel) return;
  const { orders, orderFilter } = state.studio;
  const filters = {
    open: (order) => !['delivered', 'cancelled'].includes(order.status),
    delivered: (order) => order.status === 'delivered',
    cancelled: (order) => order.status === 'cancelled',
    all: () => true
  };
  const list = orders.filter(filters[orderFilter]);
  const { stats } = state.studio;

  panel.innerHTML = `
    <div class="payout-strip">
      <div><span>${icon('lock')} Held for you</span><strong>${formatMoney(stats.payoutHeld)}</strong><small>Paid out after customers receive their orders</small></div>
      <div><span>${icon('wallet')} Ready to pay out</span><strong>${formatMoney(stats.payoutReady)}</strong><small>ShopVerse is sending this to you</small></div>
      <div><span>${icon('checkCircle')} Paid out</span><strong>${formatMoney(stats.payoutPaid)}</strong><small>Already sent to you</small></div>
    </div>
    <div class="panel-head">
      <div><h2>Orders</h2><p>Ship once payment is secured, then update the status. Customers are notified automatically.</p></div>
      <div class="chip-row">
        ${[['open', 'Open'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([key, label]) => `
          <button type="button" class="chip ${orderFilter === key ? 'active' : ''}" data-action="order-filter" data-filter="${key}">${label} <small>${orders.filter(filters[key]).length}</small></button>`).join('')}
      </div>
    </div>
    <div class="order-list">
      ${list.length ? list.map((order) => {
        const final = ['delivered', 'cancelled'].includes(order.status);
        const payout = PAYOUT_LABELS[order.payout.state] || PAYOUT_LABELS.held;
        return `
        <article class="card order-card">
          <div class="order-head">
            <div class="order-head-meta">
              <div><span>Order</span><strong>#${h(shortId(order.id))}</strong></div>
              <div><span>Placed</span><strong>${h(timeAgo(order.createdAt))}</strong></div>
              <div><span>Customer</span><strong>${h(order.customerName)}</strong></div>
              <div><span>You receive</span><strong>${formatMoney(order.payout.net)}</strong></div>
            </div>
            ${statusPill(order.status)}
          </div>
          <div class="payout-banner tone-${payout.tone || 'neutral'}">
            ${icon(order.payout.state === 'awaiting_payment' ? 'alert' : order.payout.state === 'on_hold' ? 'flag' : 'lock')}
            <div><strong>${h(payout.label)}</strong><span>${h(payout.hint)}${
              order.payout.state === 'held' && order.payout.autoReleaseAt ? ` Releases automatically on ${h(formatDate(order.payout.autoReleaseAt))} unless the customer reports a problem.` : ''}${
              order.dispute && !order.dispute.resolvedAt ? ` Customer says: “${h(order.dispute.reason)}”` : ''}</span></div>
          </div>
          <div class="order-body">
            <div class="order-lines">
              ${order.items.map((item) => `
                <div class="order-line">
                  <div class="thumb thumb-sm" style="--accent-c:${safeColor(state.user.shopThemeColor)}"><div class="placeholder-art">${h(initials(item.productName))}</div></div>
                  <div class="ol-text"><strong>${h(item.productName)}</strong><span>${formatMoney(item.price)} × ${h(item.quantity)}</span></div>
                  <strong>${formatMoney(item.price * item.quantity)}</strong>
                </div>`).join('')}
              ${order.deliveryFee ? `<div class="order-line order-line-fee"><div class="ol-text">Delivery fee</div><strong>${formatMoney(order.deliveryFee)}</strong></div>` : ''}
              ${order.payout.commission ? `<div class="order-line order-line-fee"><div class="ol-text">ShopVerse commission</div><strong>−${formatMoney(order.payout.commission)}</strong></div>` : ''}
            </div>
            <div class="order-aside">
              <div><h4>${order.method === 'pickup' ? 'Customer collects' : 'Deliver to'}</h4><p>${order.method === 'pickup' ? 'Pickup from your shop' : h(order.shippingAddress || '')}</p></div>
              ${order.courierCompany ? `<div><h4>Delivery company</h4><p>${h(order.courierCompany)}${order.courierReceiptReference ? `<br>Receipt ${h(order.courierReceiptReference)}` : ''}${order.courierDeliveredAt ? order.adminDeliveryApprovedAt ? '<br>Delivery verified by ShopVerse' : '<br>Receipt awaiting ShopVerse review' : ''}</p></div>` : ''}
              ${order.contactPhone ? `<div><h4>Customer phone</h4><p><a class="link" href="tel:${h(order.contactPhone.replace(/[^\d+]/g, ''))}">${h(order.contactPhone)}</a>${
                order.whatsapp ? ` · <a class="link" target="_blank" rel="noopener" href="${h(whatsappChatUrl(order.whatsapp, `Hi ${order.customerName}, this is ${state.user.shopName} about your ShopVerse order #${shortId(order.id)}.`))}">WhatsApp</a>` : ''}</p></div>` : ''}
              <div><h4>Payment</h4><p>${h(PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod)}</p></div>
              ${order.note ? `<div><h4>Customer note</h4><p>${h(order.note)}</p></div>` : ''}
            </div>
          </div>
          <div class="order-foot">
            <span class="muted" style="font-size:.85rem">${final ? `This order is ${h(order.status)}.` : 'Update status'}</span>
            <select data-change="order-status" data-id="${h(order.id)}" aria-label="Order status" style="width:auto;min-width:170px" ${final ? 'disabled' : ''}>
              ${ORDER_STATUSES.map((status) => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${status[0].toUpperCase()}${status.slice(1)}</option>`).join('')}
            </select>
          </div>
        </article>`;
      }).join('') : emptyState({ iconName: 'receipt', title: orderFilter === 'open' ? 'No open orders' : 'Nothing here yet', text: orderFilter === 'open' ? 'New orders will appear here. Share your storefront link to get your first sale.' : '' })}
    </div>`;
}

async function updateOrderStatus(select) {
  const order = state.studio.orders.find((entry) => entry.id === select.dataset.id);
  const status = select.value;
  if (status === 'cancelled') {
    const confirmed = await confirmDialog({
      title: 'Cancel this order?',
      message: 'The items will go back into stock and the customer will be notified. This cannot be undone.',
      confirmLabel: 'Cancel order',
      danger: true
    });
    if (!confirmed) {
      select.value = order.status;
      return;
    }
  }
  try {
    select.disabled = true;
    const result = await apiRequest(`/api/orders/${encodeURIComponent(order.id)}/status`, { method: 'PATCH', body: { status } });
    Object.assign(order, result.order);
    toast(`Order #${shortId(order.id)} marked as ${status}.`, 'success');
    renderStudioOrders();
  } catch (error) {
    select.value = order.status;
    select.disabled = false;
    reportApiError(error);
  }
}

function renderProfileTab() {
  const panel = $('#studioPanel');
  if (!panel) return;
  const user = state.user;
  const delivery = { enabled: true, fee: 0, freeOver: null, areas: '', pickup: false, ...(user.delivery || {}) };
  panel.innerHTML = `
    <div class="profile-layout">
      <form class="card card-pad form-grid" data-form="shop-profile" id="shopProfileForm" novalidate>
        <div><h2 style="font-size:1.1rem">Shop profile</h2><p class="muted" style="font-size:.875rem;margin-top:4px">This is what customers see on your storefront and shop card.</p></div>
        <div class="form-grid two">
          <label class="field"><span>Shop name</span><input type="text" name="shopName" maxlength="80" required value="${h(user.shopName || '')}" data-change="profile-preview" /></label>
          <label class="field"><span>Location</span><input type="text" name="shopLocation" maxlength="120" required value="${h(user.shopLocation || '')}" data-change="profile-preview" /></label>
          <label class="field full"><span>Description</span><textarea name="shopDescription" rows="3" maxlength="600" data-change="profile-preview">${h(user.shopDescription || '')}</textarea></label>
          <label class="field"><span>Logo <span class="hint">· square works best</span></span><input type="file" name="profileFile" accept="image/png,image/jpeg,image/gif,image/webp" data-change="profile-preview" /></label>
          <label class="field"><span>Banner <span class="hint">· wide image</span></span><input type="file" name="bannerFile" accept="image/png,image/jpeg,image/gif,image/webp" data-change="profile-preview" /></label>
          <div class="field full">
            <span class="field-label">Brand colour</span>
            <div class="color-field">
              <input type="color" name="shopThemeColor" value="${h(safeColor(user.shopThemeColor))}" data-change="profile-preview" aria-label="Brand colour" />
              <div class="color-swatches">${THEME_PRESETS.map((color) => `<button type="button" style="background:${color}" data-action="set-color" data-color="${color}" aria-label="Use ${color}"></button>`).join('')}</div>
            </div>
          </div>
          <label class="field full"><span>WhatsApp number <span class="hint">· buyers can message you before ordering</span></span>
            <input type="tel" name="shopPhone" maxlength="30" placeholder="097 123 4567" value="${h(user.shopPhone || '')}" /></label>
        </div>

        <fieldset class="settings-group">
          <legend>Delivery &amp; pickup</legend>
          <div class="form-grid two">
            <label class="toggle full"><input type="checkbox" name="deliveryEnabled" ${delivery.enabled ? 'checked' : ''} /> I deliver to customers</label>
            <label class="field"><span>Delivery fee (ZMW) <span class="hint">· 0 for free</span></span><input type="number" name="deliveryFee" min="0" step="0.01" value="${h(delivery.fee)}" /></label>
            <label class="field"><span>Free delivery over (ZMW) <span class="hint">· optional</span></span><input type="number" name="deliveryFreeOver" min="0" step="0.01" value="${h(delivery.freeOver ?? '')}" placeholder="e.g. 500" /></label>
            <label class="field full"><span>Where you deliver</span><input type="text" name="deliveryAreas" maxlength="200" value="${h(delivery.areas)}" placeholder="e.g. Lusaka same day; other towns by bus parcel" /></label>
            <label class="toggle full"><input type="checkbox" name="pickup" ${delivery.pickup ? 'checked' : ''} /> Customers can collect from my shop for free</label>
          </div>
        </fieldset>
        <div class="form-actions"><button type="submit" class="button button-primary">Save profile</button></div>
      </form>
      <div class="preview-sticky">
        <div class="preview-label">Live preview</div>
        <div id="profilePreview"></div>
      </div>
    </div>
    ${verificationCard(user)}`;
  updateProfilePreview();
}

function verificationCard(user) {
  const verification = user.verification || { status: 'none' };
  const states = {
    verified: `<div class="notice notice-success">${icon('checkCircle')}<span><strong>Your shop is verified.</strong> The ✓ Verified badge shows on your storefront, products and in search.</span></div>`,
    pending: `<div class="notice">${icon('info')}<span><strong>Verification requested${verification.submittedAt ? ` on ${h(formatDate(verification.submittedAt))}` : ''}.</strong> ShopVerse will review your details, usually within 2 working days, and may contact you on WhatsApp.</span></div>`,
    rejected: `<div class="notice notice-warning">${icon('alert')}<span><strong>Verification was not approved.</strong>${verification.reviewNote ? ` ${h(verification.reviewNote)}` : ''} Update your details below and apply again.</span></div>`
  };
  const canApply = verification.status === 'none' || verification.status === 'rejected';
  return `
    <section class="card card-pad verification-card" id="verification">
      <div class="panel-head" style="margin-bottom: 10px">
        <div><h2>${icon('shield')} Seller verification</h2><p>Only verified shops can sell on ShopVerse. Once verified, your shop and products become visible to buyers with a ✓ badge.</p></div>
        ${verifiedBadge(verification.status === 'verified')}
      </div>
      ${states[verification.status] || ''}
      ${canApply ? `
        <form class="form-grid two" data-form="verification" style="margin-top: 14px" novalidate>
          <label class="field"><span>Registered business or trading name</span><input type="text" name="businessName" maxlength="120" required value="${h(verification.businessName || user.shopName || '')}" /></label>
          <label class="field"><span>NRC or PACRA number</span><input type="text" name="idNumber" maxlength="40" required value="${h(verification.idNumber || '')}" placeholder="e.g. 123456/10/1" /></label>
          <label class="field"><span>WhatsApp number</span><input type="tel" name="phone" maxlength="30" required value="${h(user.shopPhone || '')}" placeholder="097 123 4567" /></label>
          <label class="field"><span>Anything else? <span class="hint">· optional</span></span><input type="text" name="note" maxlength="500" placeholder="e.g. Market stall number, years trading" /></label>
          <div class="form-actions full"><button type="submit" class="button button-primary">Request verification</button></div>
        </form>` : ''}
    </section>`;
}

async function submitVerification(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('[type=submit]');
  try {
    setBusy(button, true);
    const { user } = await apiRequest('/api/me/verification', { method: 'POST', body: data });
    state.user = user;
    saveSession(user, null);
    toast('Verification requested. ShopVerse will review it shortly.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
    setBusy(button, false);
  }
}

const previewImages = { profile: null, banner: null };

async function updateProfilePreview(changedInput) {
  const form = $('#shopProfileForm');
  const preview = $('#profilePreview');
  if (!form || !preview) return;

  if (changedInput && changedInput.type === 'file' && changedInput.files[0]) {
    const key = changedInput.name === 'profileFile' ? 'profile' : 'banner';
    if (previewImages[key]) URL.revokeObjectURL(previewImages[key]);
    previewImages[key] = URL.createObjectURL(changedInput.files[0]);
  }

  const data = new FormData(form);
  const user = state.user;
  preview.innerHTML = shopCard({
    id: user.id,
    name: data.get('shopName') || 'Your shop',
    description: data.get('shopDescription'),
    location: data.get('shopLocation') || 'Your location',
    themeColor: data.get('shopThemeColor'),
    profileImage: user.shopProfileImage,
    bannerImage: user.shopBannerImage,
    productCount: state.studio ? state.studio.products.length : 0,
    categories: state.studio ? [...new Set(state.studio.products.map((product) => product.category))] : []
  }).replace('href="/shops/', 'tabindex="-1" href="/shops/');

  const card = preview.querySelector('.shop-card');
  if (previewImages.profile) card.querySelector('.shop-avatar').innerHTML = `<img src="${previewImages.profile}" alt="" />`;
  if (previewImages.banner) card.querySelector('.shop-banner').style.backgroundImage = `url("${previewImages.banner}")`;
}

async function submitShopProfile(form) {
  const data = new FormData(form);
  const button = form.querySelector('[type=submit]');
  const payload = {
    shopName: data.get('shopName'),
    shopLocation: data.get('shopLocation'),
    shopDescription: data.get('shopDescription'),
    shopThemeColor: data.get('shopThemeColor'),
    shopPhone: data.get('shopPhone'),
    delivery: {
      enabled: data.get('deliveryEnabled') === 'on',
      fee: data.get('deliveryFee') || 0,
      freeOver: data.get('deliveryFreeOver') || null,
      areas: data.get('deliveryAreas'),
      pickup: data.get('pickup') === 'on'
    }
  };
  try {
    setBusy(button, true);
    const profileFile = data.get('profileFile');
    const bannerFile = data.get('bannerFile');
    if (profileFile && profileFile.size) payload.shopProfileImage = await imageFileToDataUrl(profileFile, 512);
    if (bannerFile && bannerFile.size) payload.shopBannerImage = await imageFileToDataUrl(bannerFile, 1920);

    const { user } = await apiRequest('/api/me', { method: 'PATCH', body: payload });
    state.user = user;
    saveSession(user, null);
    previewImages.profile = null;
    previewImages.banner = null;
    renderChrome();
    toast('Shop profile saved.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
    setBusy(button, false);
  }
}

// ---------------------------------------------------------------------------
// Views: admin (verification, protected payments, payouts, disputes, metrics)
// ---------------------------------------------------------------------------

const percentText = (value) => (value === null || value === undefined ? '–' : `${value}%`);

async function viewAdmin({ id, query }) {
  if (!requireRole()) return;
  if (!state.user.isAdmin) {
    viewNotFound();
    return;
  }
  const tab = ['overview', 'sellers', 'payments', 'couriers'].includes(query.get('tab')) ? query.get('tab') : 'overview';
  setTitle('Admin');
  setView(loader);

  const [overview, sellers, payments, couriers] = await Promise.all([
    apiRequest('/api/admin/overview'),
    apiRequest('/api/admin/sellers'),
    apiRequest('/api/admin/payments'),
    apiRequest('/api/admin/couriers')
  ]);
  if (stale(id)) return;
  state.admin = { metrics: overview.metrics, sellers: sellers.sellers, payments, couriers };
  const m = overview.metrics;
  const paymentTasks = payments.toConfirm.length + payments.payouts.length + payments.refunds.length + payments.disputes.length + payments.deliveryConfirmations.length;

  setView(`
    <div class="container">
      <div class="studio-head">
        <div><span class="eyebrow">ShopVerse admin</span><h1 style="font-size:1.6rem">Marketplace control room</h1></div>
        <button type="button" class="button button-outline" data-action="refresh">${icon('repeat')} Refresh</button>
      </div>
      <nav class="tabs" aria-label="Admin sections" style="margin-top:0">
        <a href="/admin?tab=overview" class="${tab === 'overview' ? 'active' : ''}">Overview</a>
        <a href="/admin?tab=sellers" class="${tab === 'sellers' ? 'active' : ''}">Sellers${m.pendingVerifications ? `<span class="tab-count">${m.pendingVerifications}</span>` : ''}</a>
        <a href="/admin?tab=payments" class="${tab === 'payments' ? 'active' : ''}">Payments${paymentTasks ? `<span class="tab-count">${paymentTasks}</span>` : ''}</a>
        <a href="/admin?tab=couriers" class="${tab === 'couriers' ? 'active' : ''}">Delivery companies</a>
      </nav>
      <div id="adminPanel"></div>
    </div>`);

  if (tab === 'overview') renderAdminOverview();
  if (tab === 'sellers') renderAdminSellers();
  if (tab === 'payments') renderAdminPayments();
  if (tab === 'couriers') renderAdminCouriers();
}

function renderAdminOverview() {
  const m = state.admin.metrics;
  const trend = m.ordersLastWeek ? Math.round(((m.ordersThisWeek - m.ordersLastWeek) / m.ordersLastWeek) * 100) : null;
  const attention = [
    [m.paymentsToConfirm, 'payments to confirm', '/admin?tab=payments', 'wallet'],
    [m.payoutsReadyCount, `payouts ready (${formatMoney(m.payoutsReadyAmount)})`, '/admin?tab=payments', 'checkCircle'],
    [m.refundsDue, 'refunds due', '/admin?tab=payments', 'repeat'],
    [m.disputesOpen, 'open disputes', '/admin?tab=payments', 'flag'],
    [m.pendingVerifications, 'sellers waiting for verification', '/admin?tab=sellers', 'shield']
  ].filter(([count]) => count > 0);

  $('#adminPanel').innerHTML = `
    <div class="panel-head"><div><h2>Growth</h2><p>The numbers that show whether ShopVerse is working.</p></div></div>
    <div class="kpi-grid admin-kpis">
      <div class="card kpi"><span>${icon('store')} Active sellers</span><strong>${h(m.activeSellers)}<small class="muted kpi-sub"> / ${h(m.sellers)}</small></strong><small class="kpi-note">5+ products listed</small></div>
      <div class="card kpi"><span>${icon('shield')} Verified sellers</span><strong>${h(m.verifiedSellers)}</strong><small class="kpi-note">${h(m.pendingVerifications)} waiting</small></div>
      <div class="card kpi"><span>${icon('receipt')} Orders this week</span><strong>${h(m.ordersThisWeek)}</strong><small class="kpi-note">${trend === null ? `${h(m.ordersLastWeek)} last week` : `${trend >= 0 ? '+' : ''}${trend}% vs last week`}</small></div>
      <div class="card kpi"><span>${icon('truck')} Completion rate</span><strong>${percentText(m.completionRate)}</strong><small class="kpi-note">Delivered vs cancelled</small></div>
      <div class="card kpi"><span>${icon('repeat')} Repeat buyers</span><strong>${percentText(m.repeatBuyerRate)}</strong><small class="kpi-note">Bought 2+ times</small></div>
    </div>
    <div class="kpi-grid admin-kpis" style="margin-top:14px">
      <div class="card kpi"><span>${icon('chart')} Sales, last 30 days</span><strong>${formatMoney(m.sales30Days)}</strong><small class="kpi-note">${formatMoney(m.salesAllTime)} all time</small></div>
      <div class="card kpi"><span>${icon('lock')} Money held</span><strong>${formatMoney(m.heldAmount)}</strong><small class="kpi-note">Protected payments not yet paid out</small></div>
      <div class="card kpi"><span>${icon('wallet')} Commission earned</span><strong>${formatMoney(m.commissionEarned)}</strong><small class="kpi-note">Rate: ${h(m.commissionPercent)}%</small></div>
      <div class="card kpi"><span>${icon('users')} Customers</span><strong>${h(m.customers)}</strong><small class="kpi-note">Registered accounts</small></div>
      <div class="card kpi"><span>${icon('box')} Products</span><strong>${h(m.products)}</strong><small class="kpi-note">Listed across all shops</small></div>
    </div>
    <section class="card card-pad" style="margin-top:20px">
      <h2 style="font-size:1.05rem;margin-bottom:12px">Needs your attention</h2>
      ${attention.length ? `<ul class="attention-list">${attention.map(([count, label, href, iconName]) => `
        <li><a href="${href}">${icon(iconName)}<strong>${h(count)}</strong> ${h(label)} <span class="link">Open →</span></a></li>`).join('')}</ul>`
        : `<p class="muted">${icon('checkCircle')} All caught up.</p>`}
    </section>`;
}

function renderAdminSellers() {
  const { sellers } = state.admin;
  const statusTone = { verified: 'badge-success', pending: 'badge-warning', rejected: 'badge-danger', none: '' };
  $('#adminPanel').innerHTML = `
    <div class="panel-head"><div><h2>Sellers</h2><p>Check each request before approving: call or WhatsApp the seller, and confirm the NRC/PACRA details.</p></div></div>
    <div class="order-list">
      ${sellers.length ? sellers.map((seller) => {
        const v = seller.verification;
        return `
          <article class="card seller-row">
            <div class="seller-main">
              <div class="shop-avatar" style="--accent-c:${safeColor(seller.shopThemeColor)}">${avatarMarkup(seller.shopProfileImage, seller.shopName)}</div>
              <div>
                <strong><a class="link" href="/shops/${encodeURIComponent(seller.id)}">${h(seller.shopName)}</a></strong> ${verifiedBadge(v.status === 'verified', { compact: true })}
                <div class="meta-row">
                  <span>${icon('user')} ${h(seller.name)}</span>
                  <span>${icon('pin')} ${h(seller.shopLocation || '–')}</span>
                  ${seller.shopPhone ? `<span>${icon('whatsapp')} <a class="link" target="_blank" rel="noopener" href="${h(whatsappChatUrl(seller.shopPhone.replace(/\D/g, ''), `Hi ${seller.name}, this is ShopVerse about your shop ${seller.shopName}.`))}">${h(seller.shopPhone)}</a></span>` : ''}
                  <span>${icon('box')} ${h(seller.productCount)} products</span>
                  <span>${icon('receipt')} ${h(seller.orderCount)} orders · ${h(seller.deliveredCount)} delivered${seller.disputeCount ? ` · ${h(seller.disputeCount)} disputes` : ''}</span>
                </div>
              </div>
              ${seller.suspended
                ? '<span class="badge badge-danger">suspended</span>'
                : `<span class="badge ${statusTone[v.status] || ''}">${h(v.status === 'none' ? 'not verified' : v.status)}</span>`}
            </div>
            ${seller.suspended ? `<p class="dispute-reason">${icon('alert')} Suspended ${h(formatDate(seller.suspended.at))}${seller.suspended.reason ? `: ${h(seller.suspended.reason)}` : ''}</p>` : ''}
            ${v.status === 'pending' ? `
              <div class="seller-request">
                <div><span>Business name</span><strong>${h(v.businessName || '–')}</strong></div>
                <div><span>NRC / PACRA</span><strong>${h(v.idNumber || '–')}</strong></div>
                <div><span>Requested</span><strong>${v.submittedAt ? h(formatDate(v.submittedAt)) : '–'}</strong></div>
                ${v.note ? `<div class="full"><span>Note</span><strong>${h(v.note)}</strong></div>` : ''}
              </div>` : ''}
            <div class="seller-actions">
              ${v.status !== 'verified' ? `<button type="button" class="button button-primary button-xs" data-action="admin-verify" data-id="${h(seller.id)}" data-status="verified">${icon('check')} Verify</button>` : ''}
              ${v.status === 'pending' ? `<button type="button" class="button button-danger-ghost button-xs" data-action="admin-verify" data-id="${h(seller.id)}" data-status="rejected">Reject</button>` : ''}
              ${v.status === 'verified' ? `<button type="button" class="button button-ghost button-xs" data-action="admin-verify" data-id="${h(seller.id)}" data-status="none">Remove badge</button>` : ''}
              ${seller.suspended
                ? `<button type="button" class="button button-outline button-xs" data-action="admin-unsuspend" data-id="${h(seller.id)}">Unsuspend</button>`
                : `<button type="button" class="button button-ghost button-xs" data-action="admin-suspend" data-id="${h(seller.id)}">Suspend</button>`}
              <button type="button" class="button button-danger-ghost button-xs" data-action="admin-delete-shop" data-id="${h(seller.id)}" data-name="${h(seller.shopName)}" data-unsettled="${h(seller.unsettledCount)}">${icon('trash')} Delete</button>
            </div>
          </article>`;
      }).join('') : emptyState({ iconName: 'store', title: 'No sellers yet', text: 'Sellers appear here as soon as they register.' })}
    </div>`;
}

const adminTaskCard = (entry, actions, extra = '') => `
  <article class="card admin-task">
    <div class="admin-task-main">
      <div>
        <strong>${h(entry.reference)}</strong> · ${h(entry.customerName)}${entry.shopName ? ` → ${h(entry.shopName)}` : ''}
        <div class="meta-row">
          <span>${icon('wallet')} ${h(PAYMENT_LABELS[entry.method] || entry.method)}</span>
          ${entry.transactionId ? `<span>Txn: <code>${h(entry.transactionId)}</code></span>` : ''}
          ${entry.customerPhone && !entry.shopName ? `<span>${icon('phone')} ${h(entry.customerPhone)}</span>` : ''}
          ${entry.shopPhone ? `<span>${icon('whatsapp')} ${h(entry.shopPhone)}</span>` : ''}
          <span>${h(timeAgo(entry.submittedAt || entry.createdAt))}</span>
        </div>
        ${extra}
      </div>
      <div class="admin-task-amount">
        <strong>${formatMoney(entry.net ?? entry.amount)}</strong>
        ${entry.commission ? `<small>after ${formatMoney(entry.commission)} commission</small>` : ''}
      </div>
    </div>
    <div class="seller-actions">${actions}</div>
  </article>`;

function renderAdminPayments() {
  const p = state.admin.payments;
  const section = (title, description, items, render, empty) => `
    <section class="admin-section">
      <div class="panel-head"><div><h2>${title} <span class="tab-count">${items.length}</span></h2><p>${description}</p></div></div>
      ${items.length ? `<div class="order-list">${items.map(render).join('')}</div>` : `<p class="muted admin-empty">${empty}</p>`}
    </section>`;

  $('#adminPanel').innerHTML = `
    ${section('Courier delivery receipts', 'Review the courier company and receipt reference. Approval confirms delivery and makes eligible protected funds ready for manual payout.', p.deliveryConfirmations, (entry) => adminTaskCard(entry, `
      <button type="button" class="button button-primary button-xs" data-action="admin-delivery-approve" data-id="${h(entry.orderId)}" data-shop="${h(entry.shopId)}">${icon('check')} Approve delivery</button>`, `<p class="dispute-reason">${h(entry.courierCompany)} receipt: ${h(entry.courierReceiptReference)}</p>`), 'No courier receipts waiting for review.')}
    ${section('Payments to confirm', 'Check that the money arrived in the ShopVerse account with this reference, then confirm.', p.toConfirm, (entry) => adminTaskCard(entry, `
      <button type="button" class="button button-primary button-xs" data-action="admin-payment" data-id="${h(entry.orderId)}" data-do="confirm">${icon('check')} Money received</button>
      <button type="button" class="button button-danger-ghost button-xs" data-action="admin-payment" data-id="${h(entry.orderId)}" data-do="reject">Not found</button>`), 'No payments waiting.')}
    ${section('Disputes', 'The customer reported a problem. Talk to both sides, then release the money or refund.', p.disputes, (entry) => adminTaskCard(entry, `
      <button type="button" class="button button-primary button-xs" data-action="admin-resolve" data-id="${h(entry.orderId)}" data-shop="${h(entry.shopId)}" data-do="release">Pay the seller</button>
      <button type="button" class="button button-danger-ghost button-xs" data-action="admin-resolve" data-id="${h(entry.orderId)}" data-shop="${h(entry.shopId)}" data-do="refund">Refund the customer</button>`,
      entry.dispute ? `<p class="dispute-reason">${icon('flag')} “${h(entry.dispute.reason)}”</p>` : ''), 'No open disputes.')}
    ${section('Payouts ready', 'The customer has their order. Send the seller their money, then mark it paid.', p.payouts, (entry) => adminTaskCard(entry, `
      <button type="button" class="button button-primary button-xs" data-action="admin-payout" data-id="${h(entry.orderId)}" data-shop="${h(entry.shopId)}">${icon('wallet')} Mark as paid</button>`), 'No payouts due.')}
    ${section('Refunds due', 'Cancelled after payment. Send the money back to the customer, then mark it refunded.', p.refunds, (entry) => adminTaskCard(entry, `
      <button type="button" class="button button-primary button-xs" data-action="admin-refund" data-id="${h(entry.orderId)}" data-shop="${h(entry.shopId)}">${icon('repeat')} Mark as refunded</button>`), 'No refunds due.')}
    ${section('Held, waiting for delivery', 'Paid and protected. Standard deliveries release after customer confirmation or the protection period. Courier deliveries require receipt review.', p.held, (entry) => adminTaskCard(entry, ''), 'Nothing held right now.')}
    ${section('Awaiting payment', 'Orders placed but not paid yet.', p.awaiting, (entry) => adminTaskCard(entry, ''), 'No unpaid orders.')}`;
}

function renderAdminCouriers() {
  const { couriers, companies } = state.admin.couriers;
  $('#adminPanel').innerHTML = `
    <section class="admin-section">
      <div class="panel-head"><div><h2>Register a delivery company</h2><p>Create a secure courier login. Company names added here become selectable at checkout.</p></div></div>
      <form class="card card-pad form-grid two" data-form="courier-account">
        <label class="field"><span>Staff name</span><input type="text" name="name" maxlength="80" required /></label>
        <label class="field"><span>Company name</span><input type="text" name="courierCompany" maxlength="80" list="courierCompanies" placeholder="Platinum, Mercury, or another company" required /></label>
        <datalist id="courierCompanies">${companies.map((company) => `<option value="${h(company)}"></option>`).join('')}</datalist>
        <label class="field"><span>Login email</span><input type="email" name="email" autocomplete="email" required /></label>
        <label class="field"><span>Temporary password <span class="hint">· at least 8 characters</span></span><input type="password" name="password" minlength="8" autocomplete="new-password" required /></label>
        <div class="form-actions full"><button type="submit" class="button button-primary">Create courier login</button></div>
      </form>
    </section>
    <section class="admin-section">
      <div class="panel-head"><div><h2>Courier accounts <span class="tab-count">${couriers.length}</span></h2><p>Each account can view and confirm deliveries assigned to its company only.</p></div></div>
      ${couriers.length ? `<div class="order-list">${couriers.map((courier) => `
        <article class="card admin-task"><div class="admin-task-main"><div><strong>${h(courier.courierCompany)}</strong><div class="meta-row"><span>${h(courier.name)}</span><span>${h(courier.email)}</span></div></div></div></article>`).join('')}</div>` : '<p class="muted admin-empty">No courier logins yet.</p>'}
    </section>`;
}

async function submitCourierAccount(form) {
  const button = form.querySelector('[type=submit]');
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    setBusy(button, true);
    await apiRequest('/api/admin/couriers', { method: 'POST', body: data });
    toast('Courier login created. Share the temporary password securely.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
    setBusy(button, false);
  }
}

async function promptText({ title, message, label, placeholder = '', confirmLabel = 'Save', required = false, danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      size: 'narrow',
      body: `${message ? `<p class="muted" style="margin-bottom:12px">${h(message)}</p>` : ''}
        <label class="field"><span>${h(label)}</span><input type="text" id="promptInput" maxlength="300" placeholder="${h(placeholder)}" /></label>`,
      foot: `<button type="button" class="button button-outline" data-modal-close>Cancel</button>
             <button type="button" class="button ${danger ? 'button-danger' : 'button-primary'}" data-confirm>${h(confirmLabel)}</button>`,
      onClose: () => {
        if (!answered) resolve(null);
      }
    });
    const input = modal.element.querySelector('#promptInput');
    const submit = () => {
      if (required && !input.value.trim()) {
        input.focus();
        return;
      }
      answered = true;
      modal.close();
      resolve(input.value.trim());
    };
    modal.element.querySelector('[data-confirm]').addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  });
}

async function adminAction(element) {
  const { action, id, shop } = element.dataset;
  const what = element.dataset.do;
  let path;
  let body = {};

  if (action === 'admin-verify') {
    const status = element.dataset.status;
    if (status === 'rejected' || status === 'none') {
      const note = await promptText({ title: status === 'rejected' ? 'Reject verification' : 'Remove verified badge', label: 'Reason (sent to the seller)', placeholder: 'e.g. NRC number did not match', confirmLabel: status === 'rejected' ? 'Reject' : 'Remove badge', danger: true });
      if (note === null) return;
      body = { status, note };
    } else {
      const ok = await confirmDialog({ title: 'Verify this seller?', message: 'Only verify after checking their NRC or PACRA details and speaking to them.', confirmLabel: 'Verify seller' });
      if (!ok) return;
      body = { status };
    }
    path = `/api/admin/sellers/${encodeURIComponent(id)}/verification`;
  } else if (action === 'admin-suspend') {
    const reason = await promptText({
      title: 'Suspend this shop?',
      message: "The shop is hidden from buyers straight away, its items are removed from carts, and the seller can't add or edit products. You can unsuspend it later.",
      label: 'Reason (sent to the seller)',
      placeholder: 'e.g. Under review after a customer complaint',
      confirmLabel: 'Suspend shop',
      danger: true
    });
    if (reason === null) return;
    body = { reason };
    path = `/api/admin/sellers/${encodeURIComponent(id)}/suspend`;
  } else if (action === 'admin-unsuspend') {
    const ok = await confirmDialog({ title: 'Unsuspend this shop?', message: 'If it is verified, it becomes visible to buyers again.', confirmLabel: 'Unsuspend' });
    if (!ok) return;
    path = `/api/admin/sellers/${encodeURIComponent(id)}/unsuspend`;
  } else if (action === 'admin-delete-shop') {
    const name = element.dataset.name;
    const unsettled = Number(element.dataset.unsettled) || 0;
    if (unsettled) {
      toast(`${name} has ${plural(unsettled, 'unsettled order')}. Suspend it and settle ${unsettled === 1 ? 'it' : 'them'} on the Payments tab before deleting.`, 'error');
      return;
    }
    const typed = await promptText({
      title: 'Delete this shop permanently?',
      message: `This deletes ${name}, all its products and the seller's account. It cannot be undone. Customers keep their past orders. Type the shop name to confirm.`,
      label: `Type "${name}"`,
      confirmLabel: 'Delete permanently',
      required: true,
      danger: true
    });
    if (typed === null) return;
    if (typed !== name) {
      toast("The name didn't match, so nothing was deleted.", 'error');
      return;
    }
    try {
      setBusy(element, true);
      await apiRequest(`/api/admin/sellers/${encodeURIComponent(id)}`, { method: 'DELETE', body: { confirmName: typed } });
      toast(`${name} was deleted.`, 'success');
      render();
    } catch (error) {
      reportApiError(error);
      setBusy(element, false);
    }
    return;
  } else if (action === 'admin-payment') {
    if (what === 'reject') {
      const note = await promptText({ title: 'Payment not found', label: 'Message to the customer (optional)', placeholder: 'e.g. No payment received with this reference', confirmLabel: 'Reject payment', danger: true });
      if (note === null) return;
      body = { action: 'reject', note };
    } else {
      const ok = await confirmDialog({ title: 'Confirm money received?', message: 'Only confirm after checking the ShopVerse account statement for this amount and reference.', confirmLabel: 'Money received' });
      if (!ok) return;
      body = { action: 'confirm' };
    }
    path = `/api/admin/orders/${encodeURIComponent(id)}/payment`;
  } else if (action === 'admin-delivery-approve') {
    const ok = await confirmDialog({
      title: 'Approve courier delivery?',
      message: 'Check the courier receipt reference before approval. This confirms delivery and may make the seller payout ready.',
      confirmLabel: 'Approve delivery'
    });
    if (!ok) return;
    path = `/api/admin/orders/${encodeURIComponent(id)}/shops/${encodeURIComponent(shop)}/delivery-approval`;
  } else if (action === 'admin-payout') {
    const reference = await promptText({ title: 'Mark payout as paid', message: 'Send the money to the seller first (for example by MoMo), then record it here.', label: 'Transfer reference (optional)', placeholder: 'e.g. MP240101.5678.B12345', confirmLabel: 'Mark as paid' });
    if (reference === null) return;
    body = { reference };
    path = `/api/admin/orders/${encodeURIComponent(id)}/shops/${encodeURIComponent(shop)}/payout`;
  } else if (action === 'admin-refund') {
    const ok = await confirmDialog({ title: 'Mark as refunded?', message: 'Only do this after you have sent the money back to the customer.', confirmLabel: 'Mark as refunded' });
    if (!ok) return;
    path = `/api/admin/orders/${encodeURIComponent(id)}/shops/${encodeURIComponent(shop)}/refund`;
  } else if (action === 'admin-resolve') {
    const note = await promptText({
      title: what === 'release' ? 'Pay the seller' : 'Refund the customer',
      label: 'Note to both sides (optional)',
      confirmLabel: what === 'release' ? 'Release payment' : 'Refund customer',
      danger: what === 'refund'
    });
    if (note === null) return;
    body = { resolution: what, note };
    path = `/api/admin/orders/${encodeURIComponent(id)}/shops/${encodeURIComponent(shop)}/resolve`;
  }

  try {
    setBusy(element, true);
    await apiRequest(path, { method: 'POST', body });
    toast('Done.', 'success');
    render();
  } catch (error) {
    reportApiError(error);
    setBusy(element, false);
  }
}

// ---------------------------------------------------------------------------
// Views: account
// ---------------------------------------------------------------------------

async function viewAccount({ id }) {
  if (!requireRole()) return;
  setTitle('Account settings');
  const { stats } = await apiRequest('/api/dashboard');
  if (stale(id)) return;
  const user = state.user;
  const isOwner = user.role === 'shop_owner';

  setView(`
    <div class="container">
      <div class="page-head"><h1>Account settings</h1><p>Manage your personal details and password.</p></div>
      ${user.role !== 'customer' ? '' : `
        <div class="kpi-grid section-tight" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); padding-bottom: 0">
          <div class="card kpi"><span>${icon('receipt')} Orders</span><strong>${h(stats.userOrderCount)}</strong></div>
          <div class="card kpi"><span>${icon('truck')} In progress</span><strong>${h(stats.activeOrderCount)}</strong></div>
          <div class="card kpi"><span>${icon('wallet')} Total spent</span><strong>${formatMoney(stats.totalSpent)}</strong></div>
        </div>`}
      <div class="account-layout section-tight">
        <form class="card card-pad" data-form="account-profile" novalidate>
          <h2>Personal details</h2>
          <p>${isOwner ? 'Your name is shown on your storefront as the shop owner.' : 'Used for your orders and reviews.'}</p>
          <div class="form-grid">
            <label class="field"><span>Full name</span><input type="text" name="name" maxlength="80" required value="${h(user.name)}" autocomplete="name" /></label>
            <label class="field"><span>Email</span><input type="email" name="email" required value="${h(user.email)}" autocomplete="email" /></label>
          </div>
          <div class="form-actions"><button type="submit" class="button button-primary">Save changes</button></div>
        </form>
        <form class="card card-pad" data-form="account-password" novalidate>
          <h2>Password</h2>
          <p>Changing your password signs you out on all other devices.</p>
          <div class="form-grid">
            <label class="field"><span>Current password</span><input type="password" name="currentPassword" required autocomplete="current-password" /></label>
            <label class="field"><span>New password <span class="hint">· at least 8 characters</span></span><input type="password" name="newPassword" minlength="8" required autocomplete="new-password" /></label>
          </div>
          <div class="form-actions"><button type="submit" class="button button-primary">Update password</button></div>
        </form>
      </div>
      <button type="button" class="button button-outline" data-action="logout">${icon('logout')} Sign out</button>
    </div>`);
}

async function submitAccountProfile(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('[type=submit]');
  try {
    setBusy(button, true);
    const { user } = await apiRequest('/api/me', { method: 'PATCH', body: { name: data.name, email: data.email } });
    state.user = user;
    saveSession(user, null);
    renderChrome();
    toast('Your details have been saved.', 'success');
  } catch (error) {
    reportApiError(error);
  } finally {
    setBusy(button, false);
  }
}

async function submitPassword(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('[type=submit]');
  try {
    setBusy(button, true);
    await apiRequest('/api/me/password', { method: 'POST', body: data });
    form.reset();
    toast('Password updated. Other devices have been signed out.', 'success');
  } catch (error) {
    reportApiError(error);
  } finally {
    setBusy(button, false);
  }
}

// ---------------------------------------------------------------------------
// Installable app (PWA)
// ---------------------------------------------------------------------------

const install = {
  prompt: null,
  installed: false
};

// The Windows installer is published as a GitHub release asset (see desktop/README.md).
const WINDOWS_DOWNLOAD_URL = 'https://github.com/shalowa67/shopVERSE/releases/latest/download/ShopVerse-Setup.exe';
// The Android app is published to a fixed "android-app" release (see android/README.md).
const ANDROID_DOWNLOAD_URL = 'https://github.com/shalowa67/shopVERSE/releases/download/android-app/ShopVerse.apk';
const isAndroid = () => isBrowser && /android/i.test(navigator.userAgent);

const isStandalone = () => isBrowser && (
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true
);
const isIos = () => isBrowser && /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !/crios|fxios|edgios/i.test(navigator.userAgent);

// Always offer installation outside the installed app. When the browser has no install
// prompt ready (Firefox, desktop Safari, or Chrome before it decides), the button opens
// the /install page with per-device instructions and the Windows download instead.
const canOfferInstall = () => !isStandalone() && !install.installed;

function renderInstallButton() {
  const button = $('#installButton');
  if (button) button.hidden = !canOfferInstall();
}

function showIosInstructions() {
  openModal({
    title: 'Install ShopVerse on your iPhone',
    subtitle: 'Add it to your Home Screen in three taps.',
    size: 'narrow',
    body: `
      <ol class="install-steps">
        <li><span class="step-num">1</span><div>Tap the <strong>Share</strong> button ${icon('share')} in Safari's toolbar.</div></li>
        <li><span class="step-num">2</span><div>Scroll down and choose <strong>Add to Home Screen</strong>.</div></li>
        <li><span class="step-num">3</span><div>Tap <strong>Add</strong>. ShopVerse will appear on your Home Screen like any other app.</div></li>
      </ol>`,
    foot: '<button type="button" class="button button-primary" data-modal-close>Got it</button>'
  });
}

async function installApp() {
  if (install.prompt) {
    const promptEvent = install.prompt;
    install.prompt = null;
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome !== 'accepted') toast('No problem. You can install ShopVerse any time from the menu.');
    renderInstallButton();
    if (location.pathname === '/install') render();
    return;
  }
  if (isIos()) {
    showIosInstructions();
    return;
  }
  if (location.pathname === '/install') {
    toast('Your browser can\'t install apps directly. Follow the steps below, or download the Windows installer.');
    return;
  }
  navigate('/install');
}

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    install.prompt = event;
    renderInstallButton();
    if (location.pathname === '/install') render();
  });

  window.addEventListener('appinstalled', () => {
    install.installed = true;
    install.prompt = null;
    renderInstallButton();
    toast('ShopVerse is installed. Find it on your home screen or app list.', 'success');
    if (location.pathname === '/install') render();
  });

  renderInstallButton();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // The site works without the service worker; installation just won't be offered.
      });
    });
  }
}

function viewInstall() {
  setTitle('Get the app');
  let action;
  if (isStandalone() || install.installed) {
    action = `<div class="notice notice-success">${icon('checkCircle')}<span>You are using the installed ShopVerse app. You're all set!</span></div>`;
  } else if (install.prompt) {
    action = `<button type="button" class="button button-primary button-lg" data-action="install-app">${icon('download')} Install ShopVerse</button>`;
  } else if (isIos()) {
    action = `<button type="button" class="button button-primary button-lg" data-action="install-app">${icon('share')} Show me how</button>`;
  } else {
    action = `<div class="notice">${icon('info')}<span>If you don't see an install option, open this page in Chrome, Edge or Samsung Internet on Android or desktop, or Safari on iPhone.</span></div>`;
  }

  setView(`
    <div class="container">
      <section class="install-hero">
        <div>
          <span class="eyebrow">ShopVerse app</span>
          <h1>Shop faster with the ShopVerse app.</h1>
          <p>Install ShopVerse on your phone or computer in seconds. It opens in its own window, stays on your home screen and keeps you signed in, with nothing to download from an app store.</p>
          <div class="button-row" style="margin-top: 24px">${action}</div>
          ${isStandalone() ? '' : `
            <p class="muted" style="font-size: .9rem; margin-top: 18px">
              ${isAndroid()
                ? `Prefer a regular app? <a class="link" href="${ANDROID_DOWNLOAD_URL}" rel="noopener">${icon('download')} Download the Android app</a> (ShopVerse.apk)`
                : `On Windows? <a class="link" href="${WINDOWS_DOWNLOAD_URL}" target="_blank" rel="noopener">${icon('download')} Download the desktop installer</a> (ShopVerse-Setup.exe)`}
            </p>`}
        </div>
        <div class="install-visual" aria-hidden="true">
          <img src="/icons/icon-512.png" alt="" width="180" height="180" />
        </div>
      </section>

      <div class="steps section-tight">
        <div class="step"><div class="step-num">${icon('device')}</div><h3>Android</h3><p>Open ShopVerse in Chrome and tap <strong>Install app</strong>, or <a class="link" href="${ANDROID_DOWNLOAD_URL}" rel="noopener">download the Android app</a> and open it to install.</p></div>
        <div class="step"><div class="step-num">${icon('share')}</div><h3>iPhone &amp; iPad</h3><p>Open ShopVerse in Safari, tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.</p></div>
        <div class="step"><div class="step-num">${icon('monitor')}</div><h3>Windows &amp; Mac</h3><p>In Chrome or Edge, click <strong>Install app</strong> at the top of the page. On Windows you can also <a class="link" href="${WINDOWS_DOWNLOAD_URL}" target="_blank" rel="noopener">download the installer</a>.</p></div>
      </div>

      <div class="steps">
        <div class="step"><div class="step-num">${icon('sparkle')}</div><h3>Feels like an app</h3><p>Full-screen, with its own icon and window. Shortcuts take you straight to products, orders or your studio.</p></div>
        <div class="step"><div class="step-num">${icon('wifi')}</div><h3>Light on data</h3><p>The app is tiny and caches product photos, so browsing uses less data on mobile.</p></div>
        <div class="step"><div class="step-num">${icon('shield')}</div><h3>Always up to date</h3><p>No updates to install. You always get the latest version automatically.</p></div>
      </div>
    </div>`);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

async function handleAction(action, element, event) {
  switch (action) {
    case 'toggle-password': {
      const input = element.closest('.password-control').querySelector('input');
      const isVisible = input.type === 'password';
      input.type = isVisible ? 'text' : 'password';
      element.textContent = isVisible ? 'Hide' : 'Show';
      element.setAttribute('aria-pressed', String(isVisible));
      break;
    }
    case 'add-to-cart': {
      const qtyInput = element.dataset.qtyInput ? $(element.dataset.qtyInput) : null;
      const quantity = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
      setBusy(element, true);
      await addToCart(element.dataset.id, quantity);
      setBusy(element, false);
      break;
    }
    case 'qty-inc':
    case 'qty-dec': {
      const stepper = element.closest('[data-stepper]');
      const input = stepper.querySelector('input');
      const max = Number(stepper.dataset.max) || 999;
      input.value = Math.min(max, Math.max(1, (parseInt(input.value, 10) || 1) + (action === 'qty-inc' ? 1 : -1)));
      break;
    }
    case 'open-cart':
      openCart();
      break;
    case 'close-drawer':
      closeCart();
      break;
    case 'cart-inc':
      changeCartQuantity(element.dataset.id, 1);
      break;
    case 'cart-dec':
      changeCartQuantity(element.dataset.id, -1);
      break;
    case 'cart-remove':
      removeFromCart(element.dataset.id);
      break;
    case 'toggle-account-menu':
      event.stopPropagation();
      toggleAccountMenu();
      break;
    case 'logout':
      logout();
      break;
    case 'demo-login': {
      setBusy(element, true);
      try {
        const result = await apiRequest('/api/login', { method: 'POST', body: { email: element.dataset.email, password: '123456' } });
        await completeSignIn(result);
      } catch (error) {
        reportApiError(error);
        setBusy(element, false);
      }
      break;
    }
    case 'set-category':
      productFilters.category = element.dataset.category;
      $$('#categoryChips .chip').forEach((chip) => chip.classList.toggle('active', chip === element));
      setTitle(productFilters.category || 'Explore products');
      loadProductResults().catch(reportApiError);
      break;
    case 'shop-category':
      state.shopView.category = element.dataset.category;
      renderShopProducts();
      break;
    case 'cancel-order': {
      const confirmed = await confirmDialog({
        title: 'Cancel this order?',
        message: 'The shop will be notified and your order will not be fulfilled.',
        confirmLabel: 'Cancel order',
        danger: true
      });
      if (!confirmed) return;
      try {
        await apiRequest(`/api/orders/${encodeURIComponent(element.dataset.id)}/cancel`, { method: 'POST' });
        toast('Your order has been cancelled.', 'success');
        render();
      } catch (error) {
        reportApiError(error);
      }
      break;
    }
    case 'new-product':
      openProductEditor(null);
      break;
    case 'edit-product':
      openProductEditor(element.dataset.id);
      break;
    case 'delete-product':
      deleteProduct(element.dataset.id);
      break;
    case 'move-product': {
      const ids = state.studio.products.map((product) => product.id);
      const index = ids.indexOf(element.dataset.id);
      const target = index + Number(element.dataset.dir);
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      saveProductOrder(ids);
      break;
    }
    case 'order-filter':
      state.studio.orderFilter = element.dataset.filter;
      renderStudioOrders();
      break;
    case 'install-app':
      installApp();
      break;
    case 'share': {
      const url = absoluteUrl(element.dataset.path);
      if (navigator.share) {
        try {
          await navigator.share({ title: element.dataset.title, text: element.dataset.text, url });
        } catch (error) {
          // The person closed the share sheet.
        }
      } else {
        window.open(whatsappShareUrl(`${element.dataset.text} ${url}`), '_blank', 'noopener');
      }
      break;
    }
    case 'copy-link':
    case 'copy-text': {
      const value = action === 'copy-link' ? absoluteUrl(element.dataset.path) : element.dataset.text;
      try {
        await navigator.clipboard.writeText(value);
        toast(action === 'copy-link' ? 'Link copied.' : 'Message copied.', 'success');
      } catch (error) {
        toast('Could not copy automatically. Select the text and copy it.', 'error');
      }
      break;
    }
    case 'confirm-receipt':
      confirmReceipt(element.dataset.id, element.dataset.shop);
      break;
    case 'courier-confirm':
      submitCourierReceipt(element.dataset.id, element.dataset.shop);
      break;
    case 'open-dispute':
      openDispute(element.dataset.id, element.dataset.shop, element.dataset.shopName);
      break;
    case 'admin-verify':
    case 'admin-suspend':
    case 'admin-unsuspend':
    case 'admin-delete-shop':
    case 'admin-payment':
    case 'admin-payout':
    case 'admin-refund':
    case 'admin-resolve':
      adminAction(element);
      break;
    case 'refresh':
      render();
      break;
    case 'set-color': {
      const input = $('#shopProfileForm [name=shopThemeColor]');
      input.value = element.dataset.color;
      updateProfilePreview();
      break;
    }
    default:
      break;
  }
}

function handleSubmit(event) {
  const form = event.target;
  if (form.id === 'headerSearch' || form.dataset.form === 'search') {
    event.preventDefault();
    const q = String(new FormData(form).get('q') || '').trim();
    form.querySelector('input').blur();
    navigate(`/products${q ? `?search=${encodeURIComponent(q)}` : ''}`);
    return;
  }

  const handlers = {
    login: () => submitAuth(form, 'login'),
    register: () => submitAuth(form, 'register'),
    'courier-account': () => submitCourierAccount(form),
    checkout: () => submitCheckout(form),
    product: () => submitProduct(form),
    'shop-profile': () => submitShopProfile(form),
    'account-profile': () => submitAccountProfile(form),
    'account-password': () => submitPassword(form),
    review: () => submitReview(form),
    'submit-payment': () => submitPayment(form),
    dispute: () => submitDispute(form),
    verification: () => submitVerification(form)
  };
  const handler = handlers[form.dataset.form];
  if (handler) {
    event.preventDefault();
    handler();
  }
}

async function submitReview(form) {
  const data = new FormData(form);
  const button = form.querySelector('[type=submit]');
  try {
    setBusy(button, true);
    await apiRequest(`/api/products/${encodeURIComponent(form.dataset.id)}/reviews`, {
      method: 'POST',
      body: { rating: Number(data.get('rating')), comment: data.get('comment') }
    });
    toast('Thanks for your review!', 'success');
    await render();
    $('#reviews')?.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    reportApiError(error);
    setBusy(button, false);
  }
}

const debouncedProductSearch = debounce((value) => {
  productFilters.search = value;
  loadProductResults().catch(reportApiError);
}, 300);
const debouncedShopSearch = debounce((value) => loadShopResults(value).catch(reportApiError), 300);

function handleInput(event) {
  const target = event.target;
  if (target.dataset.filter === 'search') debouncedProductSearch(target.value.trim());
  if (target.dataset.filter === 'shop-search') debouncedShopSearch(target.value.trim());
  if (target.dataset.change === 'profile-preview' && target.type !== 'file') updateProfilePreview(target);
}

function handleChange(event) {
  const target = event.target;
  const filter = target.dataset.filter;
  if (filter === 'sort' || filter === 'inStock') {
    productFilters[filter] = filter === 'inStock' ? target.checked : target.value;
    loadProductResults().catch(reportApiError);
  }
  if (filter === 'shop-sort') {
    state.shopView.sort = target.value;
    renderShopProducts();
  }

  switch (target.dataset.change) {
    case 'role': {
      const shopFields = $('#shopFields');
      if (shopFields) shopFields.hidden = target.value !== 'shop_owner';
      break;
    }
    case 'order-status':
      updateOrderStatus(target);
      break;
    case 'checkout-summary':
      updateCheckoutSummary();
      break;
    case 'profile-preview':
      updateProfilePreview(target);
      break;
    case 'preview-image': {
      const file = target.files[0];
      const preview = $(target.dataset.target);
      if (file && preview) preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" />`;
      break;
    }
    default:
      break;
  }
}

function wireEvents() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    const actionElement = event.target.closest('[data-action]');

    if (actionElement && actionElement.tagName !== 'A') {
      event.preventDefault();
      handleAction(actionElement.dataset.action, actionElement, event);
      return;
    }
    if (actionElement && actionElement.dataset.action === 'close-drawer') closeCart();

    if (link) {
      const href = link.getAttribute('href');
      const internal = link.origin === location.origin && !link.target && !link.hasAttribute('download') &&
        !href.startsWith('#') && !href.startsWith('tel:') && !href.startsWith('mailto:') && !link.pathname.startsWith('/media/');
      if (internal && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
        event.preventDefault();
        if (link.getAttribute('aria-disabled') === 'true') return;
        if (link.pathname + link.search + link.hash !== location.pathname + location.search + location.hash) {
          navigate(link.pathname + link.search + link.hash);
        }
        else render();
        return;
      }
    }

    if (!event.target.closest('.popover, #notificationsButton, #accountButton')) closePopovers();
  });

  document.addEventListener('submit', handleSubmit);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (modalStack.length) modalStack[modalStack.length - 1].close();
    else if (!$('#cartDrawer').hidden) closeCart();
    else closePopovers();
  });

  $('#cartButton').addEventListener('click', openCart);
  $('#drawerBackdrop').addEventListener('click', closeCart);
  $('#notificationsButton').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleNotifications();
  });
  $('#menuToggle').addEventListener('click', () => {
    const nav = $('#mainNav');
    const open = nav.classList.toggle('open');
    $('#menuToggle').setAttribute('aria-expanded', String(open));
  });

  window.addEventListener('popstate', () => render());

  // Keep the notification badge fresh while the tab is visible.
  setInterval(() => {
    if (state.user && document.visibilityState === 'visible') {
      loadUnreadCount().then(renderChrome).catch(() => {});
    }
  }, 60000);
}

async function initializeApp() {
  $('#year').textContent = new Date().getFullYear();
  wireEvents();
  setupInstall();

  state.user = getStoredUser();
  if (!getStoredToken()) state.user = null;
  renderChrome();

  apiRequest('/api/health')
    .then((result) => {
      state.demo = Boolean(result.demo);
      if (location.pathname === '/login' && state.demo && !state.user) render();
    })
    .catch(() => {});

  if (state.user) await loadDashboard();
  render();
}

if (isBrowser) {
  initializeApp();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    handleSessionError,
    clearSession,
    getStoredUser,
    getStoredToken,
    saveSession,
    escapeHtml,
    safeImageUrl,
    formatMoney,
    loadDashboard,
    reportApiError
  };
}
