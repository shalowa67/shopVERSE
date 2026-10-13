const state = {
  user: null,
  activeMode: 'login',
  shops: [],
  products: [],
  ownerProducts: [],
  cart: { items: [], subtotal: 0 },
  orders: [],
  stats: null,
  notifications: [],
  shopSearchTerm: '',
  activeShopId: null
};

const authSection = typeof document !== 'undefined' ? document.getElementById('authSection') : null;
const appSection = typeof document !== 'undefined' ? document.getElementById('appSection') : null;
const authForm = typeof document !== 'undefined' ? document.getElementById('authForm') : null;
const logoutBtn = typeof document !== 'undefined' ? document.getElementById('logoutBtn') : null;
const userBadge = typeof document !== 'undefined' ? document.getElementById('userBadge') : null;
const shopsList = typeof document !== 'undefined' ? document.getElementById('shopsList') : null;
const cartList = typeof document !== 'undefined' ? document.getElementById('cartList') : null;
const cartTotal = typeof document !== 'undefined' ? document.getElementById('cartTotal') : null;
const cartPanel = typeof document !== 'undefined' ? document.querySelector('.cart-panel') : null;
const ownerPanel = typeof document !== 'undefined' ? document.getElementById('ownerPanel') : null;
const ownerProducts = typeof document !== 'undefined' ? document.getElementById('ownerProducts') : null;
const ordersList = typeof document !== 'undefined' ? document.getElementById('ordersList') : null;
const notificationsList = typeof document !== 'undefined' ? document.getElementById('notificationsList') : null;
const statsGrid = typeof document !== 'undefined' ? document.getElementById('statsGrid') : null;
const productForm = typeof document !== 'undefined' ? document.getElementById('productForm') : null;
const shopProfileForm = typeof document !== 'undefined' ? document.getElementById('shopProfileForm') : null;
const productFormSubmit = typeof document !== 'undefined' ? document.getElementById('productFormSubmit') : null;
const cancelProductEditBtn = typeof document !== 'undefined' ? document.getElementById('cancelProductEditBtn') : null;
const shopSearchInput = typeof document !== 'undefined' ? document.getElementById('shopSearchInput') : null;
const checkoutModal = typeof document !== 'undefined' ? document.getElementById('checkoutModal') : null;
const checkoutItems = typeof document !== 'undefined' ? document.getElementById('checkoutItems') : null;
const checkoutTotal = typeof document !== 'undefined' ? document.getElementById('checkoutTotal') : null;
const shippingAddressInput = typeof document !== 'undefined' ? document.getElementById('shippingAddressInput') : null;
const paymentMethodSelect = typeof document !== 'undefined' ? document.getElementById('paymentMethodSelect') : null;
const confirmCheckoutBtn = typeof document !== 'undefined' ? document.getElementById('confirmCheckoutBtn') : null;
const cancelCheckoutBtn = typeof document !== 'undefined' ? document.getElementById('cancelCheckoutBtn') : null;
const closeCheckoutModalBtn = typeof document !== 'undefined' ? document.getElementById('closeCheckoutModalBtn') : null;
const authSubmitButton = typeof document !== 'undefined' ? document.getElementById('authSubmitButton') : null;
const roleField = typeof document !== 'undefined' ? document.getElementById('roleField') : null;
const shopNameField = typeof document !== 'undefined' ? document.getElementById('shopNameField') : null;
const shopDescriptionField = typeof document !== 'undefined' ? document.getElementById('shopDescriptionField') : null;
const shopLocationField = typeof document !== 'undefined' ? document.getElementById('shopLocationField') : null;

const userSessionKey = 'shopverse-user';
const tokenKey = 'shopverse-token';

const formatMoney = (value) => new Intl.NumberFormat('en-ZM', {
  style: 'currency',
  currency: 'ZMW'
}).format(Number(value || 0));

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const safeImageUrl = (value) => {
  const image = String(value || '').trim();

  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(image)) {
    return image;
  }

  try {
    const url = new URL(image);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch (error) {
    return '';
  }
};

