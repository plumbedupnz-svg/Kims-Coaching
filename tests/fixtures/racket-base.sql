-- Minimal Supabase identity fixture for local PostgreSQL tests; contains synthetic data only.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to public;
create table public.profiles (id uuid primary key references auth.users(id), email text, first_name text, last_name text, role text);
create function public.current_user_is_admin() returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
insert into public.profiles values
('00000000-0000-0000-0000-000000000001', 'admin@example.com', 'Demo', 'Admin', 'admin'),
('00000000-0000-0000-0000-000000000002', 'alex@example.com', 'Alex', 'Taylor', 'customer'),
('00000000-0000-0000-0000-000000000003', null, 'No', 'Email', 'customer');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
