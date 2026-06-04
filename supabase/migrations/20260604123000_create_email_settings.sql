create table if not exists public.email_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'disabled',
  from_name text not null default 'Kim Jones Coaching',
  from_email text not null default 'kimjonescoaching@outlook.com',
  reply_to_email text not null default 'kimjonescoaching@outlook.com',
  smtp_host text default 'smtp.office365.com',
  smtp_port integer default 587,
  smtp_username text,
  encrypted_secret_placeholder text,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_settings_provider_valid check (provider in ('disabled', 'outlook_smtp', 'resend', 'sendgrid', 'mailgun'))
);

create unique index if not exists email_settings_singleton_idx
on public.email_settings ((true));

insert into public.email_settings (
  provider,
  from_name,
  from_email,
  reply_to_email,
  smtp_host,
  smtp_port,
  smtp_username,
  encrypted_secret_placeholder,
  enabled
)
values (
  'disabled',
  'Kim Jones Coaching',
  'kimjonescoaching@outlook.com',
  'kimjonescoaching@outlook.com',
  'smtp.office365.com',
  587,
  'kimjonescoaching@outlook.com',
  'Secrets must be stored in Vercel environment variables, not this frontend-readable table.',
  false
)
on conflict do nothing;

create or replace function public.set_email_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_email_settings_updated_at on public.email_settings;
create trigger set_email_settings_updated_at
before update on public.email_settings
for each row
execute function public.set_email_settings_updated_at();

alter table public.email_settings enable row level security;

drop policy if exists "Admins can read email settings" on public.email_settings;
create policy "Admins can read email settings"
on public.email_settings
for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "Admins can insert email settings" on public.email_settings;
create policy "Admins can insert email settings"
on public.email_settings
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "Admins can update email settings" on public.email_settings;
create policy "Admins can update email settings"
on public.email_settings
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select, insert, update on public.email_settings to authenticated;
