-- Ensure junior group bookings always use a payable amount for Stripe Checkout.
-- The effective price comes from the group first, then the linked programme,
-- then the linked lesson type.

alter table public.junior_programmes
  add column if not exists price numeric(10, 2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'junior_programmes_price_nonnegative'
      and conrelid = 'public.junior_programmes'::regclass
  ) then
    alter table public.junior_programmes
      add constraint junior_programmes_price_nonnegative check (price >= 0);
  end if;
end $$;

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
    coalesce(
      nullif(junior_groups.price, 0),
      nullif(junior_programmes.price, 0),
      nullif(lesson_types.price, 0),
      0
    )::numeric as price,
    junior_groups.payment_link_url,
    junior_groups.description
  from public.junior_groups
  left join public.junior_programmes on junior_programmes.id = junior_groups.programme_id
  left join public.lesson_types on lesson_types.id = junior_groups.lesson_type_id
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
    junior_programmes.price,
    lesson_types.price,
    coaches.display_name,
    coaching_clubs.name,
    coaching_clubs.address
  order by junior_groups.start_date asc, junior_groups.start_time asc;
$$;

grant execute on function public.get_public_junior_groups() to anon, authenticated;

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
  required_level_rank integer := 0;
  player_level_rank integer := 0;
  created_member_id uuid;
  created_payment_id uuid;
  programme_price numeric := 0;
  lesson_type_price numeric := 0;
  effective_price numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Please log in before booking junior group coaching.';
  end if;

  select jg.*
  into target_group
  from public.junior_groups as jg
  left join public.junior_programmes as jp on jp.id = jg.programme_id
  where jg.id = p_group_id
    and jg.is_active = true
    and (
      jg.is_public = true
      or coalesce(jp.is_public, false) = true
    )
    and coalesce(jp.is_active, true) = true
  for update of jg;

  if target_group.id is null then
    raise exception 'This junior group is not currently available for booking.';
  end if;

  select
    coalesce(jp.price, 0),
    coalesce(lt.price, 0)
  into programme_price, lesson_type_price
  from public.junior_groups as jg
  left join public.junior_programmes as jp on jp.id = jg.programme_id
  left join public.lesson_types as lt on lt.id = jg.lesson_type_id
  where jg.id = target_group.id;

  effective_price := coalesce(
    nullif(target_group.price, 0),
    nullif(programme_price, 0),
    nullif(lesson_type_price, 0),
    0
  );

  if effective_price <= 0 then
    raise exception 'Online payment is required for junior group coaching. Add a price to this group, programme, or lesson type before customers can book.';
  end if;

  if target_group.age_min is not null and (p_player_age is null or p_player_age < target_group.age_min) then
    raise exception 'This programme requires players to be at least % years old.', target_group.age_min;
  end if;

  if target_group.age_max is not null and (p_player_age is null or p_player_age > target_group.age_max) then
    raise exception 'This programme is for players aged % or under.', target_group.age_max;
  end if;

  if coalesce(target_group.level, '') <> '' then
    required_level_rank := case lower(target_group.level)
      when 'beginner' then 1
      when 'developing' then 2
      when 'interclub' then 3
      when 'tournament' then 4
      else 0
    end;
    player_level_rank := case lower(coalesce(p_player_level, ''))
      when 'beginner' then 1
      when 'developing' then 2
      when 'interclub' then 3
      when 'tournament' then 4
      else 0
    end;
    if player_level_rank = 0 then
      raise exception 'Select a player level before booking this programme.';
    end if;
    if required_level_rank > 0 and player_level_rank < required_level_rank then
      raise exception 'This programme requires a minimum level of %.', target_group.level;
    end if;
  end if;

  select count(*)
  into held_count
  from public.junior_group_members as jgm
  where jgm.group_id = target_group.id
    and (
      (jgm.booking_status = 'confirmed' and jgm.payment_status = 'paid')
      or (
        jgm.booking_status = 'pending_payment'
        and jgm.payment_status = 'pending'
        and coalesce(jgm.expires_at, now()) > now()
      )
    );

  if held_count >= target_group.capacity then
    raise exception 'This junior group is full.';
  end if;

  insert into public.junior_group_members (
    group_id,
    profile_id,
    profile_player_index,
    player_name,
    player_age,
    player_level,
    parent_name,
    email,
    mobile,
    notes,
    booking_status,
    payment_status,
    expires_at
  )
  values (
    target_group.id,
    auth.uid(),
    p_profile_player_index,
    nullif(trim(p_player_name), ''),
    p_player_age,
    coalesce(p_player_level, ''),
    coalesce(p_parent_name, ''),
    nullif(trim(p_email), ''),
    coalesce(p_mobile, ''),
    coalesce(p_notes, ''),
    'pending_payment',
    'pending',
    now() + interval '30 minutes'
  )
  returning id into created_member_id;

  insert into public.payments (
    profile_id,
    junior_group_member_id,
    related_type,
    related_id,
    amount,
    payment_status,
    provider,
    payment_link_url
  )
  values (
    auth.uid(),
    created_member_id,
    'junior_group',
    target_group.id,
    effective_price,
    'pending',
    'stripe',
    target_group.payment_link_url
  )
  returning id into created_payment_id;

  return query
  select
    created_member_id,
    created_payment_id,
    'pending_payment'::text,
    'pending'::text,
    target_group.payment_link_url,
    effective_price;
end;
$$;

grant execute on function public.create_junior_group_pending_booking(
  uuid,
  text,
  integer,
  text,
  text,
  text,
  text,
  text,
  integer
) to authenticated;

notify pgrst, 'reload schema';
