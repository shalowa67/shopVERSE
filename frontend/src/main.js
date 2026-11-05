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
    title: 'Card',
    options: [
      { value: 'visa', label: 'Visa', hint: 'Debit or credit', badge: 'VISA' },
      { value: 'mastercard', label: 'Mastercard', hint: 'Debit or credit', badge: 'MC' },
      { value: 'zanaco_card', label: 'Zanaco card', hint: 'Zanaco debit card', badge: 'ZNC' },
      { value: 'zambia_credit_card', label: 'Other Zambian card', hint: 'Any local bank card', badge: 'ZM' }
    ]
  },
  {
    title: 'Other',
    options: [
      { value: 'bank_transfer', label: 'Bank transfer', hint: 'Shop shares bank details', badge: 'EFT' },
      { value: 'cash_on_delivery', label: 'Cash on delivery', hint: 'Pay when it arrives', badge: 'COD' }
    ]
  }
];
const PAYMENT_LABELS = Object.fromEntries(
  PAYMENT_GROUPS.flatMap((group) => group.options.map((option) => [option.value, option.label]))
    .concat([['card', 'Card'], ['wallet', 'Wallet'], ['standard_chartered_card', 'Standard Chartered card']])
);

const state = {
  user: null,
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
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'
};

const icon = (name, className = 'icon') => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------------------------------------------------------------------------
// Shared markup
// ---------------------------------------------------------------------------

