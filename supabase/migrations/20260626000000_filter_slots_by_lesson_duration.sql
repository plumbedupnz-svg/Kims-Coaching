-- Only return customer booking starts that can fit the configured lesson type duration.
-- Example: a 60 minute lesson in a 14:00-15:00 availability window returns 14:00 only,
-- not a deceptive 14:30 start that can only fit 30 minutes.

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
grant execute on function public.next_lesson_start_time(timestamptz) to anon, authenticated, service_role;
grant execute on function public.booking_times_overlap(timestamptz, timestamptz, timestamptz, timestamptz) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
