const API = '/api';

const state = {
  products: [],
  categories: [],
  cart: { items: [], subtotal: 0, shipping: 0, total: 0, item_count: 0 },
  user: null,
  currentPage: 'home',
  currentProduct: null,
  qty: 1,
  rating: 5,
  filters: { brand: '', category: '', search: '', sort: 'newest' },
};

const brandPages = {
  'patchmagic': { brand: 'patchmagic', label: 'PatchMagic', railId: 'patchmagicRail', countId: 'patchmagicCount' },
  'divine-foods': { brand: 'divine_foods', label: 'Divine Foods', railId: 'divineFoodsRail', countId: 'divineFoodsCount' },
};

const carouselTimers = new Map();

const $ = (id) => document.getElementById(id);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function firstImage(product) {
  if (!product?.images) return '';
  if (Array.isArray(product.images)) return product.images[0] || '';
  if (typeof product.images === 'string') {
    try {
      const parsed = JSON.parse(product.images);
      if (Array.isArray(parsed)) return parsed[0] || '';
    } catch {
      const value = product.images.split(',')[0]?.trim() || '';
      return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/') ? value : `/uploads/${value}`;
    }
  }
  return '';
}

async function request(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(message) {
  const el = $('toast'); if (!el) return;
  el.textContent = message; el.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add('hidden'), 2500);
}

function setPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const el = $(`page-${page}`);
  if (el) {
    el.classList.add('active');
    el.style.display = '';
  }
  document.body.classList.remove('legal-open');
  updateActiveNav(page);
}

function updateActiveNav(page) {
  document.querySelectorAll('.nav-link, .mobile-nav-link').forEach((link) => {
    const href = link.getAttribute('onclick') || '';
    const active = href.includes(`showPage('${page}')`) || (page === 'shop' && href.includes("showPage('shop')"));
    link.classList.toggle('active', active);
  });
}

function showPage(page) {
  setPage(page);
  if (page === 'shop') renderShop();
  if (page === 'home') renderHomeSections();
  if (brandPages[page]) renderBrandPage(page);
  if (page === 'cart') openCartDrawer();
  if (page !== 'cart') closeCartDrawer();
  closeMobileNav();
  $('userMenu')?.classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function jumpToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openCartDrawer() { document.getElementById('cart-overlay')?.classList.add('open'); document.getElementById('cart-drawer')?.classList.add('open'); renderCart(); }
function closeCartDrawer() { document.getElementById('cart-overlay')?.classList.remove('open'); document.getElementById('cart-drawer')?.classList.remove('open'); }
function toggleCartDrawer() { const d = document.getElementById('cart-drawer'); if (!d) return; if (d.classList.contains('open')) closeCartDrawer(); else openCartDrawer(); }

function closeMobileNav() {
  const nav = document.getElementById('mobile-nav');
  const btn = document.getElementById('hamburgerBtn');
  if (nav) nav.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleMobileNav() {
  const nav = document.getElementById('mobile-nav');
  const btn = document.getElementById('hamburgerBtn');
  if (!nav || !btn) return;
  const open = nav.classList.toggle('open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function showModal(id) { $(id)?.classList.remove('hidden'); }
function closeModal(id) { $(id)?.classList.add('hidden'); }
function switchModal(from, to) { closeModal(from); showModal(to); }
function toggleUserMenu() { $('userMenu')?.classList.toggle('hidden'); }

function syncAuthMenu() {
  const guestMenu = $('guestMenu');
  const loggedMenu = $('loggedMenu');
  if (guestMenu) guestMenu.classList.toggle('hidden', !!state.user);
  if (loggedMenu) loggedMenu.classList.toggle('hidden', !state.user);
}

function sortProducts(list) {
  const items = [...list];
  switch (state.filters.sort) {
    case 'price_asc':
      return items.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    case 'price_desc':
      return items.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    case 'name':
      return items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    case 'newest':
    default:
      return items.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  }
}

function syncFilterBar() {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.brand || '') === (state.filters.brand || ''));
  });
  document.querySelectorAll('input[name="brand"]').forEach((input) => {
    input.checked = (input.value || '') === (state.filters.brand || '');
  });
  document.querySelectorAll('input[name="category"]').forEach((input) => {
    input.checked = (input.value || '') === (state.filters.category || '');
  });
}