const canBuy = () => !state.user || state.user.role === 'customer';

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
      <a class="product-shop" href="/shops/${encodeURIComponent(product.shopId)}">${h(product.shopName)}</a>
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
        <h3><a href="/shops/${encodeURIComponent(shop.id)}">${h(shop.name)}</a></h3>
        <div class="meta-row" style="margin-top: 4px">
          <span>${icon('pin')} ${h(shop.location)}</span>
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

  $('#cartButton').hidden = role === 'shop_owner';
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
      : `<a href="/orders" role="menuitem">${icon('receipt')} My orders</a>`}
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
    <div class="summary-row"><span>Delivery</span><span class="muted">Arranged by each shop</span></div>
    <div class="summary-row total"><span>Total</span><strong>${formatMoney(state.cart.subtotal)}</strong></div>
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
  [/^\/account\/?$/, viewAccount]
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
    navigate(state.user.role === 'shop_owner' ? '/studio' : '/', { replace: true });
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
            ${h(product.shopName)}
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
          <div class="pd-description">${h(product.description || 'The seller has not added a description yet.')}</div>
          <div class="pd-perks">
            <div>${icon('truck')} Delivery arranged directly by ${h(product.shopName)}${product.shopLocation ? ` from ${h(product.shopLocation)}` : ''}</div>
            <div>${icon('wallet')} Pay with mobile money, card, bank transfer or cash on delivery</div>
            <div>${icon('shield')} Cancel free of charge until the shop confirms your order</div>
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

  setView(`
    <section class="storefront-hero" style="--accent-c: ${safeColor(shop.themeColor)}">
      <div class="storefront-banner" ${banner ? `style="background-image: ${h(cssUrl(banner))}"` : ''}></div>
      <div class="container storefront-info">
        <div class="shop-avatar">${avatarMarkup(shop.profileImage, shop.name)}</div>
        <div class="storefront-text">
          <h1>${h(shop.name)}</h1>
          <p>${h(shop.description || '')}</p>
          <div class="meta-row">
            <span>${icon('pin')} ${h(shop.location)}</span>
            <span>${icon('user')} Run by ${h(shop.owner)}</span>
            <span>${icon('box')} ${plural(shop.productCount, 'product')}</span>
            ${shop.reviewCount ? ratingMarkup(shop.averageRating, shop.reviewCount) : ''}
          </div>
        </div>
        ${isMine ? `<a href="/studio?tab=profile" class="button button-outline">${icon('edit')} Edit storefront</a>` : ''}
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
    navigate(state.user.role === 'shop_owner' ? '/studio' : '/', { replace: true });
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
            <label class="field"><span>Password ${isRegister ? '<span class="hint">· at least 8 characters</span>' : ''}</span><input type="password" name="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="${isRegister ? 8 : 1}" required /></label>
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
    : state.redirectAfterLogin || (result.user.role === 'shop_owner' ? '/studio' : '/');
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

async function viewCheckout({ id }) {
  if (!requireRole('customer')) return;
  setTitle('Checkout');
  setView(loader);
  await loadCart();
  if (stale(id)) return;
  renderChrome();

  if (!state.cart.items.length) {
    setView(`<div class="container section">${emptyState({ iconName: 'cart', title: 'Your cart is empty', text: 'Add some products before checking out.', action: '<a href="/products" class="button button-primary">Browse products</a>' })}</div>`);
    return;
  }

  const remembered = readRemembered();
  const problems = state.cart.items.filter((item) => !item.available);
  const shops = new Set(state.cart.items.map((item) => item.shopId));

  setView(`
    <div class="container">
      <div class="page-head"><h1>Checkout</h1><p>Review your details and place your order.</p></div>
      <form class="checkout-layout section-tight" data-form="checkout" novalidate>
        <div>
          <section class="card card-pad checkout-section">
            <h2><span class="step-num">1</span> Delivery details</h2>
            <div class="form-grid two">
              <label class="field"><span>Full name</span><input type="text" value="${h(state.user.name)}" disabled /></label>
              <label class="field"><span>Phone number</span><input type="tel" name="contactPhone" autocomplete="tel" placeholder="+260 97 123 4567" value="${h(remembered.contactPhone || '')}" /></label>
              <label class="field full"><span>Delivery address</span><textarea name="shippingAddress" rows="3" maxlength="300" autocomplete="street-address" placeholder="House/plot number, street, area, town" required>${h(remembered.shippingAddress || '')}</textarea></label>
              <label class="field full"><span>Note for the seller <span class="hint">· optional</span></span><input type="text" name="note" maxlength="500" placeholder="e.g. Call when you arrive at the gate" /></label>
            </div>
          </section>
          <section class="card card-pad checkout-section">
            <h2><span class="step-num">2</span> Payment method</h2>
            ${PAYMENT_GROUPS.map((group) => `
              <div class="option-group-title">${h(group.title)}</div>
              <div class="option-grid">
                ${group.options.map((option) => `
                  <label class="option-card">
                    <input type="radio" name="paymentMethod" value="${option.value}" ${(remembered.paymentMethod || 'mtn_mobile_money') === option.value ? 'checked' : ''} />
                    <span class="oc-icon">${h(option.badge)}</span>
                    <div><strong>${h(option.label)}</strong><small>${h(option.hint)}</small></div>
                  </label>`).join('')}
              </div>`).join('')}
            <div class="notice" style="margin-top: 18px">${icon('info')}<span>Online payment is not connected yet. After you order, the shop will contact you to complete payment using the method you choose.</span></div>
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
          <div class="summary-row"><span>Delivery</span><span class="muted">Agreed with ${shops.size > 1 ? 'each shop' : 'the shop'}</span></div>
          <div class="summary-row total"><span>Total</span><strong>${formatMoney(state.cart.subtotal)}</strong></div>
          ${shops.size > 1 ? `<p class="muted" style="font-size:.8rem;margin-top:10px">Your order includes ${shops.size} shops. Each one ships its items separately.</p>` : ''}
          ${problems.length ? `<div class="notice notice-warning" style="margin-top:14px">${icon('alert')}<span>Some items are no longer available in the quantity you chose. <button type="button" class="link" data-action="open-cart">Update your cart</button>.</span></div>` : ''}
          <button type="submit" class="button button-primary button-lg button-block" style="margin-top: 16px" ${problems.length ? 'disabled' : ''}>Place order · ${formatMoney(state.cart.subtotal)}</button>
          <p class="muted" style="font-size:.78rem;text-align:center;margin-top:10px">${icon('shield', 'icon')} You can cancel free of charge until the shop confirms.</p>
        </aside>
      </form>
    </div>`);
}

async function submitCheckout(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  if (!String(data.shippingAddress || '').trim()) {
    toast('Please enter a delivery address.', 'error');
    form.elements.shippingAddress.focus();
    return;
  }
  const button = form.querySelector('[type=submit]');
  try {
    setBusy(button, true);
    const { order } = await apiRequest('/api/orders', { method: 'POST', body: data });
    try {
      defaultStorage()?.setItem(addressKey, JSON.stringify({
        shippingAddress: data.shippingAddress,
        contactPhone: data.contactPhone,
        paymentMethod: data.paymentMethod
      }));
    } catch (error) {
      // Remembering the address is a convenience only.
    }
    state.cart = { items: [], itemCount: 0, subtotal: 0 };
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

async function viewOrders({ id, query }) {
  if (state.user && state.user.role === 'shop_owner') {
    navigate('/studio?tab=orders', { replace: true });
    return;
  }
  if (!requireRole('customer')) return;
  setTitle('My orders');
  setView(loader);
  const { orders } = await apiRequest('/api/my-orders');
  if (stale(id)) return;
  const placed = query.get('placed');

  setView(`
    <div class="container">
      <div class="page-head"><h1>My orders</h1><p>Track deliveries and review your purchase history.</p></div>
      ${placed ? `<div class="notice notice-success fade-up" style="margin: 16px 0 4px">${icon('checkCircle')}<span><strong>Thank you! Your order #${h(shortId(placed))} has been placed.</strong> The shop will be in touch to confirm delivery and payment.</span></div>` : ''}
      <div class="order-list section-tight">
        ${orders.length ? orders.map((order) => `
          <article class="card order-card">
            <div class="order-head">
              <div class="order-head-meta">
                <div><span>Order</span><strong>#${h(shortId(order.id))}</strong></div>
                <div><span>Placed</span><strong>${h(formatDate(order.createdAt))}</strong></div>
                <div><span>Total</span><strong>${formatMoney(order.total)}</strong></div>
                <div><span>Payment</span><strong>${h(PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod)} · ${h(order.paymentStatus)}</strong></div>
              </div>
              ${statusPill(order.status)}
            </div>
            ${progressMarkup(order.status)}
            <div class="order-body">
              <div class="order-lines">
                ${order.items.map((item) => `
                  <div class="order-line">
                    <div class="thumb thumb-sm"><div class="placeholder-art">${h(initials(item.productName))}</div></div>
                    <div class="ol-text"><a href="/products/${encodeURIComponent(item.productId)}"><strong>${h(item.productName)}</strong></a><span>${h(item.shopName)} · Qty ${h(item.quantity)}</span></div>
                    <strong>${formatMoney(item.price * item.quantity)}</strong>
                  </div>`).join('')}
              </div>
              <div class="order-aside">
                <div><h4>Deliver to</h4><p>${h(order.shippingAddress)}${order.contactPhone ? `\n${h(order.contactPhone)}` : ''}</p></div>
                ${order.fulfillments.length > 1 ? `
                  <div><h4>Shipments</h4><div class="fulfilment-list">${order.fulfillments.map((entry) => `<div><span>${h(entry.shopName)}</span>${statusPill(entry.status)}</div>`).join('')}</div></div>` : ''}
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
}

// ---------------------------------------------------------------------------
// Views: seller studio
// ---------------------------------------------------------------------------

async function viewStudio({ id, query }) {
  if (!requireRole('shop_owner')) return;
  const tab = ['products', 'orders', 'profile'].includes(query.get('tab')) ? query.get('tab') : 'products';
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
          <div><span class="eyebrow">Seller studio</span><h1>${h(user.shopName)}</h1></div>
        </div>
        <div class="button-row">
          <a href="/shops/${encodeURIComponent(user.id)}" class="button button-outline">${icon('store')} View storefront</a>
          <button type="button" class="button button-primary" data-action="new-product">${icon('plus')} Add product</button>
        </div>
      </div>
      ${query.get('welcome') ? `<div class="notice notice-success" style="margin-bottom:20px">${icon('sparkle')}<span><strong>Your shop is live!</strong> Add your first product and personalise your storefront to start selling.</span></div>` : ''}
      <div class="kpi-grid">
        <div class="card kpi"><span>${icon('wallet')} Revenue</span><strong>${formatMoney(stats.revenue)}</strong></div>
        <div class="card kpi"><span>${icon('receipt')} Open orders</span><strong>${h(stats.openOrderCount)}</strong></div>
        <div class="card kpi"><span>${icon('box')} Products</span><strong>${h(stats.shopProductCount)}</strong></div>
        <div class="card kpi"><span>${icon('star')} Rating</span><strong>${stats.reviewCount ? `${Number(stats.averageRating).toFixed(1)}<small class="muted" style="font-size:.85rem;font-weight:500"> / ${stats.reviewCount}</small>` : '–'}</strong></div>
        <div class="card kpi ${stats.lowStockCount ? 'alert' : ''}"><span>${icon('alert')} Low stock</span><strong>${h(stats.lowStockCount)}</strong></div>
      </div>
      <nav class="tabs" aria-label="Studio sections">
        <a href="/studio?tab=products" class="${tab === 'products' ? 'active' : ''}">Products<span class="tab-count">${state.studio.products.length}</span></a>
        <a href="/studio?tab=orders" class="${tab === 'orders' ? 'active' : ''}">Orders${openOrders ? `<span class="tab-count">${openOrders}</span>` : ''}</a>
        <a href="/studio?tab=profile" class="${tab === 'profile' ? 'active' : ''}">Shop profile</a>
      </nav>
      <div id="studioPanel"></div>
    </div>`);

  if (tab === 'products') renderInventory();
  if (tab === 'orders') renderStudioOrders();
  if (tab === 'profile') renderProfileTab();
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
            <span>${product.reviewCount ? `${Number(product.averageRating).toFixed(1)} ★ · ${plural(product.reviewCount, 'review')}` : 'No reviews yet'}</span>
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

  panel.innerHTML = `
    <div class="panel-head">
      <div><h2>Orders</h2><p>Update the status as you fulfil each order. Customers are notified automatically.</p></div>
      <div class="chip-row">
        ${[['open', 'Open'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([key, label]) => `
          <button type="button" class="chip ${orderFilter === key ? 'active' : ''}" data-action="order-filter" data-filter="${key}">${label} <small>${orders.filter(filters[key]).length}</small></button>`).join('')}
      </div>
    </div>
    <div class="order-list">
      ${list.length ? list.map((order) => {
        const final = ['delivered', 'cancelled'].includes(order.status);
        return `
        <article class="card order-card">
          <div class="order-head">
            <div class="order-head-meta">
              <div><span>Order</span><strong>#${h(shortId(order.id))}</strong></div>
              <div><span>Placed</span><strong>${h(timeAgo(order.createdAt))}</strong></div>
              <div><span>Customer</span><strong>${h(order.customerName)}</strong></div>
              <div><span>Your total</span><strong>${formatMoney(order.total)}</strong></div>
            </div>
            ${statusPill(order.status)}
          </div>
          <div class="order-body">
            <div class="order-lines">
              ${order.items.map((item) => `
                <div class="order-line">
                  <div class="thumb thumb-sm" style="--accent-c:${safeColor(state.user.shopThemeColor)}"><div class="placeholder-art">${h(initials(item.productName))}</div></div>
                  <div class="ol-text"><strong>${h(item.productName)}</strong><span>${formatMoney(item.price)} × ${h(item.quantity)}</span></div>
                  <strong>${formatMoney(item.price * item.quantity)}</strong>
                </div>`).join('')}
            </div>
            <div class="order-aside">
              <div><h4>Deliver to</h4><p>${h(order.shippingAddress)}</p></div>
              ${order.contactPhone ? `<div><h4>Phone</h4><p><a class="link" href="tel:${h(order.contactPhone.replace(/[^\d+]/g, ''))}">${h(order.contactPhone)}</a></p></div>` : ''}
              <div><h4>Payment</h4><p>${h(PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod)} · ${h(order.paymentStatus)}</p></div>
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
        </div>
        <div class="form-actions"><button type="submit" class="button button-primary">Save profile</button></div>
      </form>
      <div class="preview-sticky">
        <div class="preview-label">Live preview</div>
        <div id="profilePreview"></div>
      </div>
    </div>`;
  updateProfilePreview();
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
    shopThemeColor: data.get('shopThemeColor')
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
      ${isOwner ? '' : `
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
// Event wiring
// ---------------------------------------------------------------------------

async function handleAction(action, element, event) {
  switch (action) {
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
    checkout: () => submitCheckout(form),
    product: () => submitProduct(form),
    'shop-profile': () => submitShopProfile(form),
    'account-profile': () => submitAccountProfile(form),
    'account-password': () => submitPassword(form),
    review: () => submitReview(form)
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
        if (link.pathname + link.search !== location.pathname + location.search) navigate(link.pathname + link.search);
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
