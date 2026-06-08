grant insert, update, select on public.notification_logs to service_role;

notify pgrst, 'reload schema';