function renderCategoryFilters() {
  const target = $('categoryFilters');
  if (!target) return;

  const groups = state.categories.length ? state.categories : [];
  target.innerHTML = `
    <button type="button" class="category-filter-btn${state.filters.category ? '' : ' active'}" onclick="setCategoryFilter('')">All Categories</button>
    ${groups.map((category) => `
      <button type="button" class="category-filter-btn${state.filters.category === category.slug ? ' active' : ''}" onclick="setCategoryFilter('${esc(category.slug)}')">
        <span>${esc(category.name || '')}</span>
        <small>${Number(category.product_count || 0)} items</small>
      </button>
    `).join('')}
  `;
}

function renderHomeSections() {
  renderFeatured();
  startAutoCarousel('featuredRail');
  startAutoCarousel('foodsRail');
}

function renderBrandPage(page) {
  const config = brandPages[page];
  if (!config) return;
  const items = sortProducts(state.products.filter((product) => String(product.brand || '').toLowerCase() === config.brand));
  const featured = items.filter((product) => product.is_featured).slice(0, 10);
  renderRail(featured.length ? featured : items.slice(0, 10), config.railId);
  safeSet(config.countId, String(items.length));
  startAutoCarousel(config.railId);
}

function startAutoCarousel(id, interval = 4200) {
  const el = $(id);
  if (!el || carouselTimers.has(id)) return;

  const step = () => {
    if (!el.isConnected || el.scrollWidth <= el.clientWidth) return;
    const card = el.querySelector('.product-card');
    const width = (card?.getBoundingClientRect().width || 210) + 14;
    const maxScroll = el.scrollWidth - el.clientWidth - 4;
    const next = el.scrollLeft + width;
    el.scrollTo({ left: next >= maxScroll ? 0 : next, behavior: 'smooth' });
  };

  const timer = setInterval(step, interval);
  carouselTimers.set(id, timer);

  if (!el.dataset.carouselBound) {
    el.dataset.carouselBound = 'true';
    el.addEventListener('mouseenter', () => {
      const activeTimer = carouselTimers.get(id);
      if (activeTimer) clearInterval(activeTimer);
      carouselTimers.delete(id);
    });
    el.addEventListener('mouseleave', () => startAutoCarousel(id, interval));
    el.addEventListener('touchstart', () => {
      const activeTimer = carouselTimers.get(id);
      if (activeTimer) clearInterval(activeTimer);
      carouselTimers.delete(id);
      window.clearTimeout(el._carouselTouchResume);
      el._carouselTouchResume = window.setTimeout(() => startAutoCarousel(id, interval), 3000);
    }, { passive: true });
  }
}

function currentBrandLabel(brand) { return brand === 'patchmagic' ? 'PatchMagic' : brand === 'divine_foods' ? 'Divine Foods' : 'All Products'; }

function renderProducts(list, targetId) {
  const target = $(targetId); if (!target) return;
  target.innerHTML = (list.length ? list : []).map((p) => `
    <div class="product-card" onclick="openProduct(${p.id})">
      <div class="product-card-img">${firstImage(p) ? '<img src="' + esc(firstImage(p)) + '" alt="' + esc(p.name || 'Product') + '">' : '🧵'}</div>
      <div class="product-card-body">
        <div class="product-card-brand brand-${(p.brand || '').replace(/_/g, '-').toLowerCase()}">${esc(p.brand_label || p.brand || '')}</div>
        <h3>${esc(p.name || 'Product')}</h3>
        <div class="product-card-price">
          <span class="price-main">₹${Number(p.price || 0).toFixed(0)}</span>
          ${p.mrp ? `<span class="price-old">₹${Number(p.mrp).toFixed(0)}</span>` : ''}
          ${p.mrp ? `<span class="price-off">${Math.round((1 - p.price / p.mrp) * 100)}% off</span>` : ''}
        </div>
      </div>
    </div>`).join('') || '<div class="empty-state"><h3>No products found</h3><p>Try another brand, category, or sort option.</p></div>';
}

