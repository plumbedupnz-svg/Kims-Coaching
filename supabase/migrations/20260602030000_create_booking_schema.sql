alter table public.profiles
add column if not exists mobile text default '';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    phone,
    mobile,
    role
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(new.raw_user_meta_data ->> 'mobile', new.raw_user_meta_data ->> 'phone', ''),
    'customer'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    first_name = coalesce(nullif(public.profiles.first_name, ''), excluded.first_name),
    last_name = coalesce(nullif(public.profiles.last_name, ''), excluded.last_name),
    phone = coalesce(nullif(public.profiles.phone, ''), excluded.phone),
    mobile = coalesce(nullif(public.profiles.mobile, ''), excluded.mobile);

  return new;
end;
$$;

grant update (mobile) on public.profiles to authenticated;

comment on column public.profiles.role is
'Set to customer by default. Promote the first owner manually with SQL, for example: update public.profiles set role = ''admin'' where email = ''owner@example.com'';';

create table if not exists public.lesson_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration integer not null check (duration > 0),
  price numeric(10, 2) not null default 0 check (price >= 0)
);

create table if not exists public.availability (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_available boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  check (end_time > start_time)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_type_id uuid not null references public.lesson_types(id) on delete restrict,
  availability_id uuid not null references public.availability(id) on delete restrict,
  booking_status text not null default 'pending' check (booking_status in ('pending', 'confirmed', 'cancelled', 'completed')),
  notes text default '',
  created_at timestamptz not null default now()
);

create unique index if not exists bookings_active_availability_idx
on public.bookings (availability_id)
where booking_status in ('pending', 'confirmed');

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  preferred_days text[] not null default '{}',
  preferred_times text[] not null default '{}',
  skill_level text default '',
  notes text default ''
);

alter table public.lesson_types enable row level security;
alter table public.availability enable row level security;
alter table public.bookings enable row level security;
alter table public.waitlist enable row level security;

drop policy if exists "Anyone can read lesson types" on public.lesson_types;
create policy "Anyone can read lesson types"
on public.lesson_types
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage lesson types" on public.lesson_types;
create policy "Admins can manage lesson types"
on public.lesson_types
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Anyone can read available times" on public.availability;
create policy "Anyone can read available times"
on public.availability
for select
to anon, authenticated
using (is_available or public.current_user_is_admin());

drop policy if exists "Admins can manage availability" on public.availability;
create policy "Admins can manage availability"
on public.availability
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Users can create own bookings" on public.bookings;
create policy "Users can create own bookings"
on public.bookings
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.availability
    where availability.id = bookings.availability_id
      and availability.is_available
  )
);

drop policy if exists "Users can read own bookings" on public.bookings;
create policy "Users can read own bookings"
on public.bookings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Admins can manage all bookings" on public.bookings;
create policy "Admins can manage all bookings"
on public.bookings
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Users can create own waitlist entries" on public.waitlist;
create policy "Users can create own waitlist entries"
on public.waitlist
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can read own waitlist entries" on public.waitlist;
create policy "Users can read own waitlist entries"
on public.waitlist
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update own waitlist entries" on public.waitlist;
create policy "Users can update own waitlist entries"
on public.waitlist
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own waitlist entries" on public.waitlist;
create policy "Users can delete own waitlist entries"
on public.waitlist
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Admins can manage all waitlist entries" on public.waitlist;
create policy "Admins can manage all waitlist entries"
on public.waitlist
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

revoke all on public.lesson_types from anon, authenticated;
revoke all on public.availability from anon, authenticated;
revoke all on public.bookings from anon, authenticated;
revoke all on public.waitlist from anon, authenticated;

grant select on public.lesson_types to anon, authenticated;
grant select on public.availability to anon, authenticated;
grant insert, select on public.bookings to authenticated;
grant insert, select, update, delete on public.waitlist to authenticated;
grant all on public.lesson_types to authenticated;
grant all on public.availability to authenticated;
grant all on public.bookings to authenticated;
grant all on public.waitlist to authenticated;
