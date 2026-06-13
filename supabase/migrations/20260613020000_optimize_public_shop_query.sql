-- Kim's Coaching public shop performance indexes
-- Optimises the public inventory_items query used by shop.html.

create index if not exists inventory_items_public_shop_idx
on public.inventory_items (product_name)
where visible_in_shop = true
  and is_active = true
  and archived_at is null;

create index if not exists inventory_items_public_shop_category_idx
on public.inventory_items (category_id, product_name)
where visible_in_shop = true
  and is_active = true
  and archived_at is null;

notify pgrst, 'reload schema';
