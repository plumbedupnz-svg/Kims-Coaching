-- Fix ambiguous column references in the customer junior group booking RPC.
-- The function returns columns named booking_status and payment_status, so any
-- table columns with those names must be qualified inside the function body.

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

  select jg.*
  into target_group
  from public.junior_groups as jg
  where jg.id = p_group_id
    and jg.is_active = true
    and jg.is_public = true
  for update of jg;

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

  select count(*)
  into held_count
  from public.junior_group_members as jgm
  where jgm.group_id = target_group.id
    and jgm.booking_status = 'confirmed'
    and jgm.payment_status = 'paid';

  if held_count >= target_group.capacity then
    raise exception 'This junior group is full.';
  end if;

  if p_profile_player_index is not null then
    select p.id
    into selected_player_id
    from public.players as p
    where p.profile_id = auth.uid()
      and p.profile_player_index = p_profile_player_index
      and p.is_active = true
    limit 1;
  end if;

  insert into public.junior_group_pending_bookings as pending (
    group_id,
    profile_id,
    profile_player_index,
    player_id,
    programme_id,
    player_name,
    player_age,
    player_level,
    parent_name,
    email,
    mobile,
    notes,
    amount,
    currency,
    booking_status,
    payment_status,
    expires_at
  )
  values (
    target_group.id,
    auth.uid(),
    p_profile_player_index,
    selected_player_id,
    target_group.programme_id,
    nullif(trim(p_player_name), ''),
    p_player_age,
    coalesce(p_player_level, ''),
    coalesce(p_parent_name, ''),
    nullif(trim(p_email), ''),
    coalesce(p_mobile, ''),
    coalesce(p_notes, ''),
    target_group.price,
    'NZD',
    'pending_payment',
    'pending',
    now() + interval '30 minutes'
  )
  returning pending.id into created_pending_id;

  return query
  select
    created_pending_id,
    null::uuid,
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
) to authenticated, service_role;

notify pgrst, 'reload schema';