function renderRail(list, targetId) {
  const target = $(targetId); if (!target) return;
  target.innerHTML = (list.length ? list : []).map((p) => `
    <div class="product-card" onclick="openProduct(${p.id})">
      <div class="product-card-img">${firstImage(p) ? '<img src="' + esc(firstImage(p)) + '" alt="' + esc(p.name || 'Product') + '">' : '🧵'}</div>
      <div class="product-card-body">
        <div class="product-card-brand brand-${(p.brand || '').replace(/_/g, '-').toLowerCase()}">${esc(p.brand_label || p.brand || '')}</div>
        <h3>${esc(p.name || 'Product')}</h3>
        <div class="product-card-price">
          <span class="price-main">₹${Number(p.price || 0).toFixed(0)}</span>
          ${p.mrp ? `<span class="price-old">₹${Number(p.mrp).toFixed(0)}</span>` : ''}
          ${p.mrp ? `<span class="price-off">${Math.round((1 - p.price / p.mrp) * 100)}% off</span>` : ''}
        </div>
      </div>
    </div>`).join('') || '<div class="rail-empty">Products will appear here shortly.</div>';
}

function renderFeatured() {
  renderRail(state.products.filter((p) => String(p.brand || '').toLowerCase() === 'patchmagic').slice(0, 10), 'featuredRail');
  renderRail(state.products.filter((p) => String(p.brand || '').toLowerCase() === 'divine_foods').slice(0, 10), 'foodsRail');
}

function applyFilters() {
  const sort = $('sortSelect')?.value || 'newest';
  state.filters.sort = sort;
  const brand = document.querySelector('input[name="brand"]:checked')?.value || state.filters.brand || '';
  const category = document.querySelector('input[name="category"]:checked')?.value || state.filters.category || '';
  const search = state.filters.search || '';
  state.filters.brand = brand;
  state.filters.category = category;
  const filtered = sortProducts(state.products.filter((p) => {
    const text = `${p.name} ${p.description} ${p.short_description || ''} ${p.brand} ${p.category_name || ''} ${p.category_slug || ''}`.toLowerCase();
    return (!brand || p.brand === brand) && (!category || p.category_slug === category) && (!search || text.includes(search));
  }));
  renderProducts(filtered, 'shopProducts');
  safeSet('productCount', `${filtered.length} products`);
  safeSet('shopTitle', category ? `${currentBrandLabel(brand)} · ${category.replace(/-/g, ' ')}` : currentBrandLabel(brand));
  renderCategoryFilters();
  syncFilterBar();
}

function safeSet(id, value) { const el = $(id); if (el) el.textContent = value; }

function renderShop() { renderFeatured(); applyFilters(); }

function scrollRail(id, dir) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollBy({ left: dir * 520, behavior: 'smooth' });
}

function openProduct(id) {
  const product = state.products.find((p) => String(p.id) === String(id));
  if (!product) return toast('Product not found');
  state.currentProduct = product; state.qty = 1; state.rating = 5;
  const img = firstImage(product);
  const imgEl = $('mainImage');
  const thumbsEl = $('thumbImages');
  if (imgEl) imgEl.innerHTML = img ? `<img src="${esc(img)}" alt="${esc(product.name || 'Product')}">` : '🧵';
  if (thumbsEl) thumbsEl.innerHTML = Array.isArray(product.images) ? product.images.map((src) => `<button type="button" class="thumb" onclick="document.getElementById('mainImage').innerHTML='<img src=&quot;${esc(src)}&quot; alt=&quot;${esc(product.name || 'Product')}&quot;>'"><img src="${esc(src)}" alt="${esc(product.name || 'Product')}"></button>`).join('') : '';
  safeSet('pdName', product.name || ''); safeSet('pdDesc', product.description || ''); safeSet('pdPrice', `₹${Number(product.price || 0).toFixed(0)}`);
  safeSet('pdMrp', product.mrp ? `₹${Number(product.mrp).toFixed(0)}` : '');
  safeSet('pdDiscount', product.mrp ? `${Math.round((1 - product.price / product.mrp) * 100)}% off` : '');
  safeSet('productBreadcrumb', product.name || ''); safeSet('qtyDisplay', String(state.qty));
  showPage('product');
}

