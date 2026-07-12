-- Remove previously archived saved player profiles from Admin > Junior Players.
-- Archived/cancelled enrolments remain in junior_group_members for history, while
-- saved player profiles are reset to account-only state so families can book them again.

update public.players
set junior_programme_id = null,
    junior_group_id = null,
    junior_group_member_id = null,
    placement_status = 'awaiting_placement',
    payment_status = 'not_required',
    updated_at = now()
where placement_status in ('inactive', 'cancelled', 'refunded')
  and (
    junior_group_member_id is null
    or not exists (
      select 1
      from public.junior_group_members
      where junior_group_members.id = players.junior_group_member_id
        and junior_group_members.booking_status = 'confirmed'
        and junior_group_members.payment_status = 'paid'
        and junior_group_members.placement_status in ('paid_unplaced', 'placed', 'active_in_group', 'placement_confirmed')
    )
  );

update public.junior_group_members
set placement_status = 'cancelled',
    updated_at = now()
where booking_status = 'cancelled'
  and placement_status = 'inactive';

notify pgrst, 'reload schema';
