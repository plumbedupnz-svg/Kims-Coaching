const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { today, dueDate, formatDate } = require('../racket-stringing.js');
const fixture = readFileSync(`${__dirname}/fixtures/racket-base.sql`, 'utf8');
const migration = readFileSync(`${__dirname}/../supabase/migrations/20260912000000_customer_racket_stringing.sql`, 'utf8');

test('reminder calendar handles month ends, leap years, weeks and NZ midnight', () => {
  assert.equal(dueDate('2026-01-31', 1, 'months'), '2026-02-28');
  assert.equal(dueDate('2024-01-31', 1, 'months'), '2024-02-29');
  assert.equal(dueDate('2026-08-31', 3, 'months'), '2026-11-30');
  assert.equal(dueDate('2026-09-20', 2, 'weeks'), '2026-10-04');
  assert.equal(dueDate('2026-09-12', 0, 'months'), null);
  assert.equal(today(new Date('2026-09-11T12:30:00Z')), '2026-09-12');
  assert.equal(formatDate('2026-09-11T21:00:00Z'), formatDate('2026-09-12'));
});

test('racket database permissions, validation, history and reminder lifecycle', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fixture);
  await db.exec(migration);
  const racket = { id: randomUUID(), customer_id: '00000000-0000-0000-0000-000000000002', player_name: 'Sam Taylor', racket_type: 'Wilson Blade 100', notes: '', reminder_enabled: true, reminder_interval: 3, reminder_unit: 'months' };
  const record = { id: randomUUID(), strung_on: '2024-01-31', strings_main: 'ALU Power', strings_cross: '', tension_main: 52, tension_cross: 50, tension_unit: 'lb', notes: '' };
  const save = async (r, s, expected = null) => db.query('select public.admin_save_racket($1::jsonb, $2::jsonb, $3::timestamptz)', [JSON.stringify(r), s ? JSON.stringify(s) : null, expected]);
  const updatedAt = async () => (await db.query('select updated_at::text from customer_rackets where id = $1', [racket.id])).rows[0].updated_at;

  await t.test('non-admins cannot read, write, claim reminders or forge consent', async () => {
    await db.exec("set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);");
    await assert.rejects(save(racket, record), /Admin access required/);
    await assert.rejects(db.query('select * from claim_racket_reminders()'), /permission denied/);
    await assert.rejects(db.query('select * from racket_reminders_due'), /permission denied/);
    await assert.rejects(db.query('insert into customer_rackets(id) values ($1)', [randomUUID()]), /permission denied/);
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);");
  });
  await t.test('admin save is atomic, records consent and rejects invalid data', async () => {
    await db.exec('set role authenticated');
    await save(racket, record);
    await db.exec('reset role');
    const saved = (await db.query('select * from customer_rackets')).rows[0];
    assert.ok(saved.reminder_consent_at);
    assert.equal(saved.reminder_consent_by, '00000000-0000-0000-0000-000000000001');
    const before = await updatedAt();
    await assert.rejects(save({ ...racket, racket_type: 'Should roll back' }, { ...record, tension_main: -1 }, before), /check constraint/);
    assert.equal((await db.query('select racket_type from customer_rackets')).rows[0].racket_type, racket.racket_type);
    await assert.rejects(save(racket, { ...record, strung_on: '2099-01-01' }, before), /future/);
    await assert.rejects(save(racket, null, '2020-01-01'), /changed by someone else/);
    await assert.rejects(save({ ...racket, id: randomUUID(), customer_id: '00000000-0000-0000-0000-000000000003' }, record), /email address/);
    await db.exec("set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);");
    assert.equal((await db.query('select * from customer_rackets')).rows.length, 0);
    assert.equal((await db.query('select * from racket_stringings')).rows.length, 0);
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);");
  });
  let claim;
  await t.test('calendar matches UI and overlapping runs cannot claim twice', async () => {
    for (const [date, count, unit] of [['2026-01-31', 1, 'months'], ['2024-01-31', 1, 'months'], ['2026-09-20', 2, 'weeks']]) {
      const result = await db.query('select racket_restring_due($1::date, $2, $3)::text as due', [date, count, unit]);
      assert.equal(result.rows[0].due, dueDate(date, count, unit));
    }
    await db.exec('set role service_role');
    claim = (await db.query('select * from claim_racket_reminders()')).rows[0];
    assert.equal(claim.stringing_id, record.id);
    assert.ok(claim.lease_token);
    assert.equal((await db.query('select * from claim_racket_reminders()')).rows.length, 0);
    await db.exec('reset role');
  });
  await t.test('opt-out cancels queued reminders; opting in again reschedules an unsent one', async () => {
    await save({ ...racket, reminder_enabled: false }, null, await updatedAt());
    assert.equal((await db.query('select * from claim_racket_reminders()')).rows.length, 0);
    assert.equal((await db.query('select status from racket_reminder_deliveries')).rows[0].status, 'cancelled');
    await db.exec("update racket_reminder_deliveries set locked_until = null");
    await save(racket, null, await updatedAt());
    assert.equal((await db.query('select * from claim_racket_reminders()')).rows.length, 1);
  });
  await t.test('sent reminders never send again when the interval is changed', async () => {
    await db.exec("update racket_reminder_deliveries set status = 'sent', sent_at = now(), locked_until = null");
    await save({ ...racket, reminder_interval: 2 }, null, await updatedAt());
    assert.equal((await db.query('select * from claim_racket_reminders()')).rows.length, 0);
  });
  await t.test('new restring restarts the clock and historical entries cannot override it', async () => {
    const latest = { ...record, id: randomUUID(), strung_on: today() };
    await save(racket, latest, await updatedAt());
    await save(racket, { ...record, id: randomUUID(), strung_on: '2023-01-01' }, await updatedAt());
    assert.equal((await db.query('select * from racket_reminders_due')).rows.length, 0);
    assert.equal((await db.query('select count(*)::int as count from racket_stringings')).rows[0].count, 3);
    await save(racket, { ...latest, strung_on: '2025-01-01' }, await updatedAt());
    const next = (await db.query('select * from claim_racket_reminders()')).rows[0];
    assert.equal(next.stringing_id, latest.id);
    await db.exec("update racket_reminder_deliveries set status = 'sending', first_attempt_at = now() - interval '25 hours', locked_until = null where status = 'pending'");
    assert.equal((await db.query('select * from claim_racket_reminders()')).rows.length, 0);
    assert.equal((await db.query("select count(*)::int as count from racket_reminder_deliveries where status = 'needs_review'")).rows[0].count, 1);
  });
});
