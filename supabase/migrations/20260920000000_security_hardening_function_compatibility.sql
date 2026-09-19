-- Reapply privileged helper permissions without assuming every legacy helper
-- exists in every Kim Jones Coaching database installation.

do $$
begin
  if to_regprocedure('public.admin_list_inventory_items()') is not null then
    execute 'revoke all on function public.admin_list_inventory_items() from public, anon';
    execute 'grant execute on function public.admin_list_inventory_items() to authenticated, service_role';
  end if;

  if to_regprocedure('public.log_notification_attempt(uuid,text,text,text,uuid,text,text,text)') is not null then
    execute 'revoke all on function public.log_notification_attempt(uuid, text, text, text, uuid, text, text, text) from public, anon, authenticated';
    execute 'grant execute on function public.log_notification_attempt(uuid, text, text, text, uuid, text, text, text) to service_role';
  end if;

  if to_regprocedure('public.get_category_id(uuid,text)') is not null then
    execute 'revoke all on function public.get_category_id(uuid, text) from public, anon, authenticated';
    execute 'grant execute on function public.get_category_id(uuid, text) to service_role';
  end if;

  if to_regprocedure('public.sync_inventory_item_to_public_product(uuid)') is not null then
    execute 'revoke all on function public.sync_inventory_item_to_public_product(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.sync_inventory_item_to_public_product(uuid) to service_role';
  end if;

  if to_regprocedure('public.recalculate_inventory_status(uuid)') is not null then
    execute 'revoke all on function public.recalculate_inventory_status(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.recalculate_inventory_status(uuid) to service_role';
  end if;

  if to_regprocedure('public.apply_stock_movement(uuid,integer,text,text,text,uuid)') is not null then
    execute 'revoke all on function public.apply_stock_movement(uuid, integer, text, text, text, uuid) from public, anon, authenticated';
    execute 'grant execute on function public.apply_stock_movement(uuid, integer, text, text, text, uuid) to service_role';
  end if;

  if to_regprocedure('public.create_shop_order_with_stock(uuid,text,text,text,jsonb,numeric,numeric)') is not null then
    execute 'revoke all on function public.create_shop_order_with_stock(uuid, text, text, text, jsonb, numeric, numeric) from public, anon, authenticated';
    execute 'grant execute on function public.create_shop_order_with_stock(uuid, text, text, text, jsonb, numeric, numeric) to service_role';
  end if;

  if to_regprocedure('public.publish_inventory_item_to_shop(uuid,uuid,text,text,numeric,numeric,text)') is not null then
    execute 'revoke all on function public.publish_inventory_item_to_shop(uuid, uuid, text, text, numeric, numeric, text) from public, anon';
    execute 'grant execute on function public.publish_inventory_item_to_shop(uuid, uuid, text, text, numeric, numeric, text) to authenticated, service_role';
  end if;

  if to_regprocedure('public.publish_inventory_item_to_shop(uuid,text,text,numeric,numeric,text)') is not null then
    execute 'revoke all on function public.publish_inventory_item_to_shop(uuid, text, text, numeric, numeric, text) from public, anon';
    execute 'grant execute on function public.publish_inventory_item_to_shop(uuid, text, text, numeric, numeric, text) to authenticated, service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