const safeThemeColor = (value) => {
  const color = String(value || '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : '#4f46e5';
};

const getProductImageMarkup = (product) => {
  const image = product && safeImageUrl(product.image);
  if (!image) {
    return '<div class="product-thumb placeholder-thumb">No image</div>';
  }

  return `<img class="product-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" />`;
};

async function readFileAsDataUrl(file) {
  if (!file || !file.size) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The selected image could not be uploaded.'));
    reader.readAsDataURL(file);
  });
}

function saveSession(user, token) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(userSessionKey, JSON.stringify(user));
  localStorage.setItem(tokenKey, token);
}

function clearSession(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) {
    return;
  }

  storage.removeItem(userSessionKey);
  storage.removeItem(tokenKey);
}

function getStoredUser(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) {
    return null;
  }

  const stored = storage.getItem(userSessionKey);
  return stored ? JSON.parse(stored) : null;
}

function getStoredToken(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) {
    return null;
  }

  return storage.getItem(tokenKey);
}

function handleSessionError(error, storage = typeof localStorage !== 'undefined' ? localStorage : null, onReload = () => {
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    window.location.reload();
  }
}) {
  const message = error && error.message ? String(error.message).toLowerCase() : '';
  const shouldReset = message.includes('invalid session token') || message.includes('authentication required');

  if (!shouldReset) {
    return false;
  }

  clearSession(storage);
  onReload();
  return true;
}

function reportApiError(error) {
  if (!handleSessionError(error)) {
    alert(error.message);
  }
}

function setAuthMode(mode) {
  state.activeMode = mode;
  const tabs = document.querySelectorAll('.tab-button');
  tabs.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));

  const fields = [
    { element: roleField, visible: mode === 'register' },
    { element: shopNameField, visible: mode === 'register' },
    { element: shopDescriptionField, visible: mode === 'register' },
    { element: shopLocationField, visible: mode === 'register' }
  ];

  fields.forEach(({ element, visible }) => {
    element.classList.toggle('hide', !visible);
  });

  const nameField = authForm.elements.name;
  nameField.closest('.field-row').style.display = mode === 'login' ? 'none' : 'grid';
  const roleSelect = authForm.elements.role;
  if (mode === 'login') {
    roleSelect.value = 'customer';
  }

  authSubmitButton.textContent = mode === 'login' ? 'Login' : 'Create account';
}

async function apiRequest(path, options = {}) {
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

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
    handleSessionError(error);
    throw error;
  }

  return result;
}

function renderUserBadge() {
  if (!state.user) {
    userBadge.textContent = '';
    userBadge.classList.add('hidden');
    return;
  }

  const label = state.user.role === 'shop_owner' ? 'Shop owner' : 'Customer';
  userBadge.textContent = `${state.user.name} · ${label}`;
  userBadge.classList.remove('hidden');
}

function populateShopProfileForm() {
  if (!shopProfileForm || !state.user || state.user.role !== 'shop_owner') {
    return;
  }

  shopProfileForm.elements.shopName.value = state.user.shopName || '';
  shopProfileForm.elements.shopDescription.value = state.user.shopDescription || '';
  shopProfileForm.elements.shopLocation.value = state.user.shopLocation || '';
  shopProfileForm.elements.shopThemeColor.value = state.user.shopThemeColor || '#4f46e5';
}

function renderRoleSpecificUI() {
  if (!state.user) {
    cartPanel?.classList.add('hidden');
    ownerPanel?.classList.add('hidden');
    return;
  }

  const isOwner = state.user.role === 'shop_owner';
  cartPanel?.classList.toggle('hidden', isOwner);
  ownerPanel?.classList.toggle('hidden', !isOwner);
  populateShopProfileForm();

  const checkoutButton = document.getElementById('checkoutBtn');
  if (checkoutButton) {
    checkoutButton.disabled = isOwner;
    checkoutButton.style.opacity = isOwner ? '0.6' : '1';
  }
}

