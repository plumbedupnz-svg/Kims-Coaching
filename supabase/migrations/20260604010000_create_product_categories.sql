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

alter table public.product_categories enable row level security;

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

grant select on public.product_categories to anon, authenticated;
grant insert, update, delete on public.product_categories to authenticated;
