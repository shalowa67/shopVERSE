const state = {
  user: null,
  activeMode: 'login',
  shops: [],
  products: [],
  cart: { items: [], subtotal: 0 },
  orders: [],
  stats: null
};

const authSection = document.getElementById('authSection');
const appSection = document.getElementById('appSection');
const authForm = document.getElementById('authForm');
const logoutBtn = document.getElementById('logoutBtn');
const userBadge = document.getElementById('userBadge');
const shopsList = document.getElementById('shopsList');
const cartList = document.getElementById('cartList');
const cartTotal = document.getElementById('cartTotal');
const cartPanel = document.querySelector('.cart-panel');
const ownerPanel = document.getElementById('ownerPanel');
const ownerProducts = document.getElementById('ownerProducts');
const ordersList = document.getElementById('ordersList');
const statsGrid = document.getElementById('statsGrid');
const productForm = document.getElementById('productForm');
const authSubmitButton = document.getElementById('authSubmitButton');
const roleField = document.getElementById('roleField');
const shopNameField = document.getElementById('shopNameField');
const shopDescriptionField = document.getElementById('shopDescriptionField');

const userSessionKey = 'shopverse-user';
const tokenKey = 'shopverse-token';

const formatMoney = (value) => new Intl.NumberFormat('en-ZM', {
  style: 'currency',
  currency: 'ZMW'
}).format(Number(value || 0));

function saveSession(user, token) {
  localStorage.setItem(userSessionKey, JSON.stringify(user));
  localStorage.setItem(tokenKey, token);
}

function clearSession() {
  localStorage.removeItem(userSessionKey);
  localStorage.removeItem(tokenKey);
}

function getStoredUser() {
  const stored = localStorage.getItem(userSessionKey);
  return stored ? JSON.parse(stored) : null;
}

function getStoredToken() {
  return localStorage.getItem(tokenKey);
}