function changeQty(delta) { state.qty = Math.max(1, state.qty + delta); safeSet('qtyDisplay', String(state.qty)); }

async function addToCartFromDetail() {
  if (!state.currentProduct) return;
  try {
    const cart = await request(`${API}/cart/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: state.currentProduct.id, quantity: state.qty, customization_note: $('customNoteInput')?.value || '' }) });
    state.cart = cart.cart; updateCartBadge(); renderCart(); renderCheckout(); openCartDrawer(); toast('Added to cart');
  } catch (e) { toast(e.message); }
}

async function loadState() {
  const [products, categories, cart, user] = await Promise.allSettled([request(`${API}/products`), request(`${API}/products/categories`), request(`${API}/cart`), request(`${API}/user/me`)]);
  state.products = products.status === 'fulfilled' ? (Array.isArray(products.value) ? products.value : products.value.products || []) : [];
  state.categories = categories.status === 'fulfilled' ? (Array.isArray(categories.value) ? categories.value : []) : [];
  state.cart = cart.status === 'fulfilled' ? cart.value : state.cart;
  state.user = user.status === 'fulfilled' ? user.value.user : null;
}

function updateCartBadge() { safeSet('cartBadge', String(state.cart?.item_count || 0)); }

function renderCart() {
  const el = $('cartItems'); if (!el) return;
  el.innerHTML = state.cart.items?.length ? state.cart.items.map((i) => `
    <div class="cart-item">
      <div class="cart-item-img">${firstImage(i) ? `<img src="${esc(firstImage(i))}" alt="">` : '🧺'}</div>
      <div class="cart-item-info">
        <h4>${esc(i.name)}</h4>
        <div class="cart-item-brand">${esc(i.brand || '')}</div>
        <div class="cart-item-controls">
          <div class="cart-qty">
            <button type="button" onclick="updateCartQty(${i.product_id}, -1)">−</button>
            <span>${i.quantity}</span>
            <button type="button" onclick="updateCartQty(${i.product_id}, 1)">+</button>
          </div>
          <button type="button" class="remove-btn" onclick="safeRemoveCartItem(${i.product_id})">Remove</button>
        </div>
      </div>
      <div class="cart-item-price">₹${Number(i.price * i.quantity).toFixed(0)}</div>
    </div>`).join('') : '<div class="cart-empty"><h3>Your cart is empty</h3><p>Add beautiful crafts or wellness foods to get started.</p></div>';
  safeSet('sumSubtotal', `₹${Number(state.cart.subtotal || 0).toFixed(0)}`);
  safeSet('sumShipping', `₹${Number(state.cart.shipping || 0).toFixed(0)}`);
  safeSet('sumTotal', `₹${Number(state.cart.total || 0).toFixed(0)}`);
}

async function updateCartQty(productId, delta) {
  try {
    const cart = await request(`${API}/cart/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: productId, quantity: delta }) });
    state.cart = cart.cart; updateCartBadge(); renderCart(); renderCheckout();
  } catch (e) { toast(e.message); }
}

async function removeCartItem(productId) {
  try {
    const cart = await request(`${API}/cart/remove/${encodeURIComponent(productId)}`, { method: 'DELETE' });
    state.cart = cart.cart; updateCartBadge(); renderCart(); renderCheckout();
  } catch (e) { toast(e.message); }
}

