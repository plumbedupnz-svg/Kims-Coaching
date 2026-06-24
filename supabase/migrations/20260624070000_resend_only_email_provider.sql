-- Keep Disabled/Test Mode, but route every enabled application email through Resend.
-- Supabase Auth SMTP credentials are configured in the Supabase Dashboard and
-- cannot be set safely in a database migration.

update public.email_settings
set provider = case when enabled then 'resend' else 'disabled' end,
    smtp_host = null,
    smtp_port = null,
    smtp_username = null,
    encrypted_secret_placeholder = 'RESEND_API_KEY is stored in Vercel; Supabase Auth uses Resend SMTP configured in the Supabase Dashboard.',
    updated_at = now();

alter table public.email_settings
  alter column provider set default 'disabled';

alter table public.email_settings
  drop constraint if exists email_settings_provider_valid;

alter table public.email_settings
  add constraint email_settings_provider_valid
  check (provider in ('disabled', 'resend'));

notify pgrst, 'reload schema';
