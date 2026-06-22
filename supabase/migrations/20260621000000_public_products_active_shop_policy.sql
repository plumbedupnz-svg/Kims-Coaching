-- Kim's Coaching public shop product policy
-- Products created in Admin > Products should appear in the public shop when active,
-- even when they are order-to-sale items without inventory.

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
  fulfilment_type = coalesce(nullif(fulfilment_type, ''), 'order_to_sale'),
  stock_status = coalesce(nullif(stock_status, ''), 'order_to_sale'),
  visible_in_shop = coalesce(visible_in_shop, true);

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

create index if not exists products_active_shop_idx
on public.products (is_active);

create index if not exists products_inventory_item_id_idx
on public.products (inventory_item_id)
where inventory_item_id is not null;

alter table public.products enable row level security;

drop policy if exists "Anyone can view active products" on public.products;

create policy "Anyone can view active products"
on public.products
for select
using (is_active = true);

grant select on public.products to anon, authenticated;

notify pgrst, 'reload schema';