function renderStats() {
  if (!state.stats) {
    statsGrid.innerHTML = '';
    return;
  }

  const cards = state.user?.role === 'shop_owner'
    ? [
        { label: 'Products listed', value: state.stats.shopProductCount || 0 },
        { label: 'Orders received', value: state.stats.shopOrderCount || 0 },
        { label: 'Shops on ShopVERSE', value: state.stats.totalShops || 0 }
      ]
    : [
        { label: 'Total shops', value: state.stats.totalShops || 0 },
        { label: 'Your orders', value: state.stats.userOrderCount || 0 },
        { label: 'Marketplace orders', value: state.stats.totalOrders || 0 }
      ];

  statsGrid.innerHTML = cards.map((card) => `
    <article class="stat-card">
      <span class="eyebrow">${escapeHtml(card.label)}</span>
      <span class="value">${escapeHtml(card.value)}</span>
    </article>
  `).join('');
}

function renderShops() {
  shopsList.classList.add('shop-directory-grid');
  if (!state.shops.length) {
    shopsList.innerHTML = '<div class="empty-state">No shops have been created yet.</div>';
    return;
  }

  shopsList.innerHTML = state.shops.map((shop) => `
    <article class="shop-listing-card" style="--shop-accent: ${safeThemeColor(shop.themeColor)};">
      <div class="shop-listing-banner"></div>
      <div class="shop-listing-body">
        <div class="shop-identity">
          ${safeImageUrl(shop.profileImage)
            ? `<img class="shop-avatar" src="${escapeHtml(safeImageUrl(shop.profileImage))}" alt="${escapeHtml(shop.name)} logo" />`
            : `<div class="shop-avatar">${escapeHtml(String(shop.name || '').charAt(0).toUpperCase())}</div>`}
          <div class="shop-listing-title">
            <h3>${escapeHtml(shop.name)}</h3>
            <div class="card-meta"><span>${escapeHtml(shop.owner)}</span><span>${escapeHtml(shop.productCount)} products</span></div>
          </div>
        </div>
        <p>${escapeHtml(shop.description || 'Shop owner has not added a description yet.')}</p>
        <div class="shop-listing-footer">
          <span class="shop-location">${escapeHtml(shop.location || 'Location not set')}</span>
          <button class="small-button" data-shop-id="${escapeHtml(shop.id)}">Explore shop <span aria-hidden="true">→</span></button>
        </div>
      </div>
    </article>
  `).join('');

  shopsList.querySelectorAll('.shop-listing-banner').forEach((banner, index) => {
    const image = safeImageUrl(state.shops[index].bannerImage);
    if (image) {
      banner.style.backgroundImage = `url("${image}")`;
    }
  });

  shopsList.querySelectorAll('[data-shop-id]').forEach((button) => {
    button.addEventListener('click', () => openShop(button.dataset.shopId));
  });
}

