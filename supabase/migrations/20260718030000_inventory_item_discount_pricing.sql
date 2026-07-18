-- Add product-level discounts to inventory-backed shop products.
-- Safe to run more than once in Supabase SQL Editor.

alter table public.inventory_items
add column if not exists discount numeric(5, 2) not null default 0;

alter table public.inventory_items
drop constraint if exists inventory_items_discount_valid;

alter table public.inventory_items
add constraint inventory_items_discount_valid
check (discount >= 0 and discount <= 100);

do $$
begin
  if to_regclass('public.products') is not null then
    alter table public.products
    add column if not exists discount numeric(5, 2) not null default 0;

    update public.inventory_items ii
    set discount = coalesce(p.discount, 0)
    from public.products p
    where p.inventory_item_id = ii.id
      and coalesce(ii.discount, 0) = 0
      and coalesce(p.discount, 0) > 0;
  end if;
end $$;

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
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, true, true, $13, $14, $15, null, now())
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
            discount = excluded.discount,
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
          coalesce(v_item.purchase_price, v_item.cost_price, 0), coalesce(v_item.discount, 0), v_image_url,
          v_fulfilment_type, v_item.quantity_on_hand, v_item.status;
      else
        execute $sql$
          insert into public.products (
            inventory_item_id, category_id, name, slug, short_description, category, description,
            price, purchase_price, cost_price, discount, image_url, is_active, visible_in_shop,
            fulfilment_type, quantity_on_hand, stock_status, archived_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, true, true, $12, $13, $14, null, now())
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
            discount = excluded.discount,
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
          coalesce(v_item.purchase_price, v_item.cost_price, 0), coalesce(v_item.discount, 0), v_image_url,
          v_fulfilment_type, v_item.quantity_on_hand, v_item.status;
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

create or replace function public.admin_save_inventory_item(
  p_inventory_item_id uuid default null,
  p_product_name text default '',
  p_sku text default null,
  p_supplier text default 'Sportco',
  p_category_id uuid default null,
  p_category text default 'Other',
  p_description text default null,
  p_cost_price numeric default 0,
  p_sell_price numeric default 0,
  p_discount numeric default 0,
  p_quantity_on_hand integer default 0,
  p_low_stock_threshold integer default 2,
  p_need_order_threshold integer default 0,
  p_image text default null,
  p_visible_in_shop boolean default false,
  p_is_active boolean default true,
  p_brand text default null,
  p_short_description text default null,
  p_track_stock boolean default true,
  p_is_order_to_sale boolean default false,
  p_slug text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_existing_quantity integer;
  v_quantity_delta integer;
  v_category_id uuid;
  v_category_name text;
  v_track_stock boolean;
  v_order_to_sale boolean;
  v_slug text;
  v_discount numeric;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can save inventory items.';
  end if;

  if nullif(trim(p_product_name), '') is null then
    raise exception 'Product name is required.';
  end if;

  if p_quantity_on_hand < 0 then
    raise exception 'Quantity on hand cannot be negative.';
  end if;

  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > 100 then
    raise exception 'Discount must be between 0 and 100.';
  end if;

  v_discount := coalesce(p_discount, 0);
  v_order_to_sale := coalesce(p_is_order_to_sale, false);
  v_track_stock := coalesce(p_track_stock, true) and not v_order_to_sale;
  v_category_id := public.get_category_id(p_category_id, p_category);
  select name into v_category_name from public.product_categories where id = v_category_id;
  v_slug := lower(regexp_replace(regexp_replace(trim(coalesce(nullif(p_slug, ''), p_product_name)) || case when nullif(p_slug, '') is null and p_inventory_item_id is not null then '-' || left(p_inventory_item_id::text, 8) else '' end, '&', ' and ', 'gi'), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');

  if p_inventory_item_id is null then
    insert into public.inventory_items (
      product_name, sku, supplier, brand, category_id, category, description, short_description, full_description,
      image, image_url, cost_price, purchase_price, sell_price, discount, quantity_on_hand, low_stock_threshold,
      need_order_threshold, visible_in_shop, is_active, track_stock, is_order_to_sale, slug, review_status
    )
    values (
      trim(p_product_name),
      nullif(trim(coalesce(p_sku, '')), ''),
      coalesce(nullif(trim(p_supplier), ''), 'Sportco'),
      nullif(trim(coalesce(p_brand, '')), ''),
      v_category_id,
      v_category_name,
      nullif(trim(coalesce(p_description, '')), ''),
      nullif(trim(coalesce(p_short_description, '')), ''),
      nullif(trim(coalesce(p_description, '')), ''),
      p_image,
      p_image,
      coalesce(p_cost_price, 0),
      coalesce(p_cost_price, 0),
      coalesce(p_sell_price, 0),
      v_discount,
      0,
      coalesce(p_low_stock_threshold, 2),
      coalesce(p_need_order_threshold, 0),
      coalesce(p_visible_in_shop, false),
      coalesce(p_is_active, true),
      v_track_stock,
      v_order_to_sale,
      case when nullif(p_slug, '') is null then null else v_slug end,
      'reviewed'
    )
    returning * into v_item;

    if nullif(p_slug, '') is null then
      update public.inventory_items
      set slug = regexp_replace(v_slug || '-' || left(v_item.id::text, 8), '(^-+|-+$)', '', 'g')
      where id = v_item.id
      returning * into v_item;
    end if;

    if v_track_stock and p_quantity_on_hand > 0 then
      perform public.apply_stock_movement(v_item.id, p_quantity_on_hand, 'adjustment', 'Initial manual inventory entry', null, null);
    end if;
  else
    select quantity_on_hand into v_existing_quantity
    from public.inventory_items
    where id = p_inventory_item_id
    for update;

    if not found then
      raise exception 'Inventory item % was not found.', p_inventory_item_id;
    end if;

    update public.inventory_items
    set
      product_name = trim(p_product_name),
      sku = nullif(trim(coalesce(p_sku, '')), ''),
      supplier = coalesce(nullif(trim(p_supplier), ''), 'Sportco'),
      brand = nullif(trim(coalesce(p_brand, '')), ''),
      category_id = v_category_id,
      category = v_category_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      short_description = nullif(trim(coalesce(p_short_description, '')), ''),
      full_description = nullif(trim(coalesce(p_description, '')), ''),
      image = coalesce(p_image, image),
      image_url = coalesce(p_image, image_url),
      cost_price = coalesce(p_cost_price, 0),
      purchase_price = coalesce(p_cost_price, 0),
      sell_price = coalesce(p_sell_price, 0),
      discount = v_discount,
      low_stock_threshold = coalesce(p_low_stock_threshold, 2),
      need_order_threshold = coalesce(p_need_order_threshold, 0),
      visible_in_shop = coalesce(p_visible_in_shop, false),
      is_active = coalesce(p_is_active, true),
      track_stock = v_track_stock,
      is_order_to_sale = v_order_to_sale,
      slug = v_slug,
      archived_at = case when coalesce(p_is_active, true) then null else archived_at end,
      archived_by = case when coalesce(p_is_active, true) then null else archived_by end
    where id = p_inventory_item_id
    returning * into v_item;

    v_quantity_delta := case when v_track_stock then p_quantity_on_hand - v_existing_quantity else 0 - v_existing_quantity end;
    if v_quantity_delta <> 0 then
      perform public.apply_stock_movement(p_inventory_item_id, v_quantity_delta, 'adjustment', 'Manual quantity edit', null, null);
    end if;
  end if;

  perform public.recalculate_inventory_status(coalesce(p_inventory_item_id, v_item.id));
  perform public.sync_inventory_item_to_public_product(coalesce(p_inventory_item_id, v_item.id));

  select * into v_item
  from public.inventory_items
  where id = coalesce(p_inventory_item_id, v_item.id);

  return v_item;
end;
$$;

grant execute on function public.sync_inventory_item_to_public_product(uuid) to authenticated, service_role;
grant execute on function public.admin_save_inventory_item(uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, integer, integer, integer, text, boolean, boolean, text, text, boolean, boolean, text) to authenticated, service_role;

notify pgrst, 'reload schema';
