const xero=require('../lib/xero/client');
const {CODES,validateAccounts,processAccounting}=require('../lib/xero/accounting');
const {readJsonBody,restSelect,restUpdate}=require('./stripe/_helpers');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
 try {
  await xero.requireAdmin(req);
  if(req.method==='GET') {
   const [settings,jobs]=await Promise.all([
    restSelect('xero_accounting_settings','*',{id:'eq.true',limit:'1'}),
    restSelect('xero_accounting_jobs','id,source_type,source_id,status,external_id,error,created_at',{order:'created_at.desc',limit:'50'})
   ]);
   return res.status(200).json({settings:settings[0],codes:CODES,jobs});
  }
  const body=await readJsonBody(req);
  if(body.action==='enable') {
   await validateAccounts();
   const [current]=await restSelect('xero_accounting_settings','*',{id:'eq.true',limit:'1'});
   await restUpdate('xero_accounting_settings',{id:'eq.true'},{enabled:true,activated_at:current.activated_at||new Date().toISOString()},'');
   return res.status(200).json({enabled:true});
  }
  if(body.action==='pause') {
   await restUpdate('xero_accounting_settings',{id:'eq.true'},{enabled:false},'');
   return res.status(200).json({enabled:false});
  }
  if(body.action==='process') {
   await processAccounting(5); return res.status(200).json({processed:true});
  }
  if(body.action==='retry'&&xero.uuid(body.id)) {
   const [job]=await restSelect('xero_accounting_jobs','*',{id:`eq.${body.id}`,limit:'1'});
   if(!job||job.status!=='needs_review'||job.payload?.missing_cost) throw new Error('This entry requires its source costs or Xero record to be reviewed first.');
   await restUpdate('xero_accounting_jobs',{id:`eq.${body.id}`,status:'eq.needs_review'},{status:'pending',error:null},'');
   await processAccounting(1,body.id); return res.status(200).json({processed:true});
  }
  throw new Error('Unknown action.');
 } catch(error) {
  // Do not return raw database responses, credentials, or provider payloads.
  const message=/42P01|PGRST205/.test(error.message)?'Apply the accounting-sync database migration before activation.':
   /401|403|Admin access|auth|token/i.test(error.message)?'Admin access and Xero journal permission are required. Reconnect Xero if necessary.':
   /^(Xero account|This entry|The Xero|Connect Xero)/.test(error.message)?error.message:'Accounting sync could not complete. Check the Xero connection and database setup.';
  return res.status(400).json({error:message});
 }
};
