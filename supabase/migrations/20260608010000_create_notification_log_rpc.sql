create or replace function public.log_notification_attempt(
  p_log_id uuid default null,
  p_notification_type text default null,
  p_recipient_email text default null,
  p_related_type text default null,
  p_related_id uuid default null,
  p_status text default 'pending',
  p_provider text default null,
  p_error_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log_id uuid;
begin
  if p_status not in ('pending', 'sent', 'failed', 'skipped', 'test_mode') then
    raise exception 'Invalid notification status: %', p_status;
  end if;

  if p_log_id is null then
    insert into public.notification_logs (
      notification_type,
      recipient_email,
      related_type,
      related_id,
      status,
      provider,
      error_message
    )
    values (
      coalesce(p_notification_type, 'unknown'),
      p_recipient_email,
      p_related_type,
      p_related_id,
      p_status,
      p_provider,
      p_error_message
    )
    returning id into v_log_id;

    return v_log_id;
  end if;

  update public.notification_logs
  set
    status = p_status,
    error_message = p_error_message
  where id = p_log_id
  returning id into v_log_id;

  return coalesce(v_log_id, p_log_id);
end;
$$;

grant execute on function public.log_notification_attempt(uuid, text, text, text, uuid, text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
