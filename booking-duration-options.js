(function () {
  const settings = window.KIMS_SUPABASE || {};
  const hasConfig = Boolean(settings.url && settings.anonKey && window.supabase);
  const client = hasConfig ? window.supabase.createClient(settings.url, settings.anonKey) : null;
  const formEl = document.querySelector("[data-booking-form]");
  const durationSelectEl = document.querySelector("[data-duration-select]");
  const statusEl = document.querySelector("[data-booking-status]");
  const calendarEl = document.querySelector("[data-booking-calendar]");

  if (!formEl || !durationSelectEl || !calendarEl) return;

  function setStatus(message, tone = "neutral") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  }

  function getSelectedSlotButton() {
    return calendarEl.querySelector("[data-slot-id].selected");
  }

  function getSelectedSlotDetails() {
    const button = getSelectedSlotButton();
    const slotId = button?.dataset.slotId || "";
    const [availabilityId, startTime] = slotId.split("|");
    const maxDuration = Number(button?.textContent.match(/up to\s+(\d+)\s+min/i)?.[1] || 0);
    return { availabilityId, startTime, maxDuration };
  }

  function ensureDurationOption(duration) {
    if (durationSelectEl.querySelector(`option[value="${duration}"]`)) return;
    const option = document.createElement("option");
    option.value = String(duration);
    option.textContent = `${duration} minutes`;
    const nextOption = Array.from(durationSelectEl.options).find((item) => Number(item.value) > duration);
    durationSelectEl.insertBefore(option, nextOption || null);
  }

  function syncDurationOptions() {
    const { maxDuration } = getSelectedSlotDetails();
    if (maxDuration >= 45) ensureDurationOption(45);
  }

  async function getPrivateLessonTypeId() {
    const { data, error } = await client
      .from("lesson_types")
      .select("id")
      .ilike("name", "%private%")
      .order("duration", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data?.id) throw new Error("Private lesson type is not configured yet.");
    return data.id;
  }

  function getBookingEndTime(startTime, durationMinutes) {
    return new Date(new Date(startTime).getTime() + Number(durationMinutes) * 60000).toISOString();
  }

  function buildNotes(formData) {
    const rawNotes = formData.get("notes")?.trim() || "";
    return [
      "Private lesson booking",
      `Player: ${formData.get("player_name")?.trim() || ""}`,
      `Parent: ${formData.get("parent_name")?.trim() || ""}`,
      `Email: ${formData.get("email")?.trim() || ""}`,
      `Mobile: ${formData.get("mobile")?.trim() || ""}`,
      `Level: ${formData.get("player_level") || ""}`,
      rawNotes ? `Notes: ${rawNotes}` : ""
    ].filter(Boolean).join("\n");
  }

  async function handleFortyFiveMinuteBooking(event) {
    if (durationSelectEl.value !== "45") return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (!client) {
      setStatus("Supabase is not configured yet.", "error");
      return;
    }

    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session?.user) {
      setStatus("Please log in before confirming a booking.", "error");
      return;
    }

    const { availabilityId, startTime, maxDuration } = getSelectedSlotDetails();
    if (!availabilityId || !startTime || maxDuration < 45) {
      setStatus("Choose an available time that can fit a 45 minute lesson.", "error");
      return;
    }

    const formData = new FormData(formEl);
    const lessonTypeId = await getPrivateLessonTypeId();
    const endTime = getBookingEndTime(startTime, 45);
    const submitButton = formEl.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    setStatus("Saving your 45 minute private lesson booking...", "neutral");

    const result = await client.rpc("create_private_lesson_booking", {
      p_availability_id: availabilityId,
      p_start_time: startTime,
      p_lesson_type_id: lessonTypeId,
      p_duration_minutes: 45,
      p_customer_name: formData.get("parent_name")?.trim(),
      p_parent_name: formData.get("parent_name")?.trim(),
      p_player_name: formData.get("player_name")?.trim(),
      p_customer_email: formData.get("email")?.trim(),
      p_mobile: formData.get("mobile")?.trim(),
      p_player_level: formData.get("player_level"),
      p_notes: buildNotes(formData)
    });

    if (submitButton) submitButton.disabled = false;
    if (result.error) {
      setStatus(result.error.message, "error");
      return;
    }

    const notificationPayload = {
      customerName: formData.get("parent_name")?.trim(),
      playerName: formData.get("player_name")?.trim(),
      email: formData.get("email")?.trim(),
      mobile: formData.get("mobile")?.trim(),
      dateTime: startTime,
      startTime,
      endTime,
      durationMinutes: 45,
      notes: formData.get("notes")?.trim() || ""
    };
    await window.KimsBookingServices?.notifyAdminOfNewBooking(notificationPayload);
    sessionStorage.setItem("kims_last_booking_confirmation", JSON.stringify({
      startTime,
      endTime,
      duration: 45,
      playerName: formData.get("player_name")?.trim()
    }));
    window.location.href = "booking-confirmation";
  }

  new MutationObserver(syncDurationOptions).observe(durationSelectEl, { childList: true });
  new MutationObserver(syncDurationOptions).observe(calendarEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  durationSelectEl.addEventListener("focus", syncDurationOptions);
  formEl.addEventListener("submit", handleFortyFiveMinuteBooking, true);
})();
