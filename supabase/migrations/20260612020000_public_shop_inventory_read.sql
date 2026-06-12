create index if not exists inventory_items_public_shop_idx
on public.inventory_items (visible_in_shop, is_active, archived_at, category_id)
where visible_in_shop = true
  and is_active = true
  and archived_at is null;

alter table public.inventory_items enable row level security;

drop policy if exists "Anyone can view public shop inventory items" on public.inventory_items;
create policy "Anyone can view public shop inventory items"
on public.inventory_items
for select
to anon, authenticated
using (
  visible_in_shop = true
  and is_active = true
  and archived_at is null
);

grant select on public.inventory_items to anon, authenticated;

notify pgrst, 'reload schema';