async function openShop(shopId) {
  try {
    state.activeShopId = shopId;
    const { shop } = await apiRequest(`/api/shops/${shopId}`);
    const products = shop.products.length ? shop.products.map((product) => {
      const reviewSummary = product.reviewCount
        ? `${Number(product.averageRating).toFixed(1)} ★ (${escapeHtml(product.reviewCount)} reviews)`
        : 'No ratings yet';

      const customerReviews = product.reviews && product.reviews.length
        ? product.reviews.slice(0, 2).map((review) => `
            <div class="review-item">
              <div class="review-head">
                <strong>${escapeHtml(review.customerName)}</strong>
                <span>${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</span>
              </div>
              <p>${escapeHtml(review.comment)}</p>
            </div>
          `).join('')
        : '<div class="empty-state compact-empty">No reviews yet for this product.</div>';

      return `
        <article class="card-item product-card">
          ${getProductImageMarkup(product)}
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <div class="card-meta">
              <span>In stock: ${escapeHtml(product.stock)}</span>
              <span>${escapeHtml(shop.name)}</span>
            </div>
          </div>
          <p>${escapeHtml(product.description || 'No description provided.')}</p>
          <div class="review-summary">${reviewSummary}</div>
          <div class="review-list">${customerReviews}</div>
          ${state.user && state.user.role === 'customer' ? `
            <form class="review-form" data-review-product-id="${escapeHtml(product.id)}">
              <div class="review-form-row">
                <label>
                  <span>Rating</span>
                  <select name="rating">
                    <option value="5">5 ★</option>
                    <option value="4">4 ★</option>
                    <option value="3">3 ★</option>
                    <option value="2">2 ★</option>
                    <option value="1">1 ★</option>
                  </select>
                </label>
              </div>
              <textarea name="comment" rows="2" placeholder="Share your experience"></textarea>
              <button type="submit" class="small-button">Leave review</button>
            </form>
          ` : ''}
          <div class="card-actions">
            <span class="price-tag">${formatMoney(product.price)}</span>
            <button class="primary-button" data-product-id="${escapeHtml(product.id)}">Add to cart</button>
          </div>
        </article>
      `;
    }).join('') : '<div class="empty-state">This shop is not selling any products yet.</div>';

    shopsList.classList.remove('shop-directory-grid');
    shopsList.innerHTML = `
      <div class="storefront-view">
        <div class="shop-card" style="--shop-accent: ${safeThemeColor(shop.themeColor)};">
          <div class="shop-banner"></div>
          <div class="shop-card-body">
            <div class="shop-identity">
              ${safeImageUrl(shop.profileImage)
                ? `<img class="shop-avatar" src="${escapeHtml(safeImageUrl(shop.profileImage))}" alt="${escapeHtml(shop.name)} logo" />`
                : `<div class="shop-avatar">${escapeHtml(String(shop.name || '').charAt(0).toUpperCase())}</div>`}
              <div>
                <h3>${escapeHtml(shop.name)}</h3>
                <div class="card-meta"><span>${escapeHtml(shop.owner)}</span><span>${escapeHtml(shop.products.length)} products</span></div>
              </div>
            </div>
            <p>${escapeHtml(shop.description || 'Shop owner has not added a description yet.')}</p>
            <div class="shop-location detail-location">${escapeHtml(shop.location || 'Location not set')}</div>
          </div>
        </div>
        <div class="product-grid">${products}</div>
      </div>
    `;

    const shopBanner = shopsList.querySelector('.shop-banner');
    const shopBannerImage = safeImageUrl(shop.bannerImage);
    if (shopBanner && shopBannerImage) {
      shopBanner.style.backgroundImage = `url("${shopBannerImage}")`;
    }

    shopsList.querySelectorAll('[data-product-id]').forEach((button) => {
      button.addEventListener('click', () => addToCart(button.dataset.productId));
    });

    shopsList.querySelectorAll('.review-form').forEach((form) => {
      form.addEventListener('submit', handleReviewSubmit);
    });
  } catch (error) {
    reportApiError(error);
  }
}

async function loadDashboard() {
  try {
    const shopQuery = state.shopSearchTerm ? `?search=${encodeURIComponent(state.shopSearchTerm)}` : '';
    const [shopsResult, statsResult] = await Promise.all([
      apiRequest(`/api/shops${shopQuery}`),
      apiRequest('/api/dashboard')
    ]);

    state.shops = shopsResult.shops || [];
    state.stats = statsResult.stats || {};
    renderStats();
    renderShops();
    loadCart();
    loadOrders();
    loadOwnerProducts();
    loadNotifications();
  } catch (error) {
    reportApiError(error);
  }
}

async function loadNotifications() {
  try {
    const result = await apiRequest('/api/notifications');
    state.notifications = result.notifications || [];
    renderNotifications();
  } catch (error) {
    state.notifications = [];
    renderNotifications();
  }
}

function renderNotifications() {
  if (!state.notifications.length) {
    notificationsList.innerHTML = '<div class="empty-state">No notifications yet.</div>';
    return;
  }

  notificationsList.innerHTML = state.notifications.map((item) => `
    <div class="mini-item notification-item">
      <div>
        <strong>${escapeHtml(item.type)}</strong>
        <div class="card-meta">
          <span>${new Date(item.createdAt).toLocaleString()}</span>
        </div>
      </div>
      <span class="notification-message">${escapeHtml(item.message)}</span>
    </div>
  `).join('');
}

