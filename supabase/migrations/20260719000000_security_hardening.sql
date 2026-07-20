-- Security hardening for customer writes, checkout pricing, public catalogue data,
-- privileged helper functions, and private supplier invoice storage.
-- Forward-only and safe to paste into the Supabase SQL Editor.

create or replace function public.create_private_lesson_booking(
  p_availability_id uuid,
  p_start_time timestamptz,
  p_lesson_type_id uuid,
  p_duration_minutes integer,
  p_customer_name text,
  p_parent_name text,
  p_player_name text,
  p_customer_email text,
  p_mobile text,
  p_player_level text,
  p_notes text,
  p_payment_option text default 'pay_later',
  p_bundle_id uuid default null,
  p_bundle_lessons_count integer default null,
  p_bundle_discount_percent numeric default null,
  p_total_price numeric default 0,
  p_club_id uuid default null,
  p_coach_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_availability public.availability%rowtype;
  selected_lesson public.lesson_types%rowtype;
  selected_bundle public.lesson_bundles%rowtype;
  selected_capacity integer := 1;
  overlapping_count integer := 0;
  effective_lesson_type_id uuid;
  trusted_bundle_count integer;
  trusted_bundle_discount numeric(5, 2);
  trusted_total numeric(10, 2);
  trusted_customer_email text;
  booking_start timestamptz;
  booking_end timestamptz;
  remaining_start timestamptz;
  created_booking public.bookings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to book coaching.';
  end if;

  if p_duration_minutes not in (30, 45, 60, 90, 120) then
    raise exception 'Choose a valid lesson duration.';
  end if;

  if coalesce(p_payment_option, 'pay_later') not in ('pay_now', 'pay_later') then
    raise exception 'Choose pay now or pay later.';
  end if;

  select a.*
  into selected_availability
  from public.availability as a
  where a.id = p_availability_id
    and a.is_available = true
  for update of a;

  if not found then
    raise exception 'That coaching time is no longer available.';
  end if;

  effective_lesson_type_id := coalesce(selected_availability.lesson_type_id, p_lesson_type_id);
  select lt.*
  into selected_lesson
  from public.lesson_types as lt
  where lt.id = effective_lesson_type_id
    and lt.is_active = true;

  if not found then
    raise exception 'Choose a valid active lesson type.';
  end if;

  if coalesce(selected_lesson.price, 0) <= 0 then
    raise exception 'This lesson does not have a valid price.';
  end if;

  select coalesce(nullif(trim(pr.email), ''), nullif(auth.jwt() ->> 'email', ''))
  into trusted_customer_email
  from public.profiles as pr
  where pr.id = auth.uid();

  trusted_customer_email := coalesce(trusted_customer_email, nullif(auth.jwt() ->> 'email', ''));
  if trusted_customer_email is null then
    raise exception 'Your account does not have a verified email address.';
  end if;

  if p_bundle_id is not null then
    select lb.*
    into selected_bundle
    from public.lesson_bundles as lb
    where lb.id = p_bundle_id
      and lb.is_active = true
      and (lb.lesson_type_id is null or lb.lesson_type_id = effective_lesson_type_id);

    if not found then
      raise exception 'Choose a valid bundle for this lesson type.';
    end if;
    if coalesce(selected_lesson.pay_as_you_go_only, false) then
      raise exception 'This lesson type does not allow bundle purchases.';
    end if;

    trusted_bundle_count := selected_bundle.lesson_count;
    trusted_bundle_discount := selected_bundle.discount_percent;
  else
    trusted_bundle_count := null;
    trusted_bundle_discount := null;
  end if;

  trusted_total := round(
    selected_lesson.price
      * coalesce(trusted_bundle_count, 1)
      * (1 - coalesce(trusted_bundle_discount, 0) / 100),
    2
  );

  select greatest(1, coalesce(selected_availability.capacity, selected_lesson.capacity, 1))
  into selected_capacity;

  booking_start := p_start_time;
  booking_end := booking_start + make_interval(mins => p_duration_minutes);
  remaining_start := public.next_lesson_start_time(booking_end);

  if extract(minute from booking_start) not in (0, 30) then
    raise exception 'Lesson times must start on the hour or half hour.';
  end if;
  if booking_start < selected_availability.start_time or booking_end > selected_availability.end_time then
    raise exception 'That lesson duration does not fit in the selected availability window.';
  end if;
  if p_club_id is not null and selected_availability.club_id is distinct from p_club_id then
    raise exception 'The selected club does not match this coaching time.';
  end if;
  if selected_availability.coach_id is not null
    and p_coach_id is distinct from selected_availability.coach_id then
    raise exception 'The selected coach does not match this coaching time.';
  end if;

  select count(*)
  into overlapping_count
  from public.bookings as existing
  where existing.availability_id = selected_availability.id
    and existing.booking_status in ('pending', 'pending_payment', 'confirmed')
    and public.booking_times_overlap(booking_start, booking_end, existing.start_time, existing.end_time);

  if overlapping_count >= selected_capacity then
    raise exception 'That coaching time is no longer available.';
  end if;

  insert into public.bookings (
    user_id, lesson_type_id, availability_id, club_id, coach_id, booking_status,
    customer_name, parent_name, player_name, customer_email, mobile, player_level,
    notes, start_time, end_time, duration_minutes, payment_option, payment_status,
    bundle_id, bundle_lessons_count, bundle_discount_percent, total_price
  ) values (
    auth.uid(), effective_lesson_type_id, selected_availability.id,
    coalesce(selected_availability.club_id, p_club_id),
    coalesce(selected_availability.coach_id, p_coach_id),
    case when coalesce(p_payment_option, 'pay_later') = 'pay_now' then 'pending_payment' else 'confirmed' end,
    coalesce(p_customer_name, ''), coalesce(p_parent_name, ''), coalesce(p_player_name, ''),
    trusted_customer_email, coalesce(p_mobile, ''), coalesce(p_player_level, ''),
    coalesce(p_notes, ''), booking_start, booking_end, p_duration_minutes,
    coalesce(p_payment_option, 'pay_later'),
    case when coalesce(p_payment_option, 'pay_later') = 'pay_now' then 'pending' else 'unpaid' end,
    p_bundle_id, trusted_bundle_count, trusted_bundle_discount, trusted_total
  ) returning * into created_booking;

  if selected_capacity = 1 then
    if booking_start = selected_availability.start_time and booking_end = selected_availability.end_time then
      update public.availability set is_available = false where id = selected_availability.id;
    elsif booking_start = selected_availability.start_time then
      if remaining_start < selected_availability.end_time then
        update public.availability set start_time = remaining_start where id = selected_availability.id;
      else
        update public.availability set is_available = false where id = selected_availability.id;
      end if;
    elsif booking_end = selected_availability.end_time then
      update public.availability set end_time = booking_start where id = selected_availability.id;
    else
      update public.availability set end_time = booking_start where id = selected_availability.id;
      if remaining_start < selected_availability.end_time then
        insert into public.availability (
          start_time, end_time, is_available, created_by, recurrence_group_id,
          recurrence_label, recurrence_weekly, lesson_type_id, club_id, coach_id,
          capacity, minimum_players
        ) values (
          remaining_start, selected_availability.end_time, true, selected_availability.created_by,
          selected_availability.recurrence_group_id, selected_availability.recurrence_label,
          selected_availability.recurrence_weekly, selected_availability.lesson_type_id,
          selected_availability.club_id, selected_availability.coach_id,
          selected_availability.capacity, selected_availability.minimum_players
        );
      end if;
    end if;
  end if;

  return created_booking;
end;
$$;

revoke all on function public.create_private_lesson_booking(uuid, timestamptz, uuid, integer, text, text, text, text, text, text, text, text, uuid, integer, numeric, numeric, uuid, uuid) from public, anon;
grant execute on function public.create_private_lesson_booking(uuid, timestamptz, uuid, integer, text, text, text, text, text, text, text, text, uuid, integer, numeric, numeric, uuid, uuid) to authenticated, service_role;

create or replace function public.create_junior_group_pending_booking(
  p_group_id uuid,
  p_player_name text,
  p_player_age integer,
  p_player_level text,
  p_parent_name text,
  p_email text,
  p_mobile text,
  p_notes text default '',
  p_profile_player_index integer default null
)
returns table (
  member_id uuid,
  payment_id uuid,
  booking_status text,
  payment_status text,
  payment_link_url text,
  amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.junior_groups%rowtype;
  paid_count integer := 0;
  pending_count integer := 0;
  programme_price numeric := 0;
  lesson_type_price numeric := 0;
  effective_price numeric := 0;
  created_pending_id uuid;
  selected_player_id uuid;
  trusted_email text;
begin
  if auth.uid() is null then
    raise exception 'Please log in before booking junior group coaching.';
  end if;

  select jg.*
  into target_group
  from public.junior_groups as jg
  left join public.junior_programmes as jp on jp.id = jg.programme_id
  where jg.id = p_group_id
    and jg.is_active = true
    and (jg.is_public = true or coalesce(jp.is_public, false) = true)
    and coalesce(jp.is_active, true) = true
  for update of jg;

  if target_group.id is null then
    raise exception 'This junior group is not currently available for booking.';
  end if;

  select coalesce(jp.price, 0), coalesce(lt.price, 0)
  into programme_price, lesson_type_price
  from public.junior_groups as jg
  left join public.junior_programmes as jp on jp.id = jg.programme_id
  left join public.lesson_types as lt on lt.id = jg.lesson_type_id
  where jg.id = target_group.id;

  effective_price := coalesce(
    nullif(target_group.price, 0),
    nullif(programme_price, 0),
    nullif(lesson_type_price, 0),
    0
  );
  if effective_price <= 0 then
    raise exception 'Online payment is required for junior coaching. Please ask Kim to add a price before booking.';
  end if;

  if target_group.age_min is not null and (p_player_age is null or p_player_age < target_group.age_min) then
    raise exception 'This programme requires players to be at least % years old.', target_group.age_min;
  end if;
  if target_group.age_max is not null and (p_player_age is null or p_player_age > target_group.age_max) then
    raise exception 'This programme is for players aged % or under.', target_group.age_max;
  end if;

  select count(*)
  into paid_count
  from public.junior_group_members as jgm
  where jgm.group_id = target_group.id
    and jgm.booking_status = 'confirmed'
    and jgm.payment_status = 'paid';

  select count(*)
  into pending_count
  from public.junior_group_pending_bookings as pending
  where pending.group_id = target_group.id
    and pending.booking_status = 'pending_payment'
    and pending.payment_status = 'pending'
    and coalesce(pending.expires_at, now()) > now();

  if paid_count + pending_count >= target_group.capacity then
    raise exception 'This junior group is full.';
  end if;

  if p_profile_player_index is not null then
    select p.id
    into selected_player_id
    from public.players as p
    where p.profile_id = auth.uid()
      and p.profile_player_index = p_profile_player_index
      and p.is_active = true
    limit 1;
    if selected_player_id is null then
      raise exception 'The selected saved player could not be verified.';
    end if;
  end if;

  select coalesce(nullif(trim(pr.email), ''), nullif(auth.jwt() ->> 'email', ''))
  into trusted_email
  from public.profiles as pr
  where pr.id = auth.uid();
  trusted_email := coalesce(trusted_email, nullif(auth.jwt() ->> 'email', ''));
  if trusted_email is null then
    raise exception 'Your account does not have a verified email address.';
  end if;

  insert into public.junior_group_pending_bookings as pending (
    group_id, profile_id, profile_player_index, player_id, programme_id,
    player_name, player_age, player_level, parent_name, email, mobile, notes,
    amount, currency, booking_status, payment_status, expires_at
  ) values (
    target_group.id, auth.uid(), p_profile_player_index, selected_player_id,
    target_group.programme_id, nullif(trim(p_player_name), ''), p_player_age,
    coalesce(p_player_level, ''), coalesce(p_parent_name, ''), trusted_email,
    coalesce(p_mobile, ''), coalesce(p_notes, ''), effective_price, 'NZD',
    'pending_payment', 'pending', now() + interval '30 minutes'
  ) returning pending.id into created_pending_id;

  return query
  select created_pending_id, null::uuid, 'pending_payment'::text, 'pending'::text,
    target_group.payment_link_url, effective_price;
end;
$$;

revoke all on function public.create_junior_group_pending_booking(uuid, text, integer, text, text, text, text, text, integer) from public, anon;
grant execute on function public.create_junior_group_pending_booking(uuid, text, integer, text, text, text, text, text, integer) to authenticated, service_role;

-- Customers may keep ordinary player-profile details current, but payment,
-- placement, group assignment, and Stripe linkage remain admin/server owned.
create or replace function public.protect_player_workflow_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role') or public.current_user_is_admin() then
    return new;
  end if;
  if auth.uid() is null or new.profile_id is distinct from auth.uid() then
    raise exception 'Players can only be saved for the logged-in account.';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.admin_confirmed_level, '') <> ''
      or coalesce(new.admin_notes, '') <> ''
      or new.junior_programme_id is not null
      or new.junior_group_id is not null
      or new.junior_group_member_id is not null
      or new.placement_status <> 'awaiting_placement'
      or new.payment_status <> 'not_required'
      or coalesce(new.invoice_url, '') <> ''
      or new.stripe_session_id is not null
      or new.stripe_payment_intent_id is not null then
      raise exception 'Admin-managed player fields cannot be set by customers.';
    end if;
  elsif new.profile_id is distinct from old.profile_id
    or new.admin_confirmed_level is distinct from old.admin_confirmed_level
    or new.admin_notes is distinct from old.admin_notes
    or new.junior_programme_id is distinct from old.junior_programme_id
    or new.junior_group_id is distinct from old.junior_group_id
    or new.junior_group_member_id is distinct from old.junior_group_member_id
    or new.placement_status is distinct from old.placement_status
    or new.payment_status is distinct from old.payment_status
    or new.invoice_url is distinct from old.invoice_url
    or new.stripe_session_id is distinct from old.stripe_session_id
    or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Admin-managed player fields cannot be changed by customers.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_player_workflow_fields on public.players;
create trigger protect_player_workflow_fields
before insert or update on public.players
for each row execute function public.protect_player_workflow_fields();

revoke all on function public.protect_player_workflow_fields() from public, anon;
grant execute on function public.protect_player_workflow_fields() to authenticated, service_role;

-- Checkout/payment records may be read by their owner, but creation and status
-- transitions are only performed by the trusted RPCs or service-role APIs.
drop policy if exists "Users can create own bookings" on public.bookings;
revoke insert on public.bookings from authenticated;

drop policy if exists "Users can create own junior pending member" on public.junior_group_members;
revoke insert on public.junior_group_members from authenticated;

drop policy if exists "Users can create own pending junior bookings" on public.junior_group_pending_bookings;
drop policy if exists "Users can update own pending junior bookings" on public.junior_group_pending_bookings;
revoke insert, update on public.junior_group_pending_bookings from authenticated;

drop policy if exists "Customers can create own shop orders" on public.shop_orders;
revoke insert on public.shop_orders from authenticated;

-- Public catalogue reads use a column allow-list. Admins retain full rows through
-- checked security-definer list functions.
alter table public.inventory_items enable row level security;
drop policy if exists "Anyone can view public shop inventory items" on public.inventory_items;
create policy "Anyone can view public shop inventory items"
on public.inventory_items for select to anon, authenticated
using (visible_in_shop = true and is_active = true and archived_at is null);

revoke select on public.inventory_items from anon, authenticated;
do $$
declare
  allowed_column text;
begin
  for allowed_column in
    select c.column_name
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name = 'inventory_items'
      and c.column_name = any (array[
        'id', 'shop_product_id', 'product_name', 'sku', 'brand', 'category_id',
        'category', 'description', 'short_description', 'full_description',
        'image', 'image_url', 'sell_price', 'discount', 'quantity_on_hand',
        'low_stock_threshold', 'status', 'visible_in_shop', 'is_active',
        'track_stock', 'is_order_to_sale', 'slug', 'archived_at', 'created_at',
        'updated_at'
      ])
  loop
    execute format('grant select (%I) on table public.inventory_items to anon, authenticated', allowed_column);
  end loop;
end $$;

alter table public.products enable row level security;
drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products"
on public.products for select to anon, authenticated
using (is_active = true and visible_in_shop = true and archived_at is null);

revoke select on public.products from anon, authenticated;
do $$
declare
  allowed_column text;
begin
  for allowed_column in
    select c.column_name
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name = 'products'
      and c.column_name = any (array[
        'id', 'inventory_item_id', 'category_id', 'name', 'slug',
        'short_description', 'category', 'description', 'price', 'discount',
        'image', 'image_url', 'fulfilment_type', 'is_active', 'visible_in_shop',
        'quantity_on_hand', 'stock_status', 'archived_at', 'created_at', 'updated_at'
      ])
  loop
    execute format('grant select (%I) on table public.products to anon, authenticated', allowed_column);
  end loop;
end $$;

create or replace function public.admin_list_products()
returns setof public.products
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Admin access required to read products.';
  end if;
  return query
  select p.*
  from public.products as p
  order by p.updated_at desc nulls last, p.created_at desc nulls last;
end;
$$;

revoke all on function public.admin_list_products() from public, anon;
grant execute on function public.admin_list_products() to authenticated, service_role;
revoke all on function public.admin_list_inventory_items() from public, anon;
grant execute on function public.admin_list_inventory_items() to authenticated, service_role;

-- These helpers are intended for service-role or guarded admin RPC use only.
revoke all on function public.log_notification_attempt(uuid, text, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.log_notification_attempt(uuid, text, text, text, uuid, text, text, text) to service_role;

revoke all on function public.get_category_id(uuid, text) from public, anon, authenticated;
grant execute on function public.get_category_id(uuid, text) to service_role;

revoke all on function public.sync_inventory_item_to_public_product(uuid) from public, anon, authenticated;
grant execute on function public.sync_inventory_item_to_public_product(uuid) to service_role;

revoke all on function public.recalculate_inventory_status(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_inventory_status(uuid) to service_role;

revoke all on function public.apply_stock_movement(uuid, integer, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_stock_movement(uuid, integer, text, text, text, uuid) to service_role;

revoke all on function public.create_shop_order_with_stock(uuid, text, text, text, jsonb, numeric, numeric) from public, anon, authenticated;
grant execute on function public.create_shop_order_with_stock(uuid, text, text, text, jsonb, numeric, numeric) to service_role;

revoke all on function public.publish_inventory_item_to_shop(uuid, uuid, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.publish_inventory_item_to_shop(uuid, uuid, text, text, numeric, numeric, text) to authenticated, service_role;
revoke all on function public.publish_inventory_item_to_shop(uuid, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.publish_inventory_item_to_shop(uuid, text, text, numeric, numeric, text) to authenticated, service_role;

-- Only the homepage photo is intentionally public. Other settings remain admin-only.
drop policy if exists "Public can read site settings" on public.site_settings;
create policy "Public can read homepage site setting"
on public.site_settings for select to anon, authenticated
using (setting_key = 'homepage_photo' or public.current_user_is_admin());

-- Supplier invoices remain private and admin-only, with server-side MIME and size limits.
update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf']::text[]
where id = 'supplier-invoices';

notify pgrst, 'reload schema';
