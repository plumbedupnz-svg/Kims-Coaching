insert into public.product_categories (name, is_default)
values
  ('Recovery', true),
  ('Strength', true),
  ('Training', true),
  ('Tennis Gear', true),
  ('Accessories', true),
  ('Other', true)
on conflict (normalized_name) do update
set
  name = excluded.name,
  is_default = public.product_categories.is_default or excluded.is_default;

insert into public.product_categories (name, is_default)
select distinct trim(category), false
from (
  select category from public.inventory_items where category is not null and trim(category) <> ''
  union
  select category from public.shop_products where category is not null and trim(category) <> ''
) existing_categories
on conflict (normalized_name) do nothing;

alter table public.inventory_items
add column if not exists category_id uuid references public.product_categories(id) on delete set null;

alter table public.shop_products
add column if not exists category_id uuid references public.product_categories(id) on delete set null;

update public.inventory_items ii
set category_id = pc.id
from public.product_categories pc
where ii.category_id is null
  and lower(trim(ii.category)) = pc.normalized_name;

update public.shop_products sp
set category_id = coalesce(ii.category_id, pc.id)
from public.product_categories pc
left join public.inventory_items ii on ii.id = sp.inventory_item_id
where sp.category_id is null
  and lower(trim(sp.category)) = pc.normalized_name;

update public.inventory_items
set category_id = (
  select id from public.product_categories where normalized_name = 'other' limit 1
)
where category_id is null;

update public.shop_products
set category_id = (
  select id from public.product_categories where normalized_name = 'other' limit 1
)
where category_id is null;

create index if not exists inventory_items_category_id_idx
on public.inventory_items (category_id);

create index if not exists shop_products_category_id_idx
on public.shop_products (category_id);

