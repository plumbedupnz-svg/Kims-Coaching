-- Fix ambiguous column references in junior player placement confirmation.
-- The function returns a column named player_id, so table columns inside the
-- function must be fully qualified to avoid PL/pgSQL name collisions.

create or replace function public.admin_confirm_junior_player_placement(
  p_player_id uuid,
  p_programme_id uuid default null,
  p_group_id uuid default null,
  p_admin_confirmed_level text default null,
  p_admin_notes text default null
)
returns table (
  player_id uuid,
  member_id uuid,
  payment_id uuid,
  amount numeric,
  parent_email text,
  payment_status text,
  placement_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_player public.players%rowtype;
  target_group public.junior_groups%rowtype;
  target_member public.junior_group_members%rowtype;
  target_payment public.payments%rowtype;
  next_programme_id uuid;
  amount_due numeric := 0;
  next_booking_status text;
  next_payment_status text;
  next_placement_status text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can confirm junior placements.';
  end if;

  select p.*
  into target_player
  from public.players as p
  where p.id = p_player_id;

  if target_player.id is null then
    raise exception 'Junior player was not found.';
  end if;

  if p_group_id is null then
    raise exception 'Choose a junior group before confirming placement.';
  end if;

  select jg.*
  into target_group
  from public.junior_groups as jg
  where jg.id = p_group_id;

  if target_group.id is null then
    raise exception 'Junior group was not found.';
  end if;

  next_programme_id := coalesce(p_programme_id, target_group.programme_id, target_player.junior_programme_id);
  amount_due := coalesce(target_group.price, 0);
  next_booking_status := case when amount_due > 0 then 'pending_payment' else 'confirmed' end;
  next_payment_status := case when amount_due > 0 then 'pending' else 'paid' end;
  next_placement_status := case when amount_due > 0 then 'payment_pending' else 'active_in_group' end;

  select jgm.*
  into target_member
  from public.junior_group_members as jgm
  where jgm.player_id = target_player.id
  order by jgm.created_at desc nulls last
  limit 1;

  if target_member.id is null then
    insert into public.junior_group_members (
      group_id,
      profile_id,
      profile_player_index,
      player_id,
      programme_id,
      player_name,
      player_age,
      player_level,
      admin_confirmed_level,
      parent_name,
      email,
      mobile,
      notes,
      admin_notes,
      booking_status,
      payment_status,
      placement_status,
      expires_at,
      confirmed_at
    )
    values (
      target_group.id,
      target_player.profile_id,
      target_player.profile_player_index,
      target_player.id,
      next_programme_id,
      target_player.player_name,
      target_player.age,
      coalesce(nullif(p_admin_confirmed_level, ''), target_player.admin_confirmed_level, target_player.customer_selected_level, ''),
      coalesce(p_admin_confirmed_level, target_player.admin_confirmed_level, ''),
      target_player.parent_name,
      target_player.parent_email,
      target_player.parent_phone,
      target_player.notes,
      coalesce(p_admin_notes, target_player.admin_notes, ''),
      next_booking_status,
      next_payment_status,
      next_placement_status,
      case when amount_due > 0 then now() + interval '7 days' else null end,
      case when amount_due > 0 then null else now() end
    )
    returning * into target_member;
  else
    update public.junior_group_members as jgm
    set
      group_id = target_group.id,
      programme_id = next_programme_id,
      profile_id = target_player.profile_id,
      profile_player_index = target_player.profile_player_index,
      player_name = target_player.player_name,
      player_age = target_player.age,
      player_level = coalesce(nullif(p_admin_confirmed_level, ''), target_player.admin_confirmed_level, target_player.customer_selected_level, ''),
      admin_confirmed_level = coalesce(p_admin_confirmed_level, target_player.admin_confirmed_level, ''),
      parent_name = target_player.parent_name,
      email = target_player.parent_email,
      mobile = target_player.parent_phone,
      notes = target_player.notes,
      admin_notes = coalesce(p_admin_notes, target_player.admin_notes, ''),
      booking_status = next_booking_status,
      payment_status = next_payment_status,
      placement_status = next_placement_status,
      expires_at = case when amount_due > 0 then now() + interval '7 days' else null end,
      confirmed_at = case when amount_due > 0 then null else now() end,
      updated_at = now()
    where jgm.id = target_member.id
    returning * into target_member;
  end if;

  if amount_due > 0 then
    select pay.*
    into target_payment
    from public.payments as pay
    where pay.junior_group_member_id = target_member.id
    order by pay.created_at desc nulls last
    limit 1;

    if target_payment.id is null then
      insert into public.payments (
        profile_id,
        junior_group_member_id,
        player_id,
        related_type,
        related_id,
        amount,
        currency,
        payment_status,
        provider,
        metadata
      )
      values (
        target_player.profile_id,
        target_member.id,
        target_player.id,
        'junior_group',
        target_group.id,
        amount_due,
        'NZD',
        'pending',
        'stripe',
        jsonb_build_object(
          'player_name', target_player.player_name,
          'programme_id', next_programme_id,
          'group_id', target_group.id
        )
      )
      returning * into target_payment;
    else
      update public.payments as pay
      set
        profile_id = target_player.profile_id,
        player_id = target_player.id,
        related_id = target_group.id,
        amount = amount_due,
        currency = 'NZD',
        payment_status = 'pending',
        provider = 'stripe',
        metadata = coalesce(pay.metadata, '{}'::jsonb) || jsonb_build_object(
          'player_name', target_player.player_name,
          'programme_id', next_programme_id,
          'group_id', target_group.id
        ),
        updated_at = now()
      where pay.id = target_payment.id
      returning * into target_payment;
    end if;
  else
    target_payment := null;
  end if;

  update public.players as p
  set
    admin_confirmed_level = coalesce(p_admin_confirmed_level, p.admin_confirmed_level, ''),
    admin_notes = coalesce(p_admin_notes, p.admin_notes, ''),
    junior_programme_id = next_programme_id,
    junior_group_id = target_group.id,
    junior_group_member_id = target_member.id,
    placement_status = next_placement_status,
    payment_status = next_payment_status,
    updated_at = now()
  where p.id = target_player.id;

  return query
  select
    target_player.id,
    target_member.id,
    target_payment.id,
    amount_due,
    target_player.parent_email,
    next_payment_status,
    next_placement_status;
end;
$$;

grant execute on function public.admin_confirm_junior_player_placement(uuid, uuid, uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
