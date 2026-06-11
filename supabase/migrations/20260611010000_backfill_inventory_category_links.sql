insert into public.product_categories (name, is_default)
values
  ('Recovery', true),
  ('Strength', true),
  ('Training', true),
  ('Tennis Gear', true),
  ('Accessories', true),
  ('Other', true)
on conflict (normalized_name) do nothing;

update public.inventory_items ii
set category_id = pc.id
from public.product_categories pc
where ii.category_id is null
  and ii.category is not null
  and lower(trim(ii.category)) = pc.normalized_name;

update public.inventory_items ii
set category_id = pc.id,
    category = pc.name
from public.product_categories pc
where ii.category_id is null
  and pc.normalized_name = 'other';

update public.inventory_items ii
set category = pc.name
from public.product_categories pc
where ii.category_id = pc.id
  and coalesce(trim(ii.category), '') <> pc.name;

update public.inventory_items
set is_active = true
where is_active is null;

notify pgrst, 'reload schema';
