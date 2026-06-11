create or replace function public.admin_list_inventory_items()
returns setof public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Admin access required to read inventory items.';
  end if;

  return query
  select *
  from public.inventory_items
  order by product_name asc;
end;
$$;

grant execute on function public.current_user_is_admin() to authenticated, service_role;
grant execute on function public.admin_list_inventory_items() to authenticated, service_role;

alter table public.inventory_items enable row level security;

drop policy if exists "Admins can read inventory items" on public.inventory_items;
create policy "Admins can read inventory items"
on public.inventory_items
for select
to authenticated
using (public.current_user_is_admin());

grant select on public.inventory_items to authenticated;

notify pgrst, 'reload schema';
