const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function config() {
  let creates = 0;
  const window = { supabase: { createClient: () => ({ serial: ++creates }) } };
  vm.runInNewContext(fs.readFileSync('supabase-config.js','utf8'), { window, document: { querySelector: () => null } });
  return { window, creates: () => creates };
}
test('admin modules reuse one auth client for the same configuration', () => {
  const { window, creates } = config();
  const first = window.KimsGetSupabaseClient('url','key');
  for (let i = 0; i < 25; i++) assert.equal(window.KimsGetSupabaseClient('url','key'), first);
  assert.equal(creates(), 1);
  assert.notEqual(window.KimsGetSupabaseClient('other-url','key'), first);
});
test('image-heavy admin RPC reads every row in bounded stable pages', async () => {
  const { window } = config(), requested = [], rows = Array.from({length: 43}, (_,id) => ({id}));
  const client = { rpc: () => ({ order: column => { assert.equal(column,'id'); return { range: async (a,b) => { requested.push([a,b]); return { data: rows.slice(a,b+1), error: null }; } }; } }) };
  const result = await window.KimsReadAdminRows(client,'admin_list_inventory_items');
  assert.equal(result.data.length,43);
  assert.equal(JSON.stringify(requested), '[[0,19],[20,39],[40,59]]');
  let count = 0;
  const failure = await window.KimsReadAdminRows({ rpc: () => ({ order: () => ({ range: async () => ++count===1 ? {data:rows.slice(0,20)} : {error:{message:'timeout'}} }) }) },'admin_list_products');
  assert.equal(failure.data, null); assert.equal(failure.error.message,'timeout');
});
test('auth callbacks release before profile queries and ignore a stale login after signout', async () => {
  const source = fs.readFileSync('app.js','utf8');
  const start = source.indexOf('let authRevision = 0;');
  const end = source.indexOf('\n    }\n  } catch', start);
  let callback, resolveProfile, queries = 0, renders = 0;
  const timers = [];
  const ctx = { supabaseClient: { auth: { onAuthStateChange: fn => { callback = fn; } } }, setTimeout: fn => timers.push(fn),
    loadProfile: () => { queries++; return new Promise(resolve => { resolveProfile=resolve; }); }, currentUser: null, currentProfile: null,
    renderAccountNavigation: () => renders++, renderCustomerAccount() {}, ownerStatusEl: null, setOwnerUI() {}, setAuthMode() {}, handleAdminStartupError: e => { throw e; } };
  vm.runInNewContext(source.slice(start,end),ctx);
  assert.equal(callback('SIGNED_IN',{user:{id:'customer'}}), undefined);
  assert.equal(queries,0);
  const login = timers.shift()(); assert.equal(queries,1);
  callback('SIGNED_OUT',null); await timers.shift()();
  resolveProfile({role:'customer'}); await login;
  assert.equal(ctx.currentUser,null); assert.equal(ctx.currentProfile,null); assert.equal(renders,1);
});
