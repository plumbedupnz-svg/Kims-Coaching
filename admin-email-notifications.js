(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;
  if (!client || !window.KimsEmailService) return;

  const pendingDeleteBookings = new Map();

  function getStart(booking = {}) {
    return booking.start_time || booking.availability?.start_time || "";
  }

  function getEnd(booking = {}) {
    return booking.end_time || booking.availability?.end_time || "";
  }

  function durationOf(booking = {}) {
    if (booking.duration_minutes) return Number(booking.duration_minutes);
    const start = getStart(booking);
    const end = getEnd(booking);
    if (!start || !end) return 30;
    return Math.round((new Date(end) - new Date(start)) / 60000) || 30;
  }

  async function fetchBooking(id) {
    if (!id) return null;
    const { data } = await client
      .from("bookings")
      .select("*, availability:availability_id(start_time,end_time)")
      .eq("id", id)
      .maybeSingle();
    return data || null;
  }

  function buildPayload(booking = {}, overrides = {}) {
    return {
      relatedType: "booking",
      relatedId: booking.id,
      customerName: overrides.customer_name || booking.customer_name || booking.parent_name || "",
      playerName: overrides.player_name || booking.player_name || "",
      email: overrides.customer_email || booking.customer_email || booking.email || "",
      mobile: overrides.mobile || booking.mobile || "",
      startTime: overrides.start_time || getStart(booking),
      endTime: overrides.end_time || getEnd(booking),
      durationMinutes: overrides.duration_minutes || durationOf(booking),
      playerLevel: overrides.player_level || booking.player_level || "",
      bookingStatus: overrides.booking_status || booking.booking_status || "",
      notes: overrides.notes || booking.notes || ""
    };
  }

  function localDateTimeIso(dateValue, timeValue) {
    return new Date(`${dateValue}T${timeValue}:00`).toISOString();
  }

  function payloadFromEditForm(form) {
    const formData = new FormData(form);
    const duration = Number(formData.get("duration_minutes"));
    const startTime = localDateTimeIso(formData.get("booking_date"), formData.get("start_time"));
    const endTime = new Date(new Date(startTime).getTime() + duration * 60000).toISOString();
    const parentName = (formData.get("parent_name") || "").trim();
    return {
      id: formData.get("booking_id"),
      payload: {
        player_name: (formData.get("player_name") || "").trim(),
        parent_name: parentName,
        customer_name: parentName,
        customer_email: (formData.get("customer_email") || "").trim(),
        mobile: (formData.get("mobile") || "").trim(),
        start_time: startTime,
        end_time: endTime,
        duration_minutes: duration,
        player_level: formData.get("player_level") || "",
        notes: (formData.get("notes") || "").trim(),
        booking_status: formData.get("booking_status")
      }
    };
  }

  async function sendChangedAfterSave(form) {
    const { id, payload } = payloadFromEditForm(form);
    window.setTimeout(async () => {
      const saved = await fetchBooking(id);
      if (!saved) return;
      const emailPayload = buildPayload(saved, payload);
      if (saved.booking_status === "cancelled") {
        await window.KimsEmailService.sendBookingCancelledEmail(emailPayload);
      } else {
        await window.KimsEmailService.sendBookingChangedEmail(emailPayload);
      }
    }, 1200);
  }

  async function sendCancelledAfterAction(id, originalBooking) {
    window.setTimeout(async () => {
      const saved = await fetchBooking(id);
      const booking = saved || originalBooking;
      if (!booking) return;
      await window.KimsEmailService.sendBookingCancelledEmail(buildPayload(booking, { booking_status: "cancelled" }));
    }, 1200);
  }

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-booking-edit-form]");
    if (form) sendChangedAfterSave(form);
  }, true);

  document.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-booking-action]");
    if (actionButton?.dataset.bookingAction === "delete") {
      const booking = await fetchBooking(actionButton.dataset.id);
      if (booking) pendingDeleteBookings.set(actionButton.dataset.id, booking);
      return;
    }

    if (actionButton?.dataset.bookingAction === "cancel") {
      const booking = await fetchBooking(actionButton.dataset.id);
      await sendCancelledAfterAction(actionButton.dataset.id, booking);
      return;
    }

    const confirmDelete = event.target.closest("[data-confirm-booking-delete]");
    if (confirmDelete) {
      const id = document.querySelector("[data-booking-delete-modal] input[name='booking_id']")?.value;
      const booking = pendingDeleteBookings.get(id) || await fetchBooking(id);
      await sendCancelledAfterAction(id, booking ? { ...booking, notes: `${booking.notes || ""}\nBooking record deleted by admin.`.trim() } : null);
      pendingDeleteBookings.delete(id);
    }
  }, true);
})();
