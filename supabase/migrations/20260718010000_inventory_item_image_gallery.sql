-- Product image galleries for inventory-backed shop items.
-- Safe to run more than once in Supabase SQL Editor.

create table if not exists public.inventory_item_images (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  image_url text not null,
  storage_path text,
  alt_text text,
  sort_order integer not null default 0,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_item_images_url_required check (trim(image_url) <> '')
);

create index if not exists inventory_item_images_item_sort_idx
on public.inventory_item_images (inventory_item_id, sort_order, created_at);

create unique index if not exists inventory_item_images_item_url_unique_idx
on public.inventory_item_images (inventory_item_id, image_url);

insert into public.inventory_item_images (
  inventory_item_id,
  image_url,
  sort_order,
  is_main
)
select
  ii.id,
  ii.image_url,
  0,
  true
from public.inventory_items ii
where ii.image_url is not null
  and trim(ii.image_url) <> ''
  and ii.image_url not like 'data:image/%'
  and not exists (
    select 1
    from public.inventory_item_images img
    where img.inventory_item_id = ii.id
  )
on conflict (inventory_item_id, image_url) do nothing;

with ranked as (
  select
    id,
    row_number() over (
      partition by inventory_item_id
      order by is_main desc, sort_order asc, created_at asc, id asc
    ) as row_number
  from public.inventory_item_images
)
update public.inventory_item_images img
set is_main = ranked.row_number = 1
from ranked
where ranked.id = img.id;

create unique index if not exists inventory_item_images_single_main_idx
on public.inventory_item_images (inventory_item_id)
where is_main = true;

create or replace function public.set_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_inventory_item_images_updated_at on public.inventory_item_images;
create trigger set_inventory_item_images_updated_at
before update on public.inventory_item_images
for each row
execute function public.set_inventory_updated_at();

alter table public.inventory_item_images enable row level security;

drop policy if exists "Anyone can view public inventory item images" on public.inventory_item_images;
create policy "Anyone can view public inventory item images"
on public.inventory_item_images
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.inventory_items ii
    where ii.id = inventory_item_images.inventory_item_id
      and ii.visible_in_shop = true
      and ii.is_active = true
      and ii.archived_at is null
  )
);

drop policy if exists "Admins can manage inventory item images" on public.inventory_item_images;
create policy "Admins can manage inventory item images"
on public.inventory_item_images
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select on public.i