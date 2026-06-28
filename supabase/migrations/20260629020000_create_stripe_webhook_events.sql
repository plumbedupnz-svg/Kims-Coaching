-- Stripe webhook idempotency table.
-- Safe to run multiple times in Supabase SQL Editor.

create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  stripe_created_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.stripe_webhook_events
add column if not exists event_type text,
add column if not exists stripe_created_at timestamptz,
add column if not exists payload jsonb not null default '{}'::jsonb,
add column if not exists status text not null default 'processing',
add column if not exists error_message text,
add column if not exists received_at timestamptz not null default now(),
add column if not exists processed_at timestamptz;

alter table public.stripe_webhook_events
drop constraint if exists stripe_webhook_events_status_check;

alter table public.stripe_webhook_events
add constraint stripe_webhook_events_status_check
check (status in ('processing', 'processed', 'failed'));

create index if not exists stripe_webhook_events_event_type_idx
on public.stripe_webhook_events (event_type);

create index if not exists stripe_webhook_events_received_at_idx
on public.stripe_webhook_events (received_at desc);

create index if not exists stripe_webhook_events_status_idx
on public.stripe_webhook_events (status);

alter table public.stripe_webhook_events enable row level security;

drop policy if exists "Admins can read stripe webhook events" on public.stripe_webhook_events;
create policy "Admins can read stripe webhook events"
on public.stripe_webhook_events
for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "Service role can manage stripe webhook events" on public.stripe_webhook_events;
create policy "Service role can manage stripe webhook events"
on public.stripe_webhook_events
for all
to service_role
using (true)
with check (true);

grant select on public.stripe_webhook_events to authenticated;
grant all on public.stripe_webhook_events to service_role;

notify pgrst, 'reload schema';
