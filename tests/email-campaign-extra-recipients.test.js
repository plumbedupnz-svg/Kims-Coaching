const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./fixtures/email-campaign-harness.cjs');
const { parseAddresses } = require('../email-campaign-content');
const { draft } = require('../lib/email-campaigns');

test('pasted address parser accepts list separators, normalizes and reports every invalid entry', () => {
  const parsed = parseAddresses(' ONE@example.com, two@example.com;\nthree+tennis@example.co.nz\tfour@example.com ONE@EXAMPLE.COM bad@ missing-at.example.com a@b..com');
  assert.deepEqual(parsed.addresses, ['one@example.com', 'two@example.com', 'three+tennis@example.co.nz', 'four@example.com']);
  assert.equal(parsed.duplicates, 1);
  assert.deepEqual(parsed.invalid, ['bad@', 'missing-at.example.com', 'a@b..com']);
  assert.equal(parseAddresses(Array.from({ length: 1001 }, (_, i) => `a${i}@example.com`).join('\n')).tooMany, true);
  assert.throws(() => draft({ purpose: 'service', contact_ids: [], group_ids: [], extra_emails: 'valid@example.com, bad@' }), /Fix these email addresses/);
  assert.throws(() => draft({ purpose: 'service', contact_ids: [], group_ids: [], extra_emails: [7] }), /Paste a list/);
});

test('campaign-only addresses support drafts, sending and persistent newsletter opt-outs', async (t) => {
  const h = await harness(); t.after(() => h.restore());
  const ok = async (action, values) => { const result = await h.call(action, values); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
  const base = { subject: 'Your coaching update', body: 'Hi {{first_name}},\n\nSee you on court.', purpose: 'service', contact_ids: [], group_ids: [], all_contacts: false };
  const prepare = async (extra = {}) => (await ok('save', { draft: { ...base, ...extra } })).campaign;
  const queue = async (campaign) => { const review = await ok('preview', { id: campaign.id }); await ok('queue', { id: campaign.id, hash: review.hash }); return review; };
  await ok('sync');
  const initial = await ok();
  let newsletterUrl;

  await t.test('pasted lists are saved with drafts and deduplicated against groups and individuals', async () => {
    const d = await prepare({ extra_emails: 'Friend.One@example.com; friend.two@example.com, ALEX@example.com\nFRIEND.ONE@EXAMPLE.COM', group_ids: [initial.groups[0].id], contact_ids: [initial.contacts[0].id] });
    assert.deepEqual(d.extra_emails, ['friend.one@example.com', 'friend.two@example.com', 'alex@example.com']);
    assert.deepEqual((await ok()).campaigns.find((c) => c.id === d.id).extra_emails, d.extra_emails);
    const review = await queue(d);
    assert.equal(review.recipients.length, 4);
    assert.equal(review.recipients.filter((c) => c.id === null).length, 2);
    assert.equal((await ok('process', { id: d.id })).sent, 4);
    assert.deepEqual(new Set(h.sends.map((s) => s.payload.to[0])), new Set(['friend.one@example.com', 'friend.two@example.com', 'alex@example.com', 'jamie@example.com']));
    assert.ok(h.sends.every((s) => s.payload.to.length === 1 && !s.payload.cc && !s.payload.bcc));
    assert.match(h.sends.find((s) => s.payload.to[0] === 'friend.one@example.com').payload.text, /Hi there,/);
    assert.equal((await ok()).contacts.length, 2);
    await ok('process', { id: d.id }); assert.equal(h.sends.length, 4);
  });
  await t.test('changing the pasted list invalidates the earlier review', async () => {
    const d = await prepare({ extra_emails: 'old@example.com' });
    const review = await ok('preview', { id: d.id });
    await ok('save', { id: d.id, version: d.version, draft: { ...base, extra_emails: 'new@example.com' } });
    assert.equal((await h.call('queue', { id: d.id, hash: review.hash })).status, 409);
  });
  await t.test('newsletter lists require a consent note and cannot bypass saved unsubscribes', async () => {
    await h.db.exec("update email_contacts set marketing_status='unsubscribed' where email='alex@example.com'");
    let d = await prepare({ purpose: 'marketing', extra_emails: 'alex@example.com; news.friend@example.com' });
    assert.equal((await h.call('preview', { id: d.id })).status, 400);
    d = (await ok('save', { id: d.id, version: d.version, draft: { ...base, purpose: 'marketing', extra_emails: d.extra_emails, extra_consent_note: 'Asked to receive this newsletter by email today.' } })).campaign;
    const review = await queue(d);
    assert.deepEqual(review.recipients.map((r) => r.email), ['news.friend@example.com']);
    assert.equal((await ok('process', { id: d.id })).sent, 1);
    const payload = h.sends.at(-1).payload;
    assert.equal(payload.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    newsletterUrl = new URL(payload.headers['List-Unsubscribe'].slice(1, -1));
    assert.equal((await ok()).contacts.length, 2);
    assert.ok(!(await ok()).external_unsubscribed.length);
  });
  const unsubscribe = async (method = 'POST') => {
    let code;
    const res = { setHeader() {}, status(value) { code = value; return this; }, send() {} };
    await require('../api/email-unsubscribe')({ method, url: newsletterUrl.pathname + newsletterUrl.search }, res);
    assert.equal(code, 200);
  };
  await t.test('external unsubscribe links stop queued and future newsletters without creating contacts', async () => {
    const options = { purpose: 'marketing', extra_emails: ['news.friend@example.com'], extra_consent_note: 'Same consent for another update.' };
    const d = await prepare(options); await queue(d);
    await unsubscribe('GET');
    assert.equal((await h.db.query("select unsubscribed_at from email_external_preferences where email='news.friend@example.com'")).rows[0].unsubscribed_at, null);
    await unsubscribe();
    const before = h.sends.length;
    assert.equal((await ok('process', { id: d.id })).skipped, 1);
    assert.equal(h.sends.length, before);
    const next = await prepare(options);
    assert.equal((await ok('preview', { id: next.id })).recipients.length, 0);
    const data = await ok();
    assert.deepEqual(data.external_unsubscribed, ['news.friend@example.com']);
    assert.equal(data.contacts.length, 2);
    assert.ok(!JSON.stringify(data).includes('unsubscribe_token'));
  });
  await t.test('an external link also updates a contact created later for the same address', async () => {
    await ok('contact', { contact: { email: 'news.friend@example.com', first_name: 'New', marketing_status: 'subscribed', consent_note: 'Explicitly requested to rejoin today.' } });
    await unsubscribe();
    const contact = (await ok()).contacts.find((c) => c.email === 'news.friend@example.com');
    assert.equal(contact.marketing_status, 'unsubscribed');
  });
  await t.test('uncertain external sends safely reuse the saved payload and provider key', async () => {
    const d = await prepare({ extra_emails: 'retry.friend@example.com' }); await queue(d);
    h.state.failure = 'timeout_after_accept';
    const first = await ok('process', { id: d.id }); assert.equal(first.pending, 1); assert.ok(first.error);
    assert.equal((await ok('process', { id: d.id })).sent, 1);
    assert.deepEqual(h.sends.at(-2), h.sends.at(-1));
  });
  await t.test('external preferences and unsubscribe RPC remain inaccessible to browser roles', async () => {
    await h.db.exec('set role authenticated');
    await assert.rejects(h.db.query('select * from email_external_preferences'), /permission denied/);
    await assert.rejects(h.db.query('select unsubscribe_email_recipient($1)', [newsletterUrl.searchParams.get('token')]), /permission denied/);
    await h.db.exec('reset role');
  });
});
