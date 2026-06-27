-- Junior Group Coaching module.
-- Safe additive migration: keeps private lesson bookings, shop, inventory, auth, and existing lesson types intact.

create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.lesson_types
add column if not exists programme_type text not null default 'private_lesson',
add column if not exists minimum_age integer,
add column if not exists maximum_age integer,
add column if not exists minimum_level text not null default '',
add column if not exists default_capacity integer not null default 1,
add column if not exists pay_as_you_go_only boolean not null default false,
add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lesson_types_programme_type_check'
      and conrelid = 'public.lesson_types'::regclass
  ) then
    alter table public.lesson_types
    add constraint lesson_types_programme_type_check
    check (programme_type in ('private_lesson', 'junior_group'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lesson_types_age_range_check'
      and conrelid = 'public.lesson_types'::regclass
  ) then
    alter table public.lesson_types
    add constraint lesson_types_age_range_check
    check (
      (minimum_age is null or minimum_age between 0 and 120)
      and (maximum_age is null or maximum_age between 0 and 120)
      and (minimum_age is null or maximum_age is null or maximum_age >= minimum_age)
    );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lesson_types_default_capacity_check'
      and conrelid = 'public.lesson_types'::regclass
  ) then
    alter table public.lesson_types
    add constraint lesson_types_default_capacity_check
    check (default_capacity > 0);
  end if;
end $$;

create table if not exists public.junior_programmes (
  id uuid primary key default gen_random_uuid(),
  lesson_type_id uuid references public.lesson_types(id) on delete set null,
  programme_name text not null,
  term_name text default '',
  age_min integer,
  age_max integer,
  level text default '',
  coach_id uuid references public.coaches(id) on delete set null,
  club_id uuid references public.coaching_clubs(id) on delete set null,
  description text default '',
  is_active boolean not null default true,
  is_public boolean not null default false,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (age_min is null or age_min >= 0),
  check (age_max is null or age_max >= 0),
  check (age_min is null or age_max is null or age_max >= age_min)
);

create table if not exists public.junior_groups (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid references public.junior_programmes(id) on delete cascade,
  lesson_type_id uuid references public.lesson_types(id) on delete set null,
  group_name text not null,
  term_name text default '',
  age_min integer,
  age_max integer,
  level text default '',
  coach_id uuid references public.coaches(id) on delete set null,
  club_id uuid references public.coaching_clubs(id) on delete set null,
  start_date date not null,
  end_date date,
  recurring_day integer not null default 1 check (recurring_day between 0 and 6),
  start_time time not null,
  session_count integer not null default 1 check (session_count > 0),
  session_duration_minutes integer not null default 60 check (session_duration_minutes > 0),
  capacity integer not null default 8 check (capacity > 0),
  price numeric(10, 2) not null default 0 check (price >= 0),
  payment_link_url text,
  whatsapp_group_link text,
  description text default '',
  is_active boolean not null default true,
  is_public boolean not null default false,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (age_min is null or age_min >= 0),
  check (age_max is null or age_max >= 0),
  check (age_min is null or age_max is null or age_max >= age_min)
);

create table if not exists public.junior_group_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.junior_groups(id) on delete cascade,
  session_date date not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  coach_id uuid references public.coaches(id) on delete set null,
  club_id uuid references public.coaching_clubs(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, start_time),
  check (end_time > start_time)
);

create table if not exists public.junior_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.junior_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  profile_player_index integer,
  player_name text not null,
  player_age integer,
  player_level text default '',
  parent_name text default '',
  email text not null,
  mobile text default '',
  notes text default '',
  booking_status text not null default 'pending_payment' check (booking_status in ('draft', 'pending_payment', 'confirmed', 'cancelled', 'expired')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'overdue', 'refunded', 'cancelled')),
  expires_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.junior_group_members
alter column profile_id drop not null;

