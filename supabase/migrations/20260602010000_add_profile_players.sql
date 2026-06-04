alter table public.profiles
add column if not exists players jsonb not null default '[]'::jsonb;

grant update (players) on public.profiles to authenticated;
