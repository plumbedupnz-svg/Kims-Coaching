alter table public.bookings
add column if not exists customer_name text default '',
add column if not exists parent_name text default '',
add column if not exists player_name text default '',
add column if not exists customer_email text default '',
add column if not exists mobile text default '',
add column if not exists player_level text default '';

alter table public.lesson_types
add column if not exists created_at timestamptz not null default now();

insert into public.lesson_types (name, duration, price)
select 'Private Lesson', 60, 0
where not exists (
  select 1
  from public.lesson_types
  where lower(name) = 'private lesson'
);

create or replace function public.get_available_private_lesson_slots(
  week_start timestamptz,
  week_end timestamptz
)
returns table (
  availability_id uuid,
  start_time timestamptz,
  end_time timestamptz,
  duration integer,
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
    where lower(name) like '%private%'
    order by duration asc, created_at asc nulls last
    limit 1
  )
  select
    availability.id as availability_id,
    availability.start_time,
    availability.end_time,
    coalesce(
      private_lesson.duration,
      ceiling(extract(epoch from (availability.end_time - availability.start_time)) / 60)::integer
    ) as duration,
    private_lesson.id as lesson_type_id
  from public.availability
  cross join private_lesson
  where availability.is_available = true
    and availability.start_time >= week_start
    and availability.start_time < week_end
    and not exists (
      select 1
      from public.bookings
      where bookings.availability_id = availability.id
        and bookings.booking_status in ('pending', 'confirmed')
    )
  order by availability.start_time asc;
$$;

grant execute on function public.get_available_private_lesson_slots(timestamptz, timestamptz) to anon, authenticated;