function setAuthMode(mode) {
  state.activeMode = mode;
  const tabs = document.querySelectorAll('.tab-button');
  tabs.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));

  const fields = [
    { element: roleField, visible: mode === 'register' },
    { element: shopNameField, visible: mode === 'register' },
    { element: shopDescriptionField, visible: mode === 'register' }
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
    throw new Error(result.message || 'Request failed.');
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

function renderRoleSpecificUI() {
  if (!state.user) {
    if (cartPanel) cartPanel.classList.add('hidden');
    if (ownerPanel) ownerPanel.classList.add('hidden');
    return;
  }

  const isOwner = state.user.role === 'shop_owner';
  if (cartPanel) cartPanel.classList.toggle('hidden', isOwner);
  if (ownerPanel) ownerPanel.classList.toggle('hidden', !isOwner);

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

  const cards = [
    { label: 'Total shops', value: state.stats.totalShops },
    { label: 'Products', value: state.stats.shopProductCount || 0 },
    { label: 'Orders', value: state.stats.userOrderCount || 0 },
    { label: 'Marketplace orders', value: state.stats.totalOrders || 0 }
  ];

  statsGrid.innerHTML = cards.map((card) => `
    <article class="stat-card">
      <span class="eyebrow">${card.label}</span>
      <span class="value">${card.value}</span>
    </article>
  `).join('');
}

function renderShops() {
  if (!state.shops.length) {
    shopsList.innerHTML = '<div class="empty-state">No shops have been created yet.</div>';
    return;
  }

  shopsList.innerHTML = state.shops.map((shop) => `
    <article class="card-item">
      <div>
        <h3>${shop.name}</h3>
        <div class="card-meta">
          <span>${shop.owner}</span>
          <span>${shop.productCount} products</span>
        </div>
      </div>
      <p>${shop.description || 'Shop owner has not added a description yet.'}</p>
      <div class="card-actions">
        <span class="price-tag">Shop</span>
        <button class="small-button" data-shop-id="${shop.id}">View items</button>
      </div>
    </article>
  `).join('');

  shopsList.querySelectorAll('[data-shop-id]').forEach((button) => {
    button.addEventListener('click', () => openShop(button.dataset.shopId));
  });
}

async function openShop(shopId) {
  try {
    const { shop } = await apiRequest(`/api/shops/${shopId}`);
    const products = shop.products.length ? shop.products.map((product) => `
      <article class="card-item">
        <div>
          <h3>${product.name}</h3>
          <div class="card-meta">
            <span>In stock: ${product.stock}</span>
            <span>${shop.name}</span>
          </div>
        </div>
        <p>${product.description || 'No description provided.'}</p>
        <div class="card-actions">
          <span class="price-tag">${formatMoney(product.price)}</span>
          <button class="primary-button" data-product-id="${product.id}">Add to cart</button>
        </div>
      </article>
    `).join('') : '<div class="empty-state">This shop is not selling any products yet.</div>';

    shopsList.innerHTML = `
      <div class="card-item">
        <h3>${shop.name}</h3>
        <div class="card-meta">
          <span>${shop.owner}</span>
          <span>${shop.products.length} products</span>
        </div>
        <p>${shop.description}</p>
      </div>
      ${products}
    `;

    shopsList.querySelectorAll('[data-product-id]').forEach((button) => {
      button.addEventListener('click', () => addToCart(button.dataset.productId));
    });
  } catch (error) {
    alert(error.message);
  }
}

async function loadDashboard() {
  try {
    const [shopsResult, statsResult] = await Promise.all([
      apiRequest('/api/shops'),
      apiRequest('/api/dashboard')
    ]);

    state.shops = shopsResult.shops || [];
    state.stats = statsResult.stats || {};
    renderStats();
    renderShops();
    loadCart();
    loadOrders();
    loadOwnerProducts();
  } catch (error) {
    alert(error.message);
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
        <strong>${item.productName}</strong>
        <div class="card-meta">
          <span>${item.quantity} x ${formatMoney(item.price)}</span>
          <span>${item.shopName}</span>
        </div>
      </div>
      <button class="small-button" data-remove-product="${item.productId}">Remove</button>
    </div>
  `).join('');

  cartTotal.textContent = formatMoney(state.cart.subtotal);

  cartList.querySelectorAll('[data-remove-product]').forEach((button) => {
    button.addEventListener('click', () => removeCartItem(button.dataset.removeProduct));
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
    alert(error.message);
  }
}

async function removeCartItem(productId) {
  try {
    await apiRequest('/api/cart/remove', {
      method: 'POST',
      body: JSON.stringify({ productId })
    });
    await loadCart();
  } catch (error) {
    alert(error.message);
  }
}

async function placeOrder() {
  try {
    const result = await apiRequest('/api/orders', { method: 'POST' });
    await loadCart();
    await loadOrders();
    await loadDashboard();
    alert(`Order placed successfully! Total: ${formatMoney(result.order.total)}`);
  } catch (error) {
    alert(error.message);
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

function renderOrders() {
  if (!state.orders.length) {
    ordersList.innerHTML = '<div class="empty-state">No orders yet.</div>';
    return;
  }

  ordersList.innerHTML = state.orders.map((order) => `
    <article class="card-item">
      <div>
        <h3>Order #${order.id.slice(0, 8)}</h3>
        <div class="card-meta">
          <span>${new Date(order.createdAt).toLocaleDateString()}</span>
          <span>${order.status}</span>
        </div>
      </div>
      <div class="mini-list">
        ${order.items.map((item) => `
          <div class="mini-item">
            <span>${item.productName} x ${item.quantity}</span>
            <strong>${formatMoney(item.price * item.quantity)}</strong>
          </div>
        `).join('')}
      </div>
      <div class="card-actions">
        <span class="price-tag">Total: ${formatMoney(order.total)}</span>
      </div>
    </article>
  `).join('');
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

  if (!productsToRender.length) {
    ownerProducts.innerHTML = '<div class="empty-state">You have not added any products yet.</div>';
    return;
  }

  ownerProducts.innerHTML = productsToRender.map((product) => `
    <article class="card-item">
      <div>
        <h3>${product.name}</h3>
        <div class="card-meta">
          <span>Stock: ${product.stock}</span>
          <span>${formatMoney(product.price)}</span>
        </div>
      </div>
      <p>${product.description || 'No description provided.'}</p>
    </article>
  `).join('');
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
      alert(error.message);
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
        shopDescription: payload.shopDescription
      })
    });

    saveSession(result.user, result.token);
    state.user = result.user;
    afterLogin();
  } catch (error) {
    alert(error.message);
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

async function handleProductSubmit(event) {
  event.preventDefault();
  const formData = new FormData(productForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    await apiRequest('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        description: payload.description,
        price: Number(payload.price),
        stock: Number(payload.stock)
      })
    });

    productForm.reset();
    await loadDashboard();
    alert('Product successfully added to your shop.');
  } catch (error) {
    alert(error.message);
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
  productForm.addEventListener('submit', handleProductSubmit);
  document.getElementById('checkoutBtn').addEventListener('click', placeOrder);
  setAuthMode('login');
}

initializeApp();
