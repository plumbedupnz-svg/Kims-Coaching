-- Kim's Coaching product category/fulfilment columns
-- Ensures Admin > Products can persist selected categories and product fulfilment type.

alter table public.products
add column if not exists category text,
add column if not exists fulfilment_type text not null default 'order_to_sale',
add column if not exists quantity_on_hand integer not null default 0,
add column if not exists stock_status text not null default 'order_to_sale',
add column if not exists visible_in_shop boolean not null default true,
add column if not exists archived_at timestamptz;

do $$
begin
  if to_regclass('public.product_categories') is not null then
    alter table public.products
    add column if not exists category_id uuid references public.product_categories(id) on delete set null;
  else
    alter table public.products
    add column if not exists category_id uuid;
  end if;

  if to_regclass('public.inventory_items') is not null then
    alter table public.products
    add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;
  else
    alter table public.products
    add column if not exists inventory_item_id uuid;
  end if;
end $$;

update public.products
set
  fulfilment_type = case
    when lower(coalesce(fulfilment_type, '')) in ('stock', 'stocked', 'held_in_stock') then 'stock'
    when lower(coalesce(fulfilment_type, '')) = 'order_to_sale' then 'order_to_sale'
    else 'order_to_sale'
  end,
  stock_status = coalesce(nullif(stock_status, ''), 'order_to_sale'),
  visible_in_shop = coalesce(visible_in_shop, true);

update public.products p
set
  category_id = pc.id,
  category = pc.name
from public.product_categories pc
where p.category_id is null
  and p.category is not null
  and lower(trim(pc.name)) = lower(trim(p.category));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_fulfilment_type_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
    add constraint products_fulfilment_type_check
    check (fulfilment_type in ('stock', 'order_to_sale'));
  end if;
end $$;

create index if not exists products_category_id_idx
on public.products (category_id);

create index if not exists products_inventory_item_id_idx
on public.products (inventory_item_id)
where inventory_item_id is not null;

create index if not exists products_active_archive_idx
on public.products (is_active, archived_at);

notify pgrst, 'reload schema';
