-- Shop services and invoice checkout. Xero checkout stays disabled until configured.
begin;
alter table public.inventory_items add column if not exists item_kind text not null default 'product'
  check (item_kind in ('product', 'service'));
create or replace function public.enforce_service_inventory() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and old.item_kind<>'service' and new.item_kind='service' and old.quantity_on_hand<>0
  then raise exception 'Adjust physical stock to zero before converting it to a service'; end if;
  if new.item_kind = 'service' then new.track_stock := false; new.is_order_to_sale := false; new.quantity_on_hand := 0; end if;
  return new;
end $$;
drop trigger if exists enforce_service_inventory on public.inventory_items;
create trigger enforce_service_inventory before insert or update on public.inventory_items
for each row execute function public.enforce_service_inventory();
create or replace function public.admin_set_inventory_item_kind(p_id uuid, p_kind text, p_publish boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.current_user_is_admin() then raise exception 'Admin access required'; end if;
  if p_kind not in ('product','service') then raise exception 'Invalid item type'; end if;
  update inventory_items set item_kind=p_kind, visible_in_shop=p_publish where id=p_id;
  if not found then raise exception 'Item not found'; end if;
  if to_regprocedure('public.sync_inventory_item_to_public_product(uuid)') is not null then
    perform public.sync_inventory_item_to_public_product(p_id);
  end if;
end $$;
revoke all on function public.admin_set_inventory_item_kind(uuid,text,boolean) from public,anon;
grant execute on function public.admin_set_inventory_item_kind(uuid,text,boolean) to authenticated;

insert into public.product_categories (name,is_default) values ('Services',false) on conflict (normalized_name) do nothing;
insert into public.inventory_items (product_name,sku,supplier,category,category_id,description,short_description,full_description,
 sell_price,cost_price,purchase_price,item_kind,track_stock,is_order_to_sale,visible_in_shop,is_active,quantity_on_hand)
select 'Racket stringing – labour', 'KJC-STRING-LABOUR', 'Kim Jones Coaching', 'Services', c.id,
 'Labour per racket. Strings are charged separately. Bring your racket to Kim; string choice and tension are confirmed before stringing.',
 'Labour per racket. Strings charged separately.',
 'Labour per racket. Strings are charged separately. Bring your racket to Kim; string choice and tension are confirmed before stringing.',
 50,0,0,'service',false,false,true,true,0 from public.product_categories c where c.normalized_name='services'
 and not exists (select 1 from public.inventory_items where lower(sku)='kjc-string-labour');

create table if not exists public.shop_invoice_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 bank_name text not null default 'KIM JONES COACHING LTD', bank_number text not null default '01-0286-0978708-00',
 due_days integer not null default 0 check(due_days between 0 and 90),
 sales_account_code text not null default '', branding_theme_id uuid,
 stripe_ready boolean not null default false, updated_at timestamptz not null default now()
);
insert into public.shop_invoice_settings(id) values(true) on conflict do nothing;
create table if not exists public.xero_connection (
 id boolean primary key default true check(id), token_ciphertext text, expires_at timestamptz,
 tenant_id uuid, tenant_name text, connection_id uuid, connected_by uuid references auth.users(id),
 refresh_lock uuid, refresh_until timestamptz, updated_at timestamptz not null default now()
);
insert into public.xero_connection(id) values(true) on conflict do nothing;
create table if not exists public.xero_oauth_states (
 state_hash text primary key, cookie_hash text not null, user_id uuid not null references auth.users(id),
 expires_at timestamptz not null, consumed_at timestamptz
);
create sequence if not exists public.shop_invoice_sequence;
alter table public.shop_orders
 add column if not exists checkout_key_hash text,
 add column if not exists checkout_digest text,
 add column if not exists order_reference text,
 add column if not exists payment_method text not null default 'card',
 add column if not exists payment_provider text not null default 'stripe',
 add column if not exists service_details text,
 add column if not exists invoice_bank_name text,
 add column if not exists invoice_bank_number text,
 add column if not exists fulfilment_status text not null default 'unfulfilled' check(fulfilment_status in ('unfulfilled','in_progress','ready','completed','cancelled')),
 add column if not exists xero_tenant_id uuid,
 add column if not exists xero_invoice_id uuid,
 add column if not exists xero_invoice_status text,
 add column if not exists xero_invoice_url text,
 add column if not exists invoice_email_status text not null default 'pending',
 add column if not exists invoice_email_attempted_at timestamptz,
 add column if not exists invoice_sent_at timestamptz,
 add column if not exists xero_synced_at timestamptz,
 add column if not exists xero_due_date date,
 add column if not exists xero_amount_due numeric(10,2),
 add column if not exists xero_amount_paid numeric(10,2),
 add column if not exists xero_error text,
 add column if not exists stock_reserved boolean not null default false,
 add column if not exists stock_released boolean not null default false;
