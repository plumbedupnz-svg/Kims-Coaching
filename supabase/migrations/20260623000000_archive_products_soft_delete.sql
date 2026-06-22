-- Kim's Coaching product soft-delete support
-- Products are archived rather than hard-deleted so linked inventory history remains intact.

alter table public.products
add column if not exists visible_in_shop boolean not null default true,
add column if not exists archived_at timestamptz;

create index if not exists products_active_archive_idx
on public.products (is_active, archived_at);

notify pgrst, 'reload schema';
