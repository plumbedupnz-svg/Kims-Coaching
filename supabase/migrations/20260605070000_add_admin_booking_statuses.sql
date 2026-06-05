alter table public.bookings
  drop constraint if exists bookings_booking_status_check;

alter table public.bookings
  add constraint bookings_booking_status_check
  check (booking_status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));
