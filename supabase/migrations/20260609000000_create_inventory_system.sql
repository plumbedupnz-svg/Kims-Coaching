create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  shop_product_id text,
  product_name text not null,
  normalized_name text generated always as (lower(regexp_replace(trim(product_name), '\s+', ' ', 'g'))) stored,
  sku text,
  supplier text not null default 'Sportco',
  cost_price numeric(10, 2) not null default 0,
  sell_price numeric(10, 2) not null default 0,
  quantity_on_hand integer not null default 0,
  low_stock_threshold integer not null default 2,
  need_order_threshold integer not null default 0,
  status text not null default 'out_of_stock',
  visible_in_shop boolean not null default false,
  review_status text not null default 'reviewed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_status_valid check (status in ('in_stock', 'low_stock', 'out_of_stock', 'need_to_order', 'new_supplier_item')),
  constraint inventory_items_review_status_valid check (review_status in ('reviewed', 'new_supplier_item', 'do_not_add_to_shop', 'merged')),
  constraint inventory_items_quantity_non_negative check (quantity_on_hand >= 0)
);

create unique index if not exists inventory_items_sku_unique_idx
on public.inventory_items (lower(sku))
where sku is not null and trim(sku) <> '';

create index if not exists inventory_items_normalized_name_idx
on public.inventory_items (normalized_name);

create index if not exists inventory_items_review_status_idx
on public.inventory_items (review_status);

create table if not exists public.shop_products (
  id text primary key,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  name text not null,
  category text not null default 'Training',
  description text,
  price numeric(10, 2) not null default 0,
  discount numeric(5, 2) not null default 0,
  image text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_products_discount_valid check (discount >= 0 and discount <= 100)
);

create index if not exists shop_products_inventory_item_id_idx
on public.shop_products (inventory_item_id);

create index if not exists shop_products_category_idx
on public.shop_products (category);

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier text not null default 'Sportco',
  invoice_number text,
  invoice_date date,
  storage_path text,
  file_name text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists supplier_invoices_supplier_idx
on public.supplier_invoices (supplier);

create table if not exists public.supplier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.supplier_invoices(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  product_name text not null,
  sku text,
  quantity_purchased integer not null default 0,
  unit_cost numeric(10, 2) not null default 0,
  total_cost numeric(10, 2) not null default 0,
  supplier text not null default 'Sportco',
  invoice_number text,
  invoice_date date,
  created_at timestamptz not null default now(),
  constraint supplier_invoice_items_quantity_positive check (quantity_purchased > 0)
);

create index if not exists supplier_invoice_items_invoice_id_idx
on public.supplier_invoice_items (invoice_id);

create index if not exists supplier_invoice_items_inventory_item_id_idx
on public.supplier_invoice_items (inventory_item_id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  movement_type text not null,
  quantity_delta integer not null,
  quantity_before integer not null default 0,
  quantity_after integer not null default 0,
  reason text,
  related_type text,
  related_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint stock_movements_type_valid check (movement_type in ('stock_in', 'stock_out', 'adjustment', 'stock_return'))
);

create index if not exists stock_movements_inventory_item_id_idx
on public.stock_movements (inventory_item_id, created_at desc);

create index if not exists stock_movements_related_idx
on public.stock_movements (related_type, related_id);

create table if not exists public.shop_inventory_settings (
  id boolean primary key default true,
  hide_out_of_stock boolean not null default false,
  default_low_stock_threshold integer not null default 2,
  updated_at timestamptz not null default now(),
  constraint shop_inventory_settings_singleton check (id = true)
);

insert into public.shop_inventory_settings (id)
values (true)
on conflict (id) do nothing;

create or replace function public.set_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_inventory_items_updated_at on public.inventory_items;
create trigger set_inventory_items_updated_at
before update on public.inventory_items
for each row
execute function public.set_inventory_updated_at();

drop trigger if exists set_shop_products_updated_at on public.shop_products;
create trigger set_shop_products_updated_at
before update on public.shop_products
for each row
execute function public.set_inventory_updated_at();

drop trigger if exists set_shop_inventory_settings_updated_at on public.shop_inventory_settings;
create trigger set_shop_inventory_settings_updated_at
before update on public.shop_inventory_settings
for each row
execute function public.set_inventory_updated_at();

