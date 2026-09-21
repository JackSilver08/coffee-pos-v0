const API = 'http://127.0.0.1:4782/api';

const state = {
  token: localStorage.getItem('coffee_pos_token') || '',
  user: null,
  products: [],
  categories: [],
  categoryId: 'ALL',
  search: '',
  cart: new Map(),
  paymentMethod: 'CASH',
  shift: null,
  section: 'sale'
};

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency', currency: 'VND', maximumFractionDigits: 0
}).format(Number(value) || 0);

const roleLabel = (role) => ({ cashier: 'CASHIER', barista: 'BARISTA', admin: 'ADMIN' })[role] || role;
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearSession();
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  if (!res.ok) throw new Error(data.error || `API ${res.status}`);
  return data;
}

function toast(message) {
  $('#toastMessage').textContent = message;
  bootstrap.Toast.getOrCreateInstance($('#appToast'), { delay: 2800 }).show();
}

function clearSession() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('coffee_pos_token');
  $('#appView').classList.add('d-none');
  $('#loginView').classList.remove('d-none');
}

function allowedSections() {
  if (!state.user) return [];
  if (state.user.role === 'admin') return ['sale', 'kds', 'products', 'reports', 'users'];
  if (state.user.role === 'barista') return ['kds'];
  return ['sale'];
}

function renderNav() {
  const items = [
    ['sale', '🧾', 'Bán hàng'],
    ['kds', '☕', 'Bar / KDS'],
    ['products', '📦', 'Sản phẩm'],
    ['reports', '📊', 'Báo cáo'],
    ['users', '👥', 'Người dùng']
  ];
  $('#navStack').innerHTML = items
    .filter(([section]) => allowedSections().includes(section))
    .map(([section, icon, label]) => `<button class="nav-item ${state.section === section ? 'active' : ''}" data-section="${section}"><span>${icon}</span><span>${label}</span></button>`)
    .join('');
  document.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => setSection(button.dataset.section));
  });
}

function renderUser() {
  $('#userName').textContent = state.user.displayName;
  $('#userRole').textContent = roleLabel(state.user.role);
  $('#userAvatar').textContent = state.user.displayName.slice(0, 1).toUpperCase();
}

function setSection(section) {
  const allowed = allowedSections();
  state.section = allowed.includes(section) ? section : allowed[0];
  const titles = { sale: 'Bán hàng', kds: 'Bar / KDS', products: 'Sản phẩm', reports: 'Báo cáo', users: 'Người dùng' };
  $('#pageTitle').textContent = titles[state.section] || 'Coffee POS';
  document.querySelectorAll('.section-view').forEach((el) => el.classList.remove('active'));
  $(`#${state.section}Section`).classList.add('active');
  renderNav();

  if (state.section === 'kds') loadKds();
  if (state.section === 'products') renderProductTable();
  if (state.section === 'reports') loadReports();
  if (state.section === 'users') loadUsers();
}

async function login(username, password) {
  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  state.token = result.data.token;
  state.user = result.data.user;
  localStorage.setItem('coffee_pos_token', state.token);
  $('#loginView').classList.add('d-none');
  $('#appView').classList.remove('d-none');
  $('#loginError').classList.add('d-none');
  renderUser();
  renderNav();
  await loadAll();
}

async function loadAll() {
  if (state.user.role !== 'barista') {
    const [products, categories, shift] = await Promise.all([
      api('/products'),
      api('/categories'),
      api('/shifts/current')
    ]);
    state.products = products.data;
    state.categories = categories.data;
    state.shift = shift.data;
  } else {
    state.shift = null;
  }

  renderCategories();
  renderProducts();
  renderCart();
  renderShift();
  setSection(allowedSections()[0]);
}

function renderShift() {
  if (!state.user || state.user.role === 'barista') {
    $('#shiftCard').innerHTML = '<div class="small text-muted">KDS mode</div>';
    return;
  }
  const shift = state.shift;
  $('#shiftCard').innerHTML = shift
    ? `<div class="shift-status"><span class="status-dot"></span> Ca đang mở</div><div class="shift-caption">${escapeHtml(shift.opened_by)} • đầu ca ${money(shift.opening_cash)}</div><button id="closeShiftButton" class="btn btn-sm btn-outline-danger mt-2 w-100">Đóng ca</button>`
    : '<div class="shift-status">Chưa mở ca</div><div class="shift-caption">Mở ca trước khi thanh toán</div><button id="openShiftButton" class="btn btn-sm btn-primary mt-2 w-100">Mở ca</button>';

  $('#openShiftButton')?.addEventListener('click', async () => {
    const raw = prompt('Tiền đầu ca:', '0');
    if (raw === null) return;
    try {
      const result = await api('/shifts/open', {
        method: 'POST',
        body: JSON.stringify({ openingCash: Number(raw) })
      });
      state.shift = result.data;
      renderShift();
      toast('Đã mở ca.');
    } catch (error) { toast(error.message); }
  });

  $('#closeShiftButton')?.addEventListener('click', async () => {
    const raw = prompt('Tiền thực tế cuối ca:', '0');
    if (raw === null) return;
    try {
      await api(`/shifts/${state.shift.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ closingCash: Number(raw) })
      });
      state.shift = null;
      renderShift();
      toast('Đã đóng ca.');
    } catch (error) { toast(error.message); }
  });
}

function renderCategories() {
  $('#categoryTabs').innerHTML = [
    `<button class="category-tab ${state.categoryId === 'ALL' ? 'active' : ''}" data-category="ALL">Tất cả</button>`,
    ...state.categories.map((c) => `<button class="category-tab ${state.categoryId === c.id ? 'active' : ''}" data-category="${c.id}">${escapeHtml(c.name)}</button>`)
  ].join('');
  document.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.categoryId = button.dataset.category;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  if (!$('#productGrid')) return;
  const term = state.search.toLowerCase();
  const products = state.products.filter((p) =>
    (state.categoryId === 'ALL' || p.category_id === state.categoryId) &&
    (!term || p.name.toLowerCase().includes(term) || String(p.sku || '').toLowerCase().includes(term))
  );
  $('#productGrid').innerHTML = products.length
    ? products.map((p) => `<button class="product-card" data-product="${p.id}"><div><div class="product-sku">${escapeHtml(p.sku || 'NO-SKU')}</div><div class="product-name">${escapeHtml(p.name)}</div></div><div class="product-bottom"><b>${money(p.price)}</b><span class="add-pill">+</span></div></button>`).join('')
    : '<div class="empty-state">Không tìm thấy sản phẩm.</div>';
  document.querySelectorAll('[data-product]').forEach((button) => button.addEventListener('click', () => addToCart(button.dataset.product)));
}

function addToCart(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  const current = state.cart.get(productId);
  state.cart.set(productId, { product, quantity: (current?.quantity || 0) + 1 });
  renderCart();
}

function renderCart() {
  const items = [...state.cart.values()];
  const total = items.reduce((sum, x) => sum + Number(x.product.price) * x.quantity, 0);
  $('#cartCount').textContent = items.reduce((sum, x) => sum + x.quantity, 0);
  $('#subtotalValue').textContent = money(total);
  $('#totalValue').textContent = money(total);
  const received = Number($('#receivedAmount')?.value || 0);
  $('#changeValue').textContent = money(Math.max(0, received - total));

  $('#cartItems').innerHTML = items.length ? items.map((x) => `
    <div class="cart-item">
      <div><div class="cart-item-name">${escapeHtml(x.product.name)}</div><div class="cart-item-meta">${money(x.product.price)} × ${x.quantity}</div></div>
      <div class="cart-item-right"><div class="cart-item-total">${money(Number(x.product.price) * x.quantity)}</div><div class="qty-control"><button data-dec="${x.product.id}">−</button><span>${x.quantity}</span><button data-inc="${x.product.id}">+</button></div></div>
    </div>`).join('') : '<div class="empty-cart"><div class="empty-icon">🛒</div><div>Chưa có món</div><small>Chọn sản phẩm để bắt đầu order</small></div>';

  document.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => changeQty(b.dataset.inc, 1)));
  document.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => changeQty(b.dataset.dec, -1)));
}

function changeQty(id, delta) {
  const item = state.cart.get(id);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.cart.delete(id);
  renderCart();
}

async function submitPayment() {
  if (!state.shift) return toast('Hãy mở ca trước khi thanh toán.');
  if (!state.cart.size) return toast('Chưa có món trong giỏ.');

  const items = [...state.cart.values()].map((x) => ({ productId: x.product.id, quantity: x.quantity }));
  const receivedAmount = Number($('#receivedAmount').value || 0);

  try {
    const result = await api('/orders', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: state.shift.id,
        paymentMethod: state.paymentMethod,
        receivedAmount: state.paymentMethod === 'CASH' ? receivedAmount : undefined,
        items
      })
    });

    state.cart.clear();
    $('#receivedAmount').value = '';
    renderCart();
    toast(`Đã thanh toán ${result.data.orderCode}.`);
    if (window.pos?.printReceipt) await window.pos.printReceipt(result.data);
  } catch (error) {
    toast(error.message);
  }
}

async function loadKds() {
  const result = await api('/kds/orders');
  $('#kdsGrid').innerHTML = result.data.length ? result.data.map((order) => `
    <article class="kds-card">
      <div class="kds-head"><div><b>${order.order_code}</b><span class="kds-time">${new Date(order.created_at).toLocaleTimeString('vi-VN')}</span></div><span class="kds-badge">${order.kitchen_status}</span></div>
      <div class="kds-items">${order.items.map((item) => `<div><span>${escapeHtml(item.name)}</span><b>×${item.quantity}</b></div>`).join('')}</div>
      <button class="btn btn-primary w-100" data-kds-id="${order.id}" data-kds-status="${nextStatus(order.kitchen_status)}">${nextAction(order.kitchen_status)}</button>
    </article>`).join('') : '<div class="empty-state">Không có order đang chờ pha chế.</div>';

  document.querySelectorAll('[data-kds-id]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api(`/kds/orders/${button.dataset.kdsId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: button.dataset.kdsStatus })
      });
      await loadKds();
    } catch (error) { toast(error.message); }
  }));
}

const nextStatus = (status) => ({ NEW: 'PREPARING', PREPARING: 'READY', READY: 'DONE' })[status] || 'DONE';
const nextAction = (status) => ({ NEW: 'Bắt đầu pha', PREPARING: 'Đã pha xong', READY: 'Đã giao' })[status] || 'Hoàn tất';

async function loadReports() {
  const result = await api('/reports/today');
  $('#reportOrders').textContent = result.data.summary.order_count;
  $('#reportRevenue').textContent = money(result.data.summary.revenue);
  $('#reportAverage').textContent = money(result.data.summary.average_order);
  $('#topProducts').innerHTML = result.data.topProducts.map((p) => `<div class="top-card"><b>${escapeHtml(p.name)}</b><span>${p.quantity} món</span><strong>${money(p.revenue)}</strong></div>`).join('') || '<div class="empty-state">Chưa có dữ liệu.</div>';
}

function renderProductTable() {
  $('#pCategory').innerHTML = state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('#productsTable').innerHTML = state.products.map((p) => `
    <tr><td>${escapeHtml(p.sku || '')}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category_name)}</td><td>${money(p.price)}</td><td><span class="badge ${p.active ? 'text-bg-success' : 'text-bg-secondary'}">${p.active ? 'ACTIVE' : 'OFF'}</span></td><td><button class="btn btn-sm btn-outline-secondary" data-toggle-product="${p.id}">${p.active ? 'Tắt' : 'Bật'}</button></td></tr>
  `).join('');
  document.querySelectorAll('[data-toggle-product]').forEach((button) => button.addEventListener('click', async () => {
    const product = state.products.find((p) => p.id === button.dataset.toggleProduct);
    const name = prompt('Tên sản phẩm:', product.name);
    if (name === null) return;
    const price = prompt('Giá:', product.price);
    if (price === null) return;
    try {
      await api(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, price: Number(price), active: !product.active })
      });
      await refreshCatalog();
    } catch (error) { toast(error.message); }
  }));
}

