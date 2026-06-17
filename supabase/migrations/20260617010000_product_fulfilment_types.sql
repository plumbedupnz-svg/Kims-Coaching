-- Kim's Coaching product fulfilment types
-- Products can be sold without inventory, while stock-held products can link to inventory_items.

create table if not exists public.products (
  id text primary key,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  category_id uuid references public.product_categories(id) on delete set null,
  name text not null,
  category text not null default 'Training',
  description text,
  price numeric(10, 2) not null default 0,
  discount numeric(5, 2) not null default 0,
  image text,
  image_url text,
  fulfilment_type text not null default 'order_to_sale',
  is_active boolean not null default true,
  visible_in_shop boolean not null default true,
  quantity_on_hand integer not null default 0,
  stock_status text not null default 'order_to_sale',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists name text,
add column if not exists category text not null default 'Training',
add column if not exists description text,
add column if not exists price numeric(10, 2) not null default 0,
add column if not exists discount numeric(5, 2) not null default 0,
add column if not exists image text,
add column if not exists image_url text,
add column if not exists fulfilment_type text not null default 'order_to_sale',
add column if not exists is_active boolean not null default true,
add column if not exists visible_in_shop boolean not null default true,
add column if not exists quantity_on_hand integer not null default 0,
add column if not exists stock_status text not null default 'order_to_sale',
add column if not exists archived_at timestamptz,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

update public.products
set
  name = coalesce(nullif(trim(name), ''), 'Unnamed product'),
  fulfilment_type = case
    when inventory_item_id is not null then 'stock'
    when fulfilment_type in ('stock', 'order_to_sale') then fulfilment_type
    else 'order_to_sale'
  end,
  stock_status = case
    when inventory_item_id is null and (stock_status is null or stock_status in ('', 'out_of_stock')) then 'order_to_sale'
    else coalesce(nullif(stock_status, ''), 'order_to_sale')
  end
where name is null
   or trim(name) = ''
   or fulfilment_type is null
   or fulfilment_type not in ('stock', 'order_to_sale')
   or stock_status is null
   or stock_status = '';

alter table public.products
alter column name set not null,
alter column fulfilment_type set default 'order_to_sale',
alter column fulfilment_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_fulfilment_type_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
    add constraint products_fulfilment_type_check
    check (fulfilment_type in ('stock', 'order_to_sale'));
  end if;
end $$;

create unique index if not exists products_inventory_item_id_unique_idx
on public.products (inventory_item_id)
where inventory_item_id is not null;

create index if not exists products_category_id_idx
on public.products (category_id);

create index if not exists products_active_visible_idx
on public.products (is_active, visible_in_shop, fulfilment_type);

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
