alter table public.supplier_invoice_items
add column if not exists matched_inventory_item_id uuid references public.inventory_items(id) on delete set null,
add column if not exists suggested_category_id uuid references public.product_categories(id) on delete set null,
add column if not exists final_category_id uuid references public.product_categories(id) on delete set null,
add column if not exists sell_price numeric(10, 2) not null default 0,
add column if not exists visible_in_shop boolean not null default false,
add column if not exists review_status text not null default 'reviewed';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_invoice_items_review_status_valid'
      and conrelid = 'public.supplier_invoice_items'::regclass
  ) then
    alter table public.supplier_invoice_items
    add constraint supplier_invoice_items_review_status_valid
    check (review_status in ('matched', 'new_supplier_item', 'reviewed', 'needs_review', 'imported'));
  end if;
end;
$$;

create index if not exists supplier_invoice_items_final_category_id_idx
on public.supplier_invoice_items (final_category_id);

create index if not exists supplier_invoice_items_review_status_idx
on public.supplier_invoice_items (review_status);

create or replace function public.import_reviewed_supplier_invoice_item(
  p_invoice_id uuid,
  p_inventory_item_id uuid default null,
  p_product_name text default '',
  p_sku text default null,
  p_quantity integer default 0,
  p_unit_cost numeric default 0,
  p_total_cost numeric default 0,
  p_category_id uuid default null,
  p_category text default 'Other',
  p_sell_price numeric default 0,
  p_visible_in_shop boolean default false,
  p_review_status text default 'reviewed',
  p_invoice_number text default null,
  p_invoice_date date default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inventory_item_id uuid;
  v_inventory_item public.inventory_items;
  v_normalized_name text;
  v_category_id uuid;
  v_category_name text;
  v_supplier_item_status text;
  v_invoice_item_status text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can import reviewed supplier invoices.';
  end if;

  if p_invoice_id is null then
    raise exception 'Invoice is required.';
  end if;

  if nullif(trim(p_product_name), '') is null then
    raise exception 'Product name is required.';
  end if;

  if p_quantity <= 0 then
    raise exception 'Invoice quantity must be greater than zero.';
  end if;

  if coalesce(p_unit_cost, 0) < 0 or coalesce(p_total_cost, 0) < 0 or coalesce(p_sell_price, 0) < 0 then
    raise exception 'Costs and sell price cannot be negative.';
  end if;

  if coalesce(p_review_status, 'reviewed') = 'needs_review' then
    raise exception 'Resolve review status before importing.';
  end if;

  v_category_id := public.get_category_id(p_category_id, p_category);
  select name into v_category_name
  from public.product_categories
  where id = v_category_id;

  if p_inventory_item_id is not null then
    select id into v_inventory_item_id
    from public.inventory_items
    where id = p_inventory_item_id
    for update;
  end if;

  v_normalized_name := lower(regexp_replace(trim(p_product_name), '\s+', ' ', 'g'));

  if v_inventory_item_id is null and p_sku is not null and trim(p_sku) <> '' then
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
    v_supplier_item_status := 'new_supplier_item';
    insert into public.inventory_items (
      product_name,
      sku,
      supplier,
      category_id,
      category,
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
      v_category_id,
      v_category_name,
      coalesce(p_unit_cost, 0),
      coalesce(nullif(p_sell_price, 0), p_unit_cost, 0),
      0,
      'new_supplier_item',
      false,
      v_supplier_item_status
    )
    returning id into v_inventory_item_id;
  else
    v_supplier_item_status := 'reviewed';
    update public.inventory_items
    set
      supplier = 'Sportco',
      sku = coalesce(nullif(trim(coalesce(p_sku, '')), ''), sku),
      category_id = v_category_id,
      category = v_category_name,
      cost_price = coalesce(p_unit_cost, cost_price),
      sell_price = case
        when coalesce(p_sell_price, 0) > 0 then p_sell_price
        else sell_price
      end,
      review_status = case
        when review_status = 'new_supplier_item' then 'reviewed'
        else review_status
      end
    where id = v_inventory_item_id;
  end if;

  perform public.apply_stock_movement(
    v_inventory_item_id,
    p_quantity,
    'stock_in',
    'Sportco invoice import',
    'supplier_invoice',
    p_invoice_id
  );

  v_invoice_item_status := case
    when v_supplier_item_status = 'new_supplier_item' then 'new_supplier_item'
    when coalesce(p_review_status, '') = 'matched' then 'matched'
    else 'reviewed'
  end;

  insert into public.supplier_invoice_items (
    invoice_id,
    inventory_item_id,
    matched_inventory_item_id,
    suggested_category_id,
    final_category_id,
    product_name,
    sku,
    quantity_purchased,
    unit_cost,
    total_cost,
    supplier,
    invoice_number,
    invoice_date,
    sell_price,
    visible_in_shop,
    review_status
  )
  values (
    p_invoice_id,
    v_inventory_item_id,
    p_inventory_item_id,
    v_category_id,
    v_category_id,
    trim(p_product_name),
    nullif(trim(coalesce(p_sku, '')), ''),
    p_quantity,
    coalesce(p_unit_cost, 0),
    coalesce(p_total_cost, coalesce(p_unit_cost, 0) * p_quantity),
    'Sportco',
    p_invoice_number,
    p_invoice_date,
    coalesce(p_sell_price, 0),
    coalesce(p_visible_in_shop, false),
    v_invoice_item_status
  );

  if coalesce(p_visible_in_shop, false) then
    perform public.publish_inventory_item_to_shop(
      v_inventory_item_id,
      v_category_id,
      v_category_name,
      null,
      coalesce(nullif(p_sell_price, 0), p_unit_cost, 0),
      0,
      null
    );
  end if;

  perform public.recalculate_inventory_status(v_inventory_item_id);

  select * into v_inventory_item
  from public.inventory_items
  where id = v_inventory_item_id;

  return v_inventory_item;
end;
$$;

grant execute on function public.import_reviewed_supplier_invoice_item(uuid, uuid, text, text, integer, numeric, numeric, uuid, text, numeric, boolean, text, text, date)
to authenticated, service_role;

notify pgrst, 'reload schema';
