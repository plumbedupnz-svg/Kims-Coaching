-- Pasted addresses belong to the campaign, without creating customer/contact records.
alter table public.email_campaigns
  add column if not exists extra_emails text[] not null default '{}',
  add column if not exists extra_consent_note text not null default '' check (length(extra_consent_note) <= 1000);
alter table public.email_campaign_recipients alter column contact_id drop not null;

-- Remember external newsletter opt-outs across future pasted lists.
create table if not exists public.email_external_preferences (
  email text primary key check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
  unsubscribe_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  unsubscribed_at timestamptz
);
alter table public.email_external_preferences enable row level security;
revoke all on public.email_external_preferences from anon, authenticated;
grant all on public.email_external_preferences to service_role;

create or replace function public.email_campaign_audience(p_id uuid)
returns table(id uuid, email text, first_name text)
language sql security definer set search_path = public stable as $$
  select c.id, c.email, c.first_name from email_contacts c, email_campaigns d
  where d.id = p_id and (d.purpose = 'service' or c.marketing_status = 'subscribed')
    and (d.all_contacts or c.id = any(d.contact_ids) or c.email = any(d.extra_emails) or exists(
      select 1 from email_group_members m where m.contact_id = c.id and m.group_id = any(d.group_ids)))
  union all
  select distinct null::uuid, e.email, ''::text from email_campaigns d cross join lateral unnest(d.extra_emails) e(email)
  left join email_external_preferences p on p.email = e.email
  where d.id = p_id and not exists(select 1 from email_contacts c where c.email = e.email)
    and (d.purpose = 'service' or (btrim(d.extra_consent_note) <> '' and p.unsubscribed_at is null))
  order by email;
$$;

create or replace function public.queue_email_campaign(p_id uuid, p_version integer, p_audience jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d email_campaigns; current_audience jsonb;
begin
  select * into d from email_campaigns where id = p_id for update;
  if d.id is null then raise exception 'Email not found.'; end if;
  if d.status <> 'draft' then return; end if;
  if d.version <> p_version then raise exception 'Draft changed. Review it again.'; end if;
  if cardinality(d.extra_emails) > 1000 or exists(select 1 from unnest(d.extra_emails) e where e is null or e <> lower(btrim(e)) or length(e) > 254 or e !~ '^[^[:space:]@<>,;]+@[^[:space:]@<>,;]+\.[^[:space:]@<>,;]+$') then
    raise exception 'Paste up to 1,000 valid email addresses.';
  end if;
  if d.purpose = 'marketing' and cardinality(d.extra_emails) > 0 and btrim(d.extra_consent_note) = '' then
    raise exception 'Record newsletter consent for the pasted recipients.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.email),'[]'::jsonb) into current_audience from email_campaign_audience(p_id) a;
  if current_audience <> p_audience then raise exception 'Recipients changed. Review the email again.'; end if;
  if jsonb_array_length(current_audience) = 0 then raise exception 'Choose at least one eligible recipient.'; end if;
  if btrim(d.subject) = '' or btrim(d.body) = '' then raise exception 'Add a subject and message.'; end if;
  insert into email_campaign_recipients(campaign_id, contact_id, email, first_name)
    select p_id, a.id, a.email, a.first_name from jsonb_to_recordset(current_audience) a(id uuid, email text, first_name text);
  insert into email_external_preferences(email)
    select a.email from jsonb_to_recordset(current_audience) a(id uuid, email text)
    where a.id is null and d.purpose = 'marketing'
    on conflict (email) do nothing;
  update email_campaigns set status = 'sending', updated_at = now() where id = p_id;
end $$;

-- Either kind of link updates all current preferences for that email in one transaction.
create or replace function public.unsubscribe_email_recipient(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare address text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return false; end if;
  select email into address from (
    select email from email_contacts where unsubscribe_token = p_token
    union all select email from email_external_preferences where unsubscribe_token = p_token
  ) matches limit 1;
  if address is null then return false; end if;
  update email_contacts set marketing_status = 'unsubscribed', unsubscribed_at = now() where email = address;
  update email_external_preferences set unsubscribed_at = now() where email = address;
  return true;
end $$;

revoke all on function public.email_campaign_audience(uuid) from public, anon, authenticated;
revoke all on function public.queue_email_campaign(uuid,integer,jsonb) from public, anon, authenticated;
revoke all on function public.unsubscribe_email_recipient(text) from public, anon, authenticated;
grant execute on function public.email_campaign_audience(uuid) to service_role;
grant execute on function public.queue_email_campaign(uuid,integer,jsonb) to service_role;
grant execute on function public.unsubscribe_email_recipient(text) to service_role;
notify pgrst, 'reload schema';