async function handleReviewSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const productId = form.dataset.reviewProductId;
  const rating = Number(form.elements.rating.value);
  const comment = form.elements.comment.value.trim();

  if (!productId) {
    return;
  }

  try {
    await apiRequest(`/api/products/${productId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment })
    });

    if (state.activeShopId) {
      await openShop(state.activeShopId);
    }
  } catch (error) {
    reportApiError(error);
  }
}

async function loadCart() {
  try {
    const result = await apiRequest('/api/cart');
    state.cart = result.cart || { items: [], subtotal: 0 };
    renderCart();
  } catch (error) {
    state.cart = { items: [], subtotal: 0 };
    renderCart();
  }
}

function renderCart() {
  if (!state.cart.items || !state.cart.items.length) {
    cartList.innerHTML = '<div class="empty-state">Your cart is empty.</div>';
    cartTotal.textContent = formatMoney(0);
    return;
  }

  cartList.innerHTML = state.cart.items.map((item) => `
    <div class="mini-item">
      <div>
        <strong>${escapeHtml(item.productName)}</strong>
        <div class="card-meta">
          <span>${escapeHtml(item.quantity)} x ${formatMoney(item.price)}</span>
          <span>${escapeHtml(item.shopName)}</span>
        </div>
      </div>
      <div class="inline-button-row compact-row">
        <button class="small-button" data-cart-quantity="${escapeHtml(item.productId)}" data-direction="-1">-</button>
        <span class="qty-pill">${escapeHtml(item.quantity)}</span>
        <button class="small-button" data-cart-quantity="${escapeHtml(item.productId)}" data-direction="1">+</button>
        <button class="small-button" data-remove-product="${escapeHtml(item.productId)}">Remove</button>
      </div>
    </div>
  `).join('');

  cartTotal.textContent = formatMoney(state.cart.subtotal);

  cartList.querySelectorAll('[data-remove-product]').forEach((button) => {
    button.addEventListener('click', () => removeCartItem(button.dataset.removeProduct));
  });

  cartList.querySelectorAll('[data-cart-quantity]').forEach((button) => {
    button.addEventListener('click', () => adjustCartQuantity(button.dataset.cartQuantity, Number(button.dataset.direction)));
  });
}

async function addToCart(productId) {
  try {
    await apiRequest('/api/cart/add', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity: 1 })
    });
    await loadCart();
    alert('Product added to cart.');
  } catch (error) {
    reportApiError(error);
  }
}

async function adjustCartQuantity(productId, direction) {
  try {
    const currentItem = state.cart.items.find((item) => item.productId === productId);
    if (!currentItem) {
      return;
    }

    const nextQuantity = currentItem.quantity + direction;
    await apiRequest('/api/cart/update', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity: nextQuantity })
    });
    await loadCart();
    renderCheckoutModal();
  } catch (error) {
    reportApiError(error);
  }
}

async function removeCartItem(productId) {
  try {
    await apiRequest('/api/cart/remove', {
      method: 'POST',
      body: JSON.stringify({ productId })
    });
    await loadCart();
    if (checkoutModal && !checkoutModal.classList.contains('hidden')) {
      renderCheckoutModal();
    }
  } catch (error) {
    reportApiError(error);
  }
}

async function placeOrder() {
  try {
    if (!state.cart.items || !state.cart.items.length) {
      alert('Your cart is empty.');
      return;
    }

    const shippingAddress = (shippingAddressInput?.value || '').trim();
    if (!shippingAddress) {
      alert('Please add a delivery address before placing the order.');
      shippingAddressInput?.focus();
      return;
    }

    const paymentMethod = paymentMethodSelect?.value || 'zanaco_card';

    const result = await apiRequest('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ shippingAddress, paymentMethod })
    });
    await loadCart();
    await loadOrders();
    await loadDashboard();
    await loadNotifications();
    closeCheckoutModal();
    alert(`Order placed successfully! Total: ${formatMoney(result.order.total)}`);
  } catch (error) {
    reportApiError(error);
  }
}

async function loadOrders() {
  try {
    const path = state.user?.role === 'shop_owner' ? '/api/shop-orders' : '/api/my-orders';
    const result = await apiRequest(path);
    state.orders = result.orders || [];
    renderOrders();
  } catch (error) {
    state.orders = [];
    renderOrders();
  }
}

async function updateOrderStatus(orderId, status) {
  try {
    await apiRequest(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await loadOrders();
    await loadDashboard();
    await loadNotifications();
  } catch (error) {
    reportApiError(error);
  }
}

function renderOrders() {
  if (!state.orders.length) {
    ordersList.innerHTML = '<div class="empty-state">No orders yet.</div>';
    return;
  }

  ordersList.innerHTML = state.orders.map((order) => {
    const statusSelect = state.user?.role === 'shop_owner' ? `
      <label class="order-status-control">
        <span>Status</span>
        <select data-order-status-select="${escapeHtml(order.id)}">
          <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
          <option value="packed" ${order.status === 'packed' ? 'selected' : ''}>Packed</option>
          <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>Shipped</option>
          <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
        </select>
      </label>
    ` : `
      <div class="order-status-badge">${escapeHtml(order.status)}</div>
    `;

    return `
      <article class="card-item">
        <div>
          <h3>Order #${escapeHtml(String(order.id).slice(0, 8))}</h3>
          <div class="card-meta">
            <span>${new Date(order.createdAt).toLocaleDateString()}</span>
            <span>${escapeHtml(order.status)}</span>
          </div>
        </div>
        <div class="mini-list">
          ${order.items.map((item) => `
            <div class="mini-item">
              <span>${escapeHtml(item.productName)} x ${escapeHtml(item.quantity)}</span>
              <strong>${formatMoney(item.price * item.quantity)}</strong>
            </div>
          `).join('')}
        </div>
        <div class="order-meta-block">
          <strong>Delivery:</strong>
          <span>${escapeHtml(order.shippingAddress || 'No shipping address provided.')}</span>
        </div>
        <div class="order-meta-block">
          <strong>Payment:</strong>
          <span>${escapeHtml(order.paymentMethod)} · ${escapeHtml(order.paymentStatus)}</span>
        </div>
        ${statusSelect}
        <div class="card-actions">
          <span class="price-tag">Total: ${formatMoney(order.total)}</span>
        </div>
      </article>
    `;
  }).join('');

  ordersList.querySelectorAll('[data-order-status-select]').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const orderId = event.target.dataset.orderStatusSelect;
      await updateOrderStatus(orderId, event.target.value);
    });
  });
}

async function loadOwnerProducts() {
  try {
    const result = await apiRequest('/api/my-products');
    state.ownerProducts = result.products || [];
    renderOwnerProducts();
  } catch (error) {
    state.ownerProducts = [];
    renderOwnerProducts();
  }
}

function renderOwnerProducts() {
  const productsToRender = state.ownerProducts || [];
  ownerProducts.classList.add('product-grid');

  if (!productsToRender.length) {
    ownerProducts.innerHTML = '<div class="empty-state">You have not added any products yet.</div>';
    return;
  }

  ownerProducts.innerHTML = productsToRender.map((product) => `
    <article class="card-item">
      ${getProductImageMarkup(product)}
      <div>
        <h3>${escapeHtml(product.name)}</h3>
        <div class="card-meta">
          <span>Stock: ${escapeHtml(product.stock)}</span>
          <span>${formatMoney(product.price)}</span>
        </div>
      </div>
      <p>${escapeHtml(product.description || 'No description provided.')}</p>
      <div class="card-actions">
        <span class="price-tag">Live listing</span>
        <div class="inline-button-row compact-row">
          <button type="button" class="small-button" data-edit-product="${escapeHtml(product.id)}">Edit</button>
          <button type="button" class="small-button danger-button" data-delete-product="${escapeHtml(product.id)}">Delete</button>
        </div>
      </div>
    </article>
  `).join('');

  ownerProducts.querySelectorAll('[data-edit-product]').forEach((button) => {
    button.addEventListener('click', () => startEditProduct(button.dataset.editProduct));
  });

  ownerProducts.querySelectorAll('[data-delete-product]').forEach((button) => {
    button.addEventListener('click', () => deleteProduct(button.dataset.deleteProduct));
  });
}

function resetProductForm() {
  productForm.reset();
  if (productForm.elements.image) {
    productForm.elements.image.value = '';
  }
  delete productForm.dataset.editProductId;
  productFormSubmit.textContent = 'Add product';
  cancelProductEditBtn.classList.add('hidden');
}

function startEditProduct(productId) {
  const product = (state.ownerProducts || []).find((item) => item.id === productId);

  if (!product) {
    return;
  }

  productForm.elements.name.value = product.name;
  productForm.elements.description.value = product.description || '';
  productForm.elements.price.value = product.price;
  productForm.elements.stock.value = product.stock;
  productForm.dataset.editProductId = productId;
  productFormSubmit.textContent = 'Save changes';
  cancelProductEditBtn.classList.remove('hidden');
  productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteProduct(productId) {
  const product = (state.ownerProducts || []).find((item) => item.id === productId);

  if (!product) {
    return;
  }

  const confirmed = window.confirm(`Delete "${product.name}" from your shop?`);

  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/api/products/${productId}`, { method: 'DELETE' });
    await loadDashboard();
    alert('Product deleted successfully.');
  } catch (error) {
    reportApiError(error);
  }
}

