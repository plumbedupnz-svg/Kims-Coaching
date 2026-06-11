alter table public.inventory_items
add column if not exists category_id uuid references public.product_categories(id) on delete set null,
add column if not exists is_active boolean not null default true,
add column if not exists archived_at timestamptz,
add column if not exists visible_in_shop boolean not null default false,
add column if not exists status text not null default 'out_of_stock';

update public.inventory_items ii
set category_id = null
where category_id is not null
  and not exists (
    select 1
    from public.product_categories pc
    where pc.id = ii.category_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_items_category_id_fkey'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
    add constraint inventory_items_category_id_fkey
    foreign key (category_id)
    references public.product_categories(id)
    on delete set null;
  end if;
end;
$$;

create index if not exists inventory_items_category_id_idx
on public.inventory_items (category_id);

create index if not exists inventory_items_active_archived_idx
on public.inventory_items (is_active, archived_at);

alter table public.inventory_items enable row level security;

drop policy if exists "Admins can manage inventory items" on public.inventory_items;
create policy "Admins can manage inventory items"
on public.inventory_items
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select, insert, update, delete on public.inventory_items to authenticated;

notify pgrst, 'reload schema';
