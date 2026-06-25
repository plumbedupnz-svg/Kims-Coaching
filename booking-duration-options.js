(function () {
  const settings = window.KIMS_SUPABASE || {};
  const hasConfig = Boolean(settings.url && settings.anonKey && window.supabase);
  const client = hasConfig ? window.supabase.createClient(settings.url, settings.anonKey) : null;
  const formEl = document.querySelector("[data-booking-form]");
  const durationSelectEl = document.querySelector("[data-duration-select]");
  const calendarEl = document.querySelector("[data-booking-calendar]");

  if (!formEl || !durationSelectEl || !calendarEl) return;

  // Duration options are owned by booking.js so fixed-duration lesson types
  // cannot be silently expanded into shorter, misleading options.
  void client;
})();
