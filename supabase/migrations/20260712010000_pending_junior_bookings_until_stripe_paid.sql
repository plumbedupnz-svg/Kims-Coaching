-- Keep junior coaching checkout drafts separate from paid enrolments.
-- A row in this table is only a temporary Stripe checkout draft/hold; the paid
-- junior_group_members enrolment is created by the Stripe webhook after payment.

create table if not exists public.junior_group_pending_bookings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.junior_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  profile_player_index integer,
  player_id uuid references public.players(id) on delete set null,
  programme_id uuid references public.junior_programmes(id) on delete set null,
  player_name text not null,
  player_age integer,
  player_level text default '',
  parent_name text default '',
  email text not null,
  mobile text default '',
  notes text default '',
  amount numeric(10, 2) not null default 0,
  currency text not null default 'NZD',
  booking_status text not null default 'pending_payment'
    check (booking_status in ('pending_payment', 'converted', 'expired', 'cancelled')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  invoice_url text default '',
  stripe_session_id text,
  payment_intent_id text,
  completed_member_id uuid references public.junior_group_members(id) on delete set null,
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists junior_group_pending_bookings_profile_idx on public.junior_group_pending_bookings(profile_id);
create index if not exists junior_group_pending_bookings_group_idx on public.junior_group_pending_bookings(group_id);
create index if not exists junior_group_pending_bookings_player_idx on public.junior_group_pending_bookings(player_id);
create index if not exists junior_group_pending_bookings_status_idx on public.junior_group_pending_bookings(booking_status, payment_status, expires_at);

alter table public.junior_group_pending_bookings enable row level security;

drop policy if exists "Users can read own pending junior bookings" on public.junior_group_pending_bookings;
create policy "Users can read own pending junior bookings"
on public.junior_group_pending_bookings for select
using (profile_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Users can create own pending junior bookings" on public.junior_group_pending_bookings;
create policy "Users can create own pending junior bookings"
on public.junior_group_pending_bookings for insert
with check (profile_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Users can update own pending junior bookings" on public.junior_group_pending_bookings;
create policy "Users can update own pending junior bookings"
on public.junior_group_pending_bookings for update
using (profile_id = auth.uid() or public.current_user_is_admin())
with check (profile_id = auth.uid() or public.current_user_is_admin());

create or replace function public.create_junior_group_pending_booking(
  p_group_id uuid,
  p_player_name text,
  p_player_age integer,
  p_player_level text,
  p_parent_name text,
  p_email text,
  p_mobile text,
  p_notes text default '',
  p_profile_player_index integer default null
)
returns table (
  member_id uuid,
  payment_id uuid,
  booking_status text,
  payment_status text,
  payment_link_url text,
  amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.junior_groups%rowtype;
  held_count integer := 0;
  created_pending_id uuid;
  selected_player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please log in before booking junior group coaching.';
  end if;

  select * into target_group
  from public.junior_groups
  where id = p_group_id
    and is_active = true
    and is_public = true
  for update;

  if not found then
    raise exception 'This junior group is not currently available for booking.';
  end if;

  if coalesce(target_group.price, 0) <= 0 then
    raise exception 'Online payment is required for junior coaching. Please ask Kim to add a price before booking.';
  end if;

  if target_group.age_min is not null and (p_player_age is null or p_player_age < target_group.age_min) then
    raise exception 'This programme requires players to be at least % years old.', target_group.age_min;
  end if;

  if target_group.age_max is not null and (p_player_age is null or p_player_age > target_group.age_max) then
    raise exception 'This programme is for players aged % or under.', target_group.age_max;
  end if;

  select count(*) into held_count
  from public.junior_group_members
  where group_id = target_group.id
    and booking_status = 'confirmed'
    and payment_status = 'paid';

  if held_count >= target_group.capacity then
    raise exception 'This junior group is full.';
  end if;

  if p_profile_player_index is not null then
    select id into selected_player_id
    from public.players
    where profile_id = auth.uid()
      and profile_player_index = p_profile_player_index
      and is_active = true
    limit 1;
  end if;

  insert into public.junior_group_pending_bookings (
    group_id, profile_id, profile_player_index, player_id, programme_id,
    player_name, player_age, player_level, parent_name, email, mobile, notes,
    amount, currency, booking_status, payment_status, expires_at
  )
  values (
    target_group.id, auth.uid(), p_profile_player_index, selected_player_id, target_group.programme_id,
    nullif(trim(p_player_name), ''), p_player_age, coalesce(p_player_level, ''), coalesce(p_parent_name, ''),
    nullif(trim(p_email), ''), coalesce(p_mobile, ''), coalesce(p_notes, ''),
    target_group.price, 'NZD', 'pending_payment', 'pending', now() + interval '30 minutes'
  )
  returning id into created_pending_id;

  -- Keep the legacy return shape for the existing browser code. member_id is a
  -- pending checkout id until Stripe succeeds; no junior_group_members row exists yet.
  return query select created_pending_id, null::uuid, 'pending_payment'::text, 'pending'::text, target_group.payment_link_url, target_group.price;
end;
$$;

grant select, insert, update on public.junior_group_pending_bookings to authenticated;
grant execute on function public.create_junior_group_pending_booking(uuid, text, integer, text, text, text, text, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
