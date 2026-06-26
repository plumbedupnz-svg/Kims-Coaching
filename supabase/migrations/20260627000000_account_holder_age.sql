-- Store the account holder age separately from player ages for booking eligibility.

alter table public.profiles
add column if not exists account_holder_age integer;

alter table public.profiles
drop constraint if exists profiles_account_holder_age_valid;

alter table public.profiles
add constraint profiles_account_holder_age_valid
check (account_holder_age is null or (account_holder_age >= 0 and account_holder_age <= 120));

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
    account_holder_age,
    role
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(new.raw_user_meta_data ->> 'mobile', new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'account_holder_age', '')::integer,
    'customer'
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = coalesce(nullif(public.profiles.first_name, ''), excluded.first_name),
    last_name = coalesce(nullif(public.profiles.last_name, ''), excluded.last_name),
    phone = coalesce(nullif(public.profiles.phone, ''), excluded.phone),
    account_holder_age = coalesce(public.profiles.account_holder_age, excluded.account_holder_age);

  return new;
end;
$$;

grant update (account_holder_age) on public.profiles to authenticated;

notify pgrst, 'reload schema';
