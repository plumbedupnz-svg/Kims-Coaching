-- Raw order item snapshots include internal costs and margins.
-- Customer history is served through the verified, owner-scoped customer-history API.
begin;
alter policy "Customers can read own shop orders" on public.shop_orders
  using (public.current_user_is_admin());
notify pgrst, 'reload schema';
commit;
