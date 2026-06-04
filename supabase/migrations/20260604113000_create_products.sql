create extension if not exists pgcrypto;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (normalized_name)
);

insert into public.product_categories (name, is_default)
values
  ('Recovery', true),
  ('Strength', true),
  ('Training', true)
on conflict (normalized_name) do update
set
  name = excluded.name,
  is_default = public.product_categories.is_default or excluded.is_default;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.product_categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(10, 2) not null default 0,
  discount numeric(5, 2) not null default 0,
  image_url text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists name text,
add column if not exists description text,
add column if not exists price numeric(10, 2) default 0,
add column if not exists discount numeric(5, 2) default 0,
add column if not exists image_url text,
add column if not exists is_active boolean default true,
add column if not exists created_by uuid references auth.users(id) on delete set null,
add column if not exists created_at timestamptz default now(),
add column if not exists updated_at timestamptz default now();

alter table public.products
alter column price set default 0,
alter column discount set default 0,
alter column is_active set default true,
alter column created_at set default now(),
alter column updated_at set default now();

update public.products
set
  price = coalesce(price, 0),
  discount = coalesce(discount, 0),
  is_active = coalesce(is_active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

insert into public.products (category_id, name, description, price, discount, image_url, is_active)
select category.id, seed.name, seed.description, seed.price, 0, '', true
from (
  values
    ('Training', 'Speed Agility Kit', 'Cones, ladder, and bands for movement sessions.', 59.99::numeric),
    ('Strength', 'Resistance Power Bands', 'Warmup and strength band set.', 29.99::numeric),
    ('Recovery', 'Recovery Roller', 'Compact roller for post-session recovery.', 34.99::numeric)
) as seed(category_name, name, description, price)
join public.product_categories category
  on category.normalized_name = lower(seed.category_name)
where not exists (
  select 1
  from public.products existing
  where lower(existing.name) = lower(seed.name)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_price_non_negative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_price_non_negative check (price >= 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_discount_valid'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_discount_valid check (discount >= 0 and discount <= 100) not valid;
  end if;
end $$;

create or replace function public.set_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row
execute function public.set_products_updated_at();

alter table public.product_categories enable row level security;
alter table public.products enable row level security;

drop policy if exists "Anyone can read product categories" on public.product_categories;
create policy "Anyone can read product categories"
on public.product_categories
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage product categories" on public.product_categories;
create policy "Admins can manage product categories"
on public.product_categories
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
on public.products
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Admins can read all products" on public.products;
create policy "Admins can read all products"
on public.products
for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products"
on public.products
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
on public.products
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products"
on public.products
for delete
to authenticated
using (public.current_user_is_admin());

grant select on public.product_categories to anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.product_categories to authenticated;
grant insert, update, delete on public.products to authenticated;
