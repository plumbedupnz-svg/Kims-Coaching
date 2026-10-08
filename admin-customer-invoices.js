(function () {
  const panel = document.querySelector('[data-customer-invoices]');
  const config = window.KIMS_SUPABASE || {};
  if (!panel || !window.supabase || !config.url) return;
  const client = window.supabase.createClient(config.url, config.anonKey);
  const select = panel.querySelector('[name=customer_id]');
  const message = panel.querySelector('[data-message]');
  const lines = panel.querySelector('[data-lines]');
  let items = [], key = crypto.randomUUID();
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function request(body) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) throw new Error('Please log in as an administrator.');
    const response = await fetch('/api/admin-customers', {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  async function load(selected = select.value) {
    const data = await request();
    select.innerHTML = '<option value="">Choose customer</option>' + data.customers.map(c => `<option value="${esc(c.id)}">${esc(`${c.first_name} ${c.last_name} · ${c.email}`)}</option>`).join('');
    select.value = selected;
    const result = await client.from('inventory_items').select('id,product_name,sell_price,discount,item_kind').eq('is_active', true).is('archived_at', null).order('product_name');
    if (result.error) throw result.error;
    items = result.data || [];
    if (!lines.children.length) addLine();
  }
  function total() {
    let amount = 0;
    for (const row of lines.children) {
      const item = items.find(i => i.id === row.querySelector('[data-item]').value);
      if (item) amount += window.KimsPricing.unitPrice(item.sell_price, item.discount) * Number(row.querySelector('[data-qty]').value || 0);
    }
    panel.querySelector('[data-total]').textContent = `Estimated total: $${amount.toFixed(2)} · Pickup · Final prices checked when saved`;
  }
  function addLine() {
    const row = document.createElement('div');
    row.className = 'admin-action-row';
    row.innerHTML = `<label>Item<select required data-item><option value="">Choose item</option>${items.map(i => `<option value="${esc(i.id)}">${esc(i.product_name)} · ${esc(window.KimsPricing ? '$' + window.KimsPricing.unitPrice(i.sell_price, i.discount).toFixed(2) : '$' + Number(i.sell_price).toFixed(2))}</option>`).join('')}</select></label><label>Quantity<input data-qty type="number" min="1" max="99" step="1" value="1" required></label><button type="button" class="btn btn-secondary" data-remove>Remove</button>`;
    lines.append(row); key = crypto.randomUUID(); total();
  }
  async function run(button, work) {
    button.disabled = true; message.textContent = 'Working…'; message.dataset.tone = '';
    try { await work(); } catch (e) { message.textContent = e.message; message.dataset.tone = 'error'; }
    finally { button.disabled = false; }
  }
  panel.querySelector('[data-load]').onclick = e => run(e.currentTarget, async () => { await load(); message.textContent = 'Customers and inventory loaded.'; });
  panel.querySelector('[data-add]').onclick = addLine;
  lines.onclick = e => { if (e.target.matches('[data-remove]')) { e.target.parentElement.remove(); key = crypto.randomUUID(); total(); } };
  panel.querySelector('[data-create-customer]').onsubmit = e => {
    e.preventDefault(); const form = e.currentTarget;
    run(form.querySelector('button'), async () => {
      const data = await request({ action: 'create', ...Object.fromEntries(new FormData(form)) });
      await load(data.id); form.reset();
      message.textContent = data.existing ? 'Existing customer selected. You can invoice them now.' : 'Customer created. You can invoice now and send account activation later.';
    });
  };
  panel.querySelector('[data-activation]').onclick = e => run(e.currentTarget, async () => {
    await request({ action: 'activation', customer_id: select.value });
    message.textContent = 'Account activation email requested. The customer can use the link to verify their email and set a password.';
  });
  panel.querySelector('[data-invoice-form]').addEventListener('input', () => { key = crypto.randomUUID(); total(); });
  panel.querySelector('[data-invoice-form]').onsubmit = e => {
    e.preventDefault(); const form = e.currentTarget;
    run(form.querySelector('[type=submit]'), async () => {
      const cart = [...lines.children].map(row => ({ id: row.querySelector('[data-item]').value, inventory_item_id: row.querySelector('[data-item]').value, quantity: Number(row.querySelector('[data-qty]').value) }));
      const result = await request({ action: 'invoice', customer_id: select.value, cart, service_details: form.service_details.value, checkout_key: key });
      message.textContent = 'Order saved. Invoice creation and email delivery are queued; check Shop Orders for their status. ';
      const link = document.createElement('a'); link.href = result.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'View payment page'; message.append(link);
      // Keep the same key until the form changes so a repeated click cannot issue a duplicate invoice.
    });
  };
})();
