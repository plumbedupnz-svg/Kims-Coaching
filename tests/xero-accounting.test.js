const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const {payload,checkExisting}=require('../lib/xero/accounting');
const id='12345678-1234-4234-8234-123456789012';
const make=(type,data)=>({id,source_type:type,source_id:id,payload:{date:'2026-10-13T14:30:00Z',...data}});
test('source types use the agreed account codes, NZ dates and drafts without payment requests',()=>{
 for(const [type,account] of [['coaching_private','200'],['coaching_junior','200'],['shop_sale','201']]){
  const doc=payload(make(type,{amount:150,account}),'contact');assert.equal(doc.LineItems[0].AccountCode,account);assert.equal(doc.Status,'DRAFT');assert.equal(doc.Date,'2026-10-14');assert.equal(doc.Type,'ACCREC');assert.equal(doc.LineAmountTypes,'NoTax');
 }
 const bill=payload(make('stock_purchase',{account:'631',lines:[{description:'Racket',quantity:2,amount:99.99}]}),'supplier');assert.equal(bill.Type,'ACCPAY');assert.equal(bill.LineItems[0].AccountCode,'631');assert.equal(bill.LineItems[0].UnitAmount,99.99);
 const journal=payload(make('stock_cost',{amount:70,debit_account:'311',credit_account:'631'}));assert.equal(journal.Status,'DRAFT');assert.deepEqual(journal.JournalLines.map(l=>[l.AccountCode,l.LineAmount]),[['311',70],['631',-70]]);
});
test('missing costs, currencies and inappropriate account mappings fail closed',()=>{
 assert.throws(()=>payload(make('coaching_private',{amount:10,account:'201'})),/mapping/);
 assert.throws(()=>payload(make('shop_sale',{amount:10,account:'201',currency:'USD'})),/NZD/);
 assert.throws(()=>payload(make('stock_cost',{amount:0,missing_cost:true,debit_account:'311',credit_account:'631'})),/costs/);
 assert.throws(()=>payload(make('stock_purchase',{account:'631',lines:[]})),/lines/);
});
test('recovery accepts the matching record and rejects changed totals, accounts and journal costs',()=>{
 const job=make('shop_sale',{amount:50,account:'201'});const doc=payload(job,'contact');const record={...doc,Total:50};checkExisting(job,doc,record);
 assert.throws(()=>checkExisting(job,doc,{...record,Total:49}),/differs/);
 assert.throws(()=>checkExisting(job,doc,{...record,LineItems:[{AccountCode:'200'}]}),/differs/);
 const j=make('stock_cost',{amount:20,debit_account:'311',credit_account:'631'}),d=payload(j);checkExisting(j,d,d);
 assert.throws(()=>checkExisting(j,d,{...d,JournalLines:[{AccountCode:'311',LineAmount:21},{AccountCode:'631',LineAmount:-21}]}),/differs/);
});
function mockedModule(mocks){const module={exports:{}};const filename=path.resolve('lib/xero/accounting.js');vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:n=>mocks[n],Intl,Date,Number,String,Math,Object,Error},{filename});return module.exports;}
test('lost draft response is recovered on retry without issuing another invoice',async()=>{
 const job={...make('shop_sale',{amount:50,account:'201',name:'Demo',email:'demo@example.com'}),lease_token:id};let external=null,creates=0;const updates=[];
 const api=mockedModule({'./client':{connection:async()=>({tenant_id:id}),hash:()=>id,uuid:v=>v===id,request:async(url,options)=>{
  if(url.startsWith('/Contacts?'))return{Contacts:[{ContactID:'contact'}]};
  if(url.startsWith('/Invoices?'))return{Invoices:external?[external]:[]};
  if(url==='/Invoices'){creates++;external={...options.body.Invoices[0],Total:50,InvoiceID:id};throw new Error('lost response');}
  throw new Error('Unexpected request');
 }},'../../api/stripe/_helpers':{restSelect:async table=>table==='xero_accounting_settings'?[{enabled:true}]:[{payment_status:'paid',total_amount:50}],restUpdate:async(...args)=>updates.push(args)}});
 await assert.rejects(api.sync(job),/lost response/);await api.sync(job);assert.equal(creates,1);assert.equal(updates[0][2].external_id,id);
});
test('accounting endpoints authenticate before database reads or mutations',async()=>{
 const filename=path.resolve('api/xero-accounting.js'),module={exports:{}};let read=false;
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:n=>n.includes('client')?{requireAdmin:async()=>{throw new Error('Admin access required');}}:n.includes('accounting')?{}:{restSelect:()=>{read=true;}},console},{filename});
 const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};await module.exports({method:'GET'},res);assert.equal(read,false);assert.equal(res.code,400);
});
