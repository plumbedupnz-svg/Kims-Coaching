-- Kim's Coaching product image performance cleanup
-- This keeps public shop reads fast by preventing old base64 image blobs
-- from being copied into URL columns or public product tables.

update public.inventory_items
set image_url = null
where image_url like 'data:image/%';

do $$
begin
  if to_regclass('public.products') is not null then
    update public.products
    set image_url = null
    where image_url like 'data:image/%';
  end if;

  if to_regclass('public.shop_products') is not null then
    update public.shop_products
    set image_url = null
    where image_url like 'data:image/%';
  end if;
end $$;

notify pgrst, 'reload schema';
