create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (normalized_name)
);

alter table public.product_categories
add column if not exists name text,
add column if not exists normalized_name text generated always as (lower(trim(name))) stored,
add column if not exists is_default boolean not null default false,
add column if not exists created_at timestamptz not null default now();

update public.product_categories
set name = coalesce(nullif(trim(name), ''), 'Other')
where name is null or trim(name) = '';

alter table public.product_categories
alter column name set not null;

create unique index if not exists product_categories_normalized_name_unique_idx
on public.product_categories (normalized_name);

insert into public.product_categories (name, is_default)
values
  ('Recovery', true),
  ('Strength', true),
  ('Training', true),
  ('Tennis Gear', true),
  ('Accessories', true),
  ('Other', true)
on conflict (normalized_name) do update
set
  name = excluded.name,
  is_default = public.product_categories.is_default or excluded.is_default;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  shop_product_id text,
  product_name text not null,
  normalized_name text generated always as (lower(regexp_replace(trim(product_name), '\s+', ' ', 'g'))) stored,
  sku text,
  supplier text not null default 'Sportco',
  category text not null default 'Other',
  category_id uuid references public.product_categories(id) on delete set null,
  description text,
  image text,
  cost_price numeric(10, 2) not null default 0,
  sell_price numeric(10, 2) not null default 0,
  quantity_on_hand integer not null default 0,
  low_stock_threshold integer not null default 2,
  need_order_threshold integer not null default 0,
  status text not null default 'out_of_stock',
  visible_in_shop boolean not null default false,
  is_active boolean not null default true,
  review_status text not null default 'reviewed',
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_items
add column if not exists product_name text,
add column if not exists shop_product_id text,
add column if not exists sku text,
add column if not exists supplier text not null default 'Sportco',
add column if not exists category text not null default 'Other',
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists description text,
add column if not exists image text,
add column if not exists cost_price numeric(10, 2) not null default 0,
add column if not exists sell_price numeric(10, 2) not null default 0,
add column if not exists quantity_on_hand integer not null default 0,
add column if not exists low_stock_threshold integer not null default 2,
add column if not exists need_order_threshold integer not null default 0,
add column if not exists status text not null default 'out_of_stock',
add column if not exists visible_in_shop boolean not null default false,
add column if not exists is_active boolean not null default true,
add column if not exists review_status text not null default 'reviewed',
add column if not exists archived_at timestamptz,
add column if not exists archived_by uuid references auth.users(id) on delete set null,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

update public.inventory_items
set product_name = coalesce(nullif(trim(product_name), ''), 'Unnamed inventory item')
where product_name is null or trim(product_name) = '';

alter table public.inventory_items
alter column product_name set not null;

alter table public.inventory_items
add column if not exists normalized_name text generated always as (lower(regexp_replace(trim(product_name), '\s+', ' ', 'g'))) stored;