create or replace function public.recalculate_inventory_status(p_inventory_item_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_status text;
begin
  select * into v_item
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if not found then
    raise exception 'Inventory item % was not found.', p_inventory_item_id;
  end if;

  if v_item.review_status = 'new_supplier_item' then
    v_status := 'new_supplier_item';
  elsif v_item.quantity_on_hand <= 0 then
    v_status := 'out_of_stock';
  elsif v_item.quantity_on_hand <= v_item.need_order_threshold then
    v_status := 'need_to_order';
  elsif v_item.quantity_on_hand <= v_item.low_stock_threshold then
    v_status := 'low_stock';
  else
    v_status := 'in_stock';
  end if;

  update public.inventory_items
  set status = v_status
  where id = p_inventory_item_id;

  return v_status;
end;
$$;

create or replace function public.apply_stock_movement(
  p_inventory_item_id uuid,
  p_quantity_delta integer,
  p_movement_type text,
  p_reason text default null,
  p_related_type text default null,
  p_related_id uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before integer;
  v_after integer;
  v_movement public.stock_movements;
begin
  if p_quantity_delta = 0 then
    raise exception 'Stock movement quantity cannot be zero.';
  end if;

  select quantity_on_hand into v_before
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if not found then
    raise exception 'Inventory item % was not found.', p_inventory_item_id;
  end if;

  v_after := v_before + p_quantity_delta;
  if v_after < 0 then
    raise exception 'Not enough stock available.';
  end if;

  update public.inventory_items
  set quantity_on_hand = v_after
  where id = p_inventory_item_id;

  insert into public.stock_movements (
    inventory_item_id,
    movement_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    reason,
    related_type,
    related_id,
    created_by
  )
  values (
    p_inventory_item_id,
    p_movement_type,
    p_quantity_delta,
    v_before,
    v_after,
    p_reason,
    p_related_type,
    p_related_id,
    auth.uid()
  )
  returning * into v_movement;

  perform public.recalculate_inventory_status(p_inventory_item_id);
  return v_movement;
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
  v_review_status text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can process supplier invoices.';
  end if;

  if p_quantity <= 0 then
    raise exception 'Invoice quantity must be greater than zero.';
  end if;

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
    v_review_status := 'new_supplier_item';
    insert into public.inventory_items (
      product_name,
      sku,
      supplier,
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
      coalesce(p_unit_cost, 0),
      coalesce(p_unit_cost, 0),
      0,
      'new_supplier_item',
      false,
      v_review_status
    )
    returning id into v_inventory_item_id;
  else
    update public.inventory_items
    set
      supplier = 'Sportco',
      cost_price = coalesce(p_unit_cost, cost_price),
      sku = coalesce(nullif(trim(coalesce(p_sku, '')), ''), sku)
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

create or replace function public.admin_adjust_inventory(
  p_inventory_item_id uuid,
  p_quantity_delta integer,
  p_reason text
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can adjust inventory.';
  end if;

  perform public.apply_stock_movement(
    p_inventory_item_id,
    p_quantity_delta,
    'adjustment',
    coalesce(nullif(trim(p_reason), ''), 'Manual stock adjustment'),
    null,
    null
  );

  select * into v_item from public.inventory_items where id = p_inventory_item_id;
  return v_item;
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
declare
  v_item public.inventory_items;
  v_shop_product public.shop_products;
  v_product_id text;
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

  v_product_id := coalesce(v_item.shop_product_id, 'inv-' || v_item.id::text);

  insert into public.shop_products (
    id,
    inventory_item_id,
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
    v_item.product_name,
    coalesce(nullif(trim(p_category), ''), 'Training'),
    p_description,
    coalesce(p_sell_price, v_item.sell_price, v_item.cost_price, 0),
    coalesce(p_discount, 0),
    p_image,
    true
  )
  on conflict (id) do update
  set
    inventory_item_id = excluded.inventory_item_id,
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
    sell_price = v_shop_product.price,
    visible_in_shop = true,
    review_status = 'reviewed'
  where id = v_item.id;

  perform public.recalculate_inventory_status(v_item.id);
  return v_shop_product;
end;
$$;

create or replace function public.mark_inventory_item_internal(
  p_inventory_item_id uuid
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can update inventory review status.';
  end if;

  update public.inventory_items
  set
    visible_in_shop = false,
    review_status = 'do_not_add_to_shop'
  where id = p_inventory_item_id
  returning * into v_item;

  if v_item.shop_product_id is not null then
    update public.shop_products
    set is_active = false
    where id = v_item.shop_product_id;
  end if;

  perform public.recalculate_inventory_status(p_inventory_item_id);
  select * into v_item from public.inventory_items where id = p_inventory_item_id;
  return v_item;
end;
$$;

create or replace function public.merge_inventory_item(
  p_source_item_id uuid,
  p_target_item_id uuid,
  p_reason text default 'Merged supplier invoice item'
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.inventory_items;
  v_target public.inventory_items;
  v_target_before integer;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can merge inventory items.';
  end if;

  if p_source_item_id = p_target_item_id then
    raise exception 'Choose a different item to merge into.';
  end if;

  select * into v_source
  from public.inventory_items
  where id = p_source_item_id
  for update;

  select * into v_target
  from public.inventory_items
  where id = p_target_item_id
  for update;

  if v_source.id is null or v_target.id is null then
    raise exception 'Inventory item was not found.';
  end if;

  v_target_before := v_target.quantity_on_hand;

  update public.inventory_items
  set quantity_on_hand = quantity_on_hand + v_source.quantity_on_hand
  where id = v_target.id;

  insert into public.stock_movements (
    inventory_item_id,
    movement_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    reason,
    related_type,
    related_id,
    created_by
  )
  values (
    v_target.id,
    'stock_in',
    v_source.quantity_on_hand,
    v_target_before,
    v_target_before + v_source.quantity_on_hand,
    coalesce(nullif(trim(p_reason), ''), 'Merged supplier invoice item'),
    'inventory_item',
    v_source.id,
    auth.uid()
  );

  update public.inventory_items
  set
    quantity_on_hand = 0,
    visible_in_shop = false,
    review_status = 'merged'
  where id = v_source.id;

  perform public.recalculate_inventory_status(v_target.id);
  perform public.recalculate_inventory_status(v_source.id);

  select * into v_target from public.inventory_items where id = p_target_item_id;
  return v_target;
end;
$$;

create or replace function public.create_shop_order_with_stock(
  p_user_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_mobile text,
  p_items jsonb,
  p_subtotal numeric,
  p_total numeric
)
returns public.shop_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shop_orders;
  v_cart_item jsonb;
  v_product_id text;
  v_quantity integer;
  v_inventory_item_id uuid;
  v_quantity_on_hand integer;
  v_name text;
  v_before integer;
  v_after integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'You must be logged in to place a shop order.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  for v_cart_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := v_cart_item->>'id';
    v_quantity := greatest(1, coalesce((v_cart_item->>'quantity')::integer, 1));

    select sp.inventory_item_id, ii.quantity_on_hand, sp.name
    into v_inventory_item_id, v_quantity_on_hand, v_name
    from public.shop_products sp
    join public.inventory_items ii on ii.id = sp.inventory_item_id
    where sp.id = v_product_id
      and sp.is_active = true
      and ii.visible_in_shop = true
    for update of ii;

    if v_inventory_item_id is null then
      raise exception 'Product % is not available in the shop.', coalesce(v_product_id, 'unknown');
    end if;

    if v_quantity_on_hand < v_quantity then
      raise exception 'Not enough stock available for %. Available: %, requested: %.', v_name, v_quantity_on_hand, v_quantity;
    end if;
  end loop;

  insert into public.shop_orders (
    user_id,
    customer_name,
    customer_email,
    mobile,
    items,
    subtotal,
    total,
    order_status
  )
  values (
    p_user_id,
    p_customer_name,
    p_customer_email,
    p_mobile,
    p_items,
    coalesce(p_subtotal, 0),
    coalesce(p_total, 0),
    'pending_payment'
  )
  returning * into v_order;

  for v_cart_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := v_cart_item->>'id';
    v_quantity := greatest(1, coalesce((v_cart_item->>'quantity')::integer, 1));

    select sp.inventory_item_id, ii.quantity_on_hand
    into v_inventory_item_id, v_before
    from public.shop_products sp
    join public.inventory_items ii on ii.id = sp.inventory_item_id
    where sp.id = v_product_id
    for update of ii;

    v_after := v_before - v_quantity;

    update public.inventory_items
    set quantity_on_hand = v_after
    where id = v_inventory_item_id;

    insert into public.stock_movements (
      inventory_item_id,
      movement_type,
      quantity_delta,
      quantity_before,
      quantity_after,
      reason,
      related_type,
      related_id,
      created_by
    )
    values (
      v_inventory_item_id,
      'stock_out',
      -v_quantity,
      v_before,
      v_after,
      'Customer shop order',
      'shop_order',
      v_order.id,
      auth.uid()
    );

    perform public.recalculate_inventory_status(v_inventory_item_id);
  end loop;

  return v_order;
end;
$$;

insert into public.shop_products (id, name, category, description, price, discount, image, is_active)
values
  ('agility-kit', 'Speed Agility Kit', 'Training', 'Cones, ladder, and bands for movement sessions.', 59.99, 0, '', true),
  ('power-bands', 'Resistance Power Bands', 'Strength', 'Warmup and strength band set.', 29.99, 0, '', true),
  ('recovery-roller', 'Recovery Roller', 'Recovery', 'Compact roller for post-session recovery.', 34.99, 0, '', true)
on conflict (id) do nothing;

alter table public.inventory_items enable row level security;
alter table public.shop_products enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.shop_inventory_settings enable row level security;

drop policy if exists "Admins can manage inventory items" on public.inventory_items;
create policy "Admins can manage inventory items"
on public.inventory_items
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Anyone can read active shop products" on public.shop_products;
create policy "Anyone can read active shop products"
on public.shop_products
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Admins can manage shop products" on public.shop_products;
create policy "Admins can manage shop products"
on public.shop_products
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage supplier invoices" on public.supplier_invoices;
create policy "Admins can manage supplier invoices"
on public.supplier_invoices
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage supplier invoice items" on public.supplier_invoice_items;
create policy "Admins can manage supplier invoice items"
on public.supplier_invoice_items
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can read stock movements" on public.stock_movements;
create policy "Admins can read stock movements"
on public.stock_movements
for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "Admins can create stock movements" on public.stock_movements;
create policy "Admins can create stock movements"
on public.stock_movements
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "Anyone can read shop inventory settings" on public.shop_inventory_settings;
create policy "Anyone can read shop inventory settings"
on public.shop_inventory_settings
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage shop inventory settings" on public.shop_inventory_settings;
create policy "Admins can manage shop inventory settings"
on public.shop_inventory_settings
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select, insert, update, delete on public.inventory_items to authenticated;
grant select on public.shop_products to anon, authenticated;
grant insert, update, delete on public.shop_products to authenticated;
grant select, insert, update, delete on public.supplier_invoices to authenticated;
grant select, insert, update, delete on public.supplier_invoice_items to authenticated;
grant select, insert on public.stock_movements to authenticated;
grant select on public.shop_inventory_settings to anon, authenticated;
grant insert, update on public.shop_inventory_settings to authenticated;

grant execute on function public.recalculate_inventory_status(uuid) to authenticated, service_role;
grant execute on function public.apply_stock_movement(uuid, integer, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.process_supplier_invoice_item(uuid, text, text, integer, numeric, numeric, text, date) to authenticated, service_role;
grant execute on function public.admin_adjust_inventory(uuid, integer, text) to authenticated, service_role;
grant execute on function public.publish_inventory_item_to_shop(uuid, text, text, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.mark_inventory_item_internal(uuid) to authenticated, service_role;
grant execute on function public.merge_inventory_item(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.create_shop_order_with_stock(uuid, text, text, text, jsonb, numeric, numeric) to authenticated, service_role;

insert into storage.buckets (id, name, public)
values ('supplier-invoices', 'supplier-invoices', false)
on conflict (id) do nothing;

drop policy if exists "Admins can manage supplier invoice PDFs" on storage.objects;
create policy "Admins can manage supplier invoice PDFs"
on storage.objects
for all
to authenticated
using (bucket_id = 'supplier-invoices' and public.current_user_is_admin())
with check (bucket_id = 'supplier-invoices' and public.current_user_is_admin());

notify pgrst, 'reload schema';
