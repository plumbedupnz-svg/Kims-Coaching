const xero = require('./client');
const {restSelect, restUpdate} = require('../../api/stripe/_helpers');
const CODES = Object.freeze({coaching:'200',shop:'201',stock:'631',cost:'311'});
const round = value => Math.round(Number(value)*100)/100;
const positive = value => {const n=round(value); if(!Number.isFinite(n)||n<=0) throw new Error('A positive, verified amount is required.'); return n;};
function identifier(job) {return `KJC-${job.source_type}-${job.source_id}`;}
function payload(job, contactId) {
 const p=job.payload; const rawDate=String(p.date||'');
 const parsedDate=new Date(rawDate);
 const date=/^\d{4}-\d{2}-\d{2}$/.test(rawDate)?rawDate:Number.isNaN(parsedDate.getTime())?'':new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'}).format(parsedDate);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('The source date is invalid.');
 if(p.currency && p.currency!=='NZD') throw new Error('Only NZD transactions are supported.');
 const id=identifier(job);
 if(job.source_type==='stock_cost') {
  if(p.missing_cost) throw new Error('Stock costs need review before syncing.');
  if(p.debit_account!==CODES.cost||p.credit_account!==CODES.stock) throw new Error('Stock cost account mapping needs review.');
  const cost=positive(p.amount);
  return {Narration:id,Date:date,Status:'DRAFT',LineAmountTypes:'NoTax',JournalLines:[
   {Description:'Cost of shop stock sold',AccountCode:CODES.cost,LineAmount:cost,TaxType:'NONE'},
   {Description:'Release shop stock on hand',AccountCode:CODES.stock,LineAmount:-cost,TaxType:'NONE'}]};
 }
 const purchase=job.source_type==='stock_purchase';
 const code=purchase?CODES.stock:job.source_type==='shop_sale'?CODES.shop:
  ['coaching_private','coaching_junior'].includes(job.source_type)?CODES.coaching:null;
 if(!code||p.account!==code) throw new Error('Source account mapping needs review.');
 const lines=purchase?(p.lines||[]).map(i=>({Description:String(i.description||'Stock purchase').slice(0,500),Quantity:1,UnitAmount:positive(i.amount),AccountCode:code,TaxType:'NONE'})):
  [{Description:String(p.description||job.source_type).slice(0,500),Quantity:1,UnitAmount:positive(p.amount),AccountCode:code,TaxType:'NONE'}];
 if(!lines.length||lines.length>100) throw new Error('Review the invoice lines before syncing.');
 return {Type:purchase?'ACCPAY':'ACCREC',Contact:{ContactID:contactId},InvoiceNumber:id,Reference:purchase?`${id} / ${p.supplier_reference||''}`:id,
  Date:date,DueDate:date,CurrencyCode:'NZD',LineAmountTypes:'NoTax',Status:'DRAFT',LineItems:lines};
}
function checkExisting(job, expected, record) {
 if(job.source_type==='stock_cost') {
  const expectedLines=expected.JournalLines;
  if(record.Narration!==expected.Narration||!['DRAFT','POSTED'].includes(record.Status)||record.LineAmountTypes!=='NoTax'||record.JournalLines?.length!==2||
   expectedLines.some(line=>!record.JournalLines.some(actual=>actual.AccountCode===line.AccountCode&&Math.abs(Number(actual.LineAmount)-line.LineAmount)<0.005))) throw new Error('Existing stock journal differs from the saved cost snapshot. Review in Xero.');
 } else {
  const total=round(expected.LineItems.reduce((sum,l)=>sum+l.UnitAmount*l.Quantity,0));
  if(record.InvoiceNumber!==expected.InvoiceNumber||record.Type!==expected.Type||record.CurrencyCode!=='NZD'||
    !['DRAFT','SUBMITTED','AUTHORISED','PAID'].includes(record.Status)||Math.abs(Number(record.Total)-total)>0.005||
    record.Reference!==expected.Reference||record.LineItems?.length!==expected.LineItems.length||record.LineItems.some(l=>l.AccountCode!==expected.LineItems[0].AccountCode)||record.Contact?.ContactID!==expected.Contact.ContactID)
    throw new Error('Existing Xero invoice differs from the saved source. Review in Xero.');
 }
}
async function contact(job) {
 const p=job.payload;
 if(!String(p.name||'').trim()) throw new Error('The customer or supplier name is missing.');
 const identity=job.source_type==='stock_purchase'?`supplier:${p.name.toLowerCase()}`:`customer:${String(p.email||'').toLowerCase()}`;
 if(job.source_type!=='stock_purchase'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email||'')) throw new Error('A verified customer email is required.');
 const number=`KJC-ACCOUNTING-${xero.hash(identity).slice(0,32)}`;
 const found=await xero.request('/Contacts?where='+encodeURIComponent(`ContactNumber=="${number}"`));
 if(found.Contacts?.length===1) return found.Contacts[0].ContactID;
 const field=job.source_type==='stock_purchase'?'Name':'EmailAddress';
 const value=job.source_type==='stock_purchase'?String(p.name).trim():String(p.email).toLowerCase();
 const matching=await xero.request('/Contacts?where='+encodeURIComponent(`${field}==${JSON.stringify(value)}`));
 const active=(matching.Contacts||[]).filter(c=>c.ContactStatus!=='ARCHIVED');
 if(active.length===1)return active[0].ContactID;
 if(active.length>1)throw new Error('Multiple Xero contacts match this source. Review contacts before syncing.');
 const created=await xero.request('/Contacts',{method:'POST',key:'accounting-contact-'+number,body:{Contacts:[{Name:`${p.name}${p.email?' ('+p.email+')':''}`.slice(0,250),ContactNumber:number,...(p.email?{EmailAddress:p.email}:{})}]}});
 if(!created.Contacts?.[0]?.ContactID) throw new Error('Xero did not return a contact.');
 return created.Contacts[0].ContactID;
}
async function validateAccounts() {
 const {Accounts=[]}=await xero.request('/Accounts');
 const required=[[CODES.coaching,['REVENUE','SALES']],[CODES.shop,['REVENUE','SALES']],[CODES.stock,['CURRENT']],[CODES.cost,['DIRECTCOSTS','EXPENSE','OVERHEAD']]];
 for(const [code,types] of required) if(!Accounts.some(a=>a.Code===code&&a.Status==='ACTIVE'&&types.includes(a.Type))) throw new Error(`Xero account ${code} is missing, archived, or has an unexpected type.`);
 // Proves the reauthorised token has the journal permission before activation.
 await xero.request('/ManualJournals?page=1');
 return CODES;
}
async function sync(job) {
 const settings=(await restSelect('xero_accounting_settings','*',{id:'eq.true',limit:'1'}))[0];
 if(!settings?.enabled) throw new Error('Accounting sync is paused.');
 const connection=await xero.connection();
 if(!connection?.tenant_id||job.tenant_id&&job.tenant_id!==connection.tenant_id) throw new Error('The Xero organisation changed. Review this source.');
 // Validate source status immediately before sending. Never infer a refund/void adjustment.
 const table=job.source_type==='coaching_private'?'bookings':job.source_type==='coaching_junior'?'payments':job.source_type==='stock_purchase'?'supplier_invoices':'shop_orders';
 const source=(await restSelect(table,'*',{id:`eq.${job.source_id}`,limit:'1'}))[0];
 if(!source||job.source_type==='stock_purchase'&&!source.accounting_import_completed_at||job.source_type!=='stock_purchase'&&source.payment_status!=='paid') throw new Error('Source was removed, refunded, cancelled, or has not finished importing. Review in Xero.');
 if(job.source_type==='coaching_private' && round(source.total_price)!==round(job.payload.amount) ||
   job.source_type==='coaching_junior' && round(source.amount)!==round(job.payload.amount) ||
   job.source_type==='shop_sale' && round(source.total_amount)!==round(job.payload.amount)) throw new Error('Source amount changed after capture. Review the saved snapshot.');
 payload(job, "validate-only");
 const doc=payload(job,job.source_type==='stock_cost'?null:await contact(job));
 const journal=job.source_type==='stock_cost'; const endpoint=journal?'/ManualJournals':'/Invoices'; const list=journal?'ManualJournals':'Invoices';
 const field=journal?'Narration':'InvoiceNumber';
 const prior=await xero.request(`${endpoint}?where=`+encodeURIComponent(`${field}=="${identifier(job)}"`));
 if((prior[list]||[]).length>1) throw new Error('Multiple Xero records match this source. Review before retrying.');
 let record=prior[list]?.[0];
 if(record) checkExisting(job,doc,record);
 else {
  if(job.source_type==='stock_purchase' && job.payload.supplier_reference) {
   const existingBill=await xero.request('/Invoices?where='+encodeURIComponent(`Type=="ACCPAY"&&InvoiceNumber==${JSON.stringify(job.payload.supplier_reference)}`));
   if(existingBill.Invoices?.length)throw new Error('A supplier bill with this invoice number already exists in Xero. Review instead of creating a duplicate.');
  }
  const response=await xero.request(endpoint,{method:'POST',key:identifier(job),body:{[list]:[doc]}});
  record=response[list]?.[0];
  if(!record) throw new Error('Xero response was uncertain. Retry will look for the existing draft first.');
  checkExisting(job,doc,record);
 }
 const externalId=record[journal?'ManualJournalID':'InvoiceID'];
 if(!xero.uuid(externalId)) throw new Error('Xero did not return a valid record ID.');
 await restUpdate('xero_accounting_jobs',{id:`eq.${job.id}`,lease_token:`eq.${job.lease_token}`},{status:'draft',external_id:externalId,tenant_id:connection.tenant_id,error:null,lease_token:null,lease_until:null,updated_at:new Date().toISOString()},'');
}
async function processAccounting(limit=5,id=null) {
 const [config]=await restSelect('xero_accounting_settings','*',{id:'eq.true',limit:'1'});
 if(!config?.enabled)return;
 const started=Date.now();
 for(let count=0;count<limit&&Date.now()-started<35000;count++) {
  const [job]=await xero.rpc('claim_xero_accounting_job',{p_id:id}); if(!job) break;
  try {await sync(job);} catch(error) {
   await restUpdate('xero_accounting_jobs',{id:`eq.${job.id}`,lease_token:`eq.${job.lease_token}`},{status:'needs_review',error:String(error.message).slice(0,500),lease_token:null,lease_until:null,updated_at:new Date().toISOString()},'');
  }
 }
}
module.exports={CODES,payload,identifier,checkExisting,validateAccounts,sync,processAccounting};
