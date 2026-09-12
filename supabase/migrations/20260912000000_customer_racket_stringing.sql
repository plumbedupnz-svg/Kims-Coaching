-- Customer racket records, appendable stringing history and opt-in reminders.
begin;

create table public.customer_rackets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  player_name text not null check (length(btrim(player_name)) between 1 and 120),
  racket_type text not null check (length(btrim(racket_type)) between 1 and 160),
  notes text not null default '' check (length(notes) <= 2000),
  reminder_enabled boolean not null default false,
  reminder_interval integer not null default 3 check (reminder_interval between 1 and 104),
  reminder_unit text not null default 'months' check (reminder_unit in ('weeks', 'months')),
  reminder_consent_at timestamptz,
  reminder_consent_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not reminder_enabled or reminder_consent_at is not null)
);
create index customer_rackets_customer_idx on public.customer_rackets(customer_id);
create trigger customer_rackets_updated before update on public.customer_rackets
for each row execute function public.set_updated_at();

create table public.racket_stringings (
  id uuid primary key default gen_random_uuid(),
  racket_id uuid not null references public.customer_rackets(id) on delete cascade,
  strung_on date not null,
  strings_main text not null check (length(btrim(strings_main)) between 1 and 160),
  strings_cross text not null default '' check (length(strings_cross) <= 160),
  tension_main numeric(5,2) not null check (tension_main > 0 and tension_main <= 100),
  tension_cross numeric(5,2) check (tension_cross > 0 and tension_cross <= 100),
  tension_unit text not null default 'lb' check (tension_unit in ('lb', 'kg')),
  notes text not null default '' check (length(notes) <= 2000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index racket_stringings_latest_idx on public.racket_stringings(racket_id, strung_on desc, created_at desc, id desc);
create trigger racket_stringings_updated before update on public.racket_stringings
for each row execute function public.set_updated_at();

create table public.racket_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  racket_id uuid not null references public.customer_rackets(id) on delete cascade,
  stringing_id uuid not null references public.racket_stringings(id) on delete cascade,
  due_on date not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'needs_review', 'cancelled')),
  email_payload jsonb,
  first_attempt_at timestamptz,
  locked_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  provider_id text,
  error_message text,
  unique (racket_id, stringing_id)
);

alter table public.customer_rackets enable row level security;
alter table public.racket_stringings enable row level security;
alter table public.racket_reminder_deliveries enable row level security;
create policy "Admin racket read" on public.customer_rackets for select to authenticated using (public.current_user_is_admin());
create policy "Admin stringing read" on public.racket_stringings for select to authenticated using (public.current_user_is_admin());
create policy "Admin reminder read" on public.racket_reminder_deliveries for select to authenticated using (public.current_user_is_admin());
revoke all on public.customer_rackets, public.racket_stringings, public.racket_reminder_deliveries from anon, authenticated;
grant select on public.customer_rackets, public.racket_stringings to authenticated;
grant select (id, racket_id, stringing_id, due_on, status, sent_at, error_message) on public.racket_reminder_deliveries to authenticated;
grant all on public.customer_rackets, public.racket_stringings, public.racket_reminder_deliveries to service_role;

-- Calendar months clamp to the last day of the destination month; dates use NZ time.
create function public.racket_restring_due(p_date date, p_interval integer, p_unit text)
returns date language sql immutable strict set search_path = public as $$
  select (p_date + case when p_unit = 'weeks' then make_interval(days => p_interval * 7)
    else make_interval(months => p_interval) end)::date;
$$;

-- One transaction saves the racket, consent and optional stringing record.
-- Direct client writes are disallowed so consent timestamps cannot be fabricated.
create function public.admin_save_racket(p_racket jsonb, p_stringing jsonb default null, p_expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p_racket->>'id')::uuid;
  v_old public.customer_rackets;
  v_enabled boolean := coalesce((p_racket->>'reminder_enabled')::boolean, false);
  v_stringing_id uuid;
