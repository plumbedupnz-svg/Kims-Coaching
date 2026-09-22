// Isolated PostgreSQL + provider fixture. Every network request is intercepted;
// this harness cannot send real email or write to a production database.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const ADMIN = '00000000-0000-0000-0000-000000000001';
const CUSTOMER = '00000000-0000-0000-0000-000000000002';
async function harness() {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, 'racket-base.sql'), 'utf8'));
  await db.exec(`
    create table junior_groups(id uuid primary key default gen_random_uuid(), group_name text, term_name text, is_active boolean default true);
    create table junior_group_members(id uuid primary key default gen_random_uuid(), group_id uuid references junior_groups(id), email text, parent_name text, booking_status text, placement_status text);
    create table email_settings(provider text, enabled boolean, from_name text, from_email text, reply_to_email text);
    insert into email_settings values('resend',true,'Kim Jones Coaching','news@example.com','kim@example.com');
    insert into junior_groups(id,group_name,term_name) values('10000000-0000-0000-0000-000000000001','Tuesday juniors','Term 4');
    insert into junior_group_members(group_id,email,parent_name,booking_status,placement_status) values
      ('10000000-0000-0000-0000-000000000001','ALEX@example.com','Alex Taylor','confirmed','placed'),
      ('10000000-0000-0000-0000-000000000001','jamie@example.com','Jamie Lee','confirmed','placed'),
      ('10000000-0000-0000-0000-000000000001','cancelled@example.com','Cancelled','confirmed','cancelled');
  `);
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260922000000_email_campaigns.sql'), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Re-running the additive migration is safe.
  const extrasMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260922010000_email_campaign_extra_recipients.sql'), 'utf8');
  await db.exec(extrasMigration);
  await db.exec(extrasMigration);
  const previousEnv = { ...process.env }, previousFetch = global.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'https://email-fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', RESEND_API_KEY: 'fixture-resend', EMAIL_SITE_URL: 'https://coaching.example.com' });
  const sends = [], accepted = new Map();
  const state = { failure: null };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const ident = (value) => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid fixture identifier'); return `"${value}"`; };
  const params = (values) => values.map((value) => Array.isArray(value) ? `{${value.map((item) => JSON.stringify(item)).join(',')}}` : value && typeof value === 'object' ? JSON.stringify(value) : value);
  global.fetch = async (input, options = {}) => {
    const url = new URL(input), method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
    if (url.origin === 'https://api.resend.com') {
      const key = options.headers['Idempotency-Key'];
      sends.push({ key, payload: body });
      if (state.failure === 'rate') return json({ error: 'rate limited' }, 429);
      if (accepted.has(key)) {
        if (JSON.stringify(accepted.get(key).payload) !== JSON.stringify(body)) return json({ error: 'different payload' }, 409);
        return json({ id: accepted.get(key).id });
      }
      const id = `fixture-email-${accepted.size + 1}`;
      accepted.set(key, { id, payload: body });
      if (state.failure === 'timeout_after_accept') { state.failure = null; throw new Error('Simulated lost provider response'); }
      return json({ id });
    }
    if (url.origin !== 'https://email-fixture.invalid') throw new Error(`Network blocked in email fixture: ${url.origin}`);
    if (url.pathname === '/auth/v1/user') {
      if (options.headers.Authorization === 'Bearer fixture-admin') return json({ id: ADMIN, email: 'kim@example.com' });
      if (options.headers.Authorization === 'Bearer fixture-customer') return json({ id: CUSTOMER, email: 'alex@example.com' });
      return json({ error: 'Unauthorized' }, 401);
    }
    const resource = url.pathname.replace('/rest/v1/', '');
    try {
      if (resource.startsWith('rpc/')) {
        const name = resource.slice(4), values = body || Object.fromEntries([...url.searchParams].filter(([key]) => key.startsWith('p_')));
        const casts = { sync_email_contacts: [], save_email_group: ['uuid','text','uuid[]'], email_campaign_audience: ['uuid'], queue_email_campaign: ['uuid','integer','jsonb'], claim_email_campaign: ['uuid'], unsubscribe_email_recipient: ['text'] }[name];
        if (!casts) throw new Error('Unknown fixture RPC');
        const args = Object.values(values), sqlArgs = casts.map((cast, i) => `$${i + 1}::${cast}`);
        const paged = method === 'GET' ? ` limit ${Number(url.searchParams.get('limit') || 1000)} offset ${Number(url.searchParams.get('offset') || 0)}` : '';
        const result = await db.query(`select * from ${ident(name)}(${sqlArgs})${paged}`, params(args.map((value, i) => casts[i] === 'jsonb' ? JSON.stringify(value) : value)));
        if (['sync_email_contacts', 'queue_email_campaign'].includes(name)) return json(null);
        if (['save_email_group', 'unsubscribe_email_recipient'].includes(name)) return json(result.rows[0][name]);
        return json(result.rows);
      }
      const table = ident(resource), values = [], where = [];
      for (const [column, value] of url.searchParams) {
        if (['select','order','limit','offset'].includes(column)) continue;
        const dot = value.indexOf('.'), op = value.slice(0, dot), operand = value.slice(dot + 1);
        if (op === 'eq') { values.push(operand); where.push(`${ident(column)}=$${values.length}`); }
        else if (op === 'in') { const list = operand.slice(1,-1).split(','); where.push(`${ident(column)} in (${list.map((v) => { values.push(v); return `$${values.length}`; }).join(',')})`); }
        else throw new Error('Unsupported fixture filter');
      }
      const filter = where.length ? ` where ${where.join(' and ')}` : '';
      if (method === 'GET') {
        const select = url.searchParams.get('select') || '*';
        const fields = select === '*' ? '*' : select.split(',').map(ident).join(',');
        const order = url.searchParams.get('order');
        const sort = order ? ' order by ' + order.split(',').map((item) => { const [key, direction] = item.split('.'); return `${ident(key)} ${direction === 'desc' ? 'desc' : 'asc'}`; }).join(',') : '';
        const result = await db.query(`select ${fields} from ${table}${filter}${sort} limit ${Number(url.searchParams.get('limit') || 1000)} offset ${Number(url.searchParams.get('offset') || 0)}`, values);
        return json(result.rows);
      }
      const keys = Object.keys(body);
      let sql;
      if (method === 'POST') {
        values.push(...Object.values(body));
        sql = `insert into ${table}(${keys.map(ident)}) values(${keys.map((_, i) => `$${i + 1}`)}) returning *`;
      } else if (method === 'PATCH') {
        const set = keys.map((key) => { values.push(body[key]); return `${ident(key)}=$${values.length}`; });
        sql = `update ${table} set ${set.join(',')}${filter} returning *`;
      } else throw new Error('Unsupported fixture method');
      return json((await db.query(sql, params(values))).rows);
    } catch (error) { return json({ code: error.code, message: error.message }, 400); }
  };
  async function call(action, values = {}, token = 'fixture-admin', method) {
    let result = { status: 200, headers: {} };
    const res = { setHeader: (k,v) => { result.headers[k] = v; }, status: (code) => { result.status = code; return res; }, json: (value) => { result.body = value; }, send: (value) => { result.body = value; } };
    await require('../../api/email-campaigns')({ method: method || (action ? 'POST' : 'GET'), headers: token ? { authorization: `Bearer ${token}` } : {}, body: action ? { action, ...values } : null }, res);
    return result;
  }
  return { db, call, sends, accepted, state, ADMIN, CUSTOMER, restore: async () => { global.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]; Object.assign(process.env, previousEnv); await db.close(); } };
}
module.exports = { harness };
