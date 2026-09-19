const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/racket-reminders.js');

const settings = { provider: 'resend', enabled: true, from_name: 'Kim Jones Coaching', from_email: 'notify@example.com', reply_to_email: 'kim@example.com' };
const record = { racket_id: 'racket-1', stringing_id: 'stringing-1', due_on: '2026-09-01', strung_on: '2026-06-01', racket_type: '<Blade & 100>', player_name: 'Sam', first_name: 'Alex', email: 'alex@example.com', strings_main: 'ALU', strings_cross: 'Gut', tension_main: 52, tension_cross: 50, tension_unit: 'lb' };
const delivery = { id: 'delivery-1', racket_id: 'racket-1', stringing_id: 'stringing-1', due_on: '2026-09-01', lease_token: 'lease-1' };
const response = () => ({ code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function setup(t, options = {}) {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  t.after(() => { process.env = originalEnv; global.fetch = originalFetch; });
  Object.assign(process.env, { CRON_SECRET: 'cron-secret', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-test', RESEND_API_KEY: 'resend-test' });
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers };
    calls.push(call);
    if (url.includes('/email_settings')) return json([options.settings || settings]);
    if (url.includes('/rpc/claim_racket_reminders')) return json(options.deliveries || [{ ...delivery, ...options.delivery }]);
    if (url.includes('/racket_reminders_due?')) return json(options.records || [record]);
    if (url.includes('/racket_reminder_deliveries?')) {
      if (options.failConfirmation && call.body.status === 'sent') return json({}, 500);
      if (options.lostLease && call.body.status === 'sending') return json([]);
      return json([{ ...delivery, ...call.body }]);
    }
    if (url === 'https://api.resend.com/emails') {
      if (options.sendFailure) throw new Error('Network timeout');
      return json({ id: 'resend-id' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return calls;
}

const invoke = async () => { const res = response(); await handler({ method: 'GET', headers: { authorization: 'Bearer cron-secret' } }, res); return res; };

test('cron rejects missing or incorrect authorization without calling external services', async (t) => {
  const calls = setup(t);
  for (const authorization of [undefined, 'Bearer wrong', 'Bearer undefined']) {
    const res = response();
    await handler({ method: 'GET', headers: { authorization } }, res);
    assert.equal(res.code, 401);
  }
  delete process.env.CRON_SECRET;
  assert.equal((await invoke()).code, 401);
  assert.equal(calls.length, 0);
});

test('disabled email never claims or sends reminders', async (t) => {
  const calls = setup(t, { settings: { ...settings, enabled: false } });
  const result = await invoke();
  assert.equal(result.body.status, 'disabled');
  assert.equal(calls.length, 1);
});

test('due email persists its payload before sending and confirms delivery afterwards', async (t) => {
  const calls = setup(t);
  const result = await invoke();
  assert.equal(result.code, 200);
  assert.equal(result.body.sent, 1);
  const sendIndex = calls.findIndex((c) => c.url === 'https://api.resend.com/emails');
  const send = calls[sendIndex];
  assert.equal(send.headers['Idempotency-Key'], 'racket-reminder/delivery-1');
  assert.deepEqual(calls[sendIndex - 1].body.email_payload, send.body);
  assert.equal(calls[sendIndex + 1].body.status, 'sent');
  assert.equal(send.body.reply_to, 'kim@example.com');
  assert.deepEqual(send.body.to, ['alex@example.com']);
  assert.match(send.body.text, /52 \/ 50 lb/);
  assert.match(send.body.html, /&lt;Blade &amp; 100&gt;/);
  assert.doesNotMatch(send.body.html, /<Blade/);
  assert.match(send.body.text, /stop these reminders/);
});

test('changed consent or superseded stringing cancels without sending', async (t) => {
  const calls = setup(t, { records: [] });
  const result = await invoke();
  assert.equal(result.body.skipped, 1);
  assert.equal(calls.some((c) => c.url === 'https://api.resend.com/emails'), false);
  assert.equal(calls.at(-1).body.status, 'cancelled');
});

test('a retry uses the exact original email payload and key', async (t) => {
  const payload = handler.buildMessage(record, settings);
  const calls = setup(t, { delivery: { email_payload: payload, first_attempt_at: new Date(Date.now() - 3600000).toISOString() }, settings: { ...settings, from_name: 'Changed name' } });
  await invoke();
  assert.deepEqual(calls.find((c) => c.url === 'https://api.resend.com/emails').body, payload);
});

test('expired idempotency window or a lost lease never sends an email', async (t) => {
  await t.test('expired attempt goes to review', async (t) => {
    const calls = setup(t, { delivery: { first_attempt_at: new Date(Date.now() - 25 * 3600000).toISOString() } });
    await invoke();
    assert.equal(calls.some((c) => c.url === 'https://api.resend.com/emails'), false);
    assert.equal(calls.at(-1).body.status, 'needs_review');
  });
  await t.test('another worker owns the lease', async (t) => {
    const calls = setup(t, { lostLease: true });
    await invoke();
    assert.equal(calls.some((c) => c.url === 'https://api.resend.com/emails'), false);
  });
});

test('failed sends or failed confirmations remain visible and do not falsely mark sent', async (t) => {
  for (const option of ['sendFailure', 'failConfirmation']) {
    await t.test(option, async (t) => {
      const calls = setup(t, { [option]: true });
      const result = await invoke();
      assert.equal(result.code, 500);
      assert.equal(result.body.sent, 0);
      assert.equal(result.body.failed, 1);
      assert.ok(calls.at(-1).body.error_message);
      assert.equal(calls.at(-1).body.status, undefined);
    });
  }
});
