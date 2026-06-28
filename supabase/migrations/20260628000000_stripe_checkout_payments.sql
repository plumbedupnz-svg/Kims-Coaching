-- Stripe Checkout support for coaching bookings, junior groups, and shop orders.

alter table if exists public.bookings
add column if not exists stripe_session_id text,
add column if not exists payment_intent_id text,
add column if not exists paid_at timestamptz;

create index if not exists bookings_stripe_session_id_idx
on public.bookings (stripe_session_id)
where stripe_session_id is not null;

do $$
begin
  if to_regclass('public.bookings') is not null then
    alter table public.bookings
    drop constraint if exists bookings_booking_status_check;

    alter table public.bookings
    add constraint bookings_booking_status_check
    check (booking_status in ('pending', 'pending_payment', 'confirmed', 'completed', 'cancelled', 'no_show'));

    alter table public.bookings
    drop constraint if exists bookings_payment_status_check;

    alter table public.bookings
    add constraint bookings_payment_status_check
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'cancelled'));
  end if;
end $$;

alter table if exists public.shop_orders
add column if not exists stripe_session_id text,
add column if not exists payment_intent_id text,
add column if not exists paid_at timestamptz;

create index if not exists shop_orders_stripe_session_id_idx
on public.shop_orders (stripe_session_id)
where stripe_session_id is not null;

do $$
begin
  if to_regclass('public.shop_orders') is not null then
    alter table public.shop_orders
    drop constraint if exists shop_orders_status_valid;

    alter table public.shop_orders
    add constraint shop_orders_status_valid
    check (order_status in ('pending_payment', 'paid', 'processing', 'completed', 'cancelled', 'failed', 'refunded'));
  end if;
end $$;

alter table if exists public.payments
add column if not exists stripe_session_id text,
add column if not exists payment_intent_id text;

create index if not exists payments_stripe_session_id_idx
on public.payments (stripe_session_id)
where stripe_session_id is not null;

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

create index if not exists stripe_webhook_events_event_type_idx
on public.stripe_webhook_events (event_type);

create index if not exists stripe_webhook_events_received_at_idx
on public.stripe_webhook_events (received_at desc);

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

create or replace function public.prevent_overlapping_private_bookings()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  selected_capacity integer := 1;
  overlapping_count integer := 0;
begin
  if new.booking_status not in ('pending', 'pending_payment', 'confirmed') then
    return new;
  end if;

  select greatest(1, coalesce(availability.capacity, lesson_types.capacity, 1))
  into selected_capacity
  from public.availability
  left join public.lesson_types on lesson_types.id = availability.lesson_type_id
  where availability.id = new.availability_id;

  select count(*)
  into overlapping_count
  from public.bookings existing
  where existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and existing.availability_id = new.availability_id
    and existing.booking_status in ('pending', 'pending_payment', 'confirmed')
    and public.booking_times_overlap(
      new.start_time,
      new.end_time,
      existing.start_time,
      existing.end_time
    );

  if overlapping_count >= selected_capacity then
    raise exception 'That lesson time is no longer available.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_overlapping_private_bookings on public.bookings;
create trigger prevent_overlapping_private_bookings
before insert or update on public.bookings
for each row execute function public.prevent_overlapping_private_bookings();

drop function if exists public.get_available_private_lesson_slots(timestamptz, timestamptz);