begin
  if not public.current_user_is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  select * into v_old from public.customer_rackets where id = v_id for update;
  if found then
    if v_old.customer_id <> (p_racket->>'customer_id')::uuid then raise exception 'Customer cannot be changed'; end if;
    if p_expected_updated_at is null or v_old.updated_at <> p_expected_updated_at then
      raise exception 'This racket was changed by someone else. Reload it before saving.';
    end if;
  elsif p_expected_updated_at is not null then
    raise exception 'Racket no longer exists';
  end if;
  if v_enabled and not exists (select 1 from public.profiles where id = (p_racket->>'customer_id')::uuid and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'A customer email address is required for reminders';
  end if;
  insert into public.customer_rackets (id, customer_id, player_name, racket_type, notes, reminder_enabled, reminder_interval, reminder_unit, reminder_consent_at, reminder_consent_by)
  values (v_id, (p_racket->>'customer_id')::uuid, btrim(p_racket->>'player_name'), btrim(p_racket->>'racket_type'), coalesce(p_racket->>'notes', ''), v_enabled,
    (p_racket->>'reminder_interval')::integer, p_racket->>'reminder_unit',
    case when v_enabled then coalesce(v_old.reminder_consent_at, now()) end,
    case when v_enabled then coalesce(v_old.reminder_consent_by, auth.uid()) end)
  on conflict (id) do update set player_name = excluded.player_name, racket_type = excluded.racket_type,
    notes = excluded.notes, reminder_enabled = excluded.reminder_enabled, reminder_interval = excluded.reminder_interval,
    reminder_unit = excluded.reminder_unit, reminder_consent_at = excluded.reminder_consent_at, reminder_consent_by = excluded.reminder_consent_by;

  if p_stringing is not null and p_stringing <> 'null'::jsonb then
    if (p_stringing->>'strung_on')::date > (now() at time zone 'Pacific/Auckland')::date then
      raise exception 'The last strung date cannot be in the future';
    end if;
    v_stringing_id := (p_stringing->>'id')::uuid;
    if exists (select 1 from public.racket_stringings where id = v_stringing_id and racket_id <> v_id) then
      raise exception 'Stringing record belongs to another racket';
    end if;
    insert into public.racket_stringings (id, racket_id, strung_on, strings_main, strings_cross, tension_main, tension_cross, tension_unit, notes, created_by)
    values (v_stringing_id, v_id, (p_stringing->>'strung_on')::date, btrim(p_stringing->>'strings_main'), coalesce(btrim(p_stringing->>'strings_cross'), ''),
      (p_stringing->>'tension_main')::numeric, nullif(p_stringing->>'tension_cross', '')::numeric, p_stringing->>'tension_unit', coalesce(p_stringing->>'notes', ''), auth.uid())
    on conflict (id) do update set strung_on = excluded.strung_on, strings_main = excluded.strings_main, strings_cross = excluded.strings_cross,
      tension_main = excluded.tension_main, tension_cross = excluded.tension_cross, tension_unit = excluded.tension_unit, notes = excluded.notes;
  end if;
  return v_id;
end;
$$;
revoke all on function public.admin_save_racket(jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.admin_save_racket(jsonb, jsonb, timestamptz) to authenticated;

-- Only the latest stringing per racket is eligible; backfilled history never moves the clock backwards.
create view public.racket_reminders_due as
select r.id as racket_id, s.id as stringing_id, r.player_name, r.racket_type,
  s.strung_on, s.strings_main, s.strings_cross, s.tension_main, s.tension_cross, s.tension_unit,
  p.email, p.first_name,
  public.racket_restring_due(s.strung_on, r.reminder_interval, r.reminder_unit) as due_on
from public.customer_rackets r
join public.profiles p on p.id = r.customer_id
join lateral (select * from public.racket_stringings where racket_id = r.id order by strung_on desc, created_at desc, id desc limit 1) s on true
where r.reminder_enabled and r.reminder_consent_at is not null
  and p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  and public.racket_restring_due(s.strung_on, r.reminder_interval, r.reminder_unit) <= (now() at time zone 'Pacific/Auckland')::date;
revoke all on public.racket_reminders_due from public, anon, authenticated;
grant select on public.racket_reminders_due to service_role;

-- Atomic leases prevent overlapping daily runs from sending the same reminder.
create function public.claim_racket_reminders(p_limit integer default 20)
returns setof public.racket_reminder_deliveries language plpgsql security definer set search_path = public as $$
begin
  -- An uncertain send is never retried beyond Resend's 24-hour deduplication window.
  update public.racket_reminder_deliveries set status = 'needs_review', error_message = 'Delivery could not be confirmed. Check Resend before sending again.'
  where status = 'sending' and first_attempt_at < now() - interval '23 hours';
  update public.racket_reminder_deliveries d set status = 'cancelled'
  where d.status in ('pending', 'sending') and not exists (
    select 1 from public.racket_reminders_due q where q.racket_id = d.racket_id and q.stringing_id = d.stringing_id and q.due_on = d.due_on
  );
  insert into public.racket_reminder_deliveries (racket_id, stringing_id, due_on)
    select racket_id, stringing_id, due_on from public.racket_reminders_due
    on conflict (racket_id, stringing_id) do nothing;
  -- An unsent reminder can be rescheduled or opted back in without creating a duplicate.
  update public.racket_reminder_deliveries d set status = 'pending', due_on = q.due_on
    from public.racket_reminders_due q where q.racket_id = d.racket_id and q.stringing_id = d.stringing_id
      and d.status = 'cancelled' and d.first_attempt_at is null;
  return query
  with candidates as (
    select d.id from public.racket_reminder_deliveries d
    where d.status in ('pending', 'sending') and (d.locked_until is null or d.locked_until < now())
    order by d.due_on, d.id for update skip locked limit greatest(1, least(p_limit, 50))
  )
  update public.racket_reminder_deliveries d set locked_until = now() + interval '5 minutes', lease_token = gen_random_uuid()
    from candidates c where d.id = c.id returning d.*;
end;
$$;
revoke all on function public.claim_racket_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_racket_reminders(integer) to service_role;
commit;