create or replace function public.get_category_id(
  p_category_id uuid default null,
  p_category text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_id uuid;
  v_category_name text;
begin
  if p_category_id is not null then
    select id into v_category_id
    from public.product_categories
    where id = p_category_id;
    if v_category_id is not null then
      return v_category_id;
    end if;
  end if;

  v_category_name := coalesce(nullif(trim(p_category), ''), 'Other');

  insert into public.product_categories (name, is_default)
  values (
    v_category_name,
    lower(v_category_name) in ('recovery', 'strength', 'training', 'tennis gear', 'accessories', 'other')
  )
  on conflict (normalized_name) do update
  set name = excluded.name
  returning id into v_category_id;

  return v_category_id;
end;
$$;

create or replace function public.process_supplier_invoice_item(
  p_invoice_id uuid,
  p_product_name text,
  p_sku text,
  p_quantity integer,
  p_unit_cost numeric,
  p_total_cost numeric,
  p_invoice_number text default null,
  p_invoice_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inventory_item_id uuid;
  v_normalized_name text;
  v_category_id uuid;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can process supplier invoices.';
  end if;

  if p_quantity <= 0 then
    raise exception 'Invoice quantity must be greater than zero.';
  end if;

  v_category_id := public.get_category_id(null, 'Other');
  v_normalized_name := lower(regexp_replace(trim(p_product_name), '\s+', ' ', 'g'));

  if p_sku is not null and trim(p_sku) <> '' then
    select id into v_inventory_item_id
    from public.inventory_items
    where lower(sku) = lower(trim(p_sku))
    limit 1
    for update;
  end if;

  if v_inventory_item_id is null then
    select id into v_inventory_item_id
    from public.inventory_items
    where normalized_name = v_normalized_name
    limit 1
    for update;
  end if;

  if v_inventory_item_id is null then
    insert into public.inventory_items (
      product_name,
      sku,
      supplier,
      category,
      category_id,
      cost_price,
      sell_price,
      quantity_on_hand,
      status,
      visible_in_shop,
      review_status
    )
    values (
      trim(p_product_name),
      nullif(trim(coalesce(p_sku, '')), ''),
      'Sportco',
      'Other',
      v_category_id,
      coalesce(p_unit_cost, 0),
      coalesce(p_unit_cost, 0),
      0,
      'new_supplier_item',
      false,
      'new_supplier_item'
    )
    returning id into v_inventory_item_id;
  else
    update public.inventory_items
    set
      supplier = 'Sportco',
      cost_price = coalesce(p_unit_cost, cost_price),
      sku = coalesce(nullif(trim(coalesce(p_sku, '')), ''), sku),
      category_id = coalesce(category_id, v_category_id)
    where id = v_inventory_item_id;
  end if;

  perform public.apply_stock_movement(
    v_inventory_item_id,
    p_quantity,
    'stock_in',
    'Sportco invoice upload',
    'supplier_invoice',
    p_invoice_id
  );

  insert into public.supplier_invoice_items (
    invoice_id,
    inventory_item_id,
    product_name,
    sku,
    quantity_purchased,
    unit_cost,
    total_cost,
    supplier,
    invoice_number,
    invoice_date
  )
  values (
    p_invoice_id,
    v_inventory_item_id,
    trim(p_product_name),
    nullif(trim(coalesce(p_sku, '')), ''),
    p_quantity,
    coalesce(p_unit_cost, 0),
    coalesce(p_total_cost, coalesce(p_unit_cost, 0) * p_quantity),
    'Sportco',
    p_invoice_number,
    p_invoice_date
  );

  return v_inventory_item_id;
end;
$$;

create or replace function public.publish_inventory_item_to_shop(
  p_inventory_item_id uuid,
  p_category_id uuid default null,
  p_category text default null,
  p_description text default null,
  p_sell_price numeric default null,
  p_discount numeric default 0,
  p_image text default null
)
returns public.shop_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_shop_product public.shop_products;
  v_product_id text;
  v_category_id uuid;
  v_category_name text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can publish shop products.';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if not found then
    raise exception 'Inventory item % was not found.', p_inventory_item_id;
  end if;

  v_category_id := public.get_category_id(coalesce(p_category_id, v_item.category_id), coalesce(p_category, v_item.category, 'Other'));
  select name into v_category_name from public.product_categories where id = v_category_id;
  v_product_id := coalesce(v_item.shop_product_id, 'inv-' || v_item.id::text);

  insert into public.shop_products (
    id,
    inventory_item_id,
    category_id,
    name,
    category,
    description,
    price,
    discount,
    image,
    is_active
  )
  values (
    v_product_id,
    v_item.id,
    v_category_id,
    v_item.product_name,
    v_category_name,
    p_description,
    coalesce(p_sell_price, v_item.sell_price, v_item.cost_price, 0),
    coalesce(p_discount, 0),
    p_image,
    true
  )
  on conflict (id) do update
  set
    inventory_item_id = excluded.inventory_item_id,
    category_id = excluded.category_id,
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    price = excluded.price,
    discount = excluded.discount,
    image = coalesce(excluded.image, public.shop_products.image),
    is_active = true,
    updated_at = now()
  returning * into v_shop_product;

  update public.inventory_items
  set
    shop_product_id = v_shop_product.id,
    category_id = v_category_id,
    category = v_category_name,
    description = coalesce(v_shop_product.description, description),
    image = coalesce(v_shop_product.image, image),
    sell_price = v_shop_product.price,
    visible_in_shop = true,
    is_active = true,
    review_status = 'reviewed'
  where id = v_item.id;

  perform public.recalculate_inventory_status(v_item.id);
  return v_shop_product;
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
  p_quantity_on_hand integer default 0,
  p_low_stock_threshold integer default 2,
  p_need_order_threshold integer default 0,
  p_image text default null,
  p_visible_in_shop boolean default false,
  p_is_active boolean default true
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
  v_product_id text;
  v_category_id uuid;
  v_category_name text;
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

  v_category_id := public.get_category_id(p_category_id, p_category);
  select name into v_category_name from public.product_categories where id = v_category_id;

  if p_inventory_item_id is null then
    insert into public.inventory_items (
      product_name,
      sku,
      supplier,
      category_id,
      category,
      description,
      image,
      cost_price,
      sell_price,
      quantity_on_hand,
      low_stock_threshold,
      need_order_threshold,
      visible_in_shop,
      is_active,
      review_status
    )
    values (
      trim(p_product_name),
      nullif(trim(coalesce(p_sku, '')), ''),
      coalesce(nullif(trim(p_supplier), ''), 'Sportco'),
      v_category_id,
      v_category_name,
      nullif(trim(coalesce(p_description, '')), ''),
      p_image,
      coalesce(p_cost_price, 0),
      coalesce(p_sell_price, 0),
      0,
      coalesce(p_low_stock_threshold, 2),
      coalesce(p_need_order_threshold, 0),
      coalesce(p_visible_in_shop, false),
      coalesce(p_is_active, true),
      'reviewed'
    )
    returning * into v_item;

    if p_quantity_on_hand > 0 then
      perform public.apply_stock_movement(
        v_item.id,
        p_quantity_on_hand,
        'adjustment',
        'Initial manual inventory entry',
        null,
        null
      );
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
      category_id = v_category_id,
      category = v_category_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      image = coalesce(p_image, image),
      cost_price = coalesce(p_cost_price, 0),
      sell_price = coalesce(p_sell_price, 0),
      low_stock_threshold = coalesce(p_low_stock_threshold, 2),
      need_order_threshold = coalesce(p_need_order_threshold, 0),
      visible_in_shop = coalesce(p_visible_in_shop, false),
      is_active = coalesce(p_is_active, true),
      archived_at = case when coalesce(p_is_active, true) then null else archived_at end,
      archived_by = case when coalesce(p_is_active, true) then null else archived_by end
    where id = p_inventory_item_id
    returning * into v_item;

    v_quantity_delta := p_quantity_on_hand - v_existing_quantity;
    if v_quantity_delta <> 0 then
      perform public.apply_stock_movement(
        p_inventory_item_id,
        v_quantity_delta,
        'adjustment',
        'Manual quantity edit',
        null,
        null
      );
    end if;
  end if;

  select * into v_item
  from public.inventory_items
  where id = coalesce(p_inventory_item_id, v_item.id);

  if v_item.visible_in_shop and v_item.is_active and v_item.archived_at is null then
    v_product_id := coalesce(v_item.shop_product_id, 'inv-' || v_item.id::text);
    insert into public.shop_products (
      id,
      inventory_item_id,
      category_id,
      name,
      category,
      description,
      price,
      discount,
      image,
      is_active
    )
    values (
      v_product_id,
      v_item.id,
      v_category_id,
      v_item.product_name,
      v_category_name,
      v_item.description,
      v_item.sell_price,
      0,
      v_item.image,
      true
    )
    on conflict (id) do update
    set
      inventory_item_id = excluded.inventory_item_id,
      category_id = excluded.category_id,
      name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      price = excluded.price,
      image = coalesce(excluded.image, public.shop_products.image),
      is_active = true,
      updated_at = now();

    update public.inventory_items
    set shop_product_id = v_product_id
    where id = v_item.id;
  elsif v_item.shop_product_id is not null then
    update public.shop_products
    set is_active = false
    where id = v_item.shop_product_id;
  end if;

  perform public.recalculate_inventory_status(v_item.id);
  select * into v_item from public.inventory_items where id = v_item.id;
  return v_item;
end;
$$;

grant execute on function public.get_category_id(uuid, text) to authenticated, service_role;
grant execute on function public.publish_inventory_item_to_shop(uuid, uuid, text, text, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.admin_save_inventory_item(uuid, text, text, text, uuid, text, text, numeric, numeric, integer, integer, integer, text, boolean, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
