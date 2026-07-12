-- Separate saved player profiles from paid junior coaching enrolments.
-- Safe to run more than once. This keeps saved players in customer accounts but
-- ensures Admin > Junior Players only represents paid/confirmed junior bookings.

alter table public.players drop constraint if exists players_placement_status_check;
alter table public.players
  add constraint players_placement_status_check
  check (placement_status in (
    'awaiting_placement',
    'pending_payment',
    'paid_unplaced',
    'placed',
    'placement_confirmed',
    'payment_pending',
    'paid',
    'active_in_group',
    'cancelled',
    'refunded',
    'inactive'
  ));

alter table public.players drop constraint if exists players_payment_status_check;
alter table public.players
  add constraint players_payment_status_check
  check (payment_status in (
    'not_required',
    'pending_payment',
    'pending',
    'paid',
    'failed',
    'overdue',
    'refunded',
    'cancelled'
  ));

alter table public.junior_group_members drop constraint if exists junior_group_members_placement_status_check;
alter table public.junior_group_members
  add constraint junior_group_members_placement_status_check
  check (placement_status in (
    'pending_payment',
    'paid_unplaced',
    'placed',
    'cancelled',
    'refunded',
    'awaiting_placement',
    'placement_confirmed',
    'active_in_group'
  ));

-- Previously saved profiles should remain saved profiles only. They are not
-- admin-visible junior players until a Stripe-confirmed enrolment links them.
update public.players
set payment_status = 'not_required',
    placement_status = case
      when placement_status in ('paid_unplaced', 'placed', 'active_in_group', 'placement_confirmed')
       and payment_status = 'paid'
       and junior_group_member_id is not null
      then placement_status
      else 'awaiting_placement'
    end,
    updated_at = now()
where junior_group_member_id is null
  and payment_status <> 'paid';

create or replace function public.admin_paid_junior_players()
returns setof public.players
language sql
security definer
set search_path = public
stable
as $$
  select distinct players.*
  from public.players
  join public.junior_group_members
    on junior_group_members.player_id = players.id
    or junior_group_members.id = players.junior_group_member_id
  where public.current_user_is_admin()
    and players.is_active = true
    and junior_group_members.booking_status = 'confirmed'
    and junior_group_members.payment_status = 'paid'
    and players.payment_status = 'paid'
    and players.placement_status in ('paid_unplaced', 'placed', 'active_in_group', 'placement_confirmed')
  order by players.created_at desc;
$$;

grant execute on function public.admin_paid_junior_players() to authenticated, service_role;

notify pgrst, 'reload schema';

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
  created_member_id uuid;
  created_payment_id uuid;
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
    and (
      (booking_status = 'confirmed' and payment_status = 'paid')
      or (booking_status = 'pending_payment' and payment_status = 'pending' and coalesce(expires_at, now()) > now())
    );

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

  insert into public.junior_group_members (
    group_id, profile_id, profile_player_index, player_id, programme_id,
    player_name, player_age, player_level, parent_name, email, mobile, notes,
    booking_status, payment_status, placement_status, expires_at
  )
  values (
    target_group.id, auth.uid(), p_profile_player_index, selected_player_id, target_group.programme_id,
    nullif(trim(p_player_name), ''), p_player_age, coalesce(p_player_level, ''), coalesce(p_parent_name, ''),
    nullif(trim(p_email), ''), coalesce(p_mobile, ''), coalesce(p_notes, ''),
    'pending_payment', 'pending', 'pending_payment', now() + interval '30 minutes'
  )
  returning id into created_member_id;

  insert into public.payments (
    profile_id, junior_group_member_id, player_id, related_type, related_id, amount, currency,
    payment_status, provider, payment_link_url
  )
  values (
    auth.uid(), created_member_id, selected_player_id, 'junior_group', target_group.id, target_group.price, 'NZD',
    'pending', 'stripe', target_group.payment_link_url
  )
  returning id into created_payment_id;

  return query select created_member_id, created_payment_id, 'pending_payment'::text, 'pending'::text, target_group.payment_link_url, target_group.price;
end;
$$;

grant execute on function public.create_junior_group_pending_booking(uuid, text, integer, text, text, text, text, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