create table if not exists public.session_plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.junior_groups(id) on delete cascade,
  session_id uuid references public.junior_group_sessions(id) on delete cascade,
  title text not null,
  session_date date,
  warm_up text default '',
  technical_focus text default '',
  drills text default '',
  games text default '',
  notes text default '',
  equipment_needed text default '',
  coach_notes text default '',
  whatsapp_message text default '',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  junior_group_member_id uuid references public.junior_group_members(id) on delete cascade,
  related_type text not null default 'junior_group',
  related_id uuid,
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  currency text not null default 'NZD',
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'overdue', 'refunded', 'cancelled')),
  provider text default 'stripe',
  provider_reference text,
  payment_link_url text,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payments
add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
add column if not exists junior_group_member_id uuid references public.junior_group_members(id) on delete cascade,
add column if not exists related_type text not null default 'junior_group',
add column if not exists related_id uuid,
add column if not exists amount numeric(10, 2) not null default 0,
add column if not exists currency text not null default 'NZD',
add column if not exists payment_status text not null default 'pending',
add column if not exists provider text default 'stripe',
add column if not exists provider_reference text,
add column if not exists payment_link_url text,
add column if not exists paid_at timestamptz,
add column if not exists metadata jsonb not null default '{}'::jsonb,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete cascade,
  junior_group_member_id uuid references public.junior_group_members(id) on delete cascade,
  reminder_type text not null default 'payment_request',
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_id, reminder_type, recipient_email)
);

alter table public.payment_reminders
add column if not exists payment_id uuid references public.payments(id) on delete cascade,
add column if not exists junior_group_member_id uuid references public.junior_group_members(id) on delete cascade,
add column if not exists reminder_type text not null default 'payment_request',
add column if not exists recipient_email text,
add column if not exists status text not null default 'pending',
add column if not exists error_message text,
add column if not exists sent_at timestamptz,
add column if not exists created_at timestamptz not null default now();

