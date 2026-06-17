-- Kim's Coaching products schema alignment
-- Matches the current Products tab and public shop frontend payload.
-- Safe to run multiple times in Supabase SQL Editor.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.product_categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(10, 2) not null default 0,
  discount numeric(5, 2) not null default 0,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists name text,
add column if not exists category text,
add column if not exists description text,
add column if not exists price numeric(10, 2) not null default 0,
add column if not exists discount numeric(5, 2) not null default 0,
add column if not exists image text,
add column if not exists image_url text,
add column if not exists is_active boolean not null default true,
add column if not exists visible_in_shop boolean not null default true,
add column if not exists quantity_on_hand integer not null default 0,
add column if not exists stock_status text not null default 'order_to_sale',
add column if not exists archived_at timestamptz,
add column if not exists fulfilment_type text not null default 'order_to_sale',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'products_fulfilment_type_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products drop constraint products_fulfilment_type_check;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'products_stock_status_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products drop constraint products_stock_status_check;
  end if;
end $$;

update public.products p
set category = coalesce(nullif(trim(p.category), ''), pc.name, 'Other')
from public.product_categories pc
where p.category_id = pc.id
  and (p.category is null or trim(p.category) = '');

update public.products
set
  name = coalesce(nullif(trim(name), ''), 'Unnamed product'),
  category = coalesce(nullif(trim(category), ''), 'Other'),
  image_url = coalesce(nullif(image_url, ''), nullif(image, ''), ''),
  image = coalesce(nullif(image, ''), nullif(image_url, ''), ''),
  fulfilment_type = case
    when inventory_item_id is not null then 'stock'
    when lower(coalesce(fulfilment_type, '')) in ('stock', 'stocked', 'held_in_stock', 'inventory') then 'order_to_sale'
    when lower(coalesce(fulfilment_type, '')) = 'order_to_sale' then 'order_to_sale'
    else 'order_to_sale'
  end,
  quantity_on_hand = greatest(coalesce(quantity_on_hand, 0), 0),
  stock_status = case
    when inventory_item_id is null then 'order_to_sale'
    when coalesce(quantity_on_hand, 0) <= 0 then 'out_of_stock'
    when stock_status in ('in_stock', 'low_stock', 'need_order', 'out_of_stock') then stock_status
    else 'in_stock'
  end,
  visible_in_shop = coalesce(visible_in_shop, true),
  is_active = coalesce(is_active, true),
  updated_at = coalesce(updated_at, now())
where name is null
   or trim(name) = ''
   or category is null
   or trim(category) = ''
   or image_url is null
   or image is null
   or fulfilment_type is null
   or fulfilment_type not in ('stock', 'order_to_sale')
   or quantity_on_hand is null
   or stock_status is null
   or stock_status not in ('in_stock', 'low_stock', 'need_order', 'out_of_stock', 'order_to_sale')
   or visible_in_shop is null
   or is_active is null
   or updated_at is null;

alter table public.products
alter column name set not null,
alter column category set default 'Other',
alter column category set not null,
alter column price set default 0,
alter column price set not null,
alter column discount set default 0,
alter column discount set not null,
alter column is_active set default true,
alter column is_active set not null,
alter column visible_in_shop set default true,
alter column visible_in_shop set not null,
alter column quantity_on_hand set default 0,
alter column quantity_on_hand set not null,
alter column stock_status set default 'order_to_sale',
alter column stock_status set not null,
alter column fulfilment_type set default 'order_to_sale',
alter column fulfilment_type set not null,
alter column created_at set default now(),
alter column created_at set not null,
alter column updated_at set default now(),
alter column updated_at set not null;

do $$
begin
  alter table public.products
  add constraint products_fulfilment_type_check
  check (fulfilment_type in ('stock', 'order_to_sale'));
end $$;

do $$
begin
  alter table public.products
  add constraint products_stock_status_check
  check (stock_status in ('in_stock', 'low_stock', 'need_order', 'out_of_stock', 'order_to_sale'));
end $$;

create unique index if not exists products_inventory_item_id_unique_idx
on public.products (inventory_item_id)
where inventory_item_id is not null;

create index if not exists products_category_id_idx
on public.products (category_id);

create index if not exists products_public_shop_idx
on public.products (visible_in_shop, is_active, archived_at, fulfilment_type);

alter table public.products enable row level security;

drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products"
on public.products
for select
using (is_active = true and visible_in_shop = true and archived_at is null);

drop policy if exists "Admins can manage products" on public.products;
create policy "Admins can manage products"
on public.products
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

notify pgrst, 'reload schema';
