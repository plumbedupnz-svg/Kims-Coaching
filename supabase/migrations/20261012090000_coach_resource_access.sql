-- Coach-only resource access for the Kim Jones Coaching manual.
-- Coaches are linked to normal authenticated profiles through coaches.profile_id.

create or replace function public.current_user_is_coach()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.current_user_is_admin()
    or exists (
      select 1
      from public.coaches
      where profile_id = auth.uid()
        and is_active = true
    );
$$;

revoke all on function public.current_user_is_coach() from public;
grant execute on function public.current_user_is_coach() to authenticated;

create or replace function public.link_coach_profile_from_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.profile_id is null and nullif(trim(new.email), '') is not null then
    select id
      into new.profile_id
    from public.profiles
    where lower(email) = lower(new.email)
    order by created_at asc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists coaches_link_profile_from_email on public.coaches;
create trigger coaches_link_profile_from_email
before insert or update of email, profile_id on public.coaches
for each row execute function public.link_coach_profile_from_email();

create or replace function public.link_new_user_to_coach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coaches
  set
    profile_id = new.id,
    updated_at = now()
  where profile_id is null
    and nullif(trim(email), '') is not null
    and lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_kims_coach_link on auth.users;
create trigger on_auth_user_created_kims_coach_link
after insert on auth.users
for each row execute function public.link_new_user_to_coach();

update public.coaches c
set
  profile_id = p.id,
  updated_at = now()
from public.profiles p
where c.profile_id is null
  and nullif(trim(c.email), '') is not null
  and lower(c.email) = lower(p.email);

notify pgrst, 'reload schema';
