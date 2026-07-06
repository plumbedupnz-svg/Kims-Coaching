-- Kim's Coaching inventory to shop product fulfilment fix
-- Inventory items are stock-held products, so any linked public product must use
-- fulfilment_type = 'stock' to satisfy products_fulfilment_type_check.

create extension if not exists pgcrypto;

alter table public.inventory_items
add column if not exists image text,
add column if not exists image_url text;

alter table public.shop_products
add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists name text,
add column if not exists category text,
add column if not exists description text,
add column if not exists price numeric(10, 2) not null default 0,
add column if not exists discount numeric(5, 2) not null default 0,
add column if not exists image text,
add column if not exists is_active boolean not null default true,
add column if not exists updated_at timestamptz not null default now();

alter table public.products
add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists category text default 'Other',
add column if not exists description text,
add column if not exists price numeric(10, 2) not null default 0,
add column if not exists discount numeric(5, 2) not null default 0,
add column if not exists image_url text,
add column if not exists fulfilment_type text default 'order_to_sale',
add column if not exists is_active boolean not null default true,
add column if not exists visible_in_shop boolean not null default true,
add column if not exists quantity_on_hand integer not null default 0,
add column if not exists stock_status text not null default 'order_to_sale',
add column if not exists archived_at timestamptz,
add column if not exists updated_at timestamptz not null default now();

do $$
declare
  v_id_type text;
  v_id_default text;
begin
  select data_type, column_default
  into v_id_type, v_id_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name = 'id';

  if v_id_type = 'uuid' and v_id_default is null then
    alter table public.products
    alter column id set default gen_random_uuid();
  end if;
end $$;

alter table public.products
drop constraint if exists products_fulfilment_type_check;

update public.products
set
  fulfilment_type = case
    when inventory_item_id is not null then 'stock'
    when lower(coalesce(fulfilment_type, '')) in ('stock', 'stocked', 'held_in_stock', 'inventory', 'inventory_item', 'stock_item') then 'stock'
    when lower(coalesce(fulfilment_type, '')) in ('order_to_sale', 'order-to-sale', 'order to sale') then 'order_to_sale'
    else 'order_to_sale'
  end,
  stock_status = case
    when inventory_item_id is not null then coalesce(nullif(stock_status, ''), 'in_stock')
    else coalesce(nullif(stock_status, ''), 'order_to_sale')
  end,
  visible_in_shop = coalesce(visible_in_shop, true),
  is_active = coalesce(is_active, true),
  updated_at = now();

alter table public.products
alter column fulfilment_type set default 'order_to_sale',
alter column fulfilment_type set not null;

alter table public.products
add constraint products_fulfilment_type_check
check (fulfilment_type in ('stock', 'order_to_sale'));

create unique index if not exists products_inventory_item_id_unique_idx
on public.products (inventory_item_id)
where inventory_item_id is not null;

create index if not exists products_fulfilment_type_idx
on public.products (fulfilment_type);