create table if not exists public.shop_products (
  id text primary key,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  category_id uuid references public.product_categories(id) on delete set null,
  name text not null,
  category text not null default 'Training',
  description text,
  price numeric(10, 2) not null default 0,
  discount numeric(5, 2) not null default 0,
  image text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shop_products
add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists name text,
add column if not exists category text not null default 'Training',
add column if not exists description text,
add column if not exists price numeric(10, 2) not null default 0,
add column if not exists discount numeric(5, 2) not null default 0,
add column if not exists image text,
add column if not exists is_active boolean not null default true,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

update public.shop_products
set name = coalesce(nullif(trim(name), ''), 'Unnamed shop product')
where name is null or trim(name) = '';

alter table public.shop_products
alter column name set not null;

insert into public.product_categories (name, is_default)
select distinct trim(category), false
from (
  select category from public.inventory_items where category is not null and trim(category) <> ''
  union
  select category from public.shop_products where category is not null and trim(category) <> ''
) existing_categories
on conflict (normalized_name) do nothing;

update public.inventory_items ii
set category_id = pc.id
from public.product_categories pc
where ii.category_id is null
  and lower(trim(ii.category)) = pc.normalized_name;

update public.inventory_items
set category_id = (
  select id from public.product_categories where normalized_name = 'other' limit 1
)
where category_id is null;

update public.inventory_items ii
set category = pc.name
from public.product_categories pc
where ii.category_id = pc.id
  and ii.category is distinct from pc.name;

update public.shop_products sp
set category_id = coalesce(ii.category_id, pc.id)
from public.product_categories pc
left join public.inventory_items ii on ii.id = sp.inventory_item_id
where sp.category_id is null
  and lower(trim(sp.category)) = pc.normalized_name;

update public.shop_products
set category_id = (
  select id from public.product_categories where normalized_name = 'other' limit 1
)
where category_id is null;

update public.shop_products sp
set category = pc.name
from public.product_categories pc
where sp.category_id = pc.id
  and sp.category is distinct from pc.name;

create or replace function public.sync_inventory_category_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category_name text;
begin
  if new.category_id is null then
    select id into new.category_id
    from public.product_categories
    where normalized_name = lower(trim(coalesce(new.category, 'Other')))
    limit 1;
  end if;

  if new.category_id is null then
    select id into new.category_id
    from public.product_categories
    where normalized_name = 'other'
    limit 1;
  end if;

  select name into v_category_name
  from public.product_categories
  where id = new.category_id;

  new.category = coalesce(v_category_name, 'Other');
  return new;
end;
$$;

drop trigger if exists sync_inventory_items_category_name on public.inventory_items;
create trigger sync_inventory_items_category_name
before insert or update of category_id, category
on public.inventory_items
for each row
execute function public.sync_inventory_category_name();

create or replace function public.sync_shop_product_category_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category_name text;
begin
  if new.category_id is null and new.inventory_item_id is not null then
    select category_id into new.category_id
    from public.inventory_items
    where id = new.inventory_item_id;
  end if;

  if new.category_id is null then
    select id into new.category_id
    from public.product_categories
    where normalized_name = lower(trim(coalesce(new.category, 'Other')))
    limit 1;
  end if;

  if new.category_id is null then
    select id into new.category_id
    from public.product_categories
    where normalized_name = 'other'
    limit 1;
  end if;

  select name into v_category_name
  from public.product_categories
  where id = new.category_id;

  new.category = coalesce(v_category_name, 'Other');
  return new;
end;
$$;

drop trigger if exists sync_shop_products_category_name on public.shop_products;
create trigger sync_shop_products_category_name
before insert or update of category_id, category, inventory_item_id
on public.shop_products
for each row
execute function public.sync_shop_product_category_name();

create index if not exists inventory_items_category_id_idx
on public.inventory_items (category_id);

create index if not exists inventory_items_normalized_name_idx
on public.inventory_items (normalized_name);

create index if not exists inventory_items_sku_unique_idx
on public.inventory_items (lower(sku))
where sku is not null and trim(sku) <> '';

create index if not exists shop_products_category_id_idx
on public.shop_products (category_id);

alter table public.product_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.shop_products enable row level security;

drop policy if exists "Anyone can read product categories" on public.product_categories;
create policy "Anyone can read product categories"
on public.product_categories
for select
using (true);

drop policy if exists "Admins can manage product categories" on public.product_categories;
create policy "Admins can manage product categories"
on public.product_categories
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage inventory items" on public.inventory_items;
create policy "Admins can manage inventory items"
on public.inventory_items
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Anyone can view active shop products" on public.shop_products;
create policy "Anyone can view active shop products"
on public.shop_products
for select
using (is_active = true);

drop policy if exists "Admins can manage shop products" on public.shop_products;
create policy "Admins can manage shop products"
on public.shop_products
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select on public.product_categories to anon, authenticated;
grant insert, update, delete on public.product_categories to authenticated;
grant select on public.shop_products to anon, authenticated;
grant insert, update, delete on public.shop_products to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;

notify pgrst, 'reload schema';
