create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  recipient_email text,
  related_type text,
  related_id uuid,
  status text not null default 'pending',
  provider text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint notification_logs_status_valid check (status in ('pending', 'sent', 'failed', 'skipped', 'test_mode'))
);

create index if not exists notification_logs_created_at_idx
on public.notification_logs (created_at desc);

create index if not exists notification_logs_related_idx
on public.notification_logs (related_type, related_id);

alter table public.notification_logs enable row level security;

drop policy if exists "Admins can read notification logs" on public.notification_logs;
create policy "Admins can read notification logs"
on public.notification_logs
for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "Service role can insert notification logs" on public.notification_logs;
create policy "Service role can insert notification logs"
on public.notification_logs
for insert
to service_role
with check (true);

grant select on public.notification_logs to authenticated;
grant insert on public.notification_logs to service_role;

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_orders_status_valid check (order_status in ('pending_payment', 'paid', 'processing', 'completed', 'cancelled'))
);

create index if not exists shop_orders_user_id_idx
on public.shop_orders (user_id);

create index if not exists shop_orders_created_at_idx
on public.shop_orders (created_at desc);

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

grant insert, select on public.shop_orders to authenticated;
grant all on public.shop_orders to service_role;

notify pgrst, 'reload schema';
