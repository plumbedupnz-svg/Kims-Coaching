-- Stop inventory saves from depending on the retired public.shop_products table.
-- Safe to run more than once in Supabase SQL Editor.

create or replace function public.sync_inventory_item_to_public_product(p_inventory_item_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_product_id text;
  v_products_id text;
  v_products_id_type text;
  v_category_name text;
  v_image_url text;
  v_fulfilment_type text;
begin
  select *
  into v_item
  from public.inventory_items
  where id = p_inventory_item_id;

  if not found then
    raise exception 'Inventory item % was not found.', p_inventory_item_id;
  end if;

  v_category_name := coalesce(v_item.category, 'Other');
  v_product_id := coalesce(nullif(v_item.shop_product_id, ''), 'inv-' || v_item.id::text);
  v_image_url := nullif(coalesce(v_item.image_url, v_item.image), '');
  v_fulfilment_type := case
    when coalesce(v_item.is_order_to_sale, false) or coalesce(v_item.track_stock, true) = false then 'order_to_sale'
    else 'stock'
  end;

  if v_item.visible_in_shop and coalesce(v_item.is_active, true) and v_item.archived_at is null then
    if to_regclass('public.products') is not null then
      select data_type
      into v_products_id_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'products'
        and column_name = 'id';

      if v_products_id_type in ('text', 'character varying') then
        execute $sql$
          insert into public.products (
            id, inventory_item_id, category_id, name, slug, short_description, category, description,
            price, purchase_price, cost_price, discount, image_url, is_active, visible_in_shop,
            fulfilment_type, quantity_on_hand, stock_status, archived_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 0, $11, true, true, $12, $13, $14, null, now())
          on conflict (inventory_item_id) where inventory_item_id is not null do update
          set
            category_id = excluded.category_id,
            name = excluded.name,
            slug = excluded.slug,
            short_description = excluded.short_description,
            category = excluded.category,
            description = excluded.description,
            price = excluded.price,
            purchase_price = excluded.purchase_price,
            cost_price = excluded.cost_price,
            image_url = coalesce(excluded.image_url, public.products.image_url),
            is_active = true,
            visible_in_shop = true,
            fulfilment_type = excluded.fulfilment_type,
            quantity_on_hand = excluded.quantity_on_hand,
            stock_status = excluded.stock_status,
            archived_at = null,
            updated_at = now()
          returning id::text
        $sql$
        into v_products_id
        using v_product_id, v_item.id, v_item.category_id, v_item.product_name, v_item.slug, v_item.short_description,
          v_category_name, coalesce(v_item.full_description, v_item.description), v_item.sell_price,
          coalesce(v_item.purchase_price, v_item.cost_price, 0), v_image_url, v_fulfilment_type,
          v_item.quantity_on_hand, v_item.status;
      else
        execute $sql$
          insert into public.products (
            inventory_item_id, category_id, name, slug, short_description, category, description,
            price, purchase_price, cost_price, discount, image_url, is_active, visible_in_shop,
            fulfilment_type, quantity_on_hand, stock_status, archived_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 0, $10, true, true, $11, $12, $13, null, now())
          on conflict (inventory_item_id) where inventory_item_id is not null do update
          set
            category_id = excluded.category_id,
            name = excluded.name,
            slug = excluded.slug,
            short_description = excluded.short_description,
            category = excluded.category,
            description = excluded.description,
            price = excluded.price,
            purchase_price = excluded.purchase_price,
            cost_price = excluded.cost_price,
            image_url = coalesce(excluded.image_url, public.products.image_url),
            is_active = true,
            visible_in_shop = true,
            fulfilment_type = excluded.fulfilment_type,
            quantity_on_hand = excluded.quantity_on_hand,
            stock_status = excluded.stock_status,
            archived_at = null,
            updated_at = now()
          returning id::text
        $sql$
        into v_products_id
        using v_item.id, v_item.category_id, v_item.product_name, v_item.slug, v_item.short_description,
          v_category_name, coalesce(v_item.full_description, v_item.description), v_item.sell_price,
          coalesce(v_item.purchase_price, v_item.cost_price, 0), v_image_url, v_fulfilment_type,
          v_item.quantity_on_hand, v_item.status;
      end if;
    end if;

    update public.inventory_items
    set shop_product_id = coalesce(v_products_id, v_product_id),
        updated_at = now()
    where id = v_item.id;

    return coalesce(v_products_id, v_product_id);
  end if;

  if to_regclass('public.products') is not null then
    execute $sql$
      update public.products
      set is_active = false,
          visible_in_shop = false,
          updated_at = now()
      where inventory_item_id = $1
         or id::text = $2
      returning id::text
    $sql$
    into v_products_id
    using v_item.id, v_product_id;
  end if;

  return coalesce(v_products_id, v_product_id);
end;
$$;

grant execute on function public.sync_inventory_item_to_public_product(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
