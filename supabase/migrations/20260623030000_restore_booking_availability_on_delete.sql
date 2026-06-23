create or replace function public.admin_restore_booking_availability(
  p_booking_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking public.bookings%rowtype;
  source_availability public.availability%rowtype;
  restored_start timestamptz;
  restored_end timestamptz;
  source_found boolean := false;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can restore booking availability.';
  end if;

  select *
  into target_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking was not found.';
  end if;

  restored_start := target_booking.start_time;
  restored_end := target_booking.end_time;

  if restored_start is null or restored_end is null or restored_end <= restored_start then
    raise exception 'Booking does not have a valid time window to restore.';
  end if;

  select *
  into source_availability
  from public.availability
  where id = target_booking.availability_id
  for update;
  source_found := found;

  if exists (
    select 1
    from public.availability existing
    where existing.is_available = true
      and existing.start_time <= restored_start
      and existing.end_time >= restored_end
  ) then
    return;
  end if;

  if source_found and source_availability.is_available = false then
    update public.availability
    set
      start_time = least(source_availability.start_time, restored_start),
      end_time = greatest(source_availability.end_time, restored_end),
      is_available = true
    where id = source_availability.id;
    return;
  end if;

  insert into public.availability (
    start_time,
    end_time,
    is_available,
    created_by,
    recurrence_group_id,
    recurrence_label,
    recurrence_weekly
  )
  values (
    restored_start,
    restored_end,
    true,
    coalesce(source_availability.created_by, auth.uid()),
    source_availability.recurrence_group_id,
    source_availability.recurrence_label,
    source_availability.recurrence_weekly
  );
end;
$$;

create or replace function public.admin_delete_booking_and_restore_availability(
  p_booking_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can delete bookings.';
  end if;

  perform public.admin_restore_booking_availability(p_booking_id);

  delete from public.bookings
  where id = p_booking_id;
end;
$$;

create or replace function public.admin_cancel_booking_and_restore_availability(
  p_booking_id uuid
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_booking public.bookings%rowtype;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can cancel bookings.';
  end if;

  perform public.admin_restore_booking_availability(p_booking_id);

  update public.bookings
  set booking_status = 'cancelled'
  where id = p_booking_id
  returning * into updated_booking;

  if not found then
    raise exception 'Booking was not found.';
  end if;

  return updated_booking;
end;
$$;

grant execute on function public.admin_restore_booking_availability(uuid) to authenticated, service_role;
grant execute on function public.admin_delete_booking_and_restore_availability(uuid) to authenticated, service_role;
grant execute on function public.admin_cancel_booking_and_restore_availability(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
