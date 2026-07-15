-- Product detail pages: stable public slugs and short card descriptions.
-- Safe to run more than once in Supabase SQL Editor.

alter table public.products
add column if not exists slug text,
add column if not exists short_description text;

update public.products
set slug = lower(
  regexp_replace(
    regexp_replace(
      trim(coalesce(name, 'product')) || '-' || left(id::text, 8),
      '&',
      ' and ',
      'gi'
    ),
    '[^a-zA-Z0-9]+',
    '-',
    'g'
  )
)
where slug is null or trim(slug) = '';

update public.products
set slug = regexp_replace(slug, '(^-+|-+$)', '', 'g')
where slug is not null;

update public.products
set short_description = left(regexp_replace(coalesce(description, ''), '[[:space:]]+', ' ', 'g'), 160)
where (short_description is null or trim(short_description) = '')
  and description is not null
  and trim(description) <> '';

create unique index if not exists products_slug_unique_idx
on public.products (lower(slug))
where slug is not null and trim(slug) <> '';

notify pgrst, 'reload schema';
