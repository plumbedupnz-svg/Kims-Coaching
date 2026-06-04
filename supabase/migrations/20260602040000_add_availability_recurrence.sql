alter table public.availability
add column if not exists recurrence_group_id uuid,
add column if not exists recurrence_label text default '',
add column if not exists recurrence_weekly boolean not null default false;
