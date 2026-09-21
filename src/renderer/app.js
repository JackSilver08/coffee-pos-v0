const API = 'http://127.0.0.1:4782/api';

const state = {
  products: [],
  categories: [],
  categoryId: 'ALL',
  search: '',
  cart: new Map(),
  paymentMethod: 'CASH',
  shift: null,
  currentOrder: null
};

const money = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency', currency: 'VND', maximumFractionDigits: 0
}).format(Number(value) || 0);

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
  return payload;
}

function toast(message) {
  $('#toastMessage').textContent = message;
  bootstrap.Toast.getOrCreateInstance($('#appToast'), { delay: 3000 }).show();
}

function renderCategories() {
  $('#categoryTabs').innerHTML = [
    `<button class="category-tab ${state.categoryId === 'ALL' ? 'active' : ''}" data-category="ALL">Tất cả</button>`,
    ...state.categories.map((category) => `<button class="category-tab ${state.categoryId === category.id ? 'active' : ''}" data-category="${category.id}">${escapeHtml(category.name)}</button>`)
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
  const term = state.search.toLowerCase();
  const products = state.products.filter((product) => {
    const byCategory = state.categoryId === 'ALL' || product.category_id === state.categoryId;
    const bySearch = !term || product.name.toLowerCase().includes(term) || (product.sku || '').toLowerCase().includes(term);
    return byCategory && bySearch;
  });

  $('#productGrid').innerHTML = products.length ? products.map((product) => `
    <button class="product-card text-start" data-product-id="${product.id}">
      <div>
        <div class="product-sku">${escapeHtml(product.sku || '')}</div>
        <div class="product-name">${escapeHtml(product.name)}</div>
      </div>
      <div class="product-bottom">
        <div class="product-price">${money(product.price)}</div>
        <div class="add-pill">+</div>
      </div>
    </button>
  `).join('') : `<div class="text-center text-secondary py-5">Không tìm thấy món phù hợp.</div>`;

  document.querySelectorAll('[data-product-id]').forEach((button) => {
    button.addEventListener('click', () => addToCart(button.dataset.productId));
  });
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  const current = state.cart.get(productId) || { product, quantity: 0 };
  current.quantity += 1;
  state.cart.set(productId, current);
  renderCart();
}

function changeQuantity(productId, delta) {
  const item = state.cart.get(productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.cart.delete(productId);
  renderCart();
}

function cartTotals() {
  const subtotal = [...state.cart.values()].reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  return { subtotal, total: subtotal };
}

function renderCart() {
  if (!state.cart.size) {
    $('#cartItems').innerHTML = `<div class="empty-cart"><div class="empty-icon">🛒</div><div class="fw-semibold">Chưa có món</div><div class="small text-secondary">Chọn sản phẩm bên trái để bắt đầu.</div></div>`;
  } else {
    $('#cartItems').innerHTML = [...state.cart.values()].map((item) => `
      <div class="cart-item">
        <div>
          <div class="cart-item-name">${escapeHtml(item.product.name)}</div>
          <div class="cart-item-meta">${money(item.product.price)} × ${item.quantity}</div>
          <div class="qty-control">
            <button data-action="minus" data-id="${item.product.id}">−</button>
            <span>${item.quantity}</span>
            <button data-action="plus" data-id="${item.product.id}">+</button>
          </div>
        </div>
        <div class="cart-item-right">
          <div class="cart-item-total">${money(Number(item.product.price) * item.quantity)}</div>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => changeQuantity(button.dataset.id, button.dataset.action === 'plus' ? 1 : -1));
    });
  }

  const { subtotal, total } = cartTotals();
  $('#subtotalText').textContent = money(subtotal);
  $('#totalText').textContent = money(total);
  updateChange();
}

function updateChange() {
  const { total } = cartTotals();
  const received = Number($('#cashReceived').value || 0);
  const change = state.paymentMethod === 'CASH' ? Math.max(received - total, 0) : 0;
  $('#changeText').textContent = money(change);
  $('#checkoutButton').disabled = state.cart.size === 0 || (state.paymentMethod === 'CASH' && received < total);
}

function setPaymentMethod(method) {
  state.paymentMethod = method;
  document.querySelectorAll('.payment-tab').forEach((button) => button.classList.toggle('active', button.dataset.payment === method));
  $('#cashReceived').disabled = method !== 'CASH';
  $('#cashReceived').placeholder = method === 'CASH' ? '0' : 'QR không cần nhập tiền';
  if (method !== 'CASH') $('#cashReceived').value = '';
  updateChange();
}

async function checkout() {
  if (!state.shift) {
    toast('Hãy mở ca trước khi thanh toán.');
    openShiftModal();
    return;
  }

  const { total } = cartTotals();
  const items = [...state.cart.values()].map((item) => ({ productId: item.product.id, quantity: item.quantity }));
  const receivedAmount = state.paymentMethod === 'CASH' ? Number($('#cashReceived').value || 0) : total;

  const button = $('#checkoutButton');
  button.disabled = true;
  button.textContent = 'Đang xử lý...';

  try {
    const response = await api('/orders', {
      method: 'POST',
      body: JSON.stringify({
        items,
        paymentMethod: state.paymentMethod,
        receivedAmount,
        shiftId: state.shift.id
      })
    });

    state.currentOrder = response.data;
    state.cart.clear();
    $('#cashReceived').value = '';
    renderCart();
    toast(`Đã thanh toán ${response.data.orderCode} • ${money(response.data.total)}`);

    const printResult = await window.pos.printReceipt(response.data);
    if (!printResult.success) toast(`Đơn đã lưu, chưa in được hóa đơn: ${printResult.failureReason || 'printer unavailable'}`);
    await loadReports();
  } catch (error) {
    toast(error.message);
  } finally {
    button.textContent = 'Thanh toán';
    updateChange();
  }
}

async function loadProducts() {
  const [products, categories] = await Promise.all([api('/products'), api('/categories')]);
  state.products = products.data;
  state.categories = categories.data;
  renderCategories();
  renderProducts();
  renderProductsTable();
}

function renderProductsTable() {
  $('#productsTableBody').innerHTML = state.products.map((product) => `
    <tr><td><code>${escapeHtml(product.sku || '')}</code></td><td class="fw-semibold">${escapeHtml(product.name)}</td><td>${escapeHtml(product.category_name)}</td><td class="text-end fw-semibold">${money(product.price)}</td></tr>
  `).join('');
}

async function loadShift() {
  const response = await api('/shifts/current');
  state.shift = response.data;
  renderShift();
}

function renderShift() {
  if (!state.shift) {
    $('#shiftCard').innerHTML = `<div class="shift-status">Chưa mở ca</div><div class="shift-caption">Thu ngân chưa bắt đầu ca</div>`;
    $('#shiftButton').textContent = 'Mở ca';
  } else {
    $('#shiftCard').innerHTML = `<div class="shift-status">Ca đang mở • ${escapeHtml(state.shift.opened_by)}</div><div class="shift-caption">Tiền đầu ca: ${money(state.shift.opening_cash)}</div>`;
    $('#shiftButton').textContent = 'Đóng ca';
  }
}

function openShiftModal() {
  bootstrap.Modal.getOrCreateInstance($('#shiftModal')).show();
}

async function openShift() {
  try {
    const response = await api('/shifts/open', {
      method: 'POST',
      body: JSON.stringify({ openedBy: $('#openedBy').value, openingCash: Number($('#openingCash').value || 0) })
    });
    state.shift = response.data;
    renderShift();
    bootstrap.Modal.getOrCreateInstance($('#shiftModal')).hide();
    toast('Đã mở ca.');
  } catch (error) {
    toast(error.message);
  }
}

async function closeShift() {
  if (!state.shift) return;
  try {
    await api(`/shifts/${state.shift.id}/close`, {
      method: 'POST',
      body: JSON.stringify({ closingCash: Number($('#closingCash').value || 0) })
    });
    state.shift = null;
    renderShift();
    bootstrap.Modal.getOrCreateInstance($('#closeShiftModal')).hide();
    toast('Đã đóng ca.');
  } catch (error) {
    toast(error.message);
  }
}

async function loadReports() {
  const [report, orders] = await Promise.all([api('/reports/today'), api('/orders/today')]);
  $('#reportOrderCount').textContent = report.data.summary.order_count;
  $('#reportRevenue').textContent = money(report.data.summary.paid_revenue);
  $('#reportItemCount').textContent = report.data.topProducts.reduce((sum, product) => sum + Number(product.quantity), 0);

  $('#topProducts').innerHTML = report.data.topProducts.length
    ? report.data.topProducts.map((item) => `<div class="top-product"><div class="top-product-name">${escapeHtml(item.name)}</div><div class="top-product-value">${item.quantity} món • ${money(item.revenue)}</div></div>`).join('')
    : '<div class="text-secondary small">Chưa có dữ liệu bán hàng hôm nay.</div>';

  $('#ordersTableBody').innerHTML = orders.data.length
    ? orders.data.map((order) => `
      <tr>
        <td class="fw-semibold">${escapeHtml(order.order_code)}</td>
        <td>${new Date(order.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${order.item_count}</td>
        <td><span class="badge text-bg-light">${order.payment_method === 'CASH' ? 'Tiền mặt' : 'QR'}</span></td>
        <td class="text-end fw-semibold">${money(order.total)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="text-center text-secondary py-4">Chưa có đơn.</td></tr>';
}

function switchSection(section) {
  const titles = { sale: 'Bán hàng', products: 'Sản phẩm', reports: 'Báo cáo' };
  document.querySelectorAll('.section-view').forEach((view) => view.classList.remove('active'));
  $(`#${section}Section`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.section === section));
  $('#pageTitle').textContent = titles[section];
  if (section === 'reports') loadReports().catch((error) => toast(error.message));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function boot() {
  try {
    const health = await api('/health');
    $('#connectionPill').innerHTML = `<span class="dot"></span> ${health.database}`;
    await Promise.all([loadProducts(), loadShift(), loadReports()]);
    const version = await window.pos.getVersion();
    document.querySelector('.brand-subtitle').textContent = `v${version} • Local-first`;
  } catch (error) {
    $('#connectionPill').innerHTML = '<span class="dot" style="background:#e75b64"></span> API offline';
    toast(`Không kết nối được POS API: ${error.message}`);
  }
}

document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => switchSection(item.dataset.section)));
$('#searchInput').addEventListener('input', (event) => { state.search = event.target.value; renderProducts(); });
$('#cashReceived').addEventListener('input', updateChange);
$('#clearCartButton').addEventListener('click', () => { state.cart.clear(); renderCart(); });
document.querySelectorAll('.payment-tab').forEach((button) => button.addEventListener('click', () => setPaymentMethod(button.dataset.payment)));
$('#checkoutButton').addEventListener('click', checkout);
$('#shiftButton').addEventListener('click', () => state.shift ? bootstrap.Modal.getOrCreateInstance($('#closeShiftModal')).show() : openShiftModal());
$('#openShiftConfirm').addEventListener('click', openShift);
$('#closeShiftConfirm').addEventListener('click', closeShift);

setPaymentMethod('CASH');
boot();