create table if not exists public.accounting_links (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete cascade,
  related_type text not null default 'junior_group',
  related_id uuid,
  provider text not null default 'xero',
  external_id text,
  external_url text,
  status text default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounting_links
add column if not exists payment_id uuid references public.payments(id) on delete cascade,
add column if not exists related_type text not null default 'junior_group',
add column if not exists related_id uuid,
add column if not exists provider text not null default 'xero',
add column if not exists external_id text,
add column if not exists external_url text,
add column if not exists status text default '',
add column if not exists metadata jsonb not null default '{}'::jsonb,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

create index if not exists junior_programmes_public_idx on public.junior_programmes(is_active, is_public);
create index if not exists junior_groups_public_idx on public.junior_groups(is_active, is_public, start_date);
create index if not exists junior_groups_programme_idx on public.junior_groups(programme_id);
create index if not exists junior_group_sessions_group_time_idx on public.junior_group_sessions(group_id, start_time);
create index if not exists junior_group_members_group_status_idx on public.junior_group_members(group_id, booking_status, payment_status);
create index if not exists junior_group_members_profile_idx on public.junior_group_members(profile_id);
create index if not exists payments_junior_member_idx on public.payments(junior_group_member_id, payment_status);
create index if not exists payment_reminders_member_idx on public.payment_reminders(junior_group_member_id);

drop trigger if exists set_lesson_types_updated_at on public.lesson_types;
create trigger set_lesson_types_updated_at
before update on public.lesson_types
for each row execute function public.set_updated_at();

drop trigger if exists set_junior_programmes_updated_at on public.junior_programmes;
create trigger set_junior_programmes_updated_at
before update on public.junior_programmes
for each row execute function public.set_updated_at();

drop trigger if exists set_junior_groups_updated_at on public.junior_groups;
create trigger set_junior_groups_updated_at
before update on public.junior_groups
for each row execute function public.set_updated_at();

drop trigger if exists set_junior_group_sessions_updated_at on public.junior_group_sessions;
create trigger set_junior_group_sessions_updated_at
before update on public.junior_group_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_junior_group_members_updated_at on public.junior_group_members;
create trigger set_junior_group_members_updated_at
before update on public.junior_group_members
for each row execute function public.set_updated_at();

drop trigger if exists set_session_plans_updated_at on public.session_plans;
create trigger set_session_plans_updated_at
before update on public.session_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_payments_updated_at on public.payments;
create trigger set_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists set_accounting_links_updated_at on public.accounting_links;
create trigger set_accounting_links_updated_at
before update on public.accounting_links
for each row execute function public.set_updated_at();

create or replace function public.admin_generate_junior_group_sessions(
  p_group_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.junior_groups%rowtype;
  first_session_date date;
  generated_count integer := 0;
  counter integer := 0;
  session_start timestamptz;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can generate junior group sessions.';
  end if;

  select * into target_group
  from public.junior_groups
  where id = p_group_id;

  if not found then
    raise exception 'Junior group was not found.';
  end if;

  first_session_date := target_group.start_date
    + (((target_group.recurring_day - extract(dow from target_group.start_date)::integer) + 7) % 7);

  while counter < target_group.session_count loop
    session_start := ((first_session_date + (counter * 7))::timestamp + target_group.start_time)::timestamptz;

    insert into public.junior_group_sessions (
      group_id,
      session_date,
      start_time,
      end_time,
      coach_id,
      club_id,
      status
    )
    values (
      target_group.id,
      session_start::date,
      session_start,
      session_start + make_interval(mins => target_group.session_duration_minutes),
      target_group.coach_id,
      target_group.club_id,
      'scheduled'
    )
    on conflict (group_id, start_time) do update
    set
      end_time = excluded.end_time,
      coach_id = excluded.coach_id,
      club_id = excluded.club_id,
      status = excluded.status;

    generated_count := generated_count + 1;
    counter := counter + 1;
  end loop;

  return generated_count;
end;
$$;

create or replace function public.get_public_junior_groups()
returns table (
  group_id uuid,
  programme_id uuid,
  lesson_type_id uuid,
  programme_name text,
  group_name text,
  term_name text,
  age_min integer,
  age_max integer,
  level text,
  coach_id uuid,
  coach_name text,
  club_id uuid,
  club_name text,
  club_address text,
  start_date date,
  end_date date,
  recurring_day integer,
  start_time time,
  session_count integer,
  session_duration_minutes integer,
  capacity integer,
  confirmed_count integer,
  pending_count integer,
  spaces_remaining integer,
  price numeric,
  payment_link_url text,
  description text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    junior_groups.id as group_id,
    junior_groups.programme_id,
    junior_groups.lesson_type_id,
    coalesce(junior_programmes.programme_name, junior_groups.group_name) as programme_name,
    junior_groups.group_name,
    junior_groups.term_name,
    junior_groups.age_min,
    junior_groups.age_max,
    junior_groups.level,
    junior_groups.coach_id,
    coaches.display_name as coach_name,
    junior_groups.club_id,
    coaching_clubs.name as club_name,
    coaching_clubs.address as club_address,
    junior_groups.start_date,
    junior_groups.end_date,
    junior_groups.recurring_day,
    junior_groups.start_time,
    junior_groups.session_count,
    junior_groups.session_duration_minutes,
    junior_groups.capacity,
    count(junior_group_members.id) filter (
      where junior_group_members.booking_status = 'confirmed'
        and junior_group_members.payment_status = 'paid'
    )::integer as confirmed_count,
    count(junior_group_members.id) filter (
      where junior_group_members.booking_status = 'pending_payment'
        and junior_group_members.payment_status = 'pending'
        and coalesce(junior_group_members.expires_at, now()) > now()
    )::integer as pending_count,
    greatest(
      0,
      junior_groups.capacity - count(junior_group_members.id) filter (
        where (
          junior_group_members.booking_status = 'confirmed'
          and junior_group_members.payment_status = 'paid'
        )
        or (
          junior_group_members.booking_status = 'pending_payment'
          and junior_group_members.payment_status = 'pending'
          and coalesce(junior_group_members.expires_at, now()) > now()
        )
      )::integer
    ) as spaces_remaining,
    junior_groups.price,
    junior_groups.payment_link_url,
    junior_groups.description
  from public.junior_groups
  left join public.junior_programmes on junior_programmes.id = junior_groups.programme_id
  left join public.coaches on coaches.id = junior_groups.coach_id
  left join public.coaching_clubs on coaching_clubs.id = junior_groups.club_id
  left join public.junior_group_members on junior_group_members.group_id = junior_groups.id
  where junior_groups.is_active = true
    and junior_groups.is_public = true
    and coalesce(junior_programmes.is_active, true) = true
    and coalesce(coaches.is_active, true) = true
    and coalesce(coaching_clubs.is_active, true) = true
  group by
    junior_groups.id,
    junior_programmes.programme_name,
    coaches.display_name,
    coaching_clubs.name,
    coaching_clubs.address
  order by junior_groups.start_date asc, junior_groups.start_time asc;
$$;

create or replace function public.get_my_junior_group_sessions()
returns table (
  member_id uuid,
  group_id uuid,
  session_id uuid,
  programme_name text,
  group_name text,
  player_name text,
  coach_name text,
  club_name text,
  club_address text,
  start_time timestamptz,
  end_time timestamptz,
  session_status text,
  plan_title text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    junior_group_members.id as member_id,
    junior_groups.id as group_id,
    junior_group_sessions.id as session_id,
    coalesce(junior_programmes.programme_name, junior_groups.group_name) as programme_name,
    junior_groups.group_name,
    junior_group_members.player_name,
    coaches.display_name as coach_name,
    coaching_clubs.name as club_name,
    coaching_clubs.address as club_address,
    junior_group_sessions.start_time,
    junior_group_sessions.end_time,
    junior_group_sessions.status as session_status,
    session_plans.title as plan_title
  from public.junior_group_members
  join public.junior_groups on junior_groups.id = junior_group_members.group_id
  left join public.junior_programmes on junior_programmes.id = junior_groups.programme_id
  join public.junior_group_sessions on junior_group_sessions.group_id = junior_groups.id
  left join public.coaches on coaches.id = coalesce(junior_group_sessions.coach_id, junior_groups.coach_id)
  left join public.coaching_clubs on coaching_clubs.id = coalesce(junior_group_sessions.club_id, junior_groups.club_id)
  left join public.session_plans on session_plans.session_id = junior_group_sessions.id
  where junior_group_members.profile_id = auth.uid()
    and junior_group_members.booking_status = 'confirmed'
    and junior_group_members.payment_status = 'paid'
    and junior_group_sessions.status <> 'cancelled'
  order by junior_group_sessions.start_time asc;
$$;

create or replace function public.create_junior_group_pending_booking(
  p_group_id uuid,
  p_player_name text,
  p_player_age integer,
  p_player_level text,
  p_parent_name text,
  p_email text,
  p_mobile text,
  p_notes text default '',
  p_profile_player_index integer default null
)
returns table (
  member_id uuid,
  payment_id uuid,
  booking_status text,
  payment_status text,
  payment_link_url text,
  amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.junior_groups%rowtype;
  held_count integer := 0;
  required_level_rank integer := 0;
  player_level_rank integer := 0;
  created_member_id uuid;
  created_payment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please log in before booking junior group coaching.';
  end if;

  select * into target_group
  from public.junior_groups
  where id = p_group_id
    and is_active = true
    and is_public = true
  for update;

  if not found then
    raise exception 'This junior group is not currently available for booking.';
  end if;

  if target_group.age_min is not null and (p_player_age is null or p_player_age < target_group.age_min) then
    raise exception 'This programme requires players to be at least % years old.', target_group.age_min;
  end if;

  if target_group.age_max is not null and (p_player_age is null or p_player_age > target_group.age_max) then
    raise exception 'This programme is for players aged % or under.', target_group.age_max;
  end if;

  if coalesce(target_group.level, '') <> '' then
    required_level_rank := case lower(target_group.level)
      when 'beginner' then 1
      when 'developing' then 2
      when 'interclub' then 3
      when 'tournament' then 4
      else 0
    end;
    player_level_rank := case lower(coalesce(p_player_level, ''))
      when 'beginner' then 1
      when 'developing' then 2
      when 'interclub' then 3
      when 'tournament' then 4
      else 0
    end;
    if player_level_rank = 0 then
      raise exception 'Select a player level before booking this programme.';
    end if;
    if required_level_rank > 0 and player_level_rank < required_level_rank then
      raise exception 'This programme requires a minimum level of %.', target_group.level;
    end if;
  end if;

  select count(*) into held_count
  from public.junior_group_members
  where group_id = target_group.id
    and (
      (booking_status = 'confirmed' and payment_status = 'paid')
      or (
        booking_status = 'pending_payment'
        and payment_status = 'pending'
        and coalesce(expires_at, now()) > now()
      )
    );

  if held_count >= target_group.capacity then
    raise exception 'This junior group is full.';
  end if;

  insert into public.junior_group_members (
    group_id,
    profile_id,
    profile_player_index,
    player_name,
    player_age,
    player_level,
    parent_name,
    email,
    mobile,
    notes,
    booking_status,
    payment_status,
    expires_at
  )
  values (
    target_group.id,
    auth.uid(),
    p_profile_player_index,
    nullif(trim(p_player_name), ''),
    p_player_age,
    coalesce(p_player_level, ''),
    coalesce(p_parent_name, ''),
    nullif(trim(p_email), ''),
    coalesce(p_mobile, ''),
    coalesce(p_notes, ''),
    'pending_payment',
    'pending',
    now() + interval '30 minutes'
  )
  returning id into created_member_id;

  insert into public.payments (
    profile_id,
    junior_group_member_id,
    related_type,
    related_id,
    amount,
    payment_status,
    provider,
    payment_link_url
  )
  values (
    auth.uid(),
    created_member_id,
    'junior_group',
    target_group.id,
    target_group.price,
    'pending',
    'stripe',
    target_group.payment_link_url
  )
  returning id into created_payment_id;

  return query
  select
    created_member_id,
    created_payment_id,
    'pending_payment'::text,
    'pending'::text,
    target_group.payment_link_url,
    target_group.price;
end;
$$;

create or replace function public.admin_add_junior_group_member(
  p_group_id uuid,
  p_player_name text,
  p_player_age integer default null,
  p_player_level text default '',
  p_parent_name text default '',
  p_email text default '',
  p_mobile text default '',
  p_notes text default '',
  p_mark_paid boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.junior_groups%rowtype;
  held_count integer := 0;
  created_member_id uuid;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can add junior group members.';
  end if;

  select * into target_group
  from public.junior_groups
  where id = p_group_id
  for update;

  if not found then
    raise exception 'Junior group was not found.';
  end if;

  select count(*) into held_count
  from public.junior_group_members
  where group_id = target_group.id
    and (
      (booking_status = 'confirmed' and payment_status = 'paid')
      or (
        booking_status = 'pending_payment'
        and payment_status = 'pending'
        and coalesce(expires_at, now()) > now()
      )
    );

  if held_count >= target_group.capacity then
    raise exception 'This junior group is full.';
  end if;

  insert into public.junior_group_members (
    group_id,
    profile_id,
    player_name,
    player_age,
    player_level,
    parent_name,
    email,
    mobile,
    notes,
    booking_status,
    payment_status,
    confirmed_at,
    expires_at
  )
  values (
    target_group.id,
    null,
    nullif(trim(p_player_name), ''),
    p_player_age,
    coalesce(p_player_level, ''),
    coalesce(p_parent_name, ''),
    nullif(trim(p_email), ''),
    coalesce(p_mobile, ''),
    coalesce(p_notes, ''),
    case when p_mark_paid then 'confirmed' else 'pending_payment' end,
    case when p_mark_paid then 'paid' else 'pending' end,
    case when p_mark_paid then now() else null end,
    case when p_mark_paid then null else now() + interval '30 minutes' end
  )
  returning id into created_member_id;

  insert into public.payments (
    junior_group_member_id,
    related_type,
    related_id,
    amount,
    payment_status,
    provider,
    payment_link_url,
    paid_at
  )
  values (
    created_member_id,
    'junior_group',
    target_group.id,
    target_group.price,
    case when p_mark_paid then 'paid' else 'pending' end,
    'stripe',
    target_group.payment_link_url,
    case when p_mark_paid then now() else null end
  );

  return created_member_id;
end;
$$;

create or replace function public.admin_mark_junior_group_paid(
  p_member_id uuid,
  p_payment_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_member public.junior_group_members%rowtype;
  target_group public.junior_groups%rowtype;
  confirmed_count integer := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can mark junior group payments as paid.';
  end if;

  select * into target_member
  from public.junior_group_members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'Junior group member was not found.';
  end if;

  select * into target_group
  from public.junior_groups
  where id = target_member.group_id
  for update;

  select count(*) into confirmed_count
  from public.junior_group_members
  where group_id = target_member.group_id
    and id <> target_member.id
    and booking_status = 'confirmed'
    and payment_status = 'paid';

  if confirmed_count >= target_group.capacity then
    raise exception 'This junior group is full.';
  end if;

  update public.junior_group_members
  set booking_status = 'confirmed',
      payment_status = 'paid',
      confirmed_at = coalesce(confirmed_at, now()),
      expires_at = null
  where id = target_member.id;

  update public.payments
  set payment_status = 'paid',
      provider_reference = coalesce(nullif(p_payment_reference, ''), provider_reference),
      paid_at = coalesce(paid_at, now())
  where junior_group_member_id = target_member.id
    and payment_status <> 'paid';
end;
$$;

create or replace function public.admin_move_junior_group_member(
  p_member_id uuid,
  p_target_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  moving_member public.junior_group_members%rowtype;
  target_group public.junior_groups%rowtype;
  held_count integer := 0;
  required_level_rank integer := 0;
  player_level_rank integer := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can move junior group members.';
  end if;

  select * into target_group
  from public.junior_groups
  where id = p_target_group_id
  for update;

  if not found then
    raise exception 'Target junior group was not found.';
  end if;

  select * into moving_member
  from public.junior_group_members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'Junior group member was not found.';
  end if;

  if target_group.age_min is not null and (moving_member.player_age is null or moving_member.player_age < target_group.age_min) then
    raise exception 'Target group requires players to be at least % years old.', target_group.age_min;
  end if;

  if target_group.age_max is not null and (moving_member.player_age is null or moving_member.player_age > target_group.age_max) then
    raise exception 'Target group is for players aged % or under.', target_group.age_max;
  end if;

  if coalesce(target_group.level, '') <> '' then
    required_level_rank := case lower(target_group.level)
      when 'beginner' then 1
      when 'developing' then 2
      when 'interclub' then 3
      when 'tournament' then 4
      else 0
    end;
    player_level_rank := case lower(coalesce(moving_member.player_level, ''))
      when 'beginner' then 1
      when 'developing' then 2
      when 'interclub' then 3
      when 'tournament' then 4
      else 0
    end;
    if player_level_rank = 0 then
      raise exception 'Target group requires a player level.';
    end if;
    if required_level_rank > 0 and player_level_rank < required_level_rank then
      raise exception 'Target group requires a minimum level of %.', target_group.level;
    end if;
  end if;

  select count(*) into held_count
  from public.junior_group_members
  where group_id = p_target_group_id
    and id <> p_member_id
    and (
      (booking_status = 'confirmed' and payment_status = 'paid')
      or (
        booking_status = 'pending_payment'
        and payment_status = 'pending'
        and coalesce(expires_at, now()) > now()
      )
    );

  if held_count >= target_group.capacity then
    raise exception 'Target junior group is full.';
  end if;

  update public.junior_group_members
  set group_id = p_target_group_id
  where id = p_member_id;
end;
$$;

alter table public.junior_programmes enable row level security;
alter table public.junior_groups enable row level security;
alter table public.junior_group_sessions enable row level security;
alter table public.junior_group_members enable row level security;
alter table public.session_plans enable row level security;
alter table public.payments enable row level security;
alter table public.payment_reminders enable row level security;
alter table public.accounting_links enable row level security;

drop policy if exists "Public can read published junior programmes" on public.junior_programmes;
create policy "Public can read published junior programmes"
on public.junior_programmes for select
to anon, authenticated
using ((is_active = true and is_public = true) or public.current_user_is_admin());

drop policy if exists "Admins can manage junior programmes" on public.junior_programmes;
create policy "Admins can manage junior programmes"
on public.junior_programmes for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Public can read published junior groups" on public.junior_groups;
create policy "Public can read published junior groups"
on public.junior_groups for select
to anon, authenticated
using ((is_active = true and is_public = true) or public.current_user_is_admin());

drop policy if exists "Admins can manage junior groups" on public.junior_groups;
create policy "Admins can manage junior groups"
on public.junior_groups for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Public can read published junior sessions" on public.junior_group_sessions;
create policy "Public can read published junior sessions"
on public.junior_group_sessions for select
to anon, authenticated
using (
  exists (
    select 1 from public.junior_groups
    where junior_groups.id = junior_group_sessions.group_id
      and junior_groups.is_active = true
      and junior_groups.is_public = true
  )
  or public.current_user_is_admin()
  or exists (
    select 1 from public.junior_group_members
    where junior_group_members.group_id = junior_group_sessions.group_id
      and junior_group_members.profile_id = auth.uid()
      and junior_group_members.booking_status = 'confirmed'
      and junior_group_members.payment_status = 'paid'
  )
);

drop policy if exists "Admins can manage junior sessions" on public.junior_group_sessions;
create policy "Admins can manage junior sessions"
on public.junior_group_sessions for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Users can read own junior members" on public.junior_group_members;
create policy "Users can read own junior members"
on public.junior_group_members for select
to authenticated
using (profile_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Users can create own junior pending member" on public.junior_group_members;
create policy "Users can create own junior pending member"
on public.junior_group_members for insert
to authenticated
with check (profile_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Admins can manage junior members" on public.junior_group_members;
create policy "Admins can manage junior members"
on public.junior_group_members for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Users can read own junior payments" on public.payments;
create policy "Users can read own junior payments"
on public.payments for select
to authenticated
using (profile_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Admins can manage junior payments" on public.payments;
create policy "Admins can manage junior payments"
on public.payments for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage payment reminders" on public.payment_reminders;
create policy "Admins can manage payment reminders"
on public.payment_reminders for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Users can read own session plans" on public.session_plans;
create policy "Users can read own session plans"
on public.session_plans for select
to authenticated
using (
  public.current_user_is_admin()
  or exists (
    select 1
    from public.junior_group_members
    where junior_group_members.group_id = session_plans.group_id
      and junior_group_members.profile_id = auth.uid()
      and junior_group_members.booking_status = 'confirmed'
      and junior_group_members.payment_status = 'paid'
  )
);

drop policy if exists "Admins can manage session plans" on public.session_plans;
create policy "Admins can manage session plans"
on public.session_plans for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage accounting links" on public.accounting_links;
create policy "Admins can manage accounting links"
on public.accounting_links for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant execute on function public.current_user_is_admin() to authenticated, service_role;
grant execute on function public.admin_generate_junior_group_sessions(uuid) to authenticated, service_role;
grant execute on function public.get_public_junior_groups() to anon, authenticated;
grant execute on function public.get_my_junior_group_sessions() to authenticated;
grant execute on function public.create_junior_group_pending_booking(uuid, text, integer, text, text, text, text, text, integer) to authenticated;
grant execute on function public.admin_add_junior_group_member(uuid, text, integer, text, text, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.admin_mark_junior_group_paid(uuid, text) to authenticated, service_role;
grant execute on function public.admin_move_junior_group_member(uuid, uuid) to authenticated, service_role;

grant select on public.junior_programmes, public.junior_groups, public.junior_group_sessions to anon, authenticated;
grant select, insert, update, delete on public.junior_programmes, public.junior_groups, public.junior_group_sessions, public.junior_group_members, public.session_plans, public.payments, public.payment_reminders, public.accounting_links to authenticated;

notify pgrst, 'reload schema';
