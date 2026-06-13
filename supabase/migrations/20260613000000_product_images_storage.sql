-- Kim's Coaching product image storage setup
-- Run this in Supabase SQL Editor after the inventory schema is installed.

alter table public.inventory_items
add column if not exists image_url text;

do $$
begin
  if to_regclass('public.products') is not null then
    alter table public.products add column if not exists image_url text;
  end if;

  if to_regclass('public.shop_products') is not null then
    alter table public.shop_products add column if not exists image_url text;
  end if;
end $$;

update public.inventory_items
set image_url = image
where image_url is null
  and image is not null
  and image ~* '^https?://';

do $$
begin
  if to_regclass('public.products') is not null then
    update public.products
    set image_url = image
    where image_url is null
      and image is not null
      and image ~* '^https?://';
  end if;

  if to_regclass('public.shop_products') is not null then
    update public.shop_products
    set image_url = image
    where image_url is null
      and image is not null
      and image ~* '^https?://';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read product images" on storage.objects;
create policy "Public can read product images"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.current_user_is_admin()
);

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_user_is_admin()
)
with check (
  bucket_id = 'product-images'
  and public.current_user_is_admin()
);

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_user_is_admin()
);

notify pgrst, 'reload schema';
