-- Kim's Coaching shop checkout delivery and guest order support.
-- Safe to run multiple times in Supabase SQL Editor.

alter table public.profiles
add column if not exists delivery_full_name text,
add column if not exists delivery_phone text,
add column if not exists delivery_address_line1 text,
add column if not exists delivery_address_line2 text,
add column if not exists delivery_suburb text,
add column if not exists delivery_city text,
add column if not exists delivery_postcode text,
add column if not exists delivery_country text default 'New Zealand';

create table if not exists public.shop_inventory_settings (
  id boolean primary key default true,
  hide_out_of_stock boolean not null default false,
  default_low_stock_threshold integer not null default 2,
  updated_at timestamptz not null default now(),
  constraint shop_inventory_settings_singleton check (id = true)
);

alter table public.shop_inventory_settings
add column if not exists pickup_label text not null default 'Pick up from coaching / club',
add column if not exists pickup_instructions text,
add column if not exists local_delivery_enabled boolean not null default true,
add column if not exists local_delivery_fee numeric(10, 2) not null default 0,
add column if not exists courier_delivery_enabled boolean not null default true,
add column if not exists courier_delivery_fee numeric(10, 2) not null default 0,
add column if not exists free_shipping_threshold numeric(10, 2);

insert into public.shop_inventory_settings (id)
values (true)
on conflict (id) do nothing;

update public.shop_inventory_settings
set
  pickup_label = coalesce(nullif(pickup_label, ''), 'Pick up from coaching / club'),
  local_delivery_fee = coalesce(local_delivery_fee, 0),
  courier_delivery_fee = coalesce(courier_delivery_fee, 0)
where id = true;

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  customer_name text,
  customer_email text,
  mobile text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  order_status text not null default 'pending_payment',
  notes text,
  stripe_session_id text,
  payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shop_orders
add column if not exists customer_phone text,
add column if not exists delivery_address jsonb not null default '{}'::jsonb,
add column if not exists fulfilment_method text not null default 'pickup',
add column if not exists pickup_instructions text,
add column if not exists shipping_amount numeric(10, 2) not null default 0,
add column if not exists subtotal_amount numeric(10, 2) not null default 0,
add column if not exists tax_amount numeric(10, 2) not null default 0,
add column if not exists discount_amount numeric(10, 2) not null default 0,
add column if not exists total_amount numeric(10, 2) not null default 0,
add column if not exists payment_status text not null default 'pending';

update public.shop_orders
set
  customer_phone = coalesce(customer_phone, mobile),
  subtotal_amount = case when coalesce(subtotal_amount, 0) = 0 then coalesce(subtotal, 0) else subtotal_amount end,
  total_amount = case when coalesce(total_amount, 0) = 0 then coalesce(total, 0) else total_amount end,
  payment_status = case when order_status = 'paid' then 'paid' else coalesce(payment_status, 'pending') end
where true;

alter table public.shop_orders
drop constraint if exists shop_orders_fulfilment_method_valid;

alter table public.shop_orders
add constraint shop_orders_fulfilment_method_valid
check (fulfilment_method in ('pickup', 'local_delivery', 'courier'));

alter table public.shop_orders
drop constraint if exists shop_orders_payment_status_valid;

alter table public.shop_orders
add constraint shop_orders_payment_status_valid
check (payment_status in ('pending', 'paid', 'failed', 'refunded'));

create index if not exists shop_orders_payment_status_idx
on public.shop_orders (payment_status);

create index if not exists shop_orders_fulfilment_method_idx
on public.shop_orders (fulfilment_method);

alter table public.shop_orders enable row level security;
alter table public.shop_inventory_settings enable row level security;

drop policy if exists "Anyone can read shop inventory settings" on public.shop_inventory_settings;
create policy "Anyone can read shop inventory settings"
on public.shop_inventory_settings
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage shop inventory settings" on public.shop_inventory_settings;
create policy "Admins can manage shop inventory settings"
on public.shop_inventory_settings
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Customers can create own shop orders" on public.shop_orders;
create policy "Customers can create own shop orders"
on public.shop_orders
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Customers can read own shop orders" on public.shop_orders;
create policy "Customers can read own shop orders"
on public.shop_orders
for select
to authenticated
using (auth.uid() = user_id or public.current_user_is_admin());

drop policy if exists "Admins can manage all shop orders" on public.shop_orders;
create policy "Admins can manage all shop orders"
on public.shop_orders
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Service role can manage shop orders" on public.shop_orders;
create policy "Service role can manage shop orders"
on public.shop_orders
for all
to service_role
using (true)
with check (true);

grant select on public.shop_inventory_settings to anon, authenticated;
grant insert, update on public.shop_inventory_settings to authenticated;
grant insert, select on public.shop_orders to authenticated;
grant all on public.shop_orders to service_role;

notify pgrst, 'reload schema';
