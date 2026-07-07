-- Fix ambiguous status column references in the customer junior group booking RPC.
-- The function returns columns named booking_status and payment_status, so table
-- references inside the function must be fully qualified.

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
begin
  if auth.uid() is null then
    raise exception 'Please log in before booking junior group coaching.';
  end if;

  select jg.*
  into target_group
  from public.junior_groups as jg
  where jg.id = p_group_id
    and jg.is_active = true
    and jg.is_public = true
  for update;

  if target_group.id is null then
    raise exception 'This junior group is not currently available for booking.';
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
    target_group.price,
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
    target_group.price;
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