create unique index if not exists shop_orders_checkout_key on public.shop_orders(checkout_key_hash) where checkout_key_hash is not null;
create unique index if not exists shop_orders_order_reference on public.shop_orders(order_reference) where order_reference is not null;
create unique index if not exists shop_orders_xero_invoice on public.shop_orders(xero_tenant_id,xero_invoice_id) where xero_invoice_id is not null;
alter table public.shop_orders drop constraint if exists shop_orders_payment_status_valid;
alter table public.shop_orders add constraint shop_orders_payment_status_valid check(payment_status in ('pending','part_paid','paid','failed','refunded','cancelled'));
-- All checkout creation is server-side, including the existing Stripe path.
drop policy if exists "Customers can create own shop orders" on public.shop_orders;

create table if not exists public.xero_sync_jobs (
 order_id uuid primary key references public.shop_orders(id) on delete cascade,
 revision bigint not null default 1, available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0, last_error text
);
do $$ declare t text; begin
 foreach t in array array['shop_invoice_settings','xero_connection','xero_oauth_states','xero_sync_jobs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.shop_invoice_sequence to service_role;

create or replace function public.enqueue_xero_order(p_order_id uuid) returns void language sql as $$
 insert into public.xero_sync_jobs(order_id) values(p_order_id)
 on conflict(order_id) do update set revision=xero_sync_jobs.revision+1,available_at=now();
$$;
create or replace function public.claim_xero_jobs(p_limit integer default 5)
returns setof public.xero_sync_jobs language sql as $$
 update public.xero_sync_jobs j set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1
 where order_id in (select order_id from public.xero_sync_jobs where available_at<=now()
 and (lease_until is null or lease_until<now()) order by available_at for update skip locked limit least(greatest(p_limit,1),10)) returning j.*;
$$;
create or replace function public.finish_xero_job(p_order_id uuid,p_lease uuid,p_revision bigint,p_error text default null)
returns void language plpgsql as $$
begin
 if p_error is null then
  delete from public.xero_sync_jobs where order_id=p_order_id and lease_token=p_lease and revision=p_revision;
  update public.xero_sync_jobs set lease_token=null,lease_until=null,attempts=0 where order_id=p_order_id and lease_token=p_lease;
 else
  update public.xero_sync_jobs set lease_token=null,lease_until=null,last_error=left(p_error,300),
   available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer)
  where order_id=p_order_id and lease_token=p_lease;
 end if;
end $$;

create or replace function public.create_invoiced_shop_order(p_order jsonb)
returns public.shop_orders language plpgsql set search_path=public as $$
declare o public.shop_orders; prior public.shop_orders; item jsonb; inv public.inventory_items; q integer;
begin
 -- Serialise duplicate submissions; a retry returns the original immutable checkout.
 perform pg_advisory_xact_lock(hashtextextended(p_order->>'checkout_key_hash',0));
 select * into prior from shop_orders where checkout_key_hash=p_order->>'checkout_key_hash';
 if found then
  if prior.checkout_digest is distinct from p_order->>'checkout_digest' then raise exception 'Checkout details changed; start a new checkout'; end if;
  return prior;
 end if;
 if (select count(*) from shop_orders where customer_email=p_order->>'customer_email' and created_at>now()-interval '1 hour' and payment_provider='xero')>=10
 then raise exception 'Too many invoice requests. Please contact Kim.'; end if;
 o:=jsonb_populate_record(null::public.shop_orders,p_order);
 o.id:=gen_random_uuid(); o.order_reference:='KJC-'||lpad(nextval('shop_invoice_sequence')::text,6,'0');
 o.created_at:=now(); o.updated_at:=now(); o.payment_status:='pending'; o.order_status:='pending_payment';
 o.payment_provider:='xero'; o.fulfilment_status:='unfulfilled'; o.invoice_email_status:='pending';
 o.stock_reserved:=true; o.stock_released:=false;
 if jsonb_array_length(o.items) not between 1 and 100 or o.total_amount<=0 then raise exception 'Invalid order'; end if;
 insert into shop_orders select o.*;
 -- Reserve physical stock once, with locks in a stable order. Services never consume stock.
 for item in select value from jsonb_array_elements(o.items) order by value->>'inventory_item_id' loop
  if item->>'fulfilment_type'='stock' then
   q:=(item->>'quantity')::integer;
   if q<=0 then raise exception 'Invalid quantity'; end if;
   select * into inv from inventory_items where id=(item->>'inventory_item_id')::uuid for update;
   if not found or inv.item_kind='service' or inv.quantity_on_hand<q then raise exception 'Stock is no longer available'; end if;
   update inventory_items set quantity_on_hand=quantity_on_hand-q where id=inv.id;
   insert into stock_movements(inventory_item_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,related_type,related_id)
    values(inv.id,'stock_out',-q,inv.quantity_on_hand,inv.quantity_on_hand-q,'Reserved for invoice '||o.order_reference,'shop_invoice',o.id);
  end if;
 end loop;
 perform enqueue_xero_order(o.id);
 return o;
