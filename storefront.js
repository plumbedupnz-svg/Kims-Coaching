(() => {
  'use strict';
  const menu = document.querySelector('[data-menu-toggle]');
  const links = document.querySelector('[data-nav-links]');
  menu?.addEventListener('click', () => { const open = links.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  const data = document.getElementById('shop-page-data');
  if (!data) return;
  const seed = JSON.parse(data.textContent);
  const catalogue = new Map(seed.products.map(product => [product.id, product]));
  const key = 'kims_cart';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => `$${Number(value || 0).toFixed(2)}`;
  let cart;
  try { cart = JSON.parse(localStorage.getItem(key) || '[]'); } catch { cart = []; }
  const safeCart = items => Array.isArray(items) ? items.filter(item => item && /^[a-f0-9-]{36}$/i.test(item.id) && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0 && Number(item.quantity) <= 99).map(item => ({...item, quantity: Number(item.quantity)})) : [];
  cart = safeCart(cart);
  let verifiedIds = new Set(seed.products.map(product => product.id));
  let cartRefresh;
  const isService = p => p.item_kind === 'service';
  const toOrder = p => !isService(p) && (p.is_order_to_sale === true || p.track_stock === false);
  const stock = p => !isService(p) && !toOrder(p);
  function itemFrom(product, quantity) {
    return {
      id: product.id, inventory_item_id: product.id, name: product.product_name,
      base_price: Number(product.sell_price), discount: Number(product.discount || 0),
      price: window.KimsPricing.unitPrice(product.sell_price, product.discount), quantity: Number(quantity),
      image_url: product.image_url || '', fulfilment_type: isService(product) ? 'service' : toOrder(product) ? 'order_to_sale' : 'stock',
      stock_status: product.status || '', availability_note: toOrder(product) ? "We'll confirm arrival once stock levels have been checked." : ''
    };
  }
  function loadCart() {
    return cart.map(item => catalogue.has(item.id) ? itemFrom(catalogue.get(item.id), item.quantity) : { ...item });
  }
  function save() {
    cart = loadCart();
    try { localStorage.setItem(key, JSON.stringify(cart)); }
    catch { document.querySelector('[data-cart-message]').textContent = 'Your browser cannot save this cart. Enable website storage before continuing to checkout.'; }
    window.dispatchEvent(new CustomEvent('kims:cart-updated'));
  }
  function renderCart() {
    const items = loadCart();
    const container = document.getElementById('cart-items');
    container.innerHTML = items.length ? items.map(item => `<div class="cart-item"><div><h4>${esc(item.name)}</h4><p>${money(item.price)} each</p>${!verifiedIds.has(item.id) ? '<p>Checking current availability…</p>' : ''}</div><div class="qty-controls"><button type="button" class="qty-btn" data-cart-change="-1" data-id="${esc(item.id)}" aria-label="Remove one ${esc(item.name)}">−</button><span>${item.quantity}</span><button type="button" class="qty-btn" data-cart-change="1" data-id="${esc(item.id)}" aria-label="Add one ${esc(item.name)}">+</button><button type="button" class="qty-btn" data-cart-remove="${esc(item.id)}" aria-label="Remove ${esc(item.name)} from cart">Remove</button></div></div>`).join('') : '<p>Your cart is empty. Browse the shop to choose your gear.</p>';
    const subtotal = Math.round(items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0) * 100) / 100;
    document.getElementById('subtotal').textContent = money(subtotal);
    const tax = Number(window.KimsShopCheckout?.getTaxSummary?.(subtotal)?.amount || 0);
    const shipping = Number(window.KimsShopCheckout?.getShippingAmount?.(subtotal) || 0);
    document.getElementById('shipping').textContent = money(shipping);
    document.getElementById('total').textContent = money(subtotal + tax + shipping);
    window.dispatchEvent(new CustomEvent('kims:cart-rendered', { detail: { subtotal, tax, shipping, promoDiscount: 0, total: subtotal + tax + shipping, hasOrderToSaleItems: items.some(item => item.fulfilment_type === 'order_to_sale') } }));
  }
  async function refreshCart() {
    if (!cart.length) return;
    if (cartRefresh) return cartRefresh;
    cartRefresh = (async () => {
      const ids = [...new Set(cart.map(item => item.id))];
      const response = await fetch('/api/shop-products?ids=' + encodeURIComponent(ids.join(',')), { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.products)) throw new Error('Could not verify current prices. Please try again before checkout.');
      const returned = new Set(result.products.map(product => product.id));
      result.products.forEach(product => { catalogue.set(product.id, product); verifiedIds.add(product.id); });
      ids.filter(id => !returned.has(id)).forEach(id => { verifiedIds.delete(id); catalogue.delete(id); });
      save(); renderCart();
    })();
    try { await cartRefresh; } finally { cartRefresh = null; }
  }
  async function ensureCartCurrent() {
    const before = JSON.stringify(loadCart().map(item => [item.id, item.price, item.quantity]));
    await refreshCart();
    for (const item of loadCart()) {
      const product = catalogue.get(item.id);
      if (!verifiedIds.has(item.id) || !product) throw new Error(`${item.name} is no longer available. Remove it from the cart to continue.`);
      if (stock(product) && (product.status === 'out_of_stock' || Number(product.quantity_on_hand) < item.quantity)) throw new Error(`Please adjust the quantity of ${item.name}; only ${product.status === 'out_of_stock' ? 0 : Number(product.quantity_on_hand)} are available.`);
    }
    const after = JSON.stringify(loadCart().map(item => [item.id, item.price, item.quantity]));
    if (before !== after) throw new Error('A price has changed. Review the updated total, then continue to payment.');
    return loadCart();
  }
  function addToCart(product, quantity = 1) {
    quantity = Number(quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('Choose a whole quantity between 1 and 99.');
    const existing = cart.find(item => item.id === product.id);
    if (!existing && cart.length >= 50) throw new Error('Please check out this cart before adding more different products.');
    const next = (existing?.quantity || 0) + quantity;
    if (next > 99 || (stock(product) && (product.status === 'out_of_stock' || next > Number(product.quantity_on_hand)))) throw new Error('Not enough stock is available for that quantity.');
    if (existing) existing.quantity = next;
    else cart.push(itemFrom(product, quantity));
    save(); renderCart();
    window.KimsAnalytics?.commerce?.('add_to_cart', [itemFrom(product, quantity)]);
    return true;
  }
  window.KimsShop = { loadCart, renderCart, ensureCartCurrent, addToCart, getProducts: () => [...catalogue.values()].map(p => itemFrom(p, 1)), money };
  window.KimsStorefrontSettings = seed.settings;
  document.querySelectorAll('[data-add-product]').forEach(button => button.addEventListener('click', () => {
    const message = document.querySelector('[data-product-message]') || document.querySelector('[data-cart-message]');
    try {
      const product = catalogue.get(button.dataset.addProduct);
      const quantity = button.hasAttribute('data-product-quantity') ? document.getElementById('product-detail-quantity').value : 1;
      addToCart(product, quantity);
      message.textContent = `${quantity} added to your cart.`;
      if (!button.hasAttribute('data-product-quantity')) { button.textContent = 'Added to cart'; setTimeout(() => { button.textContent = 'Add to cart'; }, 1600); }
    } catch (error) { message.textContent = error.message; }
  }));
  document.getElementById('cart-items').addEventListener('click', event => {
    const remove = event.target.closest('[data-cart-remove]');
    const change = event.target.closest('[data-cart-change]');
    if (!remove && !change) return;
    const id = remove?.dataset.cartRemove || change.dataset.id;
    const item = loadCart().find(item => item.id === id);
    if (!item) return;
    try {
      if (change && Number(change.dataset.cartChange) > 0) { const product = catalogue.get(id); if (!product) throw new Error('This product is unavailable.'); addToCart(product); return; }
      window.KimsAnalytics?.commerce?.('remove_from_cart', [{...item, quantity: remove ? item.quantity : 1}]);
      if (remove || item.quantity <= 1) cart = cart.filter(item => item.id !== id);
      else cart.find(item => item.id === id).quantity--;
      save(); renderCart();
    } catch (error) { document.querySelector('[data-cart-message]').textContent = error.message; }
  });
  document.getElementById('clear-cart-btn').addEventListener('click', () => { window.KimsAnalytics?.commerce?.('remove_from_cart', loadCart()); cart = []; save(); renderCart(); });
  document.querySelectorAll('[data-product-photo]').forEach(button => button.addEventListener('click', () => {
    document.querySelector('[data-main-product-image]').src = button.dataset.productPhoto;
    document.querySelectorAll('[data-product-photo]').forEach(item => item.classList.toggle('active', item === button));
  }));
  window.addEventListener('storage', event => { if (event.key !== key) return; try { cart = safeCart(JSON.parse(event.newValue || '[]')); } catch { cart = []; } renderCart(); if (cart.length) refreshCart().catch(error => { document.querySelector('[data-cart-message]').textContent = error.message; }); });
  renderCart();
  if (cart.length) refreshCart().catch(error => { document.querySelector('[data-cart-message]').textContent = error.message; });
  if (seed.productId) {
    const product = catalogue.get(seed.productId);
    window.KimsAnalyticsProduct = { id: product.id, name: product.product_name, price: window.KimsPricing.unitPrice(product.sell_price, product.discount), quantity: 1 };
    window.KimsAnalytics?.viewProduct?.(window.KimsAnalyticsProduct);
  }
  const config = window.KIMS_SUPABASE;
  if (config?.url && config?.anonKey && window.supabase) {
    const client = window.supabase.createClient(config.url, config.anonKey);
    window.KimsStorefrontClient = client;
    client.auth.getSession().then(({ data }) => { if (data?.session) document.querySelector('[data-store-account]').textContent = 'My account'; });
  }
})();