create or replace function public.sync_inventory_item_to_public_product(
  p_inventory_item_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_product_id text;
  v_category_name text;
  v_products_id text;
  v_products_id_type text;
  v_image_url text;
begin
  select *
  into v_item
  from public.inventory_items
  where id = p_inventory_item_id;

  if not found then
    raise exception 'Inventory item % was not found.', p_inventory_item_id;
  end if;

  select name
  into v_category_name
  from public.product_categories
  where id = v_item.category_id;

  v_category_name := coalesce(v_category_name, v_item.category, 'Other');
  v_product_id := coalesce(v_item.shop_product_id, 'inv-' || v_item.id::text);
  v_image_url := nullif(coalesce(v_item.image_url, v_item.image), '');

  if v_item.visible_in_shop and coalesce(v_item.is_active, true) and v_item.archived_at is null then
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
      v_item.category_id,
      v_item.product_name,
      v_category_name,
      v_item.description,
      v_item.sell_price,
      0,
      v_image_url,
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

    select data_type
    into v_products_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'id';

    if v_products_id_type in ('text', 'character varying') then
      execute $sql$
        insert into public.products (
          id,
          inventory_item_id,
          category_id,
          name,
          category,
          description,
          price,
          discount,
          image_url,
          is_active,
          visible_in_shop,
          fulfilment_type,
          quantity_on_hand,
          stock_status,
          archived_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, 0, $8, true, true, 'stock', $9, $10, null, now())
        on conflict (inventory_item_id) where inventory_item_id is not null do update
        set
          category_id = excluded.category_id,
          name = excluded.name,
          category = excluded.category,
          description = excluded.description,
          price = excluded.price,
          image_url = coalesce(excluded.image_url, public.products.image_url),
          is_active = true,
          visible_in_shop = true,
          fulfilment_type = 'stock',
          quantity_on_hand = excluded.quantity_on_hand,
          stock_status = excluded.stock_status,
          archived_at = null,
          updated_at = now()
        returning id::text
      $sql$
      into v_products_id
      using
        v_product_id,
        v_item.id,
        v_item.category_id,
        v_item.product_name,
        v_category_name,
        v_item.description,
        v_item.sell_price,
        v_image_url,
        v_item.quantity_on_hand,
        coalesce(v_item.status, 'in_stock');
    else
      execute $sql$
        insert into public.products (
          inventory_item_id,
          category_id,
          name,
          category,
          description,
          price,
          discount,
          image_url,
          is_active,
          visible_in_shop,
          fulfilment_type,
          quantity_on_hand,
          stock_status,
          archived_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, 0, $7, true, true, 'stock', $8, $9, null, now())
        on conflict (inventory_item_id) where inventory_item_id is not null do update
        set
          category_id = excluded.category_id,
          name = excluded.name,
          category = excluded.category,
          description = excluded.description,
          price = excluded.price,
          image_url = coalesce(excluded.image_url, public.products.image_url),
          is_active = true,
          visible_in_shop = true,
          fulfilment_type = 'stock',
          quantity_on_hand = excluded.quantity_on_hand,
          stock_status = excluded.stock_status,
          archived_at = null,
          updated_at = now()
        returning id::text
      $sql$
      into v_products_id
      using
        v_item.id,
        v_item.category_id,
        v_item.product_name,
        v_category_name,
        v_item.description,
        v_item.sell_price,
        v_image_url,
        v_item.quantity_on_hand,
        coalesce(v_item.status, 'in_stock');
    end if;

    update public.inventory_items
    set shop_product_id = v_product_id
    where id = v_item.id;

    return coalesce(v_products_id, v_product_id);
  end if;

  update public.shop_products
  set
    is_active = false,
    updated_at = now()
  where id = v_product_id
    or inventory_item_id = v_item.id;

  execute $sql$
    update public.products
    set
      is_active = false,
      visible_in_shop = false,
      updated_at = now()
    where inventory_item_id = $1
      or id::text = $2
    returning id::text
  $sql$
  into v_products_id
  using v_item.id, v_product_id;

  return coalesce(v_products_id, v_product_id);
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
  v_image_url text;
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
  v_image_url := nullif(coalesce(p_image, v_item.image_url, v_item.image), '');

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
    coalesce(p_description, v_item.description),
    coalesce(p_sell_price, v_item.sell_price, v_item.cost_price, 0),
    coalesce(p_discount, 0),
    v_image_url,
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
    image_url = coalesce(v_shop_product.image, image_url),
    sell_price = v_shop_product.price,
    visible_in_shop = true,
    is_active = true,
    review_status = 'reviewed'
  where id = v_item.id;

  perform public.recalculate_inventory_status(v_item.id);
  perform public.sync_inventory_item_to_public_product(v_item.id);

  return v_shop_product;
end;
$$;

create or replace function public.publish_inventory_item_to_shop(
  p_inventory_item_id uuid,
  p_category text,
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
begin
  return public.publish_inventory_item_to_shop(
    p_inventory_item_id,
    null,
    p_category,
    p_description,
    p_sell_price,
    p_discount,
    p_image
  );
end;
$$;

grant execute on function public.sync_inventory_item_to_public_product(uuid) to authenticated, service_role;
grant execute on function public.publish_inventory_item_to_shop(uuid, uuid, text, text, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.publish_inventory_item_to_shop(uuid, text, text, numeric, numeric, text) to authenticated, service_role;

notify pgrst, 'reload schema';
