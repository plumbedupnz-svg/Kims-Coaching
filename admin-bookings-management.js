(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;
  const list = document.querySelector("[data-admin-bookings-list]");
  if (!list) return;

  const statusMeta = {
    confirmed: ["Confirmed", "confirmed"],
    completed: ["Completed", "completed"],
    cancelled: ["Cancelled", "cancelled"],
    no_show: ["No Show", "no-show"],
    pending: ["Pending", "pending"]
  };
  const state = { bookings: [], rendering: false };

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getStart(booking) {
    return booking.start_time || booking.availability?.start_time || "";
  }

  function getEnd(booking) {
    return booking.end_time || booking.availability?.end_time || "";
  }

  function formatDateTime(value) {
    if (!value) return "No date";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function dateInput(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function timeInput(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function durationOf(booking) {
    if (booking.duration_minutes) return Number(booking.duration_minutes);
    const start = getStart(booking);
    const end = getEnd(booking);
    if (!start || !end) return 30;
    return Math.round((new Date(end) - new Date(start)) / 60000) || 30;
  }

  function localDateTimeIso(dateValue, timeValue) {
    return new Date(`${dateValue}T${timeValue}:00`).toISOString();
  }

  function addStyles() {
    if (document.querySelector("[data-admin-bookings-management-styles]")) return;
    const style = document.createElement("style");
    style.dataset.adminBookingsManagementStyles = "true";
    style.textContent = `
      .status-pill.confirmed { color: #177a3a; background: #e7f7ed; }
      .status-pill.completed { color: #1457a3; background: #e7f0ff; }
      .status-pill.cancelled { color: #9f1f16; background: #fee7e2; }
      .status-pill.no-show { color: #9a4b00; background: #fff0d8; }
      .status-pill.pending { color: #5f6f8f; background: #eef2f7; }
      .booking-row-side { display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; flex-wrap: wrap; }
      .booking-actions .btn { padding: 0.5rem 0.7rem; }
      .admin-modal { width: min(720px, 92vw); border: 0; padding: 0; background: transparent; }
      .admin-modal::backdrop { background: rgba(19, 33, 61, 0.42); }
      .admin-modal-card { width: 100%; margin: 0; box-shadow: var(--shadow); }
      .admin-modal-card h3, .admin-modal-card p { margin: 0; }
      @media (max-width: 760px) { .booking-row-side { justify-content: flex-start; } }
    `;
    document.head.appendChild(style);
  }

  function addModals() {
    if (document.querySelector("[data-booking-edit-modal]")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <dialog class="admin-modal" data-booking-edit-modal>
        <form class="owner-add-form admin-modal-card" data-booking-edit-form method="dialog">
          <div class="availability-form-head">
            <div><p class="eyebrow">Booking</p><h3>Edit booking</h3></div>
            <button class="btn btn-secondary" type="button" data-close-booking-edit>Close</button>
          </div>
          <input type="hidden" name="booking_id" />
          <div class="availability-grid">
            <label>Player name<input type="text" name="player_name" required /></label>
            <label>Parent name<input type="text" name="parent_name" required /></label>
            <label>Email<input type="email" name="customer_email" required /></label>
            <label>Mobile<input type="tel" name="mobile" /></label>
            <label>Date<input type="date" name="booking_date" required /></label>
            <label>Start time<input type="time" name="start_time" step="1800" required /></label>
            <label>Duration<select name="duration_minutes" required><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">120 minutes</option></select></label>
            <label>Player level<select name="player_level"><option value="">Select level</option><option value="Beginner">Beginner</option><option value="Developing">Developing</option><option value="Interclub">Interclub</option><option value="Tournament">Tournament</option></select></label>
            <label>Status<select name="booking_status" required><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_show">No Show</option></select></label>
            <label class="availability-wide">Notes<textarea name="notes" rows="4"></textarea></label>
          </div>
          <button class="btn btn-primary" type="submit">Save booking</button>
          <p class="form-message" data-booking-edit-message></p>
        </form>
      </dialog>
      <dialog class="admin-modal" data-booking-delete-modal>
        <form class="owner-add-form admin-modal-card" method="dialog">
          <div><p class="eyebrow">Delete</p><h3>Delete booking?</h3><p class="helper-text">This permanently removes the booking record and makes the lesson time available again.</p></div>
          <input type="hidden" name="booking_id" />
          <div class="availability-actions">
            <button class="btn btn-secondary" type="button" data-close-booking-delete>Keep booking</button>
            <button class="btn btn-primary" type="button" data-confirm-booking-delete>Delete booking</button>
          </div>
          <p class="form-message" data-booking-delete-message></p>
        </form>
      </dialog>
    `);
  }

  function openDialog(dialog) {
    if (dialog?.showModal) dialog.showModal();
    else if (dialog) dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (dialog?.close) dialog.close();
    else if (dialog) dialog.removeAttribute("open");
  }

  function setMessage(selector, message, tone = "neutral") {
    const target = document.querySelector(selector);
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
  }

  function renderBookings() {
    state.rendering = true;
    if (!state.bookings.length) {
      list.innerHTML = '<p class="helper-text">No private lesson bookings yet.</p>';
      state.rendering = false;
      return;
    }

    list.innerHTML = state.bookings.map((booking) => {
      const [label, className] = statusMeta[booking.booking_status] || [booking.booking_status || "Pending", "pending"];
      const start = getStart(booking);
      const end = getEnd(booking);
      return `
        <article class="admin-data-row">
          <div>
            <strong>${escapeHtml(booking.player_name || "Player")}</strong>
            <p>${formatDateTime(start)}${end ? ` - ${formatDateTime(end)}` : ""}</p>
            ${booking.customer_email ? `<p>${escapeHtml(booking.customer_email)}</p>` : ""}
          </div>
          <div class="booking-row-side">
            <span class="status-pill ${className}">${escapeHtml(label)}</span>
            <div class="availability-actions booking-actions">
              <button class="btn btn-secondary" type="button" data-booking-action="edit" data-id="${booking.id}">Edit</button>
              <button class="btn btn-secondary" type="button" data-booking-action="cancel" data-id="${booking.id}">Cancel</button>
              <button class="btn btn-secondary" type="button" data-booking-action="delete" data-id="${booking.id}">Delete</button>
            </div>
          </div>
        </article>
      `;
    }).join("");
    state.rendering = false;
  }

  async function loadBookings() {
    if (!client) return;
    const { data, error } = await client
      .from("bookings")
      .select("*, availability:availability_id(start_time,end_time)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      list.innerHTML = `<p class="helper-text">${escapeHtml(error.message || "Could not load bookings.")}</p>`;
      return;
    }
    state.bookings = data || [];
    renderBookings();
  }

  function editBooking(id) {
    const booking = state.bookings.find((item) => item.id === id);
    if (!booking) return;
    const modal = document.querySelector("[data-booking-edit-modal]");
    const form = document.querySelector("[data-booking-edit-form]");
    const start = getStart(booking);
    form.elements.booking_id.value = booking.id;
    form.elements.player_name.value = booking.player_name || "";
    form.elements.parent_name.value = booking.parent_name || booking.customer_name || "";
    form.elements.customer_email.value = booking.customer_email || booking.email || "";
    form.elements.mobile.value = booking.mobile || "";
    form.elements.booking_date.value = dateInput(start);
    form.elements.start_time.value = timeInput(start);
    form.elements.duration_minutes.value = String(durationOf(booking));
    form.elements.player_level.value = booking.player_level || "";
    form.elements.notes.value = booking.notes || "";
    form.elements.booking_status.value = booking.booking_status || "confirmed";
    setMessage("[data-booking-edit-message]", "");
    openDialog(modal);
  }

  async function saveBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const duration = Number(formData.get("duration_minutes"));
    const startTime = localDateTimeIso(formData.get("booking_date"), formData.get("start_time"));
    const endTime = new Date(new Date(startTime).getTime() + duration * 60000).toISOString();
    const parentName = (formData.get("parent_name") || "").trim();
    const payload = {
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
    };

    try {
      setMessage("[data-booking-edit-message]", "Saving booking...");
      const { error } = await client.from("bookings").update(payload).eq("id", formData.get("booking_id"));
      if (error) throw error;
      closeDialog(document.querySelector("[data-booking-edit-modal]"));
      await loadBookings();
    } catch (error) {
      setMessage("[data-booking-edit-message]", error.message || "Could not save booking.", "error");
    }
  }

  async function cancelBooking(id) {
    const { error } = await client.rpc("admin_cancel_booking_and_restore_availability", {
      p_booking_id: id
    });
    if (error) throw error;
    await loadBookings();
  }

  function requestDelete(id) {
    const modal = document.querySelector("[data-booking-delete-modal]");
    modal.querySelector("input[name='booking_id']").value = id;
    setMessage("[data-booking-delete-message]", "");
    openDialog(modal);
  }

  async function deleteBooking() {
    const modal = document.querySelector("[data-booking-delete-modal]");
    const id = modal.querySelector("input[name='booking_id']").value;
    try {
      setMessage("[data-booking-delete-message]", "Deleting booking and reopening the lesson time...");
      const { error } = await client.rpc("admin_delete_booking_and_restore_availability", {
        p_booking_id: id
      });
      if (error) throw error;
      closeDialog(modal);
      await loadBookings();
    } catch (error) {
      setMessage("[data-booking-delete-message]", error.message || "Could not delete booking.", "error");
    }
  }

  async function handleAction(event) {
    const button = event.target.closest("[data-booking-action]");
    if (!button) return;
    try {
      if (button.dataset.bookingAction === "edit") editBooking(button.dataset.id);
      if (button.dataset.bookingAction === "cancel") await cancelBooking(button.dataset.id);
      if (button.dataset.bookingAction === "delete") requestDelete(button.dataset.id);
    } catch (error) {
      list.innerHTML = `<p class="helper-text">${escapeHtml(error.message || "Could not update booking.")}</p>`;
    }
  }

  function init() {
    addStyles();
    addModals();
    list.addEventListener("click", handleAction);
    document.querySelector("[data-booking-edit-form]")?.addEventListener("submit", saveBooking);
    document.querySelector("[data-close-booking-edit]")?.addEventListener("click", () => closeDialog(document.querySelector("[data-booking-edit-modal]")));
    document.querySelector("[data-close-booking-delete]")?.addEventListener("click", () => closeDialog(document.querySelector("[data-booking-delete-modal]")));
    document.querySelector("[data-confirm-booking-delete]")?.addEventListener("click", deleteBooking);
    new MutationObserver(() => {
      if (state.rendering || !state.bookings.length || list.querySelector("[data-booking-action]")) return;
      renderBookings();
    }).observe(list, { childList: true });
    loadBookings();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else window.setTimeout(init, 0);
})();