function safeRemoveCartItem(productId) {
  const item = state.cart.items?.find((i) => String(i.product_id) === String(productId));
  if (!item) return;
  const prev = JSON.parse(JSON.stringify(state.cart));
  removeCartItem(productId).catch(() => {
    state.cart.items = prev.items.filter((i) => String(i.product_id) !== String(productId));
    state.cart.item_count = Math.max(0, (prev.item_count || 0) - item.quantity);
    state.cart.subtotal = Math.max(0, (prev.subtotal || 0) - (Number(item.price) * item.quantity));
    state.cart.shipping = prev.shipping || 0;
    state.cart.total = Math.max(0, (state.cart.subtotal || 0) + (state.cart.shipping || 0));
    updateCartBadge(); renderCart(); renderCheckout();
    toast('Item removed');
  });
}

function filterBrand(brand) {
  state.filters.brand = brand;
  state.filters.category = '';
  state.filters.search = '';
  if ($('searchInput')) $('searchInput').value = '';
  const radio = document.querySelector(`input[name="brand"][value="${brand}"]`);
  if (radio) radio.checked = true;
  showPage('shop');
  applyFilters();
  jumpToSection('shopProducts');
}
function setCategoryFilter(category) {
  state.filters.category = category;
  state.filters.search = '';
  if ($('searchInput')) $('searchInput').value = '';
  const radio = document.querySelector(`input[name="category"][value="${category}"]`);
  if (radio) radio.checked = true;
  applyFilters();
}
function filterCategory(category) {
  setCategoryFilter(category);
  showPage('shop');
  jumpToSection('shopProducts');
}
function doSearch() {
  const q = $('searchInput')?.value?.trim().toLowerCase();
  if (!q) {
    state.filters.search = '';
    showPage('shop');
    applyFilters();
    return;
  }
  state.filters.search = q;
  state.filters.brand = '';
  state.filters.category = '';
  showPage('shop');
  applyFilters();
  jumpToSection('shopProducts');
  syncFilterBar();
}

function setBrandFilter(brand) { filterBrand(brand); }

async function doLogin() { try { const user = await request(`${API}/user/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('li_email')?.value, password: $('li_pass')?.value }) }); state.user = user.user; closeModal('loginModal'); toast('Logged in'); syncUserUI(); } catch (e) { toast(e.message); } }
async function doRegister() { try { const user = await request(`${API}/user/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('reg_name')?.value, email: $('reg_email')?.value, phone: $('reg_phone')?.value, password: $('reg_pass')?.value }) }); state.user = user.user; closeModal('registerModal'); toast('Account created'); syncUserUI(); } catch (e) { toast(e.message); } }
async function doLogout() { await request(`${API}/user/logout`, { method: 'POST' }).catch(() => {}); state.user = null; syncUserUI(); toast('Logged out'); }

function syncUserUI() { safeSet('userLabel', state.user?.name || 'Account'); safeSet('menuUserName', state.user?.name || ''); syncAuthMenu(); }