async function refreshCatalog() {
  const [products, categories] = await Promise.all([api('/products?includeInactive=true'), api('/categories')]);
  state.products = products.data;
  state.categories = categories.data;
  renderCategories(); renderProducts(); renderProductTable();
}

async function loadUsers() {
  const result = await api('/users');
  $('#usersTable').innerHTML = result.data.map((u) => `
    <tr><td><b>${escapeHtml(u.username)}</b></td><td>${escapeHtml(u.display_name)}</td><td><span class="badge text-bg-light">${u.role}</span></td><td><span class="badge ${u.active ? 'text-bg-success' : 'text-bg-secondary'}">${u.active ? 'ACTIVE' : 'LOCKED'}</span></td><td><button class="btn btn-sm btn-outline-secondary" data-toggle-user="${u.id}" data-active="${u.active}">${u.active ? 'Khóa' : 'Mở'}</button></td></tr>
  `).join('');
  document.querySelectorAll('[data-toggle-user]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api(`/users/${button.dataset.toggleUser}/status`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== 'true' }) });
      await loadUsers();
    } catch (error) { toast(error.message); }
  }));
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await login($('#username').value, $('#password').value);
  } catch (error) {
    $('#loginError').textContent = error.message;
    $('#loginError').classList.remove('d-none');
  }
});

$('#logoutButton').addEventListener('click', async () => {
  try { if (state.token) await api('/auth/logout', { method: 'POST' }); } catch {}
  clearSession();
});

$('#searchInput').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderProducts();
});

document.querySelectorAll('[data-payment]').forEach((button) => {
  button.addEventListener('click', () => {
    state.paymentMethod = button.dataset.payment;
    document.querySelectorAll('[data-payment]').forEach((b) => b.classList.toggle('active', b === button));
    $('#cashBox').classList.toggle('d-none', state.paymentMethod !== 'CASH');
  });
});

$('#receivedAmount').addEventListener('input', renderCart);
$('#payButton').addEventListener('click', submitPayment);
$('#refreshKds').addEventListener('click', () => loadKds().catch((e) => toast(e.message)));

$('#productForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/products', {
      method: 'POST',
      body: JSON.stringify({
        sku: $('#pSku').value,
        name: $('#pName').value,
        categoryId: $('#pCategory').value,
        price: Number($('#pPrice').value)
      })
    });
    event.target.reset();
    await refreshCatalog();
    toast('Đã thêm sản phẩm.');
  } catch (error) { toast(error.message); }
});

$('#categoryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/categories', {
      method: 'POST',
      body: JSON.stringify({ name: $('#cName').value, sortOrder: Number($('#cOrder').value) })
    });
    event.target.reset();
    await refreshCatalog();
    toast('Đã thêm danh mục.');
  } catch (error) { toast(error.message); }
});

$('#userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#uUsername').value,
        displayName: $('#uDisplayName').value,
        password: $('#uPassword').value,
        role: $('#uRole').value
      })
    });
    event.target.reset();
    await loadUsers();
    toast('Đã tạo tài khoản.');
  } catch (error) { toast(error.message); }
});

(async function bootstrapApp() {
  if (!state.token) return;
  try {
    const result = await api('/auth/me');
    state.user = result.data;
    $('#loginView').classList.add('d-none');
    $('#appView').classList.remove('d-none');
    renderUser(); renderNav();
    await loadAll();
  } catch {
    clearSession();
  }
})();
