begin;
-- Capture only records created after the owner activates this integration.
create table if not exists public.xero_accounting_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 activated_at timestamptz, coaching_account_code text not null default '200',
 shop_account_code text not null default '201', stock_account_code text not null default '631',
 cost_account_code text not null default '311'
);
insert into public.xero_accounting_settings(id) values(true) on conflict do nothing;
create table if not exists public.xero_accounting_jobs (
 id uuid primary key default gen_random_uuid(), source_type text not null,
 source_id uuid not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','draft','needs_review')),
 external_id uuid, tenant_id uuid, error text, lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(source_type, source_id)
);
do $$ declare t text; begin
 foreach t in array array['xero_accounting_settings','xero_accounting_jobs'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public,anon,authenticated', t);
  execute format('grant all on public.%I to service_role', t);
 end loop;
end $$;
alter table public.supplier_invoices add column if not exists accounting_import_completed_at timestamptz;
create or replace function public.complete_supplier_accounting_import(p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.current_user_is_admin() then raise exception 'Admin access required'; end if;
 if not exists(select 1 from supplier_invoice_items where invoice_id=p_invoice_id) then raise exception 'Import invoice lines first'; end if;
 update supplier_invoices set accounting_import_completed_at=coalesce(accounting_import_completed_at,now()) where id=p_invoice_id;
end $$;
revoke all on function public.complete_supplier_accounting_import(uuid) from public,anon;
grant execute on function public.complete_supplier_accounting_import(uuid) to authenticated,service_role;
create or replace function public.capture_xero_accounting_job()
returns trigger language plpgsql security definer set search_path=public as $$
declare s xero_accounting_settings; p jsonb; member jsonb; lines jsonb; item jsonb; costs numeric:=0; bad_cost boolean:=false; n jsonb:=to_jsonb(new);
begin
 select * into s from xero_accounting_settings where id=true;
 if not s.enabled or s.activated_at is null or (n->>'created_at')::timestamptz<s.activated_at then return new; end if;
 if tg_op='UPDATE' and exists(select 1 from xero_accounting_jobs where source_id=new.id) and (
   (n->>'total_price') is distinct from (to_jsonb(old)->>'total_price') or
   (n->>'amount') is distinct from (to_jsonb(old)->>'amount') or
   (n->>'total_amount') is distinct from (to_jsonb(old)->>'total_amount') or
   (n->'items') is distinct from (to_jsonb(old)->'items') or
   (n->>'customer_email') is distinct from (to_jsonb(old)->>'customer_email')
 ) then
  update xero_accounting_jobs set status='needs_review',error='Source details changed after capture. Review the saved snapshot and linked Xero draft.',updated_at=now() where source_id=new.id;
  return new;
 end if;
 if tg_op='UPDATE' and tg_table_name in ('bookings','payments','shop_orders') and n->>'payment_status' is distinct from 'paid' then
  update xero_accounting_jobs set status='needs_review',error='Source payment status changed. Review the linked draft in Xero; no automatic refund or stock reversal is posted.',updated_at=now()
   where source_id=new.id;
  return new;
 end if;
 if tg_table_name='bookings' then
  if n->>'payment_status'<>'paid' then return new; end if;
  p:=jsonb_build_object('amount',n->'total_price','name',coalesce(n->>'parent_name',n->>'customer_name','Coaching customer'),
    'email',n->>'customer_email','date',coalesce(n->>'paid_at',n->>'created_at'),'description','Private coaching','account',s.coaching_account_code);
  insert into xero_accounting_jobs(source_type,source_id,payload) values('coaching_private',new.id,p) on conflict do nothing;
 elsif tg_table_name='payments' then
  if n->>'payment_status'<>'paid' or n->>'related_type' not in ('junior_group','junior_group_pending') then return new; end if;
  select to_jsonb(m) into member from junior_group_members m where m.id=(n->>'junior_group_member_id')::uuid;
  p:=jsonb_build_object('amount',n->'amount','currency',n->>'currency','name',member->>'parent_name','email',member->>'email',
   'date',coalesce(n->>'paid_at',n->>'created_at'),'description','Junior coaching payment','account',s.coaching_account_code);
  insert into xero_accounting_jobs(source_type,source_id,payload) values('coaching_junior',new.id,p) on conflict do nothing;
 elsif tg_table_name='supplier_invoices' then
  if n->>'accounting_import_completed_at' is null then return new; end if;
  select jsonb_agg(jsonb_build_object('description',product_name,'quantity',quantity_purchased,'amount',total_cost)) into lines
   from supplier_invoice_items where invoice_id=new.id;
  p:=jsonb_build_object('name',n->>'supplier','date',coalesce(n->>'invoice_date',n->>'created_at'),
    'supplier_reference',n->>'invoice_number','lines',lines,'account',s.stock_account_code);
  if exists(select 1 from xero_accounting_jobs where source_type='stock_purchase' and lower(payload->>'name')=lower(p->>'name') and
    nullif(p->>'supplier_reference','') is not null and payload->>'supplier_reference'=p->>'supplier_reference' and source_id<>new.id) then
   insert into xero_accounting_jobs(source_type,source_id,payload,status,error) values('stock_purchase',new.id,p,'needs_review','This supplier invoice number was already imported. Review the original bill before syncing.') on conflict do nothing;
  else
   insert into xero_accounting_jobs(source_type,source_id,payload) values('stock_purchase',new.id,p) on conflict do nothing;
  end if;
 elsif tg_table_name='shop_orders' then
  if n->>'payment_status'<>'paid' then return new; end if;
  if n->>'payment_provider' is distinct from 'xero' then
   p:=jsonb_build_object('amount',n->'total_amount','name',n->>'customer_name','email',n->>'customer_email',
    'date',coalesce(n->>'paid_at',n->>'created_at'),'description','Shop order '||new.id,'account',s.shop_account_code);
   insert into xero_accounting_jobs(source_type,source_id,payload) values('shop_sale',new.id,p) on conflict do nothing;
  end if;
  for item in select value from jsonb_array_elements(coalesce(n->'items','[]'::jsonb)) loop
   if item->>'fulfilment_type'='stock' then
    if coalesce((item->>'cost_price_at_sale')::numeric,0)<=0 or coalesce((item->>'quantity')::numeric,0)<=0 then bad_cost:=true;
    else costs:=costs+round((item->>'cost_price_at_sale')::numeric*(item->>'quantity')::numeric,2); end if;
   end if;
  end loop;
  if costs>0 or bad_cost then
   p:=jsonb_build_object('amount',costs,'date',coalesce(n->>'paid_at',n->>'created_at'),'debit_account',s.cost_account_code,
    'credit_account',s.stock_account_code,'missing_cost',bad_cost);
   insert into xero_accounting_jobs(source_type,source_id,payload,status,error) values('stock_cost',new.id,p,
    case when bad_cost then 'needs_review' else 'pending' end,
    case when bad_cost then 'Stock cost snapshot is missing or zero. Review costs before syncing.' else null end) on conflict do nothing;
  end if;
 end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['bookings','payments','supplier_invoices','shop_orders'] loop
  execute format('drop trigger if exists capture_xero_accounting on public.%I',t);
  execute format('create trigger capture_xero_accounting after insert or update on public.%I for each row execute function public.capture_xero_accounting_job()',t);
 end loop;
end $$;
-- A stale in-flight send is held for review rather than blindly posted twice.
create or replace function public.claim_xero_accounting_job(p_id uuid default null)
returns setof public.xero_accounting_jobs language plpgsql set search_path=public as $$
begin
 update xero_accounting_jobs set status='needs_review',error='Previous sync timed out. Review and retry to recover the existing Xero draft.',updated_at=now()
  where status='processing' and lease_until<now();
 return query update xero_accounting_jobs j set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 where j.id=(select id from xero_accounting_jobs where status='pending' and (p_id is null or id=p_id) order by created_at limit 1 for update skip locked)
 returning j.*;
end $$;
revoke all on function public.capture_xero_accounting_job() from public,anon,authenticated;
revoke all on function public.claim_xero_accounting_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_xero_accounting_job(uuid) to service_role;
commit;