async function applyCoupon() { try { const result = await request(`${API}/cart/coupon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('couponInput')?.value }) }); toast(`Coupon applied: -₹${result.discount}`); } catch (e) { toast(e.message); } }
async function subscribeNewsletter(e) { e.preventDefault(); try { await request(`${API}/user/newsletter`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('nlName')?.value, email: $('nlEmail')?.value }) }); toast('Subscribed'); } catch (err) { toast(err.message); } }

async function trackOrder() { try { const order = await request(`${API}/orders/track?order_number=${encodeURIComponent($('trackOrderNo')?.value || '')}&email=${encodeURIComponent($('trackEmail')?.value || '')}`); const box = $('trackResult'); if (box) box.innerHTML = `<pre>${esc(JSON.stringify(order, null, 2))}</pre>`; toast('Order found'); } catch (e) { toast(e.message); } }
async function sendOTP() { try { const email = $('histEmail')?.value; await request(`${API}/orders/otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); $('otpSection')?.classList.remove('hidden'); toast('OTP sent'); } catch (e) { toast(e.message); } }
async function verifyOTP() { try { const email = $('histEmail')?.value; const otp = $('otpInput')?.value; const result = await request(`${API}/orders/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, otp }) }); const box = $('orderHistory'); if (box) box.innerHTML = (result.orders || []).map((o) => `<div class="order-card"><strong>${esc(o.order_number)}</strong><span>${esc(o.status || '')}</span></div>`).join('') || '<p>No orders found.</p>'; toast('OTP verified'); } catch (e) { toast(e.message); } }

async function refreshCustomerOrders() {
  if (!state.user?.email) return;
  try {
    const result = await request(`${API}/orders/my-orders`);
    const box = $('orderHistory');
    const orders = Array.isArray(result) ? result : (result.orders || []);
    if (box) box.innerHTML = orders.map((o) => `
      <div class="order-card">
        <div>
          <strong>${esc(o.order_number)}</strong>
          <small>${esc(o.created_at || '')}</small>
        </div>
        <span>${esc(o.status || '')}</span>
      </div>`).join('') || '<p>No orders found.</p>';
  } catch (e) { toast(e.message); }
}

async function initiatePayment() {
  try {
    const btn = document.querySelector('#step-payment .btn.btn-primary');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Opening Razorpay...';
    }

    const payload = {
      name: $('del-name')?.value || state.user?.name || '',
      email: $('del-email')?.value || state.user?.email || '',
      phone: $('del-phone')?.value || '',
      address1: $('del-address')?.value || '',
      address2: '',
      city: $('del-city')?.value || '',
      state: $('del-state')?.value || '',
      pincode: $('del-pin')?.value || '',
      customer_note: $('customNoteInput')?.value || ''
    };

    if (!payload.name || !payload.email || !payload.phone || !payload.address1 || !payload.city || !payload.state || !payload.pincode) {
      throw new Error('Please fill all delivery fields before paying');
    }

    const order = await request(`${API}/payment/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!order || !order.key || !order.razorpay_order_id) {
      throw new Error('Payment gateway did not return a valid test order');
    }

    const options = {
      key: order.key,
      amount: order.amount,
      currency: order.currency,
      name: 'Anton Craftex',
      description: `Order ${order.order_number}`,
      order_id: order.razorpay_order_id,
      prefill: { name: payload.name, email: payload.email, contact: payload.phone },
      handler: async function (response) {
        try {
          const verify = await request(`${API}/payment/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              order_number: order.order_number
            })
          });
          safeSet('successOrderNo', verify.order_number || order.order_number);
          openCheckoutStep('success');
          toast('Payment successful');
          loadState().then(() => { updateCartBadge(); renderCart(); renderCheckout(); });
        } catch (err) { toast(err.message); }
      },
      theme: { color: '#c46a2f' }
    };

    const rz = new Razorpay(options);
    rz.open();
  } catch (e) { toast(e.message); }
  finally {
    const btn = document.querySelector('#step-payment .btn.btn-primary');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Pay with Razorpay →';
    }
  }
}
async function cancelOrder() { toast('Cancel request sent'); }
function showCancelForm() { $('cancelForm')?.classList.remove('hidden'); }
function switchTrackTab(tab = 'track') {
  const track = $('trackForm');
  const history = $('historyForm');
  $('tab-track')?.classList.toggle('active', tab === 'track');
  $('tab-history')?.classList.toggle('active', tab === 'history');
  if (track) track.classList.toggle('hidden', tab !== 'track');
  if (history) history.classList.toggle('hidden', tab !== 'history');
  if (tab === 'history') refreshCustomerOrders();
}
function setRating(r) { state.rating = r; }

function renderCheckout() {
  const el = $('checkoutItems'); if (el) el.innerHTML = state.cart.items?.length ? state.cart.items.map((i) => `<div>${esc(i.name)} x ${i.quantity}</div>`).join('') : '<p>No items in cart.</p>';
  safeSet('coSubtotal', `₹${Number(state.cart.subtotal || 0).toFixed(0)}`);
  safeSet('coShipping', `₹${Number(state.cart.shipping || 0).toFixed(0)}`);
  safeSet('coTotal', `₹${Number(state.cart.total || 0).toFixed(0)}`);
  safeSet('pay-subtotal', `₹${Number(state.cart.subtotal || 0).toFixed(0)}`);
  safeSet('pay-shipping', `₹${Number(state.cart.shipping || 0).toFixed(0)}`);
  safeSet('pay-total', `₹${Number(state.cart.total || 0).toFixed(0)}`);
}

function openCheckoutStep(step) {
  document.getElementById('checkout-overlay')?.classList.add('open');
  document.getElementById('step-delivery')?.classList.toggle('hidden', step !== 'delivery');
  document.getElementById('step-payment')?.classList.toggle('hidden', step !== 'payment');
  document.getElementById('step-success')?.classList.toggle('hidden', step !== 'success');
}

function closeCheckoutModal() { document.getElementById('checkout-overlay')?.classList.remove('open'); }

function openCart() { showPage('cart'); }

async function submitEnquiry(e) { e.preventDefault(); try { await request(`${API}/craftpark/enquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('enqName')?.value, email: $('enqEmail')?.value, phone: $('enqPhone')?.value, interest: $('enqInterest')?.value, message: $('enqMsg')?.value }) }); toast('Enquiry sent'); } catch (err) { toast(err.message); } }

