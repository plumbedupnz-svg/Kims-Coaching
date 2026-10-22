(function () {
  const panel = document.querySelector('[data-customer-invoices]');
  const config = window.KIMS_SUPABASE || {};
  if (!panel || !window.supabase || !config.url) return;
  const client = (window.KimsGetSupabaseClient || window.supabase.createClient)(config.url, config.anonKey);
  const math = window.KimsAdminInvoice;
  const form = panel.querySelector('[data-invoice-form]');
  const select = panel.querySelector('[name=customer_id]');
  const message = panel.querySelector('[data-message]');
  const lines = panel.querySelector('[data-lines]');
  const search = panel.querySelector('[data-item-search]');
  const results = panel.querySelector('[data-search-results]');
  let customers = [], items = [], key = crypto.randomUUID(), busy = false, loaded = false;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Number(n).toFixed(2);
  const price = item => window.KimsPricing.unitPrice(item.sell_price, item.discount);
  function changed() { key = crypto.randomUUID(); panel.querySelector('[data-invoice-state]').textContent = 'Not issued'; total(); }
  panel.querySelector('[data-invoice-date]').textContent = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium' }).format(new Date());
  function customerContact() {
    const customer = customers.find(c => c.id === select.value);
    panel.querySelector('[data-customer-contact]').textContent = customer ? [customer.email, customer.phone].filter(Boolean).join(' · ') : 'Select a customer to link this invoice to their account.';
  }
  async function request(body) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) throw new Error('Please log in as an administrator.');
    const response = await fetch('/api/admin-customers', { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  async function catalogue(table, fields) {
    const rows = [];
    for (let start = 0; ; start += 500) {
      const result = await client.rpc(table === 'inventory_items' ? 'admin_list_inventory_items' : 'admin_list_products').select(fields).eq('is_active', true).is('archived_at', null).order('id').range(start, start + 499);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
      if ((result.data || []).length < 500) return rows;
    }
  }
  async function load(selected = select.value) {
    const [data, inventory, products] = await Promise.all([
      request(), catalogue('inventory_items', 'id,product_name,sku,category,sell_price,cost_price,purchase_price,discount,item_kind,track_stock,is_order_to_sale,quantity_on_hand'),
      catalogue('products', 'id,name,category,price,cost_price,purchase_price,discount,inventory_item_id'),
    ]);
    customers = data.customers;
    select.innerHTML = '<option value="">Choose customer</option>' + data.customers.map(c => `<option value="${esc(c.id)}">${esc(`${c.first_name} ${c.last_name} · ${c.email}`)}</option>`).join('');
    select.value = selected; customerContact();
    items = inventory.map(i => ({ ...i, token: 'inventory:' + i.id, name: i.product_name, inventory_item_id: i.id })).concat(products.filter(p => !p.inventory_item_id).map(p => ({ ...p, token: 'product:' + p.id, sell_price: p.price })));
    loaded = true; renderSearch(); changed();
  }
  function renderSearch() {
    if (!loaded) { results.textContent = 'Load customers and items to search the catalogue.'; return; }
    const matches = items.filter(i => math.matches(i, search.value) && (!panel.querySelector('[data-stock-only]').checked || (i.inventory_item_id && i.item_kind !== 'service' && i.track_stock !== false && !i.is_order_to_sale && Number(i.quantity_on_hand) > 0)));
    results.innerHTML = matches.length ? `<p class="helper-text">${matches.length} matching item${matches.length === 1 ? '' : 's'}${matches.length > 20 ? ' · Showing the first 20; refine your search' : ''}</p>` + matches.slice(0, 20).map(i => {
      const stock = i.item_kind === 'service' ? 'Service' : i.track_stock === true && !i.is_order_to_sale ? `${i.quantity_on_hand || 0} in stock` : '';
      return `<button type="button" class="invoice-search-result" data-pick="${esc(i.token)}"><span><strong>${esc(i.name)}</strong><small>${esc([i.sku, i.category, stock].filter(Boolean).join(' · '))}</small></span><span>${money(price(i))} · Add</span></button>`;
    }).join('') : '<p>No matching items. Try a name, SKU or category, or add a custom line.</p>';
  }
  function inputRows() {
    const cart = [], custom = [];
    for (const row of lines.children) {
      const quantity = math.quantity(row.querySelector('[data-qty]').value);
      if (row.dataset.token) {
        const item = items.find(i => i.token === row.dataset.token);
        if (!item) throw new Error('An item is no longer available. Remove it and choose another.');
        cart.push({ id: item.id, ...(item.inventory_item_id ? { inventory_item_id: item.inventory_item_id } : {}), quantity, ...lineValues(row) });
      } else custom.push({ name: row.querySelector('[data-description]').value, quantity, ...lineValues(row) });
    }
    return { cart: math.normalizeCart(cart), custom_lines: custom };
  }
  function lineValues(row) {
    return { unit_amount: row.querySelector('[data-price]').value, cost_price: row.querySelector('[data-cost]').value, discount_percent: row.querySelector('[data-line-discount]').value };
  }
  function priceControls(item, label) {
    const cost = item?.purchase_price ?? item?.cost_price ?? 0;
    return `<label><span class="invoice-mobile-label">Cost price</span><input aria-label="Cost price for ${esc(label)}" data-cost type="number" min="0" max="1000000" step="0.01" value="${esc(Number(cost).toFixed(2))}" required></label><label><span class="invoice-mobile-label">Sell price</span><input aria-label="Sell price for ${esc(label)}" data-price type="number" min="0" max="1000000" step="0.01" value="${esc(Number(item?.sell_price || 0).toFixed(2))}" required></label><label><span class="invoice-mobile-label">Discount %</span><input aria-label="Discount percent for ${esc(label)}" data-line-discount type="number" min="0" max="100" step="0.01" value="${esc(Number(item?.discount || 0))}" required></label>`;
  }
  function discount() { return { type: form.discount_type.value, value: form.discount_value.value }; }
  function total() {
    try {
      let cents = 0;
      for (const row of lines.children) {
        const quantity = math.quantity(row.querySelector('[data-qty]').value);
        const item = items.find(i => i.token === row.dataset.token);
        if (row.dataset.token && !item) throw new Error('A selected item is no longer available.');
        const priced = math.linePricing({ quantity, unitAmount: 0 }, lineValues(row));
        cents += Math.round(priced.lineTotal * 100);
        row.querySelector('[data-line-total]').textContent = money(priced.lineTotal);
      }
      const reduction = math.discountCents(cents, discount());
      panel.querySelector('[data-subtotal]').textContent = money(cents / 100);
      panel.querySelector('[data-discount-total]').textContent = '−' + money(reduction / 100);
      panel.querySelector('[data-grand-total]').textContent = money((cents - reduction) / 100);
      panel.querySelector('[data-total]').textContent = 'Line discounts applied · Pickup';
    } catch (e) { panel.querySelector('[data-grand-total]').textContent = '—'; panel.querySelector('[data-total]').textContent = e.message; }
  }
  function addItem(token) {
    if (busy) return;
    const item = items.find(i => i.token === token);
    if (!item) return;
    const existing = [...lines.children].find(row => row.dataset.token === token);
    if (existing) {
      try { existing.querySelector('[data-qty]').value = math.quantity(Number(existing.querySelector('[data-qty]').value) + 1); changed(); }
      catch (e) { message.textContent = e.message; }
      return;
    }
    if (lines.children.length >= 50) { message.textContent = 'Use up to 50 invoice lines.'; return; }
    const row = document.createElement('div'); row.className = 'invoice-line'; row.dataset.token = token;
    row.innerHTML = `<div><strong>${esc(item.name)}</strong><small>${esc(item.sku || item.category || '')} · Catalogue item</small></div><label><span class="invoice-mobile-label">Quantity</span><input aria-label="Quantity for ${esc(item.name)}" data-qty type="number" min="1" max="99" step="1" value="1" required></label>${priceControls(item, item.name)}<strong data-line-total></strong><button type="button" class="btn btn-secondary" data-remove aria-label="Remove ${esc(item.name)}">Remove</button>`;
    lines.append(row); changed();
  }
  function addCustom() {
    if (busy) return;
    if (lines.children.length >= 50) { message.textContent = 'Use up to 50 invoice lines.'; return; }
    const row = document.createElement('div'); row.className = 'invoice-line invoice-line-custom';
    row.innerHTML = `<label><span class="invoice-mobile-label">Description</span><input aria-label="Manual line description" data-description maxlength="200" required placeholder="Enter a description"><small>Manual line · No stock adjustment</small></label><label><span class="invoice-mobile-label">Quantity</span><input aria-label="Manual line quantity" data-qty type="number" min="1" max="99" step="1" value="1" required></label>${priceControls(null, 'manual line')}<strong data-line-total></strong><button type="button" class="btn btn-secondary" data-remove aria-label="Remove manual line">Remove</button>`;
    lines.append(row); row.querySelector('input').focus(); changed();
  }
  async function run(button, work, lock = false) {
    if (busy) return;
    busy = true;
    const controls = lock ? [...panel.querySelectorAll('input,select,textarea,button')] : [button];
    const disabled = controls.map(c => c.disabled); controls.forEach(c => { c.disabled = true; });
    message.textContent = 'Working…'; message.dataset.tone = '';
    try { await work(); } catch (e) { message.textContent = e.message; message.dataset.tone = 'error'; }
    finally { controls.forEach((c, i) => { c.disabled = disabled[i]; }); busy = false; }
  }
  panel.querySelector('[data-load]').onclick = e => run(e.currentTarget, async () => { await load(); message.textContent = 'Customers and items loaded. Search and click Add to build your invoice.'; }, true);
  search.oninput = renderSearch;
  panel.querySelector('[data-stock-only]').onchange = renderSearch;
  panel.querySelector('[data-open-stock]').onclick = () => { panel.querySelector('[data-stock-picker]').open = true; search.focus(); };
  select.addEventListener('change', customerContact);
  results.onclick = e => { const button = e.target.closest('[data-pick]'); if (button) addItem(button.dataset.pick); };
  panel.querySelector('[data-custom]').onclick = addCustom;
  lines.onclick = e => { if (!busy && e.target.matches('[data-remove]')) { e.target.closest('.invoice-line').remove(); changed(); } };
  panel.querySelector('[data-create-customer]').onsubmit = e => {
    e.preventDefault(); const customerForm = e.currentTarget;
    const payload = { action: 'create', ...Object.fromEntries(new FormData(customerForm)) };
    run(customerForm.querySelector('button'), async () => { const data = await request(payload); await load(data.id); customerForm.reset(); message.textContent = data.existing ? 'Existing customer selected.' : 'Customer created. Invoice now and activate their account later.'; }, true);
  };
  panel.querySelector('[data-activation]').onclick = e => run(e.currentTarget, async () => { await request({ action: 'activation', customer_id: select.value }); message.textContent = 'Account activation email requested.'; });
  form.addEventListener('input', e => { if (e.target !== search && !e.target.matches('[data-stock-only]')) changed(); });
  form.addEventListener('change', e => { if (!e.target.matches('[data-stock-only]')) changed(); });
  panel.querySelector('[data-new-invoice]').onclick = () => { if (busy) return; lines.replaceChildren(); select.value = ''; customerContact(); form.service_details.value = ''; form.discount_type.value = 'none'; form.discount_value.value = '0'; message.textContent = ''; changed(); };
  function loadOnOpen() {
    if (!loaded && !busy) panel.querySelector('[data-load]').click();
  }
  window.addEventListener('kims:admin-tab-changed', e => { if (e.detail.activeTab === 'invoices') loadOnOpen(); });
  if (location.hash === '#invoices') loadOnOpen();
  form.onsubmit = e => {
    e.preventDefault();
    let payload;
    try {
      const rows = inputRows();
      math.customLines(rows.custom_lines);
      if (!rows.cart.length && !rows.custom_lines.length) throw new Error('Add at least one invoice item.');
      payload = { action: 'invoice', customer_id: select.value, ...rows, invoice_discount: discount(), service_details: form.service_details.value, checkout_key: key };
    } catch (error) { message.textContent = error.message; message.dataset.tone = 'error'; return; }
    run(form.querySelector('[type=submit]'), async () => {
      const result = await request(payload);
      panel.querySelector('[data-invoice-state]').textContent = 'Invoice queued';
      message.textContent = 'Order saved. Invoice and email are queued; check Shop Orders for status. ';
      const link = document.createElement('a'); link.href = result.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'View payment page'; message.append(link);
    }, true);
  };
})();
