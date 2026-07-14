-- Admin reports: product cost prices, junior programme cost settings, and shop order item snapshots.
-- Safe to run more than once in Supabase SQL Editor.

alter table public.products
add column if not exists purchase_price numeric(10, 2) not null default 0,
add column if not exists cost_price numeric(10, 2) not null default 0;

update public.products p
set
  purchase_price = coalesce(nullif(p.purchase_price, 0), nullif(p.cost_price, 0), nullif(ii.cost_price, 0), 0),
  cost_price = coalesce(nullif(p.cost_price, 0), nullif(p.purchase_price, 0), nullif(ii.cost_price, 0), 0)
from public.inventory_items ii
where p.inventory_item_id = ii.id;

alter table public.junior_programmes
add column if not exists coach_cost_per_session numeric(10, 2),
add column if not exists court_cost_per_session numeric(10, 2),
add column if not exists fixed_programme_cost numeric(10, 2);

alter table public.junior_groups
add column if not exists coach_cost_per_session numeric(10, 2),
add column if not exists court_cost_per_session numeric(10, 2),
add column if not exists fixed_programme_cost numeric(10, 2);

create or replace function public.kims_reports_numeric(value text)
returns numeric
language plpgsql
immutable
as $$
declare
  cleaned text;
begin
  cleaned := nullif(regexp_replace(coalesce(value, ''), '[^0-9.\-]', '', 'g'), '');
  if cleaned is null then
    return null;
  end if;
  return cleaned::numeric;
exception
  when others then
    return null;
end;
$$;

update public.shop_orders so
set items = coalesce(snapshot.items, so.items)
from (
  select
    so_inner.id,
    jsonb_agg(
      item.value
      || jsonb_build_object(
        'category', coalesce(item.value->>'category', p.category, ii.category, 'Uncategorized'),
        'sale_price_at_sale', sale.sale_price,
        'purchase_price_at_sale', cost.purchase_price,
        'cost_price_at_sale', cost.purchase_price,
        'gross_profit_at_sale', round((sale.sale_price - cost.purchase_price) * qty.quantity, 2),
        'gross_margin_percent_at_sale',
          case
            when sale.sale_price > 0 then round(((sale.sale_price - cost.purchase_price) / sale.sale_price) * 100, 2)
            else 0
          end
      )
      order by item.ordinality
    ) as items
  from public.shop_orders so_inner
  cross join lateral jsonb_array_elements(so_inner.items) with ordinality as item(value, ordinality)
  left join public.products p on p.id = item.value->>'id'
  left join public.inventory_items ii
    on ii.id::text = coalesce(nullif(item.value->>'inventory_item_id', ''), nullif(item.value->>'id', ''))
  cross join lateral (
    select greatest(1, coalesce(public.kims_reports_numeric(item.value->>'quantity'), 1)) as quantity
  ) qty
  cross join lateral (
    select coalesce(
      public.kims_reports_numeric(item.value->>'sale_price_at_sale'),
      public.kims_reports_numeric(item.value->>'unitAmount'),
      public.kims_reports_numeric(item.value->>'price'),
      public.kims_reports_numeric(item.value->>'lineTotal') / nullif(qty.quantity, 0),
      p.price,
      ii.sell_price,
      0
    ) as sale_price
  ) sale
  cross join lateral (
    select coalesce(
      public.kims_reports_numeric(item.value->>'purchase_price_at_sale'),
      public.kims_reports_numeric(item.value->>'cost_price_at_sale'),
      p.purchase_price,
      p.cost_price,
      ii.cost_price,
      0
    ) as purchase_price
  ) cost
  where jsonb_typeof(so_inner.items) = 'array'
  group by so_inner.id
) snapshot
where so.id = snapshot.id
  and jsonb_typeof(so.items) = 'array';

drop function if exists public.kims_reports_numeric(text);

notify pgrst, 'reload schema';
