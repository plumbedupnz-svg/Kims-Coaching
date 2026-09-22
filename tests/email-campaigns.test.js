const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./fixtures/email-campaign-harness.cjs');
const { content } = require('../email-campaign-content');
const { draft } = require('../lib/email-campaigns');

test('email content escapes names and markup and validates button URLs', () => {
  const result = content({ subject: 'Hi {{first_name}}', body: 'Hi {{first_name}},\n\n<script>alert(1)</script>', purpose: 'marketing', button_url: 'javascript:alert(1)', button_label: 'Open' }, { first_name: '<Alex>' });
  assert.ok(!result.html.includes('<script>'));
  assert.ok(result.html.includes('&lt;Alex&gt;'));
  assert.ok(!result.html.includes('javascript:'));
  assert.ok(result.html.includes('Unsubscribe'));
  assert.throws(() => draft({ purpose: 'service', contact_ids: [], group_ids: [], button_url: 'javascript:alert(1)', button_label: 'Open' }), /https/);
});

test('email workspace database, authorization and reliable sending', async (t) => {
  const h = await harness(); t.after(() => h.restore());
  const ok = async (action, values) => { const r = await h.call(action, values); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  let contacts, group, campaign;
  const baseDraft = { subject: 'Coaching update', preview_text: '', body: 'Hi {{first_name}},\n\nSee you on Tuesday.\n\nKim', purpose: 'service', button_url: '', button_label: '', contact_ids: [], group_ids: [], all_contacts: false };
  const prepare = async (values = {}) => (await ok('save', { draft: { ...baseDraft, ...values } })).campaign;
  const queue = async (d) => { const review = await ok('preview', { id: d.id }); return ok('queue', { id: d.id, hash: review.hash }); };

  await t.test('rejects anonymous/customer calls and direct privileged database access', async () => {
    assert.equal((await h.call(null, {}, null)).status, 401);
    assert.equal((await h.call('sync', {}, 'fixture-customer')).status, 403);
    await h.db.exec('set role authenticated');
    await assert.rejects(h.db.query('select * from email_contacts'), /permission denied/);
    await assert.rejects(h.db.query('select sync_email_contacts()'), /permission denied/);
    await assert.rejects(h.db.query('select * from claim_email_campaign(gen_random_uuid())'), /permission denied/);
    await h.db.exec('reset role');
  });
  await t.test('sync deduplicates addresses, skips archived members and never infers consent', async () => {
    await ok('sync'); await ok('sync');
    const data = await ok(); contacts = data.contacts; group = data.groups[0];
    assert.equal(contacts.length, 2); assert.equal(data.memberships.length, 2);
    assert.ok(contacts.every((c) => c.marketing_status === 'not_subscribed'));
    assert.ok(contacts.every((c) => !('unsubscribe_token' in c)));
    await h.db.query("update email_contacts set marketing_status='unsubscribed' where email='alex@example.com'");
    await ok('sync');
    assert.equal((await ok()).contacts.find((c) => c.email === 'alex@example.com').marketing_status, 'unsubscribed');
  });
  await t.test('custom groups update atomically and cannot overwrite junior groups', async () => {
    const result = await ok('group', { name: 'Adults', contact_ids: [contacts[0].id, contacts[0].id] });
    await ok('group', { id: result.id, name: 'Tuesday adults', contact_ids: [contacts[1].id] });
    const data = await ok();
    assert.equal(data.memberships.filter((m) => m.group_id === result.id).length, 1);
    assert.equal((await h.call('group', { id: group.id, name: 'Forged', contact_ids: [] })).status, 409);
  });
  await t.test('requires consent evidence and protects concurrent unsubscribes', async () => {
    const alex = (await ok()).contacts.find((c) => c.email === 'alex@example.com');
    assert.equal((await h.call('contact', { contact: { ...alex, original_status: 'unsubscribed', marketing_status: 'subscribed' } })).status, 400);
    await ok('contact', { contact: { ...alex, original_status: 'unsubscribed', marketing_status: 'subscribed', consent_note: 'Requested newsletter by email on 22 September.' } });
    assert.equal((await h.call('contact', { contact: { ...alex, original_status: 'unsubscribed', marketing_status: 'subscribed', consent_note: 'Stale form' } })).status, 409);
  });
  await t.test('draft concurrency and reviewed recipient changes block sending', async () => {
    campaign = await prepare({ group_ids: [group.id], contact_ids: [contacts[0].id] });
    const review = await ok('preview', { id: campaign.id });
    assert.equal(review.recipients.length, 2);
    assert.equal((await h.call('save', { id: campaign.id, version: 0, draft: baseDraft })).status, 409);
    await h.db.query("update email_contacts set first_name='Changed' where id=$1", [contacts[0].id]);
    assert.equal((await h.call('queue', { id: campaign.id, hash: review.hash })).status, 409);
    assert.equal(h.sends.length, 0);
  });
  await t.test('queues once, freezes content, leases work and sends individual messages once', async () => {
    await queue(campaign); await queue(campaign);
    assert.equal((await h.call('save', { id: campaign.id, version: 1, draft: baseDraft })).status, 409);
    const claim = (await h.db.query('select * from claim_email_campaign($1)', [campaign.id])).rows;
    assert.equal(claim.length, 1);
    assert.equal((await ok('process', { id: campaign.id })).busy, true);
    await h.db.query('update email_campaigns set locked_until=null where id=$1', [campaign.id]);
    const result = await ok('process', { id: campaign.id });
    assert.equal(result.sent, 2); assert.equal(result.status, 'complete');
    await ok('process', { id: campaign.id }); assert.equal(h.sends.length, 2);
    assert.ok(h.sends.every((s) => s.payload.to.length === 1 && !s.payload.cc && !s.payload.bcc));
  });
  await t.test('newsletters filter consent and suppress changes made after queueing', async () => {
    const d = await prepare({ purpose: 'marketing', all_contacts: true });
    assert.equal((await ok('preview', { id: d.id })).recipients.length, 1);
    await queue(d);
    await h.db.query("update email_contacts set marketing_status='unsubscribed'");
    const before = h.sends.length, result = await ok('process', { id: d.id });
    assert.equal(result.skipped, 1); assert.equal(h.sends.length, before);
  });
  await t.test('an uncertain response retries the identical saved payload with the same key', async () => {
    const d = await prepare({ contact_ids: [contacts[0].id] }); await queue(d);
    h.state.failure = 'timeout_after_accept';
    const first = await ok('process', { id: d.id }); assert.equal(first.pending, 1); assert.ok(first.error);
    await h.db.query("update email_settings set from_name='Changed sender'");
    const second = await ok('process', { id: d.id }); assert.equal(second.sent, 1);
    const last = h.sends.slice(-2); assert.deepEqual(last[0], last[1]);
  });
  await t.test('uncertain deliveries older than the retry window require review', async () => {
    const d = await prepare({ contact_ids: [contacts[0].id] }); await queue(d);
    await h.db.query("update email_campaign_recipients set first_attempt_at=now()-interval '24 hours' where campaign_id=$1", [d.id]);
    const before = h.sends.length, result = await ok('process', { id: d.id });
    assert.equal(result.needs_review, 1); assert.equal(result.status, 'needs_review'); assert.equal(h.sends.length, before);
  });
  await t.test('newsletter headers link to a working, scanner-safe unsubscribe endpoint', async () => {
    await h.db.query("update email_contacts set marketing_status='subscribed' where id=$1", [contacts[0].id]);
    const d = await prepare({ purpose: 'marketing', contact_ids: [contacts[0].id] }); await queue(d); await ok('process', { id: d.id });
    const payload = h.sends.at(-1).payload;
    assert.equal(payload.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    const url = new URL(payload.headers['List-Unsubscribe'].slice(1,-1));
    assert.ok(payload.html.includes(url.href.replaceAll('&', '&amp;')));
    const handler = require('../api/email-unsubscribe');
    let code, html;
    const res = { setHeader() {}, status(n) { code=n; return this; }, send(s) { html=s; } };
    await handler({ method: 'GET', url: url.pathname + url.search }, res);
    assert.equal(code, 200); assert.ok(html.includes('<form'));
    assert.equal((await h.db.query('select marketing_status from email_contacts where id=$1', [contacts[0].id])).rows[0].marketing_status, 'subscribed');
    await handler({ method: 'POST', url: url.pathname + url.search }, res);
    assert.equal(code, 200);
    assert.equal((await h.db.query('select marketing_status from email_contacts where id=$1', [contacts[0].id])).rows[0].marketing_status, 'unsubscribed');
    await handler({ method: 'POST', url: '/api/email-unsubscribe?token=bad' }, res); assert.equal(code, 400);
  });
  await t.test('test emails only go to the authenticated administrator', async () => {
    const d = await prepare(); await ok('test', { id: d.id, to: 'someone-else@example.com' });
    assert.deepEqual(h.sends.at(-1).payload.to, ['kim@example.com']);
  });
  await t.test('a junior membership change after review requires a new review', async () => {
    const d = await prepare({ group_ids: [group.id] });
    const reviewed = await ok('preview', { id: d.id });
    await h.db.query("update junior_group_members set placement_status='cancelled' where email='jamie@example.com'");
    assert.equal((await h.call('queue', { id: d.id, hash: reviewed.hash })).status, 409);
    assert.equal((await ok('preview', { id: d.id })).recipients.length, 1);
    await h.db.query("update junior_group_members set placement_status='placed' where email='jamie@example.com'");
  });
  await t.test('disabled sending and a missing unsubscribe origin cannot queue messages', async () => {
    const d = await prepare({ all_contacts: true });
    const reviewed = await ok('preview', { id: d.id });
    await h.db.query('update email_settings set enabled=false');
    assert.equal((await h.call('queue', { id: d.id, hash: reviewed.hash })).status, 503);
    assert.equal((await h.db.query('select status from email_campaigns where id=$1', [d.id])).rows[0].status, 'draft');
    await h.db.query('update email_settings set enabled=true');
    await h.db.query("update email_contacts set marketing_status='subscribed' where id=$1", [contacts[0].id]);
    const newsletter = await prepare({ purpose: 'marketing', all_contacts: true });
    const review = await ok('preview', { id: newsletter.id });
    delete process.env.EMAIL_SITE_URL; delete process.env.NEXT_PUBLIC_SITE_URL; delete process.env.SITE_URL;
    assert.equal((await h.call('queue', { id: newsletter.id, hash: review.hash })).status, 503);
    process.env.EMAIL_SITE_URL = 'https://coaching.example.com';
  });
  await t.test('pagination includes contacts beyond the first database page', async () => {
    await h.db.exec("insert into email_contacts(email,first_name) select 'person'||i||'@example.com','Person '||i from generate_series(1,510) i");
    assert.equal((await ok()).contacts.length, 512);
    const d = await prepare({ all_contacts: true }); assert.equal((await ok('preview', { id: d.id })).recipients.length, 512);
  });
});
