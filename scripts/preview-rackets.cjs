// Local-only preview. Uses synthetic customers and an in-memory PostgreSQL database.
// It never connects to Supabase, Resend or any production service.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');

(async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(root, 'tests/fixtures/racket-base.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260912000000_customer_racket_stringing.sql'), 'utf8'));
  const racket = { id: randomUUID(), customer_id: '00000000-0000-0000-0000-000000000002', player_name: 'Sam Taylor', racket_type: 'Wilson Blade 100', notes: 'Blue grip · racket 1', reminder_enabled: true, reminder_interval: 3, reminder_unit: 'months' };
  const strungOn = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  await db.query('select admin_save_racket($1::jsonb, $2::jsonb)', [JSON.stringify(racket), JSON.stringify({ id: randomUUID(), strung_on: strungOn, strings_main: 'Luxilon ALU Power 1.25', tension_main: 52, tension_unit: 'lb', notes: 'Two-piece stringing' })]);
  const profiles = [
    { id: racket.customer_id, first_name: 'Alex', last_name: 'Taylor', email: 'alex@example.com', phone: '021 000 0000', role: 'customer', players: [{ name: 'Sam Taylor' }, { name: 'Jamie Taylor' }] },
    { id: '00000000-0000-0000-0000-000000000003', first_name: 'No', last_name: 'Email', email: null, role: 'customer', players: [] }
  ];
  const bootstrap = `
    window.KIMS_SUPABASE = { url: 'local-preview', anonKey: 'demo' };
    class PreviewQuery {
      constructor(table) { this.table = table; this.customerId = ''; }
      select() { return this; } order() { return this; } limit() { return this; } in() { return this; }
      eq(key, value) { if (key === 'customer_id') this.customerId = value; return this; }
      single() { return Promise.resolve({ data: { role: 'admin' } }); }
      then(resolve, reject) {
        let result;
        if (this.table === 'profiles') result = Promise.resolve({ data: ${JSON.stringify(profiles)} });
        else if (this.table === 'customer_rackets') result = fetch('/fixture/rackets?customer=' + encodeURIComponent(this.customerId)).then(r => r.json());
        else result = Promise.resolve({ data: [], count: 0 });
        return result.then(resolve, reject);
      }
    }
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'demo-admin' } } } }) }, from: table => new PreviewQuery(table), rpc: (name, payload) => fetch('/fixture/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()) }) };
  `;
  const allowed = new Set(['styles.css', 'admin-availability.css', 'admin-rackets.css', 'racket-stringing.js', 'admin-rackets.js', 'admin-dashboard.js']);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const send = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      if (url.pathname === '/fixture/rackets') {
        const result = await db.query(`select r.*, r.updated_at::text as updated_at, coalesce((select json_agg(s) from racket_stringings s where s.racket_id = r.id), '[]'::json) as stringings from customer_rackets r where customer_id = $1 order by created_at`, [url.searchParams.get('customer')]);
        return send({ data: result.rows });
      }
      if (url.pathname === '/fixture/save' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        try {
          const result = await db.query('select admin_save_racket($1::jsonb, $2::jsonb, $3::timestamptz) as id', [JSON.stringify(input.p_racket), input.p_stringing ? JSON.stringify(input.p_stringing) : null, input.p_expected_updated_at]);
          return send({ data: result.rows[0].id });
        } catch (error) { return send({ error: { message: error.message, code: error.code } }); }
      }
      if (url.pathname === '/' || url.pathname === '/admin.html') {
        let html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
          .replace('<div id="owner-panel" hidden>', '<div id="owner-panel">')
          .replace('<p id="owner-status" class="helper-text"></p>', '<p id="owner-status" class="helper-text">LOCAL PREVIEW · Sample customers only. Saving here sends no emails and changes no live data.</p>')
          .replace('</body>', `<script>${bootstrap}</script><script src="racket-stringing.js"></script><script src="admin-rackets.js"></script><script src="admin-dashboard.js"></script></body>`);
        res.setHeader('Content-Type', 'text/html'); return res.end(html);
      }
      const file = url.pathname.slice(1);
      if (allowed.has(file)) {
        res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/javascript');
        return res.end(fs.readFileSync(path.join(root, file)));
      }
      res.statusCode = 404; res.end('Not found');
    } catch (error) { res.statusCode = 500; res.end('Preview request failed'); console.error(error.message); }
  });
  server.listen(4173, '127.0.0.1', () => console.log('Racket preview: http://127.0.0.1:4173/admin.html#customers'));
})();
