alter table public.lesson_types
add column if not exists description text,
add column if not exists capacity integer not null default 1,
add column if not exists is_active boolean not null default true,
add column if not exists created_at timestamptz not null default now();

create table if not exists public.lesson_bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lesson_type_id uuid references public.lesson_types(id) on delete set null,
  lesson_count integer not null default 1 check (lesson_count > 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bookings
add column if not exists payment_option text not null default 'pay_later',
add column if not exists payment_status text not null default 'unpaid',
add column if not exists bundle_id uuid references public.lesson_bundles(id) on delete set null,
add column if not exists bundle_lessons_count integer,
add column if not exists bundle_discount_percent numeric(5, 2),
add column if not exists total_price numeric(10, 2) not null default 0;

create table if not exists public.coaching_clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists coaching_clubs_name_unique_idx
on public.coaching_clubs (lower(name));

create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  display_name text not null,
  email text,
  mobile text,
  bio text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.availability
add column if not exists lesson_type_id uuid references public.lesson_types(id) on delete set null,
add column if not exists capacity integer not null default 1,
add column if not exists club_id uuid references public.coaching_clubs(id) on delete set null,
add column if not exists coach_id uuid references public.coaches(id) on delete set null;

alter table public.bookings
add column if not exists club_id uuid references public.coaching_clubs(id) on delete set null,
add column if not exists coach_id uuid references public.coaches(id) on delete set null;

create index if not exists availability_club_idx on public.availability(club_id);
create index if not exists availability_coach_idx on public.availability(coach_id);
create index if not exists bookings_club_idx on public.bookings(club_id);
create index if not exists bookings_coach_idx on public.bookings(coach_id);

alter table public.coaching_clubs enable row level security;
alter table public.coaches enable row level security;
alter table public.lesson_types enable row level security;
alter table public.lesson_bundles enable row level security;

drop policy if exists "Public can read active lesson types" on public.lesson_types;
create policy "Public can read active lesson types"
on public.lesson_types
for select
to anon, authenticated
using (is_active = true or public.current_user_is_admin());

drop policy if exists "Admins can manage lesson types" on public.lesson_types;
create policy "Admins can manage lesson types"
on public.lesson_types
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Public can read active lesson bundles" on public.lesson_bundles;
create policy "Public can read active lesson bundles"
on public.lesson_bundles
for select
to anon, authenticated
using (is_active = true or public.current_user_is_admin());

drop policy if exists "Admins can manage lesson bundles" on public.lesson_bundles;
create policy "Admins can manage lesson bundles"
on public.lesson_bundles
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Public can read active coaching clubs" on public.coaching_clubs;
create policy "Public can read active coaching clubs"
on public.coaching_clubs
for select
to anon, authenticated
using (is_active = true or public.current_user_is_admin());

drop policy if exists "Admins can manage coaching clubs" on public.coaching_clubs;
create policy "Admins can manage coaching clubs"
on public.coaching_clubs
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Public can read active coaches" on public.coaches;
drop policy if exists "Admins can read coaches" on public.coaches;
create policy "Admins can read coaches"
on public.coaches
for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "Admins can manage coaches" on public.coaches;
create policy "Admins can manage coaches"
on public.coaches
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select on public.coaching_clubs to anon, authenticated;
grant select on public.coaches to authenticated;
grant insert, update, delete on public.coaching_clubs, public.coaches to authenticated;
grant select on public.lesson_types, public.lesson_bundles to anon, authenticated;
grant insert, update, delete on public.lesson_types, public.lesson_bundles to authenticated;

create or replace function public.next_lesson_start_time(value timestamptz)
returns timestamptz
language sql
immutable
as $$
  select to_timestamp(
    ceil(extract(epoch from value) / 1800.0) * 1800
  )::timestamptz;
$$;

create or replace function public.booking_times_overlap(
  first_start timestamptz,
  first_end timestamptz,
  second_start timestamptz,
  second_end timestamptz
)
returns boolean
language sql
immutable
as $$
  select first_start < second_end
    and second_start < first_end;
$$;

create or replace function public.get_public_coaches()
returns table (
  coach_id uuid,
  coach_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select id, display_name
  from public.coaches
  where is_active = true
  order by display_name asc;
$$;

do $$
declare
  active_coach_count integer := 0;
  default_coach_id uuid;
begin
  select count(*)
  into active_coach_count
  from public.coaches
  where is_active = true;

  if active_coach_count = 1 then
    select id
    into default_coach_id
    from public.coaches
    where is_active = true
    limit 1;

    update public.availability
    set coach_id = default_coach_id
    where coach_id is null;
  end if;
end $$;

create or replace function public.admin_restore_booking_availability(
  p_booking_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking public.bookings%rowtype;
  source_availability public.availability%rowtype;
  restored_start timestamptz;
  restored_end timestamptz;
  source_found boolean := false;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can restore booking availability.';
  end if;

  select * into target_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking was not found.';
  end if;

  restored_start := target_booking.start_time;
  restored_end := target_booking.end_time;

  if restored_start is null or restored_end is null or restored_end <= restored_start then
    raise exception 'Booking does not have a valid time window to restore.';
  end if;

  select * into source_availability
  from public.availability
  where id = target_booking.availability_id
  for update;
  source_found := found;

  if exists (
    select 1
    from public.availability existing
    where existing.is_available = true
      and existing.start_time <= restored_start
      and existing.end_time >= restored_end
      and coalesce(existing.lesson_type_id, target_booking.lesson_type_id) is not distinct from target_booking.lesson_type_id
      and coalesce(existing.club_id, target_booking.club_id) is not distinct from target_booking.club_id
      and coalesce(existing.coach_id, target_booking.coach_id) is not distinct from target_booking.coach_id
  ) then
    return;
  end if;

  if source_found and source_availability.is_available = false then
    update public.availability
    set
      start_time = least(source_availability.start_time, restored_start),
      end_time = greatest(source_availability.end_time, restored_end),
      is_available = true,
      lesson_type_id = coalesce(source_availability.lesson_type_id, target_booking.lesson_type_id),
      club_id = coalesce(source_availability.club_id, target_booking.club_id),
      coach_id = coalesce(source_availability.coach_id, target_booking.coach_id),
      capacity = greatest(1, coalesce(source_availability.capacity, 1))
    where id = source_availability.id;
    return;
  end if;

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
    capacity
  )
  values (
    restored_start,
    restored_end,
    true,
    coalesce(source_availability.created_by, auth.uid()),
    source_availability.recurrence_group_id,
    source_availability.recurrence_label,
    source_availability.recurrence_weekly,
    coalesce(source_availability.lesson_type_id, target_booking.lesson_type_id),
    coalesce(source_availability.club_id, target_booking.club_id),
    coalesce(source_availability.coach_id, target_booking.coach_id),
    greatest(1, coalesce(source_availability.capacity, 1))
  );
end;
$$;

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
    select id, name, duration, price, capacity
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
          and existing.booking_status in ('pending', 'confirmed')
          and public.booking_times_overlap(
            expanded_slots.start_time,
            expanded_slots.start_time + interval '30 minutes',
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
    least(counted.lesson_type_duration, counted.max_duration_minutes) as duration,
    counted.max_duration_minutes,
    counted.lesson_type_id,
    counted.lesson_type_name,
    counted.lesson_type_price,
    counted.lesson_type_duration,
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
    and counted.max_duration_minutes >= 30
    and extract(minute from counted.start_time) in (0, 30)
    and counted.booked_count < counted.capacity
  order by counted.start_time asc;
$$;

drop function if exists public.create_private_lesson_booking(uuid, timestamptz, uuid, integer, text, text, text, text, text, text, text, text, uuid, integer, numeric, numeric);
drop function if exists public.create_private_lesson_booking(uuid, timestamptz, uuid, integer, text, text, text, text, text, text, text, text, uuid, integer, numeric, numeric, uuid, uuid);
drop function if exists public.create_private_lesson_booking(uuid, timestamptz, uuid, integer, text, text, text, text, text, text, text);

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
    and existing.booking_status in ('pending', 'confirmed')
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
    'confirmed',
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
          capacity
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
          selected_availability.capacity
        );
      end if;
    end if;
  end if;

  return created_booking;
end;
$$;

grant execute on function public.get_available_private_lesson_slots(timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.get_public_coaches() to anon, authenticated;
grant execute on function public.create_private_lesson_booking(uuid, timestamptz, uuid, integer, text, text, text, text, text, text, text, text, uuid, integer, numeric, numeric, uuid, uuid) to authenticated;
grant execute on function public.admin_restore_booking_availability(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
