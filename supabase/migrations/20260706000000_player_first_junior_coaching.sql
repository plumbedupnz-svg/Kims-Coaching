-- Player-first Junior Coaching workflow
-- Safe to run more than once.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
    where id = auth.uid()
      and role = 'admin'
  );
$$;

alter table public.profiles
add column if not exists phone text,
add column if not exists parent_name text,
add column if not exists player_name text,
add column if not exists player_age integer,
add column if not exists tennis_level text,
add column if not exists notes text,
add column if not exists players jsonb not null default '[]'::jsonb;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  profile_player_index integer,
  player_name text not null default '',
  date_of_birth date,
  age integer check (age is null or age between 0 and 120),
  parent_name text default '',
  parent_email text default '',
  parent_phone text default '',
  customer_selected_level text default '',
  admin_confirmed_level text default '',
  notes text default '',
  admin_notes text default '',
  junior_programme_id uuid references public.junior_programmes(id) on delete set null,
  junior_group_id uuid references public.junior_groups(id) on delete set null,
  junior_group_member_id uuid references public.junior_group_members(id) on delete set null,
  placement_status text not null default 'awaiting_placement'
    check (placement_status in ('awaiting_placement', 'placement_confirmed', 'payment_pending', 'paid', 'active_in_group', 'cancelled', 'inactive')),
  payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending', 'paid', 'failed', 'overdue', 'refunded', 'cancelled')),
  invoice_url text default '',
  stripe_session_id text,
  stripe_payment_intent_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists players_profile_index_unique
on public.players(profile_id, profile_player_index)
where profile_player_index is not null;

create index if not exists players_profile_idx on public.players(profile_id);
create index if not exists players_junior_group_idx on public.players(junior_group_id);
create index if not exists players_junior_programme_idx on public.players(junior_programme_id);
create index if not exists players_status_idx on public.players(placement_status, payment_status);
create index if not exists players_active_idx on public.players(is_active);

drop trigger if exists set_players_updated_at on public.players;
create trigger set_players_updated_at
before update on public.players
for each row execute function public.set_updated_at();

alter table public.junior_group_members
add column if not exists player_id uuid references public.players(id) on delete set null,
add column if not exists programme_id uuid references public.junior_programmes(id) on delete set null,
add column if not exists admin_confirmed_level text default '',
add column if not exists admin_notes text default '',
add column if not exists invoice_url text default '',
add column if not exists stripe_session_id text,
add column if not exists payment_intent_id text,
add column if not exists placement_status text not null default 'awaiting_placement';

alter table public.payments
add column if not exists player_id uuid references public.players(id) on delete set null,
add column if not exists stripe_session_id text,
add column if not exists payment_intent_id text,
add column if not exists invoice_url text default '';

create index if not exists junior_group_members_player_idx on public.junior_group_members(player_id);
create index if not exists junior_group_members_programme_idx on public.junior_group_members(programme_id);
create index if not exists payments_player_idx on public.payments(player_id);