function renderCheckoutModal() {
  if (!state.cart.items || !state.cart.items.length) {
    checkoutItems.innerHTML = '<div class="empty-state">Your cart is empty.</div>';
    checkoutTotal.textContent = formatMoney(0);
    confirmCheckoutBtn.disabled = true;
    return;
  }

  checkoutItems.innerHTML = state.cart.items.map((item) => `
    <div class="mini-item">
      <div>
        <strong>${escapeHtml(item.productName)}</strong>
        <div class="card-meta">
          <span>${escapeHtml(item.quantity)} x ${formatMoney(item.price)}</span>
          <span>${escapeHtml(item.shopName)}</span>
        </div>
      </div>
      <strong>${formatMoney(item.price * item.quantity)}</strong>
    </div>
  `).join('');

  checkoutTotal.textContent = formatMoney(state.cart.subtotal);
  confirmCheckoutBtn.disabled = false;
}

function openCheckoutModal() {
  if (!state.cart.items || !state.cart.items.length) {
    alert('Your cart is empty.');
    return;
  }

  if (shippingAddressInput) {
    shippingAddressInput.value = '';
  }
  if (paymentMethodSelect) {
    paymentMethodSelect.value = 'zanaco_card';
  }
  renderCheckoutModal();
  checkoutModal.classList.remove('hidden');
}

