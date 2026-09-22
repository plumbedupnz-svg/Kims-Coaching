-- Admin email workspace. Sending and contact changes go through the authenticated server API.
create table if not exists public.email_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
  first_name text not null default '',
  last_name text not null default '',
  marketing_status text not null default 'not_subscribed' check (marketing_status in ('not_subscribed', 'subscribed', 'unsubscribed')),
  consent_note text not null default '',
  consent_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
create table if not exists public.email_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  junior_group_id uuid unique references public.junior_groups(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.email_group_members (
  group_id uuid not null references public.email_groups(id) on delete cascade,
  contact_id uuid not null references public.email_contacts(id) on delete cascade,
  primary key (group_id, contact_id)
);
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '' check (length(subject) <= 200),
  preview_text text not null default '' check (length(preview_text) <= 180),
  body text not null default '' check (length(body) <= 20000),
  button_label text not null default '' check (length(button_label) <= 80),
  button_url text not null default '' check (length(button_url) <= 2000),
  purpose text not null default 'service' check (purpose in ('service', 'marketing')),
  contact_ids uuid[] not null default '{}',
  group_ids uuid[] not null default '{}',
  all_contacts boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'sending', 'complete', 'needs_review')),
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  lease_token uuid,
  locked_until timestamptz
);
create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id uuid not null references public.email_contacts(id) on delete restrict,
  email text not null,
  first_name text not null default '',
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'needs_review')),
  email_payload jsonb,
  first_attempt_at timestamptz,
  provider_id text,
  sent_at timestamptz,
  error_message text,
  unique (campaign_id, email)
);
create index if not exists email_campaign_pending_idx on public.email_campaign_recipients(campaign_id, status);
create index if not exists email_group_contacts_idx on public.email_group_members(contact_id);

do $$ declare t text; begin
  foreach t in array array['email_contacts','email_groups','email_group_members','email_campaigns','email_campaign_recipients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Import existing addresses without interpreting a booking as newsletter consent.
create or replace function public.sync_email_contacts() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into email_contacts(email, first_name, last_name)
    select distinct on (lower(btrim(email))) lower(btrim(email)), coalesce(first_name,''), coalesce(last_name,'')
    from profiles where role = 'customer' and length(email) <= 254
      and btrim(email) ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    order by lower(btrim(email)), id
    on conflict (email) do nothing;
  insert into email_contacts(email, first_name)
    select distinct on (lower(btrim(m.email))) lower(btrim(m.email)), coalesce(nullif(split_part(btrim(m.parent_name),' ',1),''), 'there')
    from junior_group_members m join junior_groups g on g.id = m.group_id
    where g.is_active and m.booking_status = 'confirmed'
      and m.placement_status not in ('cancelled','refunded','inactive')
      and length(m.email) <= 254 and btrim(m.email) ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    order by lower(btrim(m.email)), m.id
    on conflict (email) do nothing;
  insert into email_groups(name, junior_group_id)
    select left(group_name || case when coalesce(term_name,'') <> '' then ' · ' || term_name else '' end,120), id
    from junior_groups where is_active
    on conflict (junior_group_id) do update set name = excluded.name;
  delete from email_group_members where group_id in (select id from email_groups where junior_group_id is not null);
  insert into email_group_members(group_id, contact_id)
    select distinct eg.id, c.id from email_groups eg
    join junior_groups g on g.id = eg.junior_group_id and g.is_active
    join junior_group_members m on m.group_id = g.id
    join email_contacts c on c.email = lower(btrim(m.email))
    where m.booking_status = 'confirmed' and m.placement_status not in ('cancelled','refunded','inactive');
end $$;

create or replace function public.save_email_group(p_id uuid, p_name text, p_contacts uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if length(btrim(p_name)) not between 1 and 120 then raise exception 'Enter a group name.'; end if;
  if p_id is null then
    insert into email_groups(name) values(btrim(p_name)) returning id into v_id;
  else
    update email_groups set name = btrim(p_name) where id = p_id and junior_group_id is null returning id into v_id;
    if v_id is null then raise exception 'This group is managed by junior coaching.'; end if;
  end if;
  delete from email_group_members where group_id = v_id;
  insert into email_group_members(group_id, contact_id) select v_id, unnest(p_contacts) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.email_campaign_audience(p_id uuid)
returns table(id uuid, email text, first_name text)
language sql security definer set search_path = public stable as $$
  select c.id, c.email, c.first_name from email_contacts c, email_campaigns d
  where d.id = p_id and (d.purpose = 'service' or c.marketing_status = 'subscribed')
    and (d.all_contacts or c.id = any(d.contact_ids) or exists(
      select 1 from email_group_members m where m.contact_id = c.id and m.group_id = any(d.group_ids)))
  order by c.id;
$$;

-- Version + exact audience comparison make review/send and double clicks safe.
create or replace function public.queue_email_campaign(p_id uuid, p_version integer, p_audience jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d email_campaigns; current_audience jsonb;
begin
  select * into d from email_campaigns where id = p_id for update;
  if d.id is null then raise exception 'Email not found.'; end if;
  if d.status <> 'draft' then return; end if;
  if d.version <> p_version then raise exception 'Draft changed. Review it again.'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into current_audience from email_campaign_audience(p_id) a;
  if current_audience <> p_audience then raise exception 'Recipients changed. Review the email again.'; end if;
  if jsonb_array_length(current_audience) = 0 then raise exception 'Choose at least one eligible recipient.'; end if;
  if btrim(d.subject) = '' or btrim(d.body) = '' then raise exception 'Add a subject and message.'; end if;
  insert into email_campaign_recipients(campaign_id, contact_id, email, first_name)
    select p_id, a.id, a.email, a.first_name from jsonb_to_recordset(current_audience) a(id uuid, email text, first_name text);
  update email_campaigns set status = 'sending', updated_at = now() where id = p_id;
end $$;

-- Only one worker per campaign; abandoned work can resume after the lease expires.
create or replace function public.claim_email_campaign(p_id uuid) returns setof public.email_campaigns
language plpgsql security definer set search_path = public as $$
begin
  return query update email_campaigns set lease_token = gen_random_uuid(), locked_until = now() + interval '90 seconds'
    where id = p_id and status = 'sending' and (locked_until is null or locked_until < now()) returning *;
end $$;

-- Do not expose the privileged operations or unsubscribe tokens to browser roles.
revoke all on function public.sync_email_contacts() from public, anon, authenticated;
revoke all on function public.save_email_group(uuid,text,uuid[]) from public, anon, authenticated;
revoke all on function public.email_campaign_audience(uuid) from public, anon, authenticated;
revoke all on function public.queue_email_campaign(uuid,integer,jsonb) from public, anon, authenticated;
revoke all on function public.claim_email_campaign(uuid) from public, anon, authenticated;
grant execute on function public.sync_email_contacts() to service_role;
grant execute on function public.save_email_group(uuid,text,uuid[]) to service_role;
grant execute on function public.email_campaign_audience(uuid) to service_role;
grant execute on function public.queue_email_campaign(uuid,integer,jsonb) to service_role;
grant execute on function public.claim_email_campaign(uuid) to service_role;
notify pgrst, 'reload schema';