create or replace function public.get_available_private_lesson_slots(
  week_start timestamptz,
  week_end timestamptz
)
returns table (
  availability_id uuid,
  start_time timestamptz,
  end_time timestamptz,
  duration integer,
  max_duration_minutes integer,
  lesson_type_id uuid,
  lesson_type_name text,
  lesson_type_price numeric,
  lesson_type_duration integer,
  lesson_type_minimum_players integer,
  lesson_type_minimum_age integer,
  lesson_type_minimum_level text,
  lesson_type_pay_as_you_go_only boolean,
  capacity integer,
  booked_count integer,
  spaces_remaining integer,
  club_id uuid,
  club_name text,
  club_address text,
  coach_id uuid,
  coach_name text
)
language sql
security definer
set search_path = public
stable
as $$
  with private_lesson as (
    select
      id,
      name,
      duration,
      price,
      capacity,
      minimum_players,
      minimum_age,
      minimum_level,
      pay_as_you_go_only
    from public.lesson_types
    where lower(name) = 'private lesson'
    order by created_at asc nulls last
    limit 1
  ),
  expanded_slots as (
    select
      availability.id as availability_id,
      generated_start as start_time,
      availability.end_time,
      ceiling(extract(epoch from (availability.end_time - generated_start)) / 60)::integer as max_duration_minutes,
      coalesce(availability.lesson_type_id, lesson_types.id, private_lesson.id) as lesson_type_id,
      coalesce(lesson_types.name, private_lesson.name, 'Coaching') as lesson_type_name,
      coalesce(lesson_types.price, private_lesson.price, 0) as lesson_type_price,
      coalesce(lesson_types.duration, private_lesson.duration, 60) as lesson_type_duration,
      greatest(1, coalesce(availability.minimum_players, lesson_types.minimum_players, private_lesson.minimum_players, 1)) as lesson_type_minimum_players,
      coalesce(lesson_types.minimum_age, private_lesson.minimum_age) as lesson_type_minimum_age,
      coalesce(lesson_types.minimum_level, private_lesson.minimum_level, '') as lesson_type_minimum_level,
      coalesce(lesson_types.pay_as_you_go_only, private_lesson.pay_as_you_go_only, false) as lesson_type_pay_as_you_go_only,
      greatest(1, coalesce(availability.capacity, lesson_types.capacity, private_lesson.capacity, 1)) as capacity,
      availability.club_id,
      coaching_clubs.name as club_name,
      coaching_clubs.address as club_address,
      availability.coach_id,
      coaches.display_name as coach_name
    from public.availability
    left join public.lesson_types on lesson_types.id = availability.lesson_type_id
    left join public.coaching_clubs on coaching_clubs.id = availability.club_id
    left join public.coaches on coaches.id = availability.coach_id
    left join private_lesson on true
    cross join lateral generate_series(
      public.next_lesson_start_time(availability.start_time),
      availability.end_time - interval '30 minutes',
      interval '30 minutes'
    ) as generated_start
    where availability.is_available = true
      and availability.start_time < week_end
      and availability.end_time > week_start
      and coalesce(lesson_types.is_active, true) = true
      and coalesce(coaching_clubs.is_active, true) = true
      and coalesce(coaches.is_active, true) = true
  ),
  counted as (
    select
      expanded_slots.*,
      (
        select count(*)::integer
        from public.bookings existing
        where existing.availability_id = expanded_slots.availability_id
          and existing.booking_status in ('pending', 'pending_payment', 'confirmed')
          and public.booking_times_overlap(
            expanded_slots.start_time,
            expanded_slots.start_time + make_interval(mins => expanded_slots.lesson_type_duration),
            existing.start_time,
            existing.end_time
          )
      ) as booked_count
    from expanded_slots
  )
  select
    counted.availability_id,
    counted.start_time,
    counted.end_time,
    counted.lesson_type_duration as duration,
    counted.max_duration_minutes,
    counted.lesson_type_id,
    counted.lesson_type_name,
    counted.lesson_type_price,
    counted.lesson_type_duration,
    counted.lesson_type_minimum_players,
    counted.lesson_type_minimum_age,
    counted.lesson_type_minimum_level,
    counted.lesson_type_pay_as_you_go_only,
    counted.capacity,
    counted.booked_count,
    greatest(0, counted.capacity - counted.booked_count) as spaces_remaining,
    counted.club_id,
    counted.club_name,
    counted.club_address,
    counted.coach_id,
    counted.coach_name
  from counted
  where counted.start_time >= week_start
    and counted.start_time < week_end
    and counted.max_duration_minutes >= counted.lesson_type_duration
    and extract(minute from counted.start_time) in (0, 30)
    and counted.booked_count < counted.capacity
  order by counted.start_time asc;
$$;

