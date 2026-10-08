(function () {
  const panel = document.querySelector('[data-customer-invoices]');
  const config = window.KIMS_SUPABASE || {};
  if (!panel || !window.supabase || !config.url) return;
  const client = window.supabase.createClient(config.url, config.anonKey);
  const math = window.KimsAdminInvoice;
  const form = panel.querySelector('[data-invoice-form]');
  const select = panel.querySelector('[name=customer_id]');
  const message = panel.querySelector('[data-message]');
  const lines = panel.querySelector('[data-lines]');
  const search = panel.querySelector('[data-item-search]');
  const results = panel.querySelector('[data-search-results]');
  let items = [], key = crypto.randomUUID(), busy = false, loaded = false;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Number(n).toFixed(2);
  const price = item => window.KimsPricing.unitPrice(item.sell_price, item.discount);
  function changed() { key = crypto.randomUUID(); total(); }
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
      const result = await client.from(table).select(fields).eq('is_active', true).is('archived_at', null).order('id').range(start, start + 499);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
      if ((result.data || []).length < 500) return rows;
    }
  }
  async function load(selected = select.value) {
    const [data, inventory, products] = await Promise.all([
      request(), catalogue('inventory_items', 'id,product_name,sku,category,sell_price,discount,item_kind,track_stock,is_order_to_sale,quantity_on_hand'),
      catalogue('products', 'id,name,category,price,discount,inventory_item_id'),
    ]);
    select.innerHTML = '<option value="">Choose customer</option>' + data.customers.map(c => `<option value="${esc(c.id)}">${esc(`${c.first_name} ${c.last_name} · ${c.email}`)}</option>`).join('');
    select.value = selected;
    items = inventory.map(i => ({ ...i, token: 'inventory:' + i.id, name: i.product_name, inventory_item_id: i.id })).concat(products.filter(p => !p.inventory_item_id).map(p => ({ ...p, token: 'product:' + p.id, sell_price: p.price })));
    loaded = true; renderSearch(); changed();
  }
  function renderSearch() {
    if (!loaded) { results.textContent = 'Load customers and items to search the catalogue.'; return; }
    const matches = items.filter(i => math.matches(i, search.value));
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
        cart.push({ id: item.id, ...(item.inventory_item_id ? { inventory_item_id: item.inventory_item_id } : {}), quantity });
      } else custom.push({ name: row.querySelector('[data-description]').value, unit_amount: row.querySelector('[data-price]').value, quantity });
    }
    return { cart: math.normalizeCart(cart), custom_lines: custom };
  }
  function discount() { return { type: form.discount_type.value, value: form.discount_value.value }; }
  function total() {
    try {
      let cents = 0;
      for (const row of lines.children) {
        const quantity = math.quantity(row.querySelector('[data-qty]').value);
        const item = items.find(i => i.token === row.dataset.token);
        const unit = row.dataset.token ? (item ? Math.round(price(item) * 100) : NaN) : math.money(row.querySelector('[data-price]').value);
        if (!Number.isFinite(unit)) throw new Error('A selected item is no longer available.');
        const line = unit * quantity; cents += line;
        row.querySelector('[data-line-total]').textContent = money(line / 100);
        if (item) row.querySelector('[data-unit-price]').textContent = money(unit / 100) + ' each';
      }
      const reduction = math.discountCents(cents, discount());
      panel.querySelector('[data-total]').textContent = `Subtotal ${money(cents / 100)} − discount ${money(reduction / 100)} = total ${money((cents - reduction) / 100)} · Pickup`;
    } catch (e) { panel.querySelector('[data-total]').textContent = e.message; }
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
    row.innerHTML = `<div><strong>${esc(item.name)}</strong><small>${esc(item.sku || item.category || '')}</small><small data-unit-price>${money(price(item))} each</small></div><label>Quantity<input aria-label="Quantity for ${esc(item.name)}" data-qty type="number" min="1" max="99" step="1" value="1" required></label><strong data-line-total></strong><button type="button" class="btn btn-secondary" data-remove aria-label="Remove ${esc(item.name)}">Remove</button>`;
    lines.append(row); changed();
  }
  function addCustom() {
    if (busy) return;
    if (lines.children.length >= 50) { message.textContent = 'Use up to 50 invoice lines.'; return; }
    const row = document.createElement('div'); row.className = 'invoice-line invoice-line-custom';
    row.innerHTML = '<label>Description<input data-description maxlength="200" required placeholder="e.g. Racquet grip fitting"><small>Custom line · No inventory stock change</small></label><label>Unit price ($)<input data-price type="number" min="0" max="1000000" step="0.01" value="0.00" required></label><label>Quantity<input data-qty type="number" min="1" max="99" step="1" value="1" required></label><strong data-line-total></strong><button type="button" class="btn btn-secondary" data-remove>Remove</button>';
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
  results.onclick = e => { const button = e.target.closest('[data-pick]'); if (button) addItem(button.dataset.pick); };
  panel.querySelector('[data-custom]').onclick = addCustom;
  lines.onclick = e => { if (!busy && e.target.matches('[data-remove]')) { e.target.closest('.invoice-line').remove(); changed(); } };
  panel.querySelector('[data-create-customer]').onsubmit = e => {
    e.preventDefault(); const customerForm = e.currentTarget;
    const payload = { action: 'create', ...Object.fromEntries(new FormData(customerForm)) };
    run(customerForm.querySelector('button'), async () => { const data = await request(payload); await load(data.id); customerForm.reset(); message.textContent = data.existing ? 'Existing customer selected.' : 'Customer created. Invoice now and activate their account later.'; }, true);
  };
  panel.querySelector('[data-activation]').onclick = e => run(e.currentTarget, async () => { await request({ action: 'activation', customer_id: select.value }); message.textContent = 'Account activation email requested.'; });
  form.addEventListener('input', e => { if (e.target !== search) changed(); });
  form.addEventListener('change', changed);
  panel.querySelector('[data-new-invoice]').onclick = () => { if (busy) return; lines.replaceChildren(); form.service_details.value = ''; form.discount_type.value = 'none'; form.discount_value.value = '0'; message.textContent = ''; changed(); };
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
      message.textContent = 'Order saved. Invoice and email are queued; check Shop Orders for status. ';
      const link = document.createElement('a'); link.href = result.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'View payment page'; message.append(link);
    }, true);
  };
})();
