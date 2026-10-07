const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
function load(file, mocks, fetch) {
  const filename = path.resolve(file), module = { exports: {} }, real = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: n => mocks[n] || real(n), fetch, URL, Buffer, Intl, Date, console });
  return module.exports;
}
function response() { return { setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } }; }
const id = '12345678-1234-4234-8234-123456789012';
const customer = { id, email: 'customer@example.com', first_name: 'Customer', last_name: 'Test', phone: '123' };
function harness({ deny = false, existing = false } = {}) {
  const calls = [];
  const handler = load('api/admin-customers.js', {
    './stripe/_helpers': {
      readJsonBody: async req => req.body,
      getSupabaseConfig: () => ({ projectUrl: 'https://auth.example', serviceRoleKey: 'private' }),
      getSiteUrl: () => 'https://site.example',
      restSelect: async (table, fields, params) => params.email ? (existing ? [{ id, role: 'customer' }] : []) : [customer],
    },
    '../lib/xero/client': { requireAdmin: async () => { if (deny) throw Error('Admin access required.'); }, uuid: v => v === id },
    './shop-checkout': async (req, res, user) => { calls.push({ checkout: req.body, user }); return res.status(200).json({ saved: true }); },
  }, async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ id }) }; });
  return { calls, handler };
}
test('customer creation is admin only, unconfirmed, and sends no activation email', async () => {
  const { handler, calls } = harness(); const res = response();
  await handler({ method: 'POST', headers: {}, body: { action: 'create', first_name: 'Kim', email: 'PERSON@example.com' } }, res);
  assert.equal(res.code, 200); assert.equal(calls.length, 1);
  assert.equal(calls[0].body.email_confirm, false);
  assert.equal(calls[0].body.email, 'person@example.com');
  assert.ok(calls[0].body.password.length >= 48);
  assert.equal(calls[0].body.user_metadata.role, undefined);
  const denied = harness({ deny: true }); const rejected = response();
  await denied.handler({ method: 'POST', headers: {}, body: {} }, rejected);
  assert.equal(rejected.code, 400); assert.equal(denied.calls.length, 0);
});
test('duplicate email selects existing customer without changing auth details', async () => {
  const { handler, calls } = harness({ existing: true }); const res = response();
  await handler({ method: 'POST', headers: {}, body: { action: 'create', first_name: 'Kim', email: customer.email } }, res);
  assert.equal(res.body.existing, true); assert.equal(calls.length, 0);
});
test('admin invoice uses selected customer and ignores supplied prices or identity', async () => {
  const { handler, calls } = harness(); const res = response();
  await handler({ method: 'POST', headers: {}, body: { action: 'invoice', customer_id: id, checkout_key: id, user_id: 'attacker', checkout: { customer: { email: 'attacker@example.com' } }, cart: [{ id, quantity: 1, price: 0 }] } }, res);
  assert.equal(res.code, 200); assert.equal(calls[0].user.id, id);
  assert.equal(calls[0].checkout.checkout.customer.email, customer.email);
  assert.equal(calls[0].checkout.checkout.payment_method, 'bank_transfer');
});
test('activation is a separate email request with a fixed account redirect', async () => {
  const { handler, calls } = harness(); const res = response();
  await handler({ method: 'POST', headers: {}, body: { action: 'activation', customer_id: id, redirect_to: 'https://attacker.example' } }, res);
  assert.equal(res.body.sent, true); assert.match(calls[0].url, /recover\?redirect_to=https%3A%2F%2Fsite.example%2Faccount.html/);
});
test('account history requires verification and scopes every query to session ownership', async () => {
  let verified = false; const calls = [];
  const handler = load('api/customer-history.js', { './stripe/_helpers': {
    verifyUser: async () => ({ id, email_confirmed_at: verified ? '2026-10-08' : null }),
    restSelect: async (table, fields, params) => { calls.push({ table, params }); return table === 'customer_rackets' ? [{ id, player_name: 'Me' }] : []; },
    uuidList: ids => `in.(${ids.join(',')})`,
  } });
  const denied = response(); await handler({ method: 'GET', headers: {} }, denied);
  assert.equal(denied.code, 403); assert.equal(calls.length, 0);
  verified = true; const res = response(); await handler({ method: 'GET', headers: {}, query: { customer_id: 'attacker' } }, res);
  assert.equal(res.code, 200); assert.equal(calls[0].params.user_id, `eq.${id}`);
  assert.equal(calls[1].params.customer_id, `eq.${id}`); assert.equal(calls[2].params.racket_id, `in.(${id})`);
});
