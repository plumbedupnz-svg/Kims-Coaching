-- Allow public junior programmes to show their active groups on Book Coaching.
-- Previously get_public_junior_groups required junior_groups.is_public = true,
-- so a public programme with generated active groups could still appear empty.

create or replace function public.get_public_junior_groups()
returns table (
  group_id uuid,
  programme_id uuid,
  lesson_type_id uuid,
  programme_name text,
  group_name text,
  term_name text,
  age_min integer,
  age_max integer,
  level text,
  coach_id uuid,
  coach_name text,
  club_id uuid,
  club_name text,
  club_address text,
  start_date date,
  end_date date,
  recurring_day integer,
  start_time time,
  session_count integer,
  session_duration_minutes integer,
  capacity integer,
  confirmed_count integer,
  pending_count integer,
  spaces_remaining integer,
  price numeric,
  payment_link_url text,
  description text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    junior_groups.id as group_id,
    junior_groups.programme_id,
    junior_groups.lesson_type_id,
    coalesce(junior_programmes.programme_name, junior_groups.group_name) as programme_name,
    junior_groups.group_name,
    junior_groups.term_name,
    junior_groups.age_min,
    junior_groups.age_max,
    junior_groups.level,
    junior_groups.coach_id,
    coaches.display_name as coach_name,
    junior_groups.club_id,
    coaching_clubs.name as club_name,
    coaching_clubs.address as club_address,
    junior_groups.start_date,
    junior_groups.end_date,
    junior_groups.recurring_day,
    junior_groups.start_time,
    junior_groups.session_count,
    junior_groups.session_duration_minutes,
    junior_groups.capacity,
    count(junior_group_members.id) filter (
      where junior_group_members.booking_status = 'confirmed'
        and junior_group_members.payment_status = 'paid'
    )::integer as confirmed_count,
    count(junior_group_members.id) filter (
      where junior_group_members.booking_status = 'pending_payment'
        and junior_group_members.payment_status = 'pending'
        and coalesce(junior_group_members.expires_at, now()) > now()
    )::integer as pending_count,
    greatest(
      0,
      junior_groups.capacity - count(junior_group_members.id) filter (
        where (
          junior_group_members.booking_status = 'confirmed'
          and junior_group_members.payment_status = 'paid'
        )
        or (
          junior_group_members.booking_status = 'pending_payment'
          and junior_group_members.payment_status = 'pending'
          and coalesce(junior_group_members.expires_at, now()) > now()
        )
      )::integer
    ) as spaces_remaining,
    junior_groups.price,
    junior_groups.payment_link_url,
    junior_groups.description
  from public.junior_groups
  left join public.junior_programmes on junior_programmes.id = junior_groups.programme_id
  left join public.coaches on coaches.id = junior_groups.coach_id
  left join public.coaching_clubs on coaching_clubs.id = junior_groups.club_id
  left join public.junior_group_members on junior_group_members.group_id = junior_groups.id
  where junior_groups.is_active = true
    and (
      junior_groups.is_public = true
      or coalesce(junior_programmes.is_public, false) = true
    )
    and coalesce(junior_programmes.is_active, true) = true
    and coalesce(coaches.is_active, true) = true
    and coalesce(coaching_clubs.is_active, true) = true
  group by
    junior_groups.id,
    junior_programmes.programme_name,
    coaches.display_name,
    coaching_clubs.name,
    coaching_clubs.address
  order by junior_groups.start_date asc, junior_groups.start_time asc;
$$;

grant execute on function public.get_public_junior_groups() to anon, authenticated;

notify pgrst, 'reload schema';
