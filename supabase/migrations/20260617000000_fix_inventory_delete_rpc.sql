-- Kim's Coaching inventory delete safety fix
-- Hard delete is only allowed for test/internal items with no stock history
-- and no order references. Real inventory should be archived instead.

create or replace function public.delete_inventory_item_if_safe(p_inventory_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_has_movements boolean := false;
  v_has_orders boolean := false;
  v_has_shop_products_inventory_link boolean := false;
  v_has_products_inventory_link boolean := false;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can delete inventory items.';
  end if;

  select *
  into v_item
  from public.inventory_items
  where id = p_inventory_item_id;

  if not found then
    raise exception 'Inventory item % was not found.', p_inventory_item_id;
  end if;

  select exists (
    select 1
    from public.stock_movements
    where inventory_item_id = p_inventory_item_id
  ) into v_has_movements;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shop_products'
      and column_name = 'inventory_item_id'
  ) into v_has_shop_products_inventory_link;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'inventory_item_id'
  ) into v_has_products_inventory_link;

  if to_regclass('public.shop_orders') is not null
     and v_has_shop_products_inventory_link then
    execute $sql$
      select exists (
        select 1
        from public.shop_orders so
        cross join lateral jsonb_array_elements(coalesce(so.items, '[]'::jsonb)) item
        where item->>'id' = $1::text
          or item->>'inventory_item_id' = $1::text
          or item->>'product_id' in (
            select sp.id::text
            from public.shop_products sp
            where sp.inventory_item_id = $1
          )
      )
    $sql$
    into v_has_orders
    using p_inventory_item_id;
  elsif to_regclass('public.shop_orders') is not null then
    execute $sql$
      select exists (
        select 1
        from public.shop_orders so
        cross join lateral jsonb_array_elements(coalesce(so.items, '[]'::jsonb)) item
        where item->>'id' = $1::text
          or item->>'inventory_item_id' = $1::text
      )
    $sql$
    into v_has_orders
    using p_inventory_item_id;
  end if;

  if v_has_movements or v_has_orders then
    raise exception 'This item has stock history and cannot be permanently deleted. Use Archive instead.';
  end if;

  if v_has_shop_products_inventory_link then
    delete from public.shop_products
    where inventory_item_id = p_inventory_item_id
       or id::text = coalesce(v_item.shop_product_id, '');
  end if;

  if v_has_products_inventory_link then
    delete from public.products
    where inventory_item_id = p_inventory_item_id
       or id::text = coalesce(v_item.shop_product_id, '');
  end if;

  delete from public.inventory_items
  where id = p_inventory_item_id;

  return true;
end;
$$;

grant execute on function public.delete_inventory_item_if_safe(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