insert into public.players (
  profile_id,
  profile_player_index,
  player_name,
  date_of_birth,
  age,
  parent_name,
  parent_email,
  parent_phone,
  customer_selected_level,
  notes,
  is_active
)
select
  profiles.id,
  (player_data.ordinality - 1)::integer,
  coalesce(player_data.player ->> 'name', ''),
  case
    when coalesce(player_data.player ->> 'dob', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (player_data.player ->> 'dob')::date
    else null
  end,
  case
    when coalesce(player_data.player ->> 'age', '') ~ '^\d+$'
      then (player_data.player ->> 'age')::integer
    else null
  end,
  coalesce(player_data.player ->> 'parent_name', profiles.parent_name, ''),
  coalesce(player_data.player ->> 'parent_email', profiles.email, ''),
  coalesce(player_data.player ->> 'parent_phone', profiles.phone, ''),
  coalesce(player_data.player ->> 'level', player_data.player ->> 'tennis_level', ''),
  coalesce(player_data.player ->> 'notes', ''),
  true
from public.profiles
cross join lateral jsonb_array_elements(coalesce(profiles.players, '[]'::jsonb)) with ordinality as player_data(player, ordinality)
where coalesce(player_data.player ->> 'name', '') <> ''
on conflict (profile_id, profile_player_index) where profile_player_index is not null
do update set
  player_name = excluded.player_name,
  date_of_birth = coalesce(excluded.date_of_birth, public.players.date_of_birth),
  age = coalesce(excluded.age, public.players.age),
  parent_name = coalesce(nullif(excluded.parent_name, ''), public.players.parent_name),
  parent_email = coalesce(nullif(excluded.parent_email, ''), public.players.parent_email),
  parent_phone = coalesce(nullif(excluded.parent_phone, ''), public.players.parent_phone),
  customer_selected_level = coalesce(nullif(excluded.customer_selected_level, ''), public.players.customer_selected_level),
  notes = coalesce(nullif(excluded.notes, ''), public.players.notes),
  is_active = true,
  updated_at = now();

insert into public.players (
  profile_id,
  profile_player_index,
  player_name,
  age,
  parent_name,
  parent_email,
  parent_phone,
  customer_selected_level,
  notes,
  is_active
)
select
  profiles.id,
  0,
  profiles.player_name,
  profiles.player_age,
  profiles.parent_name,
  profiles.email,
  profiles.phone,
  profiles.tennis_level,
  profiles.notes,
  true
from public.profiles
where coalesce(profiles.player_name, '') <> ''
  and not exists (
    select 1 from public.players
    where players.profile_id = profiles.id
  )
on conflict (profile_id, profile_player_index) where profile_player_index is not null
do nothing;

create or replace function public.upsert_profile_players(p_players jsonb)
returns setof public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  player_item jsonb;
  player_index integer := 0;
  existing_id uuid;
  player_dob date;
  player_age integer;
  saved_ids uuid[] := '{}';
  parent_email text;
  parent_phone text;
  profile_parent_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to save players.';
  end if;

  select email, phone, parent_name
  into parent_email, parent_phone, profile_parent_name
  from public.profiles
  where id = auth.uid();

  for player_item in select value from jsonb_array_elements(coalesce(p_players, '[]'::jsonb))
  loop
    if coalesce(player_item ->> 'name', '') <> '' then
      player_dob := null;
      player_age := null;

      if coalesce(player_item ->> 'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then
        player_dob := (player_item ->> 'dob')::date;
      end if;

      if coalesce(player_item ->> 'age', '') ~ '^\d+$' then
        player_age := (player_item ->> 'age')::integer;
      end if;

      select id into existing_id
      from public.players
      where profile_id = auth.uid()
        and profile_player_index = player_index
      limit 1;

      if existing_id is null then
        insert into public.players (
          profile_id,
          profile_player_index,
          player_name,
          date_of_birth,
          age,
          parent_name,
          parent_email,
          parent_phone,
          customer_selected_level,
          notes,
          is_active
        )
        values (
          auth.uid(),
          player_index,
          coalesce(player_item ->> 'name', ''),
          player_dob,
          player_age,
          coalesce(player_item ->> 'parent_name', profile_parent_name, ''),
          coalesce(player_item ->> 'parent_email', parent_email, ''),
          coalesce(player_item ->> 'parent_phone', parent_phone, ''),
          coalesce(player_item ->> 'level', player_item ->> 'tennis_level', ''),
          coalesce(player_item ->> 'notes', ''),
          true
        )
        returning id into existing_id;
      else
        update public.players
        set
          player_name = coalesce(player_item ->> 'name', ''),
          date_of_birth = player_dob,
          age = player_age,
          parent_name = coalesce(player_item ->> 'parent_name', profile_parent_name, ''),
          parent_email = coalesce(player_item ->> 'parent_email', parent_email, ''),
          parent_phone = coalesce(player_item ->> 'parent_phone', parent_phone, ''),
          customer_selected_level = coalesce(player_item ->> 'level', player_item ->> 'tennis_level', ''),
          notes = coalesce(player_item ->> 'notes', ''),
          is_active = true,
          updated_at = now()
        where id = existing_id;
      end if;

      saved_ids := array_append(saved_ids, existing_id);
    end if;

    player_index := player_index + 1;
  end loop;

  update public.players
  set is_active = false,
      placement_status = case when placement_status = 'awaiting_placement' then 'inactive' else placement_status end,
      updated_at = now()
  where profile_id = auth.uid()
    and profile_player_index is not null
    and not (id = any(saved_ids));

  return query
  select *
  from public.players
  where profile_id = auth.uid()
  order by profile_player_index nulls last, created_at asc;
end;
$$;

create or replace function public.admin_update_junior_player(
  p_player_id uuid,
  p_admin_confirmed_level text default null,
  p_admin_notes text default null,
  p_placement_status text default null,
  p_payment_status text default null
)
returns public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_player public.players%rowtype;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can update junior players.';
  end if;

  update public.players
  set
    admin_confirmed_level = coalesce(p_admin_confirmed_level, admin_confirmed_level),
    admin_notes = coalesce(p_admin_notes, admin_notes),
    placement_status = coalesce(p_placement_status, placement_status),
    payment_status = coalesce(p_payment_status, payment_status),
    updated_at = now()
  where id = p_player_id
  returning * into updated_player;

  if updated_player.id is null then
    raise exception 'Junior player was not found.';
  end if;

  return updated_player;
end;
$$;

create or replace function public.admin_confirm_junior_player_placement(
  p_player_id uuid,
  p_programme_id uuid default null,
  p_group_id uuid default null,
  p_admin_confirmed_level text default null,
  p_admin_notes text default null
)
returns table (
  player_id uuid,
  member_id uuid,
  payment_id uuid,
  amount numeric,
  parent_email text,
  payment_status text,
  placement_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_player public.players%rowtype;
  target_group public.junior_groups%rowtype;
  target_member public.junior_group_members%rowtype;
  target_payment public.payments%rowtype;
  next_programme_id uuid;
  amount_due numeric := 0;
  next_booking_status text;
  next_payment_status text;
  next_placement_status text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admin users can confirm junior placements.';
  end if;

  select *
  into target_player
  from public.players
  where id = p_player_id;

  if target_player.id is null then
    raise exception 'Junior player was not found.';
  end if;

  if p_group_id is null then
    raise exception 'Choose a junior group before confirming placement.';
  end if;

  select *
  into target_group
  from public.junior_groups
  where id = p_group_id;

  if target_group.id is null then
    raise exception 'Junior group was not found.';
  end if;

  next_programme_id := coalesce(p_programme_id, target_group.programme_id, target_player.junior_programme_id);
  amount_due := coalesce(target_group.price, 0);
  next_booking_status := case when amount_due > 0 then 'pending_payment' else 'confirmed' end;
  next_payment_status := case when amount_due > 0 then 'pending' else 'paid' end;
  next_placement_status := case when amount_due > 0 then 'payment_pending' else 'active_in_group' end;

  select *
  into target_member
  from public.junior_group_members
  where player_id = target_player.id
  order by created_at desc
  limit 1;

  if target_member.id is null then
    insert into public.junior_group_members (
      group_id,
      profile_id,
      profile_player_index,
      player_id,
      programme_id,
      player_name,
      player_age,
      player_level,
      admin_confirmed_level,
      parent_name,
      email,
      mobile,
      notes,
      admin_notes,
      booking_status,
      payment_status,
      placement_status,
      expires_at,
      confirmed_at
    )
    values (
      target_group.id,
      target_player.profile_id,
      target_player.profile_player_index,
      target_player.id,
      next_programme_id,
      target_player.player_name,
      target_player.age,
      coalesce(nullif(p_admin_confirmed_level, ''), target_player.admin_confirmed_level, target_player.customer_selected_level, ''),
      coalesce(p_admin_confirmed_level, target_player.admin_confirmed_level, ''),
      target_player.parent_name,
      target_player.parent_email,
      target_player.parent_phone,
      target_player.notes,
      coalesce(p_admin_notes, target_player.admin_notes, ''),
      next_booking_status,
      next_payment_status,
      next_placement_status,
      case when amount_due > 0 then now() + interval '7 days' else null end,
      case when amount_due > 0 then null else now() end
    )
    returning * into target_member;
  else
    update public.junior_group_members
    set
      group_id = target_group.id,
      programme_id = next_programme_id,
      profile_id = target_player.profile_id,
      profile_player_index = target_player.profile_player_index,
      player_name = target_player.player_name,
      player_age = target_player.age,
      player_level = coalesce(nullif(p_admin_confirmed_level, ''), target_player.admin_confirmed_level, target_player.customer_selected_level, ''),
      admin_confirmed_level = coalesce(p_admin_confirmed_level, target_player.admin_confirmed_level, ''),
      parent_name = target_player.parent_name,
      email = target_player.parent_email,
      mobile = target_player.parent_phone,
      notes = target_player.notes,
      admin_notes = coalesce(p_admin_notes, target_player.admin_notes, ''),
      booking_status = next_booking_status,
      payment_status = next_payment_status,
      placement_status = next_placement_status,
      expires_at = case when amount_due > 0 then now() + interval '7 days' else null end,
      confirmed_at = case when amount_due > 0 then null else now() end,
      updated_at = now()
    where id = target_member.id
    returning * into target_member;
  end if;

  if amount_due > 0 then
    select *
    into target_payment
    from public.payments
    where junior_group_member_id = target_member.id
    order by created_at desc
    limit 1;

    if target_payment.id is null then
      insert into public.payments (
        profile_id,
        junior_group_member_id,
        player_id,
        related_type,
        related_id,
        amount,
        currency,
        payment_status,
        provider,
        metadata
      )
      values (
        target_player.profile_id,
        target_member.id,
        target_player.id,
        'junior_group',
        target_group.id,
        amount_due,
        'NZD',
        'pending',
        'stripe',
        jsonb_build_object(
          'player_name', target_player.player_name,
          'programme_id', next_programme_id,
          'group_id', target_group.id
        )
      )
      returning * into target_payment;
    else
      update public.payments
      set
        profile_id = target_player.profile_id,
        player_id = target_player.id,
        related_id = target_group.id,
        amount = amount_due,
        currency = 'NZD',
        payment_status = 'pending',
        provider = 'stripe',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'player_name', target_player.player_name,
          'programme_id', next_programme_id,
          'group_id', target_group.id
        ),
        updated_at = now()
      where id = target_payment.id
      returning * into target_payment;
    end if;
  end if;

  update public.players
  set
    admin_confirmed_level = coalesce(p_admin_confirmed_level, admin_confirmed_level, ''),
    admin_notes = coalesce(p_admin_notes, admin_notes, ''),
    junior_programme_id = next_programme_id,
    junior_group_id = target_group.id,
    junior_group_member_id = target_member.id,
    placement_status = next_placement_status,
    payment_status = case when amount_due > 0 then 'pending' else 'paid' end,
    updated_at = now()
  where id = target_player.id;

  return query
  select
    target_player.id,
    target_member.id,
    target_payment.id,
    amount_due,
    target_player.parent_email,
    case when amount_due > 0 then 'pending' else 'paid' end,
    next_placement_status;
end;
$$;

alter table public.players enable row level security;

drop policy if exists "Users can read own players" on public.players;
create policy "Users can read own players"
on public.players for select
using (profile_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Users can create own players" on public.players;
create policy "Users can create own players"
on public.players for insert
with check (profile_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Users can update own players" on public.players;
create policy "Users can update own players"
on public.players for update
using (profile_id = auth.uid() or public.current_user_is_admin())
with check (profile_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Admins can delete players" on public.players;
create policy "Admins can delete players"
on public.players for delete
using (public.current_user_is_admin());

grant select, insert, update, delete on public.players to authenticated;
grant execute on function public.current_user_is_admin() to authenticated, service_role;
grant execute on function public.upsert_profile_players(jsonb) to authenticated, service_role;
grant execute on function public.admin_update_junior_player(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.admin_confirm_junior_player_placement(uuid, uuid, uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