end $$;

create or replace function public.apply_xero_invoice_state(p_order_id uuid,p_tenant uuid,p_invoice uuid,p_status text,p_total numeric,p_due numeric,p_paid numeric,p_currency text)
returns public.shop_orders language plpgsql set search_path=public as $$
declare o public.shop_orders; item jsonb; inv public.inventory_items; q integer;
begin
 select * into o from shop_orders where id=p_order_id for update;
 if not found or o.payment_provider<>'xero' or o.xero_tenant_id is distinct from p_tenant or o.xero_invoice_id is distinct from p_invoice
 then raise exception 'Invoice does not belong to this order'; end if;
 if p_currency is distinct from 'NZD' or p_total is null or abs(o.total_amount-p_total)>0.009 or p_due is null or p_due<0 or p_paid is null or p_paid<0
 then raise exception 'Invoice amount or currency differs from the order; review in Xero'; end if;
 if p_status is null or p_status not in ('DRAFT','SUBMITTED','AUTHORISED','PAID','VOIDED','DELETED') then raise exception 'Unsupported Xero invoice status'; end if;
 if p_status in ('VOIDED','DELETED') and o.paid_at is null and coalesce(o.xero_amount_paid,0)=0
 and o.fulfilment_status in ('unfulfilled','cancelled') and o.stock_reserved and not o.stock_released then
  for item in select value from jsonb_array_elements(o.items) order by value->>'inventory_item_id' loop
   if item->>'fulfilment_type'='stock' then
    q:=(item->>'quantity')::integer;
    select * into inv from inventory_items where id=(item->>'inventory_item_id')::uuid for update;
    if not found then raise exception 'Reserved inventory item missing'; end if;
    update inventory_items set quantity_on_hand=quantity_on_hand+q where id=inv.id;
    insert into stock_movements(inventory_item_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,related_type,related_id)
     values(inv.id,'stock_return',q,inv.quantity_on_hand,inv.quantity_on_hand+q,'Invoice voided '||o.order_reference,'shop_invoice',o.id);
   end if;
  end loop;
  o.stock_released:=true;
 end if;
 update shop_orders set xero_invoice_status=p_status,xero_amount_due=p_due,xero_amount_paid=p_paid,xero_synced_at=now(),xero_error=null,
  stock_released=o.stock_released,
  payment_status=case when p_status='PAID' and p_due=0 then 'paid' when p_status in ('VOIDED','DELETED') then 'cancelled' when p_paid>0 then 'part_paid' else 'pending' end,
  paid_at=case when p_status='PAID' and p_due=0 then coalesce(paid_at,now()) else paid_at end,
  order_status=case when p_status='PAID' and p_due=0 and order_status='pending_payment' then 'paid'
    when p_status in ('DRAFT','SUBMITTED','AUTHORISED') and order_status='paid' then 'pending_payment'
    when p_status in ('VOIDED','DELETED') and paid_at is null then 'cancelled' else order_status end
 where id=p_order_id returning * into o;
 return o;
end $$;

do $$ declare f text; begin
 foreach f in array array['enqueue_xero_order(uuid)','claim_xero_jobs(integer)','finish_xero_job(uuid,uuid,bigint,text)','create_invoiced_shop_order(jsonb)','apply_xero_invoice_state(uuid,uuid,uuid,text,numeric,numeric,numeric,text)'] loop
  execute 'revoke all on function public.'||f||' from public,anon,authenticated';
  execute 'grant execute on function public.'||f||' to service_role';
 end loop;
end $$;
create or replace function public.enqueue_xero_events(p_events jsonb) returns void language sql as $$
 insert into public.xero_sync_jobs(order_id)
 select distinct o.id from public.shop_orders o join jsonb_to_recordset(p_events) as e(invoice_id uuid,tenant_id uuid)
 on o.xero_invoice_id=e.invoice_id and o.xero_tenant_id=e.tenant_id where o.payment_provider='xero'
 on conflict(order_id) do update set revision=xero_sync_jobs.revision+1,available_at=now();
$$;
revoke all on function public.enqueue_xero_events(jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_xero_events(jsonb) to service_role;
-- Recover missed events, including payment removals on previously paid invoices.
-- Do not reset retries or revisions for work already in the queue.
create or replace function public.enqueue_xero_recovery() returns integer language plpgsql as $$
declare queued integer;
begin
 insert into public.xero_sync_jobs(order_id)
 select id from public.shop_orders where payment_provider='xero'
 and (payment_status in ('pending','part_paid','paid') or xero_error is not null)
 order by xero_synced_at asc nulls first limit 100
 on conflict(order_id) do nothing;
 get diagnostics queued=row_count;
 delete from public.xero_oauth_states where expires_at<now()-interval '1 day';
 return queued;
end $$;
revoke all on function public.enqueue_xero_recovery() from public,anon,authenticated;
grant execute on function public.enqueue_xero_recovery() to service_role;
notify pgrst,'reload schema';
commit;
