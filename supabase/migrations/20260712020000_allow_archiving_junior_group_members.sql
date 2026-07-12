-- Allow existing junior group memberships to be archived cleanly from Admin.
-- New archive actions write placement_status = 'cancelled'. 'inactive' remains
-- allowed for backwards compatibility with earlier admin code or existing rows.

alter table public.junior_group_members drop constraint if exists junior_group_members_placement_status_check;
alter table public.junior_group_members
  add constraint junior_group_members_placement_status_check
  check (placement_status in (
    'pending_payment',
    'paid_unplaced',
    'placed',
    'cancelled',
    'refunded',
    'inactive',
    'awaiting_placement',
    'placement_confirmed',
    'active_in_group'
  ));

notify pgrst, 'reload schema';