grant execute on function public.get_available_private_lesson_slots(timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.prevent_overlapping_private_bookings() to authenticated, service_role;

create or replace function public.create_private_lesson_booking(
  p_availability_id uuid,
  p_start_time timestamptz,
  p_lesson_type_id uuid,
  p_duration_minutes integer,
  p_customer_name text,
  p_parent_name text,
  p_player_name text,
  p_customer_email text,
  p_mobile text,
  p_player_level text,
  p_notes text,
  p_payment_option text default 'pay_later',
  p_bundle_id uuid default null,
  p_bundle_lessons_count integer default null,
  p_bundle_discount_percent numeric default null,
  p_total_price numeric default 0,
  p_club_id uuid default null,
  p_coach_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_availability public.availability%rowtype;
  selected_capacity integer := 1;
  overlapping_count integer := 0;
  booking_start timestamptz;
  booking_end timestamptz;
  remaining_start timestamptz;
  created_booking public.bookings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to book coaching.';
  end if;

  if p_duration_minutes not in (30, 45, 60, 90, 120) then
    raise exception 'Choose a valid lesson duration.';
  end if;

  if coalesce(p_payment_option, 'pay_later') not in ('pay_now', 'pay_later') then
    raise exception 'Choose pay now or pay later.';
  end if;

  select * into selected_availability
  from public.availability
  where id = p_availability_id
    and is_available = true
  for update;

  if not found then
    raise exception 'That coaching time is no longer available.';
  end if;

  select greatest(1, coalesce(selected_availability.capacity, lesson_types.capacity, 1))
  into selected_capacity
  from public.lesson_types
  where lesson_types.id = coalesce(selected_availability.lesson_type_id, p_lesson_type_id);

  selected_capacity := coalesce(selected_capacity, greatest(1, selected_availability.capacity));
  booking_start := p_start_time;
  booking_end := booking_start + make_interval(mins => p_duration_minutes);
  remaining_start := public.next_lesson_start_time(booking_end);

  if extract(minute from booking_start) not in (0, 30) then
    raise exception 'Lesson times must start on the hour or half hour.';
  end if;

  if booking_start < selected_availability.start_time or booking_end > selected_availability.end_time then
    raise exception 'That lesson duration does not fit in the selected availability window.';
  end if;

  if p_club_id is not null and selected_availability.club_id is distinct from p_club_id then
    raise exception 'The selected club does not match this coaching time.';
  end if;

  if selected_availability.coach_id is not null
    and p_coach_id is distinct from selected_availability.coach_id
  then
    raise exception 'The selected coach does not match this coaching time.';
  end if;

  select count(*) into overlapping_count
  from public.bookings existing
  where existing.availability_id = selected_availability.id
    and existing.booking_status in ('pending', 'pending_payment', 'confirmed')
    and public.booking_times_overlap(booking_start, booking_end, existing.start_time, existing.end_time);

  if overlapping_count >= selected_capacity then
    raise exception 'That coaching time is no longer available.';
  end if;

  insert into public.bookings (
    user_id,
    lesson_type_id,
    availability_id,
    club_id,
    coach_id,
    booking_status,
    customer_name,
    parent_name,
    player_name,
    customer_email,
    mobile,
    player_level,
    notes,
    start_time,
    end_time,
    duration_minutes,
    payment_option,
    payment_status,
    bundle_id,
    bundle_lessons_count,
    bundle_discount_percent,
    total_price
  ) values (
    auth.uid(),
    coalesce(selected_availability.lesson_type_id, p_lesson_type_id),
    selected_availability.id,
    coalesce(selected_availability.club_id, p_club_id),
    coalesce(selected_availability.coach_id, p_coach_id),
    case when coalesce(p_payment_option, 'pay_later') = 'pay_now' then 'pending_payment' else 'confirmed' end,
    coalesce(p_customer_name, ''),
    coalesce(p_parent_name, ''),
    coalesce(p_player_name, ''),
    coalesce(p_customer_email, ''),
    coalesce(p_mobile, ''),
    coalesce(p_player_level, ''),
    coalesce(p_notes, ''),
    booking_start,
    booking_end,
    p_duration_minutes,
    coalesce(p_payment_option, 'pay_later'),
    case when coalesce(p_payment_option, 'pay_later') = 'pay_now' then 'pending' else 'unpaid' end,
    p_bundle_id,
    p_bundle_lessons_count,
    p_bundle_discount_percent,
    coalesce(p_total_price, 0)
  ) returning * into created_booking;

  if selected_capacity = 1 then
    if booking_start = selected_availability.start_time and booking_end = selected_availability.end_time then
      update public.availability set is_available = false where id = selected_availability.id;
    elsif booking_start = selected_availability.start_time then
      if remaining_start < selected_availability.end_time then
        update public.availability set start_time = remaining_start where id = selected_availability.id;
      else
        update public.availability set is_available = false where id = selected_availability.id;
      end if;
    elsif booking_end = selected_availability.end_time then
      update public.availability set end_time = booking_start where id = selected_availability.id;
    else
      update public.availability set end_time = booking_start where id = selected_availability.id;

      if remaining_start < selected_availability.end_time then
        insert into public.availability (
          start_time,
          end_time,
          is_available,
          created_by,
          recurrence_group_id,
          recurrence_label,
          recurrence_weekly,
          lesson_type_id,
          club_id,
          coach_id,
          capacity,
          minimum_players
        ) values (
          remaining_start,
          selected_availability.end_time,
          true,
          selected_availability.created_by,
          selected_availability.recurrence_group_id,
          selected_availability.recurrence_label,
          selected_availability.recurrence_weekly,
          selected_availability.lesson_type_id,
          selected_availability.club_id,
          selected_availability.coach_id,
          selected_availability.capacity,
          selected_availability.minimum_players
        );
      end if;
    end if;
  end if;

  return created_booking;
end;
$$;

grant execute on function public.create_private_lesson_booking(uuid, timestamptz, uuid, integer, text, text, text, text, text, text, text, text, uuid, integer, numeric, numeric, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
