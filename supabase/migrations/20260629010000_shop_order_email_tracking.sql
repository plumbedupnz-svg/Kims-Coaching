-- Track paid shop order emails so Stripe webhook retries stay idempotent.
-- Safe to run multiple times in Supabase SQL Editor.

alter table if exists public.shop_orders
add column if not exists admin_notification_email_sent_at timestamptz,
add column if not exists customer_confirmation_email_sent_at timestamptz;

create index if not exists shop_orders_admin_email_sent_idx
on public.shop_orders (admin_notification_email_sent_at)
where admin_notification_email_sent_at is not null;

create index if not exists shop_orders_customer_email_sent_idx
on public.shop_orders (customer_confirmation_email_sent_at)
where customer_confirmation_email_sent_at is not null;

notify pgrst, 'reload schema';
