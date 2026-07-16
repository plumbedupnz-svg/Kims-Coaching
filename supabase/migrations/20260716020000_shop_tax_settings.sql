-- Kim Jones Coaching shop tax settings.
-- Safe to run more than once in Supabase SQL Editor.

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

alter table public.shop_inventory_settings
add column if not exists tax_mode text not null default 'none',
add column if not exists tax_label text not null default 'GST',
add column if not exists tax_rate_percent numeric(6, 3) not null default 15,
add column if not exists prices_include_tax boolean not null default false,
add column if not exists stripe_automatic_tax boolean not null default false;

update public.shop_inventory_settings
set
  tax_mode = case
    when tax_mode in ('none', 'gst_inclusive', 'gst_exclusive') then tax_mode
    else 'none'
  end,
  tax_label = coalesce(nullif(trim(tax_label), ''), 'GST'),
  tax_rate_percent = coalesce(tax_rate_percent, 15),
  prices_include_tax = case when tax_mode = 'gst_inclusive' then true else false end,
  stripe_automatic_tax = case when tax_mode = 'none' then false else coalesce(stripe_automatic_tax, false) end
where id = true;

alter table public.shop_inventory_settings
drop constraint if exists shop_inventory_settings_tax_mode_valid;

alter table public.shop_inventory_settings
add constraint shop_inventory_settings_tax_mode_valid
check (tax_mode in ('none', 'gst_inclusive', 'gst_exclusive'));

alter table if exists public.shop_orders
add column if not exists tax_mode text not null default 'none',
add column if not exists tax_label text not null default 'GST',
add column if not exists tax_rate_percent numeric(6, 3) not null default 15,
add column if not exists prices_include_tax boolean not null default false,
add column if not exists tax_included_amount numeric(10, 2) not null default 0;

do $$
begin
  if to_regclass('public.shop_orders') is not null then
    update public.shop_orders
    set
      tax_mode = case
        when tax_mode in ('none', 'gst_inclusive', 'gst_exclusive') then tax_mode
        else 'none'
      end,
      tax_label = coalesce(nullif(trim(tax_label), ''), 'GST'),
      tax_rate_percent = coalesce(tax_rate_percent, 15),
      prices_include_tax = case when tax_mode = 'gst_inclusive' then true else false end,
      tax_included_amount = coalesce(tax_included_amount, 0)
    where true;

    alter table public.shop_orders
    drop constraint if exists shop_orders_tax_mode_valid;

    alter table public.shop_orders
    add constraint shop_orders_tax_mode_valid
    check (tax_mode in ('none', 'gst_inclusive', 'gst_exclusive'));
  end if;
end $$;

notify pgrst, 'reload schema';
