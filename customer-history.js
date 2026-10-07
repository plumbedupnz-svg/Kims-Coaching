(function () {
  const panel = document.querySelector('[data-account-history]');
  const config = window.KIMS_SUPABASE || {};
  if (!panel || !window.supabase || !config.url) return;
  const client = window.supabase.createClient(config.url, config.anonKey);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = v => new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium' }).format(new Date(v.length === 10 ? v + 'T12:00:00Z' : v));
  let revision = 0;
  async function load() {
    const current = ++revision;
    const { data: { session } } = await client.auth.getSession();
    panel.hidden = !session;
    panel.querySelector('[data-orders]').textContent = '';
    panel.querySelector('[data-rackets]').textContent = '';
    if (!session) return;
    try {
      const response = await fetch('/api/customer-history', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await response.json();
      if (current !== revision) return;
      if (!response.ok) throw new Error(data.error);
      panel.querySelector('[data-orders]').innerHTML = data.orders.length ? data.orders.map(o => `<article><h4>${esc(o.order_reference || '#' + o.id.slice(0, 8))} · ${esc(date(o.created_at))}</h4><p>${esc((o.items || []).map(i => `${i.name || 'Item'} × ${i.quantity}`).join(', '))}</p><p>$${Number(o.total_amount).toFixed(2)} · ${esc(o.payment_status)} · ${esc(o.fulfilment_status || 'unfulfilled')}</p></article>`).join('') : '<p>No purchases yet.</p>';
      panel.querySelector('[data-rackets]').innerHTML = data.rackets.length ? data.rackets.map(r => `<article><h4>${esc(r.player_name)} · ${esc(r.racket_type)}</h4>${r.stringings.length ? r.stringings.map(s => `<p>${esc(date(s.strung_on))} · ${esc(s.strings_main)}${s.strings_cross ? ' / ' + esc(s.strings_cross) : ''} · ${esc(s.tension_main)}${s.tension_cross == null ? '' : ' / ' + esc(s.tension_cross)} ${esc(s.tension_unit)}</p>`).join('') : '<p>No stringing recorded yet.</p>'}</article>`).join('') : '<p>No rackets recorded yet.</p>';
      panel.querySelector('[data-history-message]').textContent = '';
    } catch (e) {
      if (current === revision) panel.querySelector('[data-history-message]').textContent = e.message;
    }
  }
  panel.querySelector('button').onclick = load;
  client.auth.onAuthStateChange(() => { setTimeout(load, 0); });
  load();
})();