async function submitReview(e) { e.preventDefault(); toast('Review submission is ready for backend integration'); }

function expose() { Object.assign(window, { showPage, filterBrand, filterCategory, setCategoryFilter, doSearch, toggleUserMenu, showModal, closeModal, switchModal, doLogin, doRegister, doLogout, applyFilters, changeQty, addToCartFromDetail, subscribeNewsletter, initiatePayment, trackOrder, cancelOrder, switchTrackTab, sendOTP, verifyOTP, applyCoupon, setRating, showCancelForm, openProduct, submitEnquiry, submitReview, toggleMobileNav, closeMobileNav, setBrandFilter, openCart, openCartDrawer, closeCartDrawer, toggleCartDrawer, updateCartQty, removeCartItem, openCheckoutStep, closeCheckoutModal, scrollRail, refreshCustomerOrders }); }

async function init() {
  expose();
  await loadState();
  syncUserUI(); updateCartBadge(); renderCategoryFilters(); renderHomeSections(); renderBrandPage('patchmagic'); renderBrandPage('divine-foods'); renderShop();
  renderCart(); renderCheckout();
  document.getElementById('cart-overlay')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cart-close-btn')?.addEventListener('click', closeCartDrawer);
  document.getElementById('checkout-close-btn')?.addEventListener('click', closeCheckoutModal);
  document.getElementById('step-to-payment-btn')?.addEventListener('click', () => openCheckoutStep('payment'));
  document.getElementById('step-back-btn')?.addEventListener('click', () => openCheckoutStep('delivery'));
  document.getElementById('success-close-btn')?.addEventListener('click', () => { closeCheckoutModal(); showPage('home'); });
  document.getElementById('checkout-btn')?.addEventListener('click', () => { closeCartDrawer(); openCheckoutStep('delivery'); });
  document.getElementById('cart-shop-now-btn')?.addEventListener('click', () => { closeCartDrawer(); showPage('shop'); });
  document.getElementById('clear-cart-btn')?.addEventListener('click', async () => {
    try {
      const cart = await request(`${API}/cart/clear`, { method: 'DELETE' });
      state.cart = cart.cart;
      updateCartBadge(); renderCart(); renderCheckout();
      toast('Cart cleared');
    } catch (e) { toast(e.message); }
  });
  document.getElementById('checkout-overlay')?.addEventListener('click', (e) => { if (e.target?.id === 'checkout-overlay') closeCheckoutModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMobileNav(); closeCartDrawer(); closeCheckoutModal(); $('userMenu')?.classList.add('hidden'); } });
}

window.addEventListener('DOMContentLoaded', init);
