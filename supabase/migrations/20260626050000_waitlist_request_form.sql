create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  preferred_days text[] not null default '{}',
  preferred_times text[] not null default '{}',
  skill_level text default '',
  notes text default ''
);

alter table public.waitlist
  alter column user_id drop not null;

alter table public.waitlist
  add column if not exists player_name text default '',
  add column if not exists preferred_lesson_type text default '',
  add column if not exists preferred_duration integer,
  add column if not exists lesson_type_id uuid,
  add column if not exists club text default '',
  add column if not exists club_id uuid,
  add column if not exists coach text default '',
  add column if not exists coach_id uuid,
  add column if not exists customer_name text default '',
  add column if not exists email text default '',
  add column if not exists mobile text default '',
  add column if not exists request_status text default 'new',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists waitlist_created_at_idx on public.waitlist(created_at desc);
create index if not exists waitlist_user_id_idx on public.waitlist(user_id);
create index if not exists waitlist_request_status_idx on public.waitlist(request_status);

alter table public.waitlist enable row level security;

drop policy if exists "Anyone can create waitlist requests" on public.waitlist;
create policy "Anyone can create waitlist requests"
on public.waitlist
for insert
to anon, authenticated
with check (user_id is null or user_id = auth.uid());

drop policy if exists "Users can read own waitlist entries" on public.waitlist;
create policy "Users can read own waitlist entries"
on public.waitlist
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can update own waitlist entries" on public.waitlist;
create policy "Users can update own waitlist entries"
on public.waitlist
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete own waitlist entries" on public.waitlist;
create policy "Users can delete own waitlist entries"
on public.waitlist
for delete
to authenticated
using (user_id = auth.uid());

do $$
begin
  if to_regprocedure('public.current_user_is_admin()') is not null then
    execute 'drop policy if exists "Admins can manage all waitlist entries" on public.waitlist';
    execute 'create policy "Admins can manage all waitlist entries"
      on public.waitlist
      for all
      to authenticated
      using (public.current_user_is_admin())
      with check (public.current_user_is_admin())';
  end if;
end $$;

grant insert on public.waitlist to anon;
grant insert, select, update, delete on public.waitlist to authenticated;
grant all on public.waitlist to service_role;

notify pgrst, 'reload schema';
