begin;
-- Add the supplier import prerequisites missing from older live installations.
create table if not exists public.supplier_invoices (
 id uuid primary key default gen_random_uuid(),supplier text not null default 'Sportco',invoice_number text,invoice_date date,
 storage_path text,file_name text,uploaded_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now()
);
create table if not exists public.supplier_invoice_items (
 id uuid primary key default gen_random_uuid(),invoice_id uuid references public.supplier_invoices(id) on delete cascade,
 inventory_item_id uuid references public.inventory_items(id) on delete set null,product_name text not null,sku text,
 quantity_purchased integer not null check(quantity_purchased>0),unit_cost numeric(10,2) not null,total_cost numeric(10,2) not null,
 supplier text not null default 'Sportco',invoice_number text,invoice_date date,created_at timestamptz not null default now()
);
alter table public.supplier_invoice_items add column if not exists line_key text;
create unique index if not exists supplier_invoice_line_identity on public.supplier_invoice_items(invoice_id,line_key) where line_key is not null;
alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_items enable row level security;
revoke all on public.supplier_invoices,public.supplier_invoice_items from public,anon,authenticated;
grant select,insert on public.supplier_invoices to authenticated;
grant select on public.supplier_invoice_items to authenticated;
grant all on public.supplier_invoices,public.supplier_invoice_items to service_role;
drop policy if exists "Admins read supplier invoices" on public.supplier_invoices;
create policy "Admins read supplier invoices" on public.supplier_invoices for select to authenticated using(public.current_user_is_admin());
drop policy if exists "Admins create supplier invoices" on public.supplier_invoices;
create policy "Admins create supplier invoices" on public.supplier_invoices for insert to authenticated with check(public.current_user_is_admin() and uploaded_by=auth.uid());
drop policy if exists "Admins read supplier invoice items" on public.supplier_invoice_items;
create policy "Admins read supplier invoice items" on public.supplier_invoice_items for select to authenticated using(public.current_user_is_admin());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('supplier-invoices','supplier-invoices',false,10485760,array['application/pdf']) on conflict(id) do nothing;
drop policy if exists "Admins upload supplier invoice PDFs" on storage.objects;
create policy "Admins upload supplier invoice PDFs" on storage.objects for insert to authenticated with check(bucket_id='supplier-invoices' and public.current_user_is_admin());
drop policy if exists "Admins read supplier invoice PDFs" on storage.objects;
create policy "Admins read supplier invoice PDFs" on storage.objects for select to authenticated using(bucket_id='supplier-invoices' and public.current_user_is_admin());
create or replace function public.import_reviewed_supplier_invoice_item(
 p_invoice_id uuid,p_inventory_item_id uuid default null,p_product_name text default '',p_sku text default null,
 p_quantity integer default 0,p_unit_cost numeric default 0,p_total_cost numeric default 0,p_category_id uuid default null,
 p_category text default 'Other',p_sell_price numeric default 0,p_visible_in_shop boolean default false,
 p_review_status text default 'reviewed',p_invoice_number text default null,p_invoice_date date default null,p_line_key text default null
) returns public.inventory_items language plpgsql security definer set search_path=public as $$
declare inv public.inventory_items; prior public.supplier_invoice_items; invoice public.supplier_invoices; v_category_id uuid; category_name text; identity text;
begin
 if not public.current_user_is_admin() then raise exception 'Admin access required'; end if;
 select * into invoice from supplier_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Supplier invoice not found'; end if;
 identity:=coalesce(nullif(p_line_key,''),md5(concat_ws('|',p_product_name,p_sku,p_quantity,p_unit_cost,p_total_cost)));
 select * into prior from supplier_invoice_items where invoice_id=p_invoice_id and line_key=identity;
 if found then
  if prior.product_name<>trim(p_product_name) or prior.quantity_purchased<>p_quantity or prior.unit_cost<>round(p_unit_cost,2) or prior.total_cost<>round(p_total_cost,2)
   then raise exception 'Imported line changed; review the saved invoice'; end if;
  select * into inv from inventory_items where id=prior.inventory_item_id;return inv;
 end if;
 if coalesce(to_jsonb(invoice)->>'accounting_import_completed_at','')<>'' then raise exception 'This supplier invoice was already completed'; end if;
 if nullif(trim(p_product_name),'') is null or p_quantity<=0 or p_unit_cost<0 or p_sell_price<0 or p_total_cost<0 or p_review_status='needs_review'
  or abs(round(p_quantity*p_unit_cost,2)-p_total_cost)>0.02 then raise exception 'Review supplier quantities, costs and line total'; end if;
 v_category_id:=public.get_category_id(p_category_id,p_category);
 select name into category_name from product_categories where id=v_category_id;
 if p_inventory_item_id is not null then
  select * into inv from inventory_items where id=p_inventory_item_id for update;
  if not found then raise exception 'Matched stock item no longer exists'; end if;
 elsif nullif(trim(p_sku),'') is not null then
  select * into inv from inventory_items where lower(sku)=lower(trim(p_sku)) limit 1 for update;
 end if;
 if inv.id is null then select * into inv from inventory_items where normalized_name=lower(regexp_replace(trim(p_product_name),'\s+',' ','g')) limit 1 for update; end if;
 if inv.id is not null and (inv.archived_at is not null or to_jsonb(inv)->>'item_kind'='service') then raise exception 'Choose an active physical stock item'; end if;
 if inv.id is null then
  insert into inventory_items(product_name,sku,supplier,category_id,category,cost_price,purchase_price,sell_price,quantity_on_hand,visible_in_shop,review_status)
  values(trim(p_product_name),nullif(trim(p_sku),''),invoice.supplier,v_category_id,category_name,p_unit_cost,p_unit_cost,p_sell_price,0,false,'new_supplier_item') returning * into inv;
 else
  update inventory_items set cost_price=p_unit_cost,purchase_price=p_unit_cost,sell_price=case when p_sell_price>0 then p_sell_price else sell_price end,
   category_id=v_category_id,category=category_name where id=inv.id returning * into inv;
 end if;
 perform public.apply_stock_movement(inv.id,p_quantity,'stock_in','Reviewed supplier invoice import','supplier_invoice',p_invoice_id);
 insert into supplier_invoice_items(invoice_id,inventory_item_id,product_name,sku,quantity_purchased,unit_cost,total_cost,supplier,invoice_number,invoice_date,line_key)
 values(p_invoice_id,inv.id,trim(p_product_name),nullif(trim(p_sku),''),p_quantity,p_unit_cost,p_total_cost,invoice.supplier,p_invoice_number,p_invoice_date,identity);
 if p_visible_in_shop then
  update inventory_items set visible_in_shop=true where id=inv.id;
  perform public.sync_inventory_item_to_public_product(inv.id);
 end if;
 select * into inv from inventory_items where id=inv.id;return inv;
end $$;
revoke all on function public.import_reviewed_supplier_invoice_item(uuid,uuid,text,text,integer,numeric,numeric,uuid,text,numeric,boolean,text,text,date,text) from public,anon;
grant execute on function public.import_reviewed_supplier_invoice_item(uuid,uuid,text,text,integer,numeric,numeric,uuid,text,numeric,boolean,text,text,date,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