function closeCheckoutModal() {
  if (shippingAddressInput) {
    shippingAddressInput.value = '';
  }
  if (paymentMethodSelect) {
    paymentMethodSelect.value = 'zanaco_card';
  }
  checkoutModal.classList.add('hidden');
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const formData = new FormData(authForm);
  const payload = Object.fromEntries(formData.entries());
  const isLogin = state.activeMode === 'login';

  if (isLogin) {
    const { email, password } = payload;
    try {
      const result = await apiRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      saveSession(result.user, result.token);
      state.user = result.user;
      afterLogin();
    } catch (error) {
      reportApiError(error);
    }
    return;
  }

  try {
    const result = await apiRequest('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        email: payload.email,
        password: payload.password,
        role: payload.role,
        shopName: payload.shopName,
        shopDescription: payload.shopDescription,
        shopLocation: payload.shopLocation
      })
    });

    saveSession(result.user, result.token);
    state.user = result.user;
    afterLogin();
  } catch (error) {
    reportApiError(error);
  }
}

function afterLogin() {
  authForm.reset();
  appSection.classList.remove('hidden');
  authSection.classList.add('hidden');
  logoutBtn.hidden = false;
  renderUserBadge();
  renderRoleSpecificUI();
  loadDashboard();
}

function renderLoggedOut() {
  authSection.classList.remove('hidden');
  appSection.classList.add('hidden');
  logoutBtn.hidden = true;
  state.user = null;
  clearSession();
  renderUserBadge();
  renderRoleSpecificUI();
}

