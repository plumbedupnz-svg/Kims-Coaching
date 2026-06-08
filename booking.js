(function () {
  const settings = window.KIMS_SUPABASE || {};
  const hasConfig = Boolean(settings.url && settings.anonKey && window.supabase);
  const client = hasConfig ? window.supabase.createClient(settings.url, settings.anonKey) : null;
  const calendarEl = document.querySelector("[data-booking-calendar]");
  const emptyEl = document.querySelector("[data-booking-empty]");
  const weekTitleEl = document.querySelector("[data-week-title]");
  const previousWeekEl = document.querySelector("[data-previous-week]");
  const nextWeekEl = document.querySelector("[data-next-week]");
  const selectedSlotTitleEl = document.querySelector("[data-selected-slot-title]");
  const selectedSlotCopyEl = document.querySelector("[data-selected-slot-copy]");
  const bookingFormEl = document.querySelector("[data-booking-form]");
  const bookingStatusEl = document.querySelector("[data-booking-status]");
  const bookingSuccessEl = document.querySelector("[data-booking-success]");
  const authRequiredEl = document.querySelector("[data-auth-required]");
  const myBookingsEl = document.querySelector("[data-my-bookings]");
  const durationSelectEl = document.querySelector("[data-duration-select]");
  const invalidStartMessage = "Lesson times must start on the hour or half hour.";
  const durationOptions = [30, 60, 90, 120];
  const state = {
    user: null,
    profile: null,
    lessonType: null,
    selectedSlot: null,
    selectedDuration: null,
    weekStart: getMonday(new Date()),
    slots: []
  };

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function getMonday(date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    const day = value.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    value.setDate(value.getDate() + diff);
    return value;
  }

  function formatDate(value, options) {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
  }

  function formatTime(value) {
    return formatDate(value, { hour: "numeric", minute: "2-digit" });
  }

  function getDurationMinutes(slot) {
    if (slot.duration) return Number(slot.duration);
    return Math.round((new Date(slot.end_time) - new Date(slot.start_time)) / 60000);
  }

  function getMaxDurationMinutes(slot) {
    if (slot.max_duration_minutes) return Number(slot.max_duration_minutes);
    return getDurationMinutes(slot);
  }

  function getSlotKey(slot) {
    return `${slot.id}|${slot.start_time}`;
  }

  function getBookingEndTime(slot, durationMinutes) {
    return new Date(new Date(slot.start_time).getTime() + Number(durationMinutes) * 60000).toISOString();
  }

  function getAvailableDurations(slot) {
    const maxDuration = getMaxDurationMinutes(slot);
    return durationOptions.filter((duration) => duration <= maxDuration);
  }

  function isHalfHourStart(value) {
    const date = new Date(value);
    const minutes = date.getMinutes();
    return !Number.isNaN(date.getTime()) && (minutes === 0 || minutes === 30);
  }

  function onlyValidStartSlots(slots) {
    const validSlots = (slots || []).filter((slot) => isHalfHourStart(slot.start_time));
    if (slots?.length && validSlots.length !== slots.length) {
      setStatus(invalidStartMessage, "error");
    }
    return validSlots;
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(message, tone = "neutral") {
    if (!bookingStatusEl) return;
    bookingStatusEl.textContent = message;
    bookingStatusEl.dataset.tone = tone;
  }

  async function refreshSession() {
    if (!client) return;
    const { data } = await client.auth.getSession();
    state.user = data?.session?.user || null;

    if (!state.user) return;
    const { data: profile, error } = await client
      .from("profiles")
      .select("*")
      .eq("id", state.user.id)
      .single();

    if (!error) state.profile = profile;
  }

  async function loadPrivateLessonType() {
    if (!client) return null;
    const { data, error } = await client
      .from("lesson_types")
      .select("*")
      .ilike("name", "%private%")
      .order("duration", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) console.error("Could not load private lesson type", error);
    state.lessonType = data || null;
    return state.lessonType;
  }

  async function loadAvailableSlots() {
    if (!calendarEl) return;
    if (!client) {
      calendarEl.innerHTML = '<div class="booking-empty">Supabase is not configured yet.</div>';
      return;
    }

    const weekEnd = addDays(state.weekStart, 7);
    const weekStartIso = state.weekStart.toISOString();
    const weekEndIso = weekEnd.toISOString();

    const { data, error } = await client.rpc("get_available_private_lesson_slots", {
      week_start: weekStartIso,
      week_end: weekEndIso
    });

    if (error) {
      console.error("Could not load available slots with RPC", error);
      await loadAvailableSlotsFallback(weekStartIso, weekEndIso);
      return;
    }

    state.slots = onlyValidStartSlots((data || []).map((slot) => ({
      id: slot.availability_id || slot.id,
      start_time: slot.start_time,
      end_time: slot.end_time,
      duration: slot.duration || getDurationMinutes(slot),
      max_duration_minutes: slot.max_duration_minutes || getDurationMinutes(slot),
      lesson_type_id: slot.lesson_type_id
    })));
    renderCalendar();
  }

  async function loadAvailableSlotsFallback(weekStartIso, weekEndIso) {
    const { data, error } = await client
      .from("availability")
      .select("*")
      .eq("is_available", true)
      .gte("start_time", weekStartIso)
      .lt("start_time", weekEndIso)
      .order("start_time", { ascending: true });

    if (error) {
      calendarEl.innerHTML = '<div class="booking-empty">Could not load private lesson times.</div>';
      return;
    }

    const expandedSlots = [];
    (data || []).forEach((availability) => {
      const start = new Date(availability.start_time);
      const end = new Date(availability.end_time);
      for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getTime() + 30 * 60000)) {
        const maxDuration = Math.round((end - cursor) / 60000);
        if (maxDuration >= 30) {
          expandedSlots.push({
            ...availability,
            start_time: cursor.toISOString(),
            max_duration_minutes: maxDuration,
            duration: Math.min(60, maxDuration)
          });
        }
      }
    });

    state.slots = onlyValidStartSlots(expandedSlots);
    renderCalendar();
  }

  function renderCalendar() {
    if (!calendarEl) return;
    const weekEnd = addDays(state.weekStart, 6);
    weekTitleEl.textContent = `${formatDate(state.weekStart, { month: "short", day: "numeric" })} - ${formatDate(weekEnd, { month: "short", day: "numeric" })}`;

    const days = Array.from({ length: 7 }, (_item, index) => addDays(state.weekStart, index));
    const slotsByDay = new Map();
    state.slots.forEach((slot) => {
      const key = new Date(slot.start_time).toDateString();
      slotsByDay.set(key, [...(slotsByDay.get(key) || []), slot]);
    });

    const hasSlots = state.slots.length > 0;
    if (emptyEl) emptyEl.hidden = hasSlots;

    calendarEl.innerHTML = days.map((day) => {
      const daySlots = slotsByDay.get(day.toDateString()) || [];
      const slotButtons = daySlots.map((slot) => `
        <button class="slot-button ${state.selectedSlot && getSlotKey(state.selectedSlot) === getSlotKey(slot) ? "selected" : ""}" type="button" data-slot-id="${getSlotKey(slot)}">
          ${formatTime(slot.start_time)}
          <span>${formatTime(slot.start_time)} start · up to ${getMaxDurationMinutes(slot)} min</span>
        </button>
      `).join("");

      return `
        <section class="booking-day">
          <div>
            <h3>${formatDate(day, { weekday: "long" })}</h3>
            <p class="booking-day-date">${formatDate(day, { month: "short", day: "numeric" })}</p>
          </div>
          ${slotButtons || '<p class="helper-text">No open times</p>'}
        </section>
      `;
    }).join("");
  }

  function getProfilePlayers(profile) {
    if (Array.isArray(profile?.players) && profile.players.length) return profile.players;
    if (profile?.player_name) return [{ name: profile.player_name, level: profile.tennis_level || "" }];
    return [];
  }

  function prefillBookingForm() {
    if (!bookingFormEl || !state.user) return;
    const profile = state.profile || {};
    const player = getProfilePlayers(profile)[0] || {};
    bookingFormEl.elements.player_name.value = player.name || profile.player_name || "";
    bookingFormEl.elements.parent_name.value = profile.parent_name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
    bookingFormEl.elements.email.value = state.user.email || profile.email || "";
    bookingFormEl.elements.mobile.value = profile.mobile || profile.phone || "";
    bookingFormEl.elements.player_level.value = player.level || player.tennis_level || profile.tennis_level || "";
    bookingFormEl.elements.notes.value = profile.notes || "";
  }

  function renderDurationOptions() {
    if (!durationSelectEl) return;
    const durations = state.selectedSlot ? getAvailableDurations(state.selectedSlot) : [];
    durationSelectEl.innerHTML = [
      '<option value="">Select duration</option>',
      ...durations.map((duration) => `<option value="${duration}">${duration} minutes</option>`)
    ].join("");

    const preferredDuration = durations.includes(60) ? 60 : durations[0] || "";
    state.selectedDuration = preferredDuration || null;
    durationSelectEl.value = preferredDuration ? String(preferredDuration) : "";
  }

  function selectSlot(slotKey) {
    state.selectedSlot = state.slots.find((slot) => getSlotKey(slot) === slotKey);
    if (!state.selectedSlot) return;
    if (!isHalfHourStart(state.selectedSlot.start_time)) {
      state.selectedSlot = null;
      setStatus(invalidStartMessage, "error");
      renderCalendar();
      return;
    }

    selectedSlotTitleEl.textContent = `${formatDate(state.selectedSlot.start_time, { weekday: "long", month: "short", day: "numeric" })}`;
    selectedSlotCopyEl.textContent = `${formatTime(state.selectedSlot.start_time)} start · choose your lesson duration`;
    if (authRequiredEl) authRequiredEl.hidden = Boolean(state.user);
    if (bookingFormEl) bookingFormEl.hidden = !state.user;
    if (bookingSuccessEl) bookingSuccessEl.hidden = true;
    renderDurationOptions();
    prefillBookingForm();
    renderCalendar();
  }

  function buildNotes(formData) {
    const rawNotes = formData.get("notes")?.trim() || "";
    return [
      `Private lesson booking`,
      `Player: ${formData.get("player_name")?.trim() || ""}`,
      `Parent: ${formData.get("parent_name")?.trim() || ""}`,
      `Email: ${formData.get("email")?.trim() || ""}`,
      `Mobile: ${formData.get("mobile")?.trim() || ""}`,
      `Level: ${formData.get("player_level") || ""}`,
      rawNotes ? `Notes: ${rawNotes}` : ""
    ].filter(Boolean).join("\n");
  }

  async function createBooking(event) {
    event.preventDefault();
    if (!client || !state.user || !state.selectedSlot) return;
    if (!state.lessonType) {
      setStatus("Private lesson type is not configured yet.", "error");
      return;
    }
    if (!isHalfHourStart(state.selectedSlot.start_time)) {
      setStatus(invalidStartMessage, "error");
      await loadAvailableSlots();
      return;
    }

    const formData = new FormData(bookingFormEl);
    const selectedDuration = Number(formData.get("duration_minutes"));
    const availableDurations = getAvailableDurations(state.selectedSlot);
    if (!availableDurations.includes(selectedDuration)) {
      setStatus("Choose a lesson duration that fits this available time.", "error");
      return;
    }

    const bookingEndTime = getBookingEndTime(state.selectedSlot, selectedDuration);
    if (new Date(bookingEndTime) > new Date(state.selectedSlot.end_time)) {
      setStatus("That lesson duration does not fit in the selected availability window.", "error");
      await loadAvailableSlots();
      return;
    }

    const payload = {
      user_id: state.user.id,
      lesson_type_id: state.selectedSlot.lesson_type_id || state.lessonType.id,
      availability_id: state.selectedSlot.id,
      booking_status: "confirmed",
      customer_name: formData.get("parent_name")?.trim(),
      player_name: formData.get("player_name")?.trim(),
      parent_name: formData.get("parent_name")?.trim(),
      customer_email: formData.get("email")?.trim(),
      mobile: formData.get("mobile")?.trim(),
      player_level: formData.get("player_level"),
      notes: buildNotes(formData),
      start_time: state.selectedSlot.start_time,
      end_time: bookingEndTime,
      duration_minutes: selectedDuration
    };

    setStatus("Saving your private lesson booking...", "neutral");
    const submitButton = bookingFormEl.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;

    const result = await client.rpc("create_private_lesson_booking", {
      p_availability_id: payload.availability_id,
      p_start_time: payload.start_time,
      p_lesson_type_id: payload.lesson_type_id,
      p_duration_minutes: payload.duration_minutes,
      p_customer_name: payload.customer_name,
      p_parent_name: payload.parent_name,
      p_player_name: payload.player_name,
      p_customer_email: payload.customer_email,
      p_mobile: payload.mobile,
      p_player_level: payload.player_level,
      p_notes: payload.notes
    });

    if (submitButton) submitButton.disabled = false;

    if (result.error) {
      const message = result.error.code === "23505"
        ? "That time has just been booked. Please choose another private lesson time."
        : result.error.message;
      setStatus(message, "error");
      await loadAvailableSlots();
      return;
    }

    const notificationPayload = {
      relatedType: "booking",
      relatedId: result.data?.id || "",
      customerName: payload.parent_name,
      playerName: payload.player_name,
      email: payload.customer_email,
      mobile: payload.mobile,
      dateTime: payload.start_time,
      startTime: payload.start_time,
      endTime: payload.end_time,
      durationMinutes: payload.duration_minutes,
      notes: formData.get("notes")?.trim() || ""
    };
    const emailStatus = await window.KimsBookingServices?.notifyAdminOfNewBooking(notificationPayload);

    setStatus("", "success");
    bookingFormEl.hidden = true;
    bookingSuccessEl.hidden = false;
    bookingSuccessEl.innerHTML = `
      <strong>Your private lesson request has been booked.</strong>
      <p>${formatDate(payload.start_time, { weekday: "long", month: "long", day: "numeric" })}</p>
      <p>${formatTime(payload.start_time)} · ${payload.duration_minutes} minutes</p>
      <p>Player: ${escapeHtml(payload.player_name)}</p>
    `;
    sessionStorage.setItem("kims_last_booking_confirmation", JSON.stringify({
      startTime: payload.start_time,
      endTime: payload.end_time,
      duration: payload.duration_minutes,
      playerName: payload.player_name,
      emailStatus
    }));
    state.selectedSlot = null;
    await loadAvailableSlots();
    await renderMyBookings();
    window.location.href = "booking-confirmation";
  }

  async function renderMyBookings() {
    if (!myBookingsEl || !client) return;
    await refreshSession();
    if (!state.user) {
      myBookingsEl.innerHTML = '<p class="helper-text">Log in to view your private lesson bookings.</p>';
      return;
    }

    const { data, error } = await client
      .from("bookings")
      .select("*, availability:availability_id(start_time,end_time), lesson_type:lesson_type_id(name,duration)")
      .eq("user_id", state.user.id)
      .in("booking_status", ["pending", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      myBookingsEl.innerHTML = '<p class="helper-text">Could not load bookings yet.</p>';
      return;
    }

    if (!data?.length) {
      myBookingsEl.innerHTML = '<p class="helper-text">No private lesson bookings yet.</p>';
      return;
    }

    myBookingsEl.innerHTML = data.map((booking) => {
      const slot = booking.availability || {};
      const playerName = booking.player_name || getPlayerNameFromNotes(booking.notes) || "Player";
      const startTime = booking.start_time || slot.start_time;
      const duration = booking.duration_minutes || booking.lesson_type?.duration || (slot.end_time ? getDurationMinutes(slot) : "");
      return `
        <article class="booking-list-item">
          <h4>${escapeHtml(playerName)}</h4>
          <p>${startTime ? formatDate(startTime, { weekday: "short", month: "short", day: "numeric" }) : "Private lesson"}</p>
          <p>${startTime ? formatTime(startTime) : ""}${duration ? ` · ${duration} min` : ""}</p>
          <p>Status: ${escapeHtml(booking.booking_status)}</p>
        </article>
      `;
    }).join("");
  }

  function getPlayerNameFromNotes(notes = "") {
    return notes.split("\n").find((line) => line.startsWith("Player:"))?.replace("Player:", "").trim();
  }

  async function initBookingPage() {
    await refreshSession();
    await loadPrivateLessonType();
    await loadAvailableSlots();
    prefillBookingForm();
  }

  if (previousWeekEl) previousWeekEl.addEventListener("click", async () => {
    state.weekStart = addDays(state.weekStart, -7);
    state.selectedSlot = null;
    state.selectedDuration = null;
    await loadAvailableSlots();
  });

  if (nextWeekEl) nextWeekEl.addEventListener("click", async () => {
    state.weekStart = addDays(state.weekStart, 7);
    state.selectedSlot = null;
    state.selectedDuration = null;
    await loadAvailableSlots();
  });

  if (calendarEl) calendarEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-slot-id]");
    if (button) selectSlot(button.dataset.slotId);
  });

  if (durationSelectEl) durationSelectEl.addEventListener("change", () => {
    state.selectedDuration = Number(durationSelectEl.value) || null;
    if (state.selectedSlot && state.selectedDuration) {
      selectedSlotCopyEl.textContent = `${formatTime(state.selectedSlot.start_time)} start · ${state.selectedDuration} minutes`;
    }
  });

  if (bookingFormEl) bookingFormEl.addEventListener("submit", createBooking);

  if (calendarEl) initBookingPage();
  if (myBookingsEl) renderMyBookings();
})();
