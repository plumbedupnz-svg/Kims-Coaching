create or replace function public.next_lesson_start_time(value timestamptz)
returns timestamptz
language sql
immutable
as $$
  select to_timestamp(ceil(extract(epoch from value) / 1800.0) * 1800)::timestamptz;
$$;

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
  lesson_type_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  with private_lesson as (
    select id, duration
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
      private_lesson.id as lesson_type_id
    from public.availability
    cross join private_lesson
    cross join lateral generate_series(
      public.next_lesson_start_time(availability.start_time),
      availability.end_time - interval '30 minutes',
      interval '30 minutes'
    ) as generated_start
    where availability.is_available = true
      and availability.start_time < week_end
      and availability.end_time > week_start
  )
  select
    expanded_slots.availability_id,
    expanded_slots.start_time,
    expanded_slots.end_time,
    least(60, expanded_slots.max_duration_minutes) as duration,
    expanded_slots.max_duration_minutes,
    expanded_slots.lesson_type_id
  from expanded_slots
  where expanded_slots.start_time >= week_start
    and expanded_slots.start_time < week_end
    and expanded_slots.max_duration_minutes >= 30
    and extract(minute from expanded_slots.start_time) in (0, 30)
  order by expanded_slots.start_time asc;
$$;

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
  p_notes text
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_availability public.availability%rowtype;
  booking_start timestamptz;
  booking_end timestamptz;
  remaining_start timestamptz;
  created_booking public.bookings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to book a private lesson.';
  end if;

  if p_duration_minutes not in (30, 45, 60, 90, 120) then
    raise exception 'Choose a valid lesson duration.';
  end if;

  select *
  into selected_availability
  from public.availability
  where id = p_availability_id
    and is_available = true
  for update;

  if not found then
    raise exception 'That private lesson time is no longer available.';
  end if;

  booking_start := p_start_time;
  booking_end := booking_start + make_interval(mins => p_duration_minutes);
  remaining_start := public.next_lesson_start_time(booking_end);

  if extract(minute from booking_start) not in (0, 30) then
    raise exception 'Lesson times must start on the hour or half hour.';
  end if;

  if booking_start < selected_availability.start_time
    or booking_end > selected_availability.end_time
  then
    raise exception 'That lesson duration does not fit in the selected availability window.';
  end if;

  if exists (
    select 1
    from public.bookings existing
    where existing.booking_status in ('pending', 'confirmed')
      and public.booking_times_overlap(
        booking_start,
        booking_end,
        existing.start_time,
        existing.end_time
      )
  ) then
    raise exception 'That private lesson time is no longer available.';
  end if;

  insert into public.bookings (
    user_id,
    lesson_type_id,
    availability_id,
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
    duration_minutes
  )
  values (
    auth.uid(),
    p_lesson_type_id,
    selected_availability.id,
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
    p_duration_minutes
  )
  returning * into created_booking;

  if booking_start = selected_availability.start_time
    and booking_end = selected_availability.end_time
  then
    update public.availability
    set is_available = false
    where id = selected_availability.id;
  elsif booking_start = selected_availability.start_time then
    if remaining_start < selected_availability.end_time then
      update public.availability
      set start_time = remaining_start
      where id = selected_availability.id;
    else
      update public.availability
      set is_available = false
      where id = selected_availability.id;
    end if;
  elsif booking_end = selected_availability.end_time then
    update public.availability
    set end_time = booking_start
    where id = selected_availability.id;
  else
    update public.availability
    set end_time = booking_start
    where id = selected_availability.id;

    if remaining_start < selected_availability.end_time then
      insert into public.availability (
        start_time,
        end_time,
        is_available,
        created_by,
        recurrence_group_id,
        recurrence_label,
        recurrence_weekly
      )
      values (
        remaining_start,
        selected_availability.end_time,
        true,
        selected_availability.created_by,
        selected_availability.recurrence_group_id,
        selected_availability.recurrence_label,
        selected_availability.recurrence_weekly
      );
    end if;
  end if;

  return created_booking;
end;
$$;

grant execute on function public.get_available_private_lesson_slots(timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.create_private_lesson_booking(uuid, timestamptz, uuid, integer, text, text, text, text, text, text, text) to authenticated;
