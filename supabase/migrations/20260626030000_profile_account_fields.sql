alter table public.profiles
add column if not exists phone text default '',
add column if not exists parent_name text default '',
add column if not exists player_name text default '',
add column if not exists player_age integer,
add column if not exists tennis_level text default '',
add column if not exists notes text default '',
add column if not exists players jsonb default '[]'::jsonb;

update public.profiles
set players = '[]'::jsonb
where players is null;

alter table public.profiles
alter column players set default '[]'::jsonb,
alter column players set not null;

grant update (
  first_name,
  last_name,
  phone,
  parent_name,
  player_name,
  player_age,
  tennis_level,
  notes,
  players
) on public.profiles to authenticated;

notify pgrst, 'reload schema';
