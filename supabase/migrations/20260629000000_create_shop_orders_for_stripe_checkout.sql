-- Ensure Stripe shop checkout has a real public.shop_orders table to insert into.
-- Safe to run multiple times in Supabase SQL Editor.

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
add column if not exists user_id uuid references auth.users(id) on delete set null,
add column if not exists customer_name text,
add column if not exists customer_email text,
add column if not exists mobile text,
add column if not exists items jsonb not null default '[]'::jsonb,
add column if not exists subtotal numeric(10, 2) not null default 0,
add column if not exists total numeric(10, 2) not null default 0,
add column if not exists order_status text not null default 'pending_payment',
add column if not exists notes text,
add column if not exists stripe_session_id text,
add column if not exists payment_intent_id text,
add column if not exists paid_at timestamptz,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.shop_orders
drop constraint if exists shop_orders_status_valid;

alter table public.shop_orders
add constraint shop_orders_status_valid
check (order_status in ('pending_payment', 'paid', 'processing', 'completed', 'cancelled', 'failed', 'refunded'));

create index if not exists shop_orders_user_id_idx
on public.shop_orders (user_id);

create index if not exists shop_orders_created_at_idx
on public.shop_orders (created_at desc);

create index if not exists shop_orders_stripe_session_id_idx
on public.shop_orders (stripe_session_id)
where stripe_session_id is not null;

create or replace function public.set_shop_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_shop_orders_updated_at on public.shop_orders;
create trigger set_shop_orders_updated_at
before update on public.shop_orders
for each row
execute function public.set_shop_orders_updated_at();

alter table public.shop_orders enable row level security;

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

grant insert, select on public.shop_orders to authenticated;
grant all on public.shop_orders to service_role;

notify pgrst, 'reload schema';