async function handleShopProfileSubmit(event) {
  event.preventDefault();

  if (!state.user || state.user.role !== 'shop_owner') {
    return;
  }

  try {
    const formData = new FormData(shopProfileForm);
    const profileFile = formData.get('shopProfileImageFile');
    const bannerFile = formData.get('shopBannerImageFile');
    const payload = {
      shopName: formData.get('shopName') || state.user.shopName,
      shopDescription: formData.get('shopDescription') || state.user.shopDescription,
      shopLocation: formData.get('shopLocation') || state.user.shopLocation,
      shopThemeColor: formData.get('shopThemeColor') || state.user.shopThemeColor || '#4f46e5'
    };

    if (profileFile && profileFile.size) {
      payload.shopProfileImage = await readFileAsDataUrl(profileFile);
    }

    if (bannerFile && bannerFile.size) {
      payload.shopBannerImage = await readFileAsDataUrl(bannerFile);
    }

    const result = await apiRequest('/api/me', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    state.user = result.user;
    saveSession(result.user, getStoredToken());
    populateShopProfileForm();
    await loadDashboard();
    alert('Shop profile updated successfully.');
  } catch (error) {
    reportApiError(error);
  }
}

async function handleProductSubmit(event) {
  event.preventDefault();
  const formData = new FormData(productForm);
  const payload = Object.fromEntries(formData.entries());
  const isEditing = Boolean(productForm.dataset.editProductId);

  try {
    const nextPayload = {
      name: payload.name,
      description: payload.description,
      price: Number(payload.price),
      stock: Number(payload.stock)
    };

    const imageFile = productForm.elements.image && productForm.elements.image.files[0];
    if (imageFile && imageFile.size) {
      nextPayload.image = await readFileAsDataUrl(imageFile);
    }

    const options = {
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify(nextPayload)
    };

    const route = isEditing ? `/api/products/${productForm.dataset.editProductId}` : '/api/products';
    await apiRequest(route, options);

    resetProductForm();
    await loadDashboard();
    alert(isEditing ? 'Product updated successfully.' : 'Product successfully added to your shop.');
  } catch (error) {
    reportApiError(error);
  }
}

async function initializeApp() {
  const savedUser = getStoredUser();
  const savedToken = getStoredToken();

  if (savedUser && savedToken) {
    state.user = savedUser;
    appSection.classList.remove('hidden');
    authSection.classList.add('hidden');
    logoutBtn.hidden = false;
    renderUserBadge();
    renderRoleSpecificUI();
    await loadDashboard();
  }

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => setAuthMode(button.dataset.mode));
  });

  authForm.addEventListener('submit', handleAuthSubmit);
  logoutBtn.addEventListener('click', renderLoggedOut);
  if (shopProfileForm) {
    shopProfileForm.addEventListener('submit', handleShopProfileSubmit);
  }
  productForm.addEventListener('submit', handleProductSubmit);
  cancelProductEditBtn.addEventListener('click', resetProductForm);
  shopSearchInput?.addEventListener('input', async (event) => {
    state.shopSearchTerm = event.target.value.trim();
    await loadDashboard();
  });
  closeCheckoutModalBtn.addEventListener('click', closeCheckoutModal);
  cancelCheckoutBtn.addEventListener('click', closeCheckoutModal);
  confirmCheckoutBtn.addEventListener('click', placeOrder);
  document.getElementById('checkoutBtn').addEventListener('click', openCheckoutModal);
  setAuthMode('login');
}

if (typeof document !== 'undefined') {
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
    loadDashboard,
    reportApiError
  };
}
