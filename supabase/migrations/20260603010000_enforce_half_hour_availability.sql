-- Enforce private lesson availability starts on the hour or half hour.
-- NOT VALID preserves any existing legacy rows while still checking new inserts/updates.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'availability_start_time_half_hour'
      and conrelid = 'public.availability'::regclass
  ) then
    alter table public.availability
      add constraint availability_start_time_half_hour
      check (extract(minute from start_time) in (0, 30))
      not valid;
  end if;
end $$;
