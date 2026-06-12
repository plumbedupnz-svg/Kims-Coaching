create table if not exists public.products (
  id text primary key,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  category_id uuid references public.product_categories(id) on delete set null,
  name text not null,
  category text not null default 'Training',
  description text,
  price numeric(10, 2) not null default 0,
  discount numeric(5, 2) not null default 0,
  image text,
  is_active boolean not null default true,
  visible_in_shop boolean not null default true,
  quantity_on_hand integer not null default 0,
  stock_status text not null default 'out_of_stock',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists name text,
add column if not exists category text not null default 'Training',
add column if not exists description text,
add column if not exists price numeric(10, 2) not null default 0,
add column if not exists discount numeric(5, 2) not null default 0,
add column if not exists image text,
add column if not exists is_active boolean not null default true,
add column if not exists visible_in_shop boolean not null default true,
add column if not exists quantity_on_hand integer not null default 0,
add column if not exists stock_status text not null default 'out_of_stock',
add column if not exists archived_at timestamptz,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

update public.products
set name = coalesce(nullif(trim(name), ''), 'Unnamed product')
where name is null or trim(name) = '';

alter table public.products
alter column name set not null;

create unique index if not exists products_inventory_item_id_unique_idx
on public.products (inventory_item_id)
where inventory_item_id is not null;

create index if not exists products_category_id_idx
on public.products (category_id);

create index if not exists products_active_visible_idx
on public.products (is_active, visible_in_shop);

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

  if v_item.visible_in_shop and v_item.is_active and v_item.archived_at is null then
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
          image,
          is_active,
          visible_in_shop,
          quantity_on_hand,
          stock_status,
          archived_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, 0, $8, true, true, $9, $10, $11, now())
        on conflict (inventory_item_id) where inventory_item_id is not null do update
        set
          category_id = excluded.category_id,
          name = excluded.name,
          category = excluded.category,
          description = excluded.description,
          price = excluded.price,
          image = coalesce(excluded.image, public.products.image),
          is_active = true,
          visible_in_shop = true,
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
        v_item.image,
        v_item.quantity_on_hand,
        v_item.status,
        v_item.archived_at;
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
          image,
          is_active,
          visible_in_shop,
          quantity_on_hand,
          stock_status,
          archived_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, 0, $7, true, true, $8, $9, $10, now())
        on conflict (inventory_item_id) where inventory_item_id is not null do update
        set
          category_id = excluded.category_id,
          name = excluded.name,
          category = excluded.category,
          description = excluded.description,
          price = excluded.price,
          image = coalesce(excluded.image, public.products.image),
          is_active = true,
          visible_in_shop = true,
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
        v_item.image,
        v_item.quantity_on_hand,
        v_item.status,
        v_item.archived_at;
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
  v_public_product_id text;
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

  perform public.recalculate_inventory_status(v_item.id);
  select * into v_item from public.inventory_items where id = v_item.id;

  v_public_product_id := public.sync_inventory_item_to_public_product(v_item.id);

  select * into v_item from public.inventory_items where id = v_item.id;
  return v_item;
end;
$$;

do $$
declare
  v_products_id_type text;
begin
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
        image,
        is_active,
        visible_in_shop,
        quantity_on_hand,
        stock_status,
        archived_at,
        updated_at
      )
      select
        coalesce(ii.shop_product_id, 'inv-' || ii.id::text),
        ii.id,
        ii.category_id,
        ii.product_name,
        coalesce(pc.name, ii.category, 'Other'),
        ii.description,
        ii.sell_price,
        0,
        ii.image,
        true,
        true,
        ii.quantity_on_hand,
        ii.status,
        ii.archived_at,
        now()
      from public.inventory_items ii
      left join public.product_categories pc on pc.id = ii.category_id
      where ii.visible_in_shop = true
        and ii.is_active = true
        and ii.archived_at is null
      on conflict (inventory_item_id) where inventory_item_id is not null do update
      set
        category_id = excluded.category_id,
        name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        price = excluded.price,
        image = coalesce(excluded.image, public.products.image),
        is_active = true,
        visible_in_shop = true,
        quantity_on_hand = excluded.quantity_on_hand,
        stock_status = excluded.stock_status,
        archived_at = excluded.archived_at,
        updated_at = now()
    $sql$;
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
        image,
        is_active,
        visible_in_shop,
        quantity_on_hand,
        stock_status,
        archived_at,
        updated_at
      )
      select
        ii.id,
        ii.category_id,
        ii.product_name,
        coalesce(pc.name, ii.category, 'Other'),
        ii.description,
        ii.sell_price,
        0,
        ii.image,
        true,
        true,
        ii.quantity_on_hand,
        ii.status,
        ii.archived_at,
        now()
      from public.inventory_items ii
      left join public.product_categories pc on pc.id = ii.category_id
      where ii.visible_in_shop = true
        and ii.is_active = true
        and ii.archived_at is null
      on conflict (inventory_item_id) where inventory_item_id is not null do update
      set
        category_id = excluded.category_id,
        name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        price = excluded.price,
        image = coalesce(excluded.image, public.products.image),
        is_active = true,
        visible_in_shop = true,
        quantity_on_hand = excluded.quantity_on_hand,
        stock_status = excluded.stock_status,
        archived_at = excluded.archived_at,
        updated_at = now()
    $sql$;
  end if;
end;
$$;

update public.products p
set
  is_active = false,
  visible_in_shop = false,
  updated_at = now()
from public.inventory_items ii
where p.inventory_item_id = ii.id
  and (
    ii.visible_in_shop = false
    or ii.is_active = false
    or ii.archived_at is not null
  );

alter table public.products enable row level security;

drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products"
on public.products
for select
using (is_active = true and visible_in_shop = true);

drop policy if exists "Admins can manage products" on public.products;
create policy "Admins can manage products"
on public.products
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant execute on function public.sync_inventory_item_to_public_product(uuid) to authenticated, service_role;
grant execute on function public.admin_save_inventory_item(uuid, text, text, text, uuid, text, text, numeric, numeric, integer, integer, integer, text, boolean, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
