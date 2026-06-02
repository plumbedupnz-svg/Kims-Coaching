(function () {
  const settings = window.KIMS_SUPABASE || {};
  const hasConfig = Boolean(settings.url && settings.anonKey && window.supabase);
  const client = hasConfig ? window.supabase.createClient(settings.url, settings.anonKey) : null;
  const formEl = document.querySelector("[data-availability-form]");
  const repeatWeeksEl = document.querySelector("[data-repeat-weeks]");
  const recurringEl = document.querySelector("[data-recurring-weekly]");
  const cancelEditEl = document.querySelector("[data-cancel-availability-edit]");
  const saveEl = document.querySelector("[data-save-availability]");
  const messageEl = document.querySelector("[data-availability-message]");
  const state = { user: null, profile: null, slots: [] };

  function isAdmin() {
    return state.profile?.role === "admin";
  }

  function setMessage(message, tone = "") {
    if (!messageEl) return;
    messageEl.textContent = message;
    if (tone) messageEl.dataset.tone = tone;
    else messageEl.removeAttribute("data-tone");
  }

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function formatDateInput(value) {
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function formatTimeInput(value) {
    const date = new Date(value);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function addWeeks(date, weeks) {
    const next = new Date(date);
    next.setDate(next.getDate() + weeks * 7);
    return next;
  }

  function setRepeatControls() {
    if (!repeatWeeksEl || !recurringEl) return;
    repeatWeeksEl.disabled = !recurringEl.checked;
    if (!recurringEl.checked) repeatWeeksEl.value = "1";
  }

  function resetForm() {
    if (!formEl) return;
    formEl.reset();
    if (formEl.elements.availability_id) formEl.elements.availability_id.value = "";
    if (cancelEditEl) cancelEditEl.hidden = true;
    if (saveEl) saveEl.textContent = "Save lesson time";
    setRepeatControls();
    setMessage("");
  }

  function getPayloads(formData) {
    const slotDate = formData.get("slot_date");
    const startTime = formData.get("start_time");
    const endTime = formData.get("end_time");
    const isAvailable = formData.get("is_available") === "true";
    const recurrenceLabel = (formData.get("recurrence_label") || "").trim();
    const recurringWeekly = formData.get("recurring_weekly") === "on";
    const repeatWeeks = recurringWeekly ? Math.min(Math.max(Number(formData.get("repeat_weeks") || 1), 1), 52) : 1;
    const start = new Date(`${slotDate}T${startTime}`);
    const end = new Date(`${slotDate}T${endTime}`);

    if (!slotDate || !startTime || !endTime || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Choose a date, start time, and end time.");
    }
    if (end <= start) throw new Error("End time must be after start time.");

    const recurrenceGroupId = recurringWeekly && repeatWeeks > 1 && window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : null;

    return Array.from({ length: repeatWeeks }, (_item, index) => ({
      start_time: addWeeks(start, index).toISOString(),
      end_time: addWeeks(end, index).toISOString(),
      is_available: isAvailable,
      created_by: state.user.id,
      recurrence_group_id: recurrenceGroupId,
      recurrence_label: recurrenceLabel,
      recurrence_weekly: Boolean(recurrenceGroupId)
    }));
  }

  function fillForm(slot) {
    if (!formEl || !slot) return;
    formEl.elements.availability_id.value = slot.id;
    formEl.elements.slot_date.value = formatDateInput(slot.start_time);
    formEl.elements.start_time.value = formatTimeInput(slot.start_time);
    formEl.elements.end_time.value = formatTimeInput(slot.end_time);
    formEl.elements.is_available.value = String(slot.is_available);
    formEl.elements.recurrence_label.value = slot.recurrence_label || "";
    formEl.elements.recurring_weekly.checked = false;
    formEl.elements.repeat_weeks.value = "1";
    if (cancelEditEl) cancelEditEl.hidden = false;
    if (saveEl) saveEl.textContent = "Save edit";
    setRepeatControls();
    setMessage("Editing one lesson time.", "success");
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  window.KimsAvailability = {
    client,
    state,
    statusEl: document.getElementById("owner-status"),
    formEl,
    listEl: document.querySelector("[data-availability-list]"),
    cancelEditEl,
    recurringEl,
    setRepeatControls,
    setMessage,
    escapeHtml,
    formatDateTime,
    formatTimeInput,
    resetForm,
    getPayloads,
    fillForm,
    isAdmin
  };
})();