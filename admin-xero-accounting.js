(function(){
 const panel=document.querySelector('[data-xero-accounting]'); if(!panel)return;
 const client=window.supabase?.createClient(window.KIMS_SUPABASE?.url,window.KIMS_SUPABASE?.anonKey);
 const status=panel.querySelector('[data-accounting-status]'),list=panel.querySelector('[data-accounting-jobs]');
 async function api(body){
  const {data}=await client.auth.getSession(); if(!data.session)throw new Error('Sign in as an administrator.');
  const r=await fetch('/api/xero-accounting',{method:body?'POST':'GET',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const result=await r.json();if(!r.ok)throw new Error(result.error);return result;
 }
 async function refresh(){
  try{
   const data=await api();
   status.textContent=data.settings.enabled?'New-record accounting sync is enabled. Xero drafts need approval and reconciliation in Xero.':'Accounting sync is paused. Historical records will not be backfilled.';
   panel.querySelector('[data-accounting-enable]').disabled=data.settings.enabled;
   panel.querySelector('[data-accounting-pause]').disabled=!data.settings.enabled;
   list.replaceChildren();
   for(const job of data.jobs){
    const row=document.createElement('p');
    row.textContent=`${job.source_type.replaceAll('_',' ')} · ${job.source_id} · ${job.status==='draft'?'Synced to Xero draft':job.status}${job.external_id?' · Xero ID '+job.external_id:''}${job.error?' · '+job.error:''}`;
    if(job.status==='needs_review'){
     const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';b.textContent='Retry after review';
     b.onclick=()=>act({action:'retry',id:job.id});row.append(' ',b);
    }
    list.append(row);
   }
   if(!data.jobs.length)list.textContent='No new transactions captured.';
  }catch(e){status.textContent=e.message;}
 }
 async function act(body){
  const buttons=panel.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);status.textContent='Checking and syncing…';
  try{await api(body);await refresh();}catch(e){status.textContent=e.message;}
  finally{panel.querySelector('[data-accounting-refresh]').disabled=false;panel.querySelector('[data-accounting-process]').disabled=false;}
 }
 panel.querySelector('[data-accounting-enable]').onclick=()=>act({action:'enable'});
 panel.querySelector('[data-accounting-pause]').onclick=()=>act({action:'pause'});
 panel.querySelector('[data-accounting-process]').onclick=()=>act({action:'process'});
 panel.querySelector('[data-accounting-refresh]').onclick=refresh;
 document.querySelector('[data-settings-tab="xero"]')?.addEventListener('click',refresh);
 refresh();
})();
