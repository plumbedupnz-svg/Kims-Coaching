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
  const bundleSelectEl = document.querySelector("[data-bundle-select]");
  const paymentOptionEl = document.querySelector("[data-payment-option]");
  const paymentOptionRowEl = document.querySelector("[data-payment-option-row]");
  const bundleRowEl = document.querySelector("[data-bundle-row]");
  const paymentPolicyNoteEl = document.querySelector("[data-payment-policy-note]");
  const minimumPlayersNoteEl = document.querySelector("[data-minimum-players-note]");
  const priceSummaryEl = document.querySelector("[data-booking-price-summary]");
  const lessonFilterEl = document.querySelector("[data-booking-lesson-filter]");
  const clubFilterEl = document.querySelector("[data-booking-club-filter]");
  const coachFilterEl = document.querySelector("[data-booking-coach-filter]");
  const bookingPersonSelectEl = document.querySelector("[data-booking-person-select]");
  const waitlistFormEl = document.querySelector("[data-waitlist-form]");
  const waitlistOpenEl = document.querySelector("[data-waitlist-open]");
  const waitlistStatusEl = document.querySelector("[data-waitlist-status]");
  const waitlistPlayerRowEl = document.querySelector("[data-waitlist-player-row]");
  const waitlistPlayerSelectEl = document.querySelector("[data-waitlist-player-select]");
  const waitlistLessonTypeEl = document.querySelector("[data-waitlist-lesson-type]");
  const waitlistClubEl = document.querySelector("[data-waitlist-club]");
  const waitlistCoachEl = document.querySelector("[data-waitlist-coach]");
  const adminWaitlistEmail = "kim@kimjonescoaching.co.nz";
  const invalidStartMessage = "Lesson times must start on the hour or half hour.";
  const durationOptions = [30, 45, 60, 90, 120];
  const state = {
    user: null,
    profile: null,
    lessonType: null,
    lessonTypes: [],
    bundles: [],
    publicClubs: [],
    publicCoaches: [],
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

  function getRequiredDurationMinutes(slot) {
    const lessonDuration = Number(slot?.lesson_type_duration || 0);
    if (lessonDuration > 0) return lessonDuration;
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
    const requiredDuration = getRequiredDurationMinutes(slot);
    if (requiredDuration > 0) return requiredDuration <= maxDuration ? [requiredDuration] : [];
    return durationOptions.filter((duration) => duration <= maxDuration);
  }

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function getSlotLesson(slot = state.selectedSlot) {
    return {
      id: slot?.lesson_type_id || state.lessonType?.id || "",
      name: slot?.lesson_type_name || state.lessonType?.name || "Coaching",
      price: Number(slot?.lesson_type_price ?? state.lessonType?.price ?? 0),
      duration: Number(slot?.lesson_type_duration ?? state.lessonType?.duration ?? 0),
      minimumPlayers: Number(slot?.lesson_type_minimum_players ?? state.lessonType?.minimum_players ?? 1),
      payAsYouGoOnly: Boolean(slot?.lesson_type_pay_as_you_go_only ?? state.lessonType?.pay_as_you_go_only ?? false)
    };
  }

  function getSelectedBundle() {
    if (getSlotLesson().payAsYouGoOnly) return null;
    const bundleId = bundleSelectEl?.value || "";
    return state.bundles.find((bundle) => bundle.id === bundleId) || null;
  }

  function getSelectedCoach() {
    const coachId = coachFilterEl?.value || "all";
    if (coachId === "all") return null;
    return state.publicCoaches.find((coach) => coach.id === coachId) || null;
  }

  function getEffectiveCoach(slot = state.selectedSlot) {
    if (slot?.coach_id) {
      return {
        id: slot.coach_id,
        name: slot.coach_name || state.publicCoaches.find((coach) => coach.id === slot.coach_id)?.name || ""
      };
    }
    return getSelectedCoach();
  }

  function getBookingTotal() {
    const lesson = getSlotLesson();
    const bundle = getSelectedBundle();
    const lessonCount = bundle ? Number(bundle.lesson_count || 1) : 1;
    const discount = bundle ? Number(bundle.discount_percent || 0) : 0;
    const subtotal = lesson.price * lessonCount;
    return {
      lesson,
      bundle,
      lessonCount,
      discount,
      subtotal,
      total: Math.max(0, subtotal * (1 - discount / 100))
    };
  }

  function isHalfHourStart(value) {
    const date = new Date(value);
    const minutes = date.getMinutes();
    return !Number.isNaN(date.getTime()) && (minutes === 0 || minutes === 30);
  }

  function onlyBookableStartSlots(slots) {
    const validSlots = (slots || []).filter((slot) => isHalfHourStart(slot.start_time));
    if (slots?.length && validSlots.length !== slots.length) {
      setStatus(invalidStartMessage, "error");
    }
    const groupedSlots = new Map();
    validSlots.forEach((slot) => {
      const groupKey = slot.id || slot.availability_id || `${slot.lesson_type_id || "lesson"}|${slot.end_time || ""}`;
      groupedSlots.set(groupKey, [...(groupedSlots.get(groupKey) || []), slot]);
    });

    return Array.from(groupedSlots.values()).flatMap((group) => {
      const sortedGroup = group.sort((first, second) => new Date(first.start_time) - new Date(second.start_time));
      const blockStart = new Date(sortedGroup[0]?.start_time || "").getTime();
      return sortedGroup.filter((slot) => {
        const requiredDuration = getRequiredDurationMinutes(slot);
        const fitsWindow = getMaxDurationMinutes(slot) >= requiredDuration;
        if (!fitsWindow) return false;
        if (!requiredDuration || requiredDuration <= 30 || Number.isNaN(blockStart)) return true;
        const offsetMinutes = Math.round((new Date(slot.start_time).getTime() - blockStart) / 60000);
        return offsetMinutes % requiredDuration === 0;
      });
    });
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

  function createEmailTraceId() {
    return `booking-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    if (error) console.error("Could not load coaching type", error);
    state.lessonType = data || null;
    return state.lessonType;
  }

  async function loadLessonTypes() {
    if (!client) return [];
    const { data, error } = await client
      .from("lesson_types")
      .select("id,name,duration,price,capacity,minimum_players,pay_as_you_go_only,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.warn("Could not load active lesson types.", error.message);
      state.lessonTypes = [];
      return [];
    }

    state.lessonTypes = data || [];
    if (!state.lessonType && state.lessonTypes.length) state.lessonType = state.lessonTypes[0];
    return state.lessonTypes;
  }

  async function loadBundles() {
    if (!client) return [];
    const { data, error } = await client
      .from("lesson_bundles")
      .select("id,name,lesson_type_id,lesson_count,discount_percent,description,is_active")
      .eq("is_active", true)
      .order("lesson_count", { ascending: true });

    if (error) {
      console.warn("Could not load lesson bundles.", error.message);
      state.bundles = [];
      return [];
    }

    state.bundles = data || [];
    return state.bundles;
  }

  async function loadPublicCoaches() {
    if (!client) return [];
    const { data, error } = await client.rpc("get_public_coaches");
    if (error) {
      console.warn("Could not load public coaches.", error.message);
      state.publicCoaches = [];
      return [];
    }
    state.publicCoaches = (data || []).map((coach) => ({
      id: coach.coach_id,
      name: coach.coach_name
    })).filter((coach) => coach.id && coach.name);
    return state.publicCoaches;
  }

  async function loadPublicClubs() {
    if (!client) return [];
    const { data, error } = await client
      .from("coaching_clubs")
      .select("id,name,address,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.warn("Could not load public clubs.", error.message);
      state.publicClubs = [];
      return [];
    }

    state.publicClubs = (data || []).map((club) => ({
      id: club.id,
      name: club.name,
      address: club.address || ""
    })).filter((club) => club.id && club.name);
    return state.publicClubs;
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

    state.slots = onlyBookableStartSlots((data || []).map((slot) => ({
      id: slot.availability_id || slot.id,
      start_time: slot.start_time,
      end_time: slot.end_time,
      duration: slot.duration || getDurationMinutes(slot),
      max_duration_minutes: slot.max_duration_minutes || getDurationMinutes(slot),
      lesson_type_id: slot.lesson_type_id,
      lesson_type_name: slot.lesson_type_name,
      lesson_type_price: slot.lesson_type_price,
      lesson_type_duration: slot.lesson_type_duration,
      lesson_type_minimum_players: slot.lesson_type_minimum_players,
      lesson_type_pay_as_you_go_only: slot.lesson_type_pay_as_you_go_only,
      capacity: slot.capacity,
      booked_count: slot.booked_count,
      spaces_remaining: slot.spaces_remaining,
      club_id: slot.club_id,
      club_name: slot.club_name,
      club_address: slot.club_address,
      coach_id: slot.coach_id,
      coach_name: slot.coach_name
    })));
    renderFilterOptions();
    renderCalendar();
  }

  async function loadAvailableSlotsFallback(weekStartIso, weekEndIso) {
    let { data, error } = await client
      .from("availability")
      .select("*, lesson_type:lesson_type_id(id,name,duration,price,capacity,minimum_players,pay_as_you_go_only), club:club_id(id,name,address), coach:coach_id(id,display_name)")
      .eq("is_available", true)
      .gte("start_time", weekStartIso)
      .lt("start_time", weekEndIso)
      .order("start_time", { ascending: true });

    if (error && /club_id|coach_id|relationship|schema cache/i.test(error.message || "")) {
      console.warn("Club/coach booking columns are not installed yet; loading legacy availability.");
      const legacyResult = await client
        .from("availability")
        .select("*, lesson_type:lesson_type_id(id,name,duration,price,capacity,minimum_players,pay_as_you_go_only)")
        .eq("is_available", true)
        .gte("start_time", weekStartIso)
        .lt("start_time", weekEndIso)
        .order("start_time", { ascending: true });
      data = legacyResult.data;
      error = legacyResult.error;
    }

    if (error) {
      calendarEl.innerHTML = '<div class="booking-empty">Could not load coaching times.</div>';
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
            duration: Math.min(60, maxDuration),
            lesson_type_id: availability.lesson_type_id,
            lesson_type_name: availability.lesson_type?.name,
            lesson_type_price: availability.lesson_type?.price,
            lesson_type_duration: availability.lesson_type?.duration,
            lesson_type_minimum_players: availability.minimum_players || availability.lesson_type?.minimum_players,
            lesson_type_pay_as_you_go_only: availability.lesson_type?.pay_as_you_go_only,
            capacity: availability.capacity || availability.lesson_type?.capacity || 1,
            spaces_remaining: availability.capacity || availability.lesson_type?.capacity || 1,
            club_id: availability.club_id,
            club_name: availability.club?.name,
            club_address: availability.club?.address,
            coach_id: availability.coach_id,
            coach_name: availability.coach?.display_name
          });
        }
      }
    });

    state.slots = onlyBookableStartSlots(expandedSlots);
    renderFilterOptions();
    renderCalendar();
  }

  function populateFilter(select, items, placeholder) {
    if (!select) return;
    const current = select.value || "all";
    select.innerHTML = [
      `<option value="all">${escapeHtml(placeholder)}</option>`,
      ...items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    ].join("");
    if (current === "all" || items.some((item) => item.id === current)) select.value = current;
  }

  function uniqueFilterItems(idKey, nameKey) {
    const unique = new Map();
    state.slots.forEach((slot) => {
      if (slot[idKey] && slot[nameKey]) unique.set(slot[idKey], { id: slot[idKey], name: slot[nameKey] });
    });
    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderFilterOptions() {
    const lessonOptions = new Map();
    state.lessonTypes.forEach((lesson) => lessonOptions.set(lesson.id, { id: lesson.id, name: lesson.name }));
    uniqueFilterItems("lesson_type_id", "lesson_type_name").forEach((lesson) => lessonOptions.set(lesson.id, lesson));
    populateFilter(lessonFilterEl, Array.from(lessonOptions.values()).sort((a, b) => a.name.localeCompare(b.name)), "All lesson types");
    populateFilter(clubFilterEl, uniqueFilterItems("club_id", "club_name"), "All clubs");
    const slotCoaches = uniqueFilterItems("coach_id", "coach_name");
    const coaches = new Map(slotCoaches.map((coach) => [coach.id, coach]));
    state.publicCoaches.forEach((coach) => coaches.set(coach.id, coach));
    const coachOptions = Array.from(coaches.values()).sort((a, b) => a.name.localeCompare(b.name));
    populateFilter(coachFilterEl, coachOptions, "All coaches");
    if (coachFilterEl?.value === "all" && coachOptions.length === 1) coachFilterEl.value = coachOptions[0].id;
  }

  function populateSimpleSelect(select, items, placeholder) {
    if (!select) return;
    const current = select.value || "";
    select.innerHTML = [
      `<option value="">${escapeHtml(placeholder)}</option>`,
      ...items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    ].join("");
    if (items.some((item) => item.id === current)) select.value = current;
  }

  function populateWaitlistSelects() {
    const lessonOptions = state.lessonTypes
      .map((lesson) => ({ id: lesson.id, name: lesson.name }))
      .filter((lesson) => lesson.id && lesson.name);
    const clubOptions = state.publicClubs.length
      ? state.publicClubs
      : uniqueFilterItems("club_id", "club_name");
    const coachOptions = state.publicCoaches.length
      ? state.publicCoaches
      : uniqueFilterItems("coach_id", "coach_name");

    populateSimpleSelect(waitlistLessonTypeEl, lessonOptions, "Any coaching type");
    populateSimpleSelect(waitlistClubEl, clubOptions, "Any club");
    populateSimpleSelect(waitlistCoachEl, coachOptions, "Any coach");
  }

  function getFilteredSlots() {
    const lessonId = lessonFilterEl?.value || "all";
    const clubId = clubFilterEl?.value || "all";
    const coachId = coachFilterEl?.value || "all";
    return state.slots.filter((slot) => (
      (lessonId === "all" || slot.lesson_type_id === lessonId)
      && (clubId === "all" || slot.club_id === clubId)
      && (coachId === "all" || !slot.coach_id || slot.coach_id === coachId)
    ));
  }

  function renderCalendar() {
    if (!calendarEl) return;
    const weekEnd = addDays(state.weekStart, 6);
    weekTitleEl.textContent = `${formatDate(state.weekStart, { month: "short", day: "numeric" })} - ${formatDate(weekEnd, { month: "short", day: "numeric" })}`;

    const days = Array.from({ length: 7 }, (_item, index) => addDays(state.weekStart, index));
    const visibleSlots = getFilteredSlots();
    const slotsByDay = new Map();
    visibleSlots.forEach((slot) => {
      const key = new Date(slot.start_time).toDateString();
      slotsByDay.set(key, [...(slotsByDay.get(key) || []), slot]);
    });

    const hasSlots = visibleSlots.length > 0;
    if (emptyEl) emptyEl.hidden = hasSlots;

    calendarEl.innerHTML = days.map((day) => {
      const daySlots = slotsByDay.get(day.toDateString()) || [];
      const slotButtons = daySlots.map((slot) => {
        const lesson = getSlotLesson(slot);
        const spots = Number(slot.spaces_remaining || slot.capacity || 0);
        const spotText = spots ? ` · ${spots} spot${spots === 1 ? "" : "s"}` : "";
        const effectiveCoach = getEffectiveCoach(slot);
        const contextText = [slot.club_name, effectiveCoach?.name ? `Coach ${effectiveCoach.name}` : ""].filter(Boolean).join(" · ");
        return `
        <button class="slot-button ${state.selectedSlot && getSlotKey(state.selectedSlot) === getSlotKey(slot) ? "selected" : ""}" type="button" data-slot-id="${getSlotKey(slot)}">
          <span class="slot-lesson-type">${escapeHtml(lesson.name)}</span>
          <strong class="slot-time">${formatTime(slot.start_time)}</strong>
          <span class="slot-meta">${getRequiredDurationMinutes(slot)} min${spotText}</span>
          ${contextText ? `<span class="slot-context">${escapeHtml(contextText)}</span>` : ""}
        </button>
      `;
      }).join("");

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
    if (Array.isArray(profile?.players) && profile.players.length) {
      return profile.players
        .map((player) => ({
          name: player?.name || "",
          level: player?.level || player?.tennis_level || "",
          notes: player?.notes || ""
        }))
        .filter((player) => player.name);
    }
    if (profile?.player_name) return [{ name: profile.player_name, level: profile.tennis_level || "" }];
    return [];
  }

  function getAccountHolderName(profile = state.profile) {
    return `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
  }

  function getBookingPeople() {
    const profile = state.profile || {};
    const accountHolderName = getAccountHolderName(profile);
    const people = [];
    if (accountHolderName) {
      people.push({
        id: "account-holder",
        label: `${accountHolderName} (account holder)`,
        name: accountHolderName,
        level: profile.tennis_level || "",
        parentName: ""
      });
    }

    getProfilePlayers(profile).forEach((player, index) => {
      people.push({
        id: `player-${index}`,
        label: player.name,
        name: player.name,
        level: player.level || "",
        notes: player.notes || "",
        parentName: profile.parent_name || ""
      });
    });

    return people;
  }

  function renderBookingPersonOptions() {
    if (!bookingPersonSelectEl) return;
    const people = getBookingPeople();
    bookingPersonSelectEl.innerHTML = [
      '<option value="">Select account holder or player</option>',
      ...people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.label)}</option>`)
    ].join("");

    if (people.length) bookingPersonSelectEl.value = people[0].id;
  }

  function applySelectedBookingPerson() {
    if (!bookingFormEl || !bookingPersonSelectEl) return;
    const selected = getBookingPeople().find((person) => person.id === bookingPersonSelectEl.value);
    if (!selected) return;
    bookingFormEl.elements.player_name.value = selected.name || "";
    bookingFormEl.elements.parent_name.value = selected.parentName || "";
    if (bookingFormEl.elements.player_level) {
      bookingFormEl.elements.player_level.value = selected.level || "";
    }
  }

  function prefillBookingForm() {
    if (!bookingFormEl || !state.user) return;
    const profile = state.profile || {};
    bookingFormEl.elements.parent_name.value = profile.parent_name || "";
    bookingFormEl.elements.email.value = state.user.email || profile.email || "";
    bookingFormEl.elements.mobile.value = profile.mobile || profile.phone || "";
    bookingFormEl.elements.notes.value = profile.notes || "";
    renderBookingPersonOptions();
    applySelectedBookingPerson();
  }

  function setWaitlistStatus(message, tone = "neutral") {
    if (!waitlistStatusEl) return;
    waitlistStatusEl.textContent = message;
    waitlistStatusEl.dataset.tone = tone;
  }

  function getSelectedOptionText(select) {
    if (!select || !select.value) return "";
    return select.selectedOptions?.[0]?.textContent?.trim() || "";
  }

  function splitPreferenceList(value = "") {
    return String(value || "")
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function prefillWaitlistForm() {
    if (!waitlistFormEl) return;
    const profile = state.profile || {};
    const accountHolderName = getAccountHolderName(profile);
    const players = getProfilePlayers(profile);

    if (waitlistPlayerSelectEl) {
      waitlistPlayerSelectEl.innerHTML = [
        '<option value="">Select a saved player</option>',
        ...players.map((player, index) => `<option value="${index}">${escapeHtml(player.name)}</option>`)
      ].join("");
    }
    if (waitlistPlayerRowEl) waitlistPlayerRowEl.hidden = !players.length;

    if (!state.user) return;
    waitlistFormEl.elements.customer_name.value = profile.parent_name || accountHolderName || "";
    waitlistFormEl.elements.email.value = state.user.email || profile.email || "";
    waitlistFormEl.elements.mobile.value = profile.mobile || profile.phone || "";
  }

  function openWaitlistForm() {
    if (!waitlistFormEl) return;
    waitlistFormEl.hidden = false;
    if (waitlistOpenEl) waitlistOpenEl.hidden = true;
    prefillWaitlistForm();
    const focusTarget = waitlistPlayerSelectEl && !waitlistPlayerSelectEl.closest("[hidden]")
      ? waitlistPlayerSelectEl
      : waitlistFormEl.elements.player_name;
    focusTarget?.focus?.({ preventScroll: true });
    waitlistFormEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyWaitlistPlayerSelection() {
    if (!waitlistFormEl || !waitlistPlayerSelectEl) return;
    const selectedIndex = waitlistPlayerSelectEl.value;
    if (selectedIndex === "") return;
    const player = getProfilePlayers(state.profile || {})[Number(selectedIndex)];
    if (!player) return;
    waitlistFormEl.elements.player_name.value = player.name || "";
    waitlistFormEl.elements.player_level.value = player.level || "";
  }

  function buildWaitlistRequest(formData) {
    const lessonTypeName = getSelectedOptionText(waitlistLessonTypeEl);
    const clubName = getSelectedOptionText(waitlistClubEl);
    const coachName = getSelectedOptionText(waitlistCoachEl);
    const preferredDuration = formData.get("preferred_duration") || "";
    return {
      relatedType: "waitlist",
      adminEmail: adminWaitlistEmail,
      lessonTypeId: formData.get("lesson_type_id") || "",
      clubId: formData.get("club_id") || "",
      coachId: formData.get("coach_id") || "",
      playerName: formData.get("player_name")?.trim() || "",
      playerLevel: formData.get("player_level") || "",
      lessonTypeName: lessonTypeName === "Any coaching type" ? "" : lessonTypeName,
      preferredDuration,
      preferredDays: splitPreferenceList(formData.get("preferred_days")),
      preferredTimes: splitPreferenceList(formData.get("preferred_times")),
      clubName: clubName === "Any club" ? "" : clubName,
      coachName: coachName === "Any coach" ? "" : coachName,
      customerName: formData.get("customer_name")?.trim() || "",
      email: formData.get("email")?.trim() || "",
      mobile: formData.get("mobile")?.trim() || "",
      notes: formData.get("notes")?.trim() || ""
    };
  }

  function buildWaitlistInsertPayload(request) {
    return {
      user_id: state.user?.id || null,
      preferred_days: request.preferredDays,
      preferred_times: request.preferredTimes,
      skill_level: request.playerLevel,
      notes: request.notes,
      player_name: request.playerName,
      preferred_lesson_type: request.lessonTypeName,
      preferred_duration: request.preferredDuration ? Number(request.preferredDuration) : null,
      lesson_type_id: request.lessonTypeId || null,
      club: request.clubName,
      club_id: request.clubId || null,
      coach: request.coachName,
      coach_id: request.coachId || null,
      customer_name: request.customerName,
      email: request.email,
      mobile: request.mobile,
      request_status: "new"
    };
  }

  function buildLegacyWaitlistPayload(request) {
    const legacyNotes = [
      request.notes,
      request.playerName ? `Player: ${request.playerName}` : "",
      request.lessonTypeName ? `Lesson type: ${request.lessonTypeName}` : "",
      request.preferredDuration ? `Preferred duration: ${request.preferredDuration} minutes` : "",
      request.clubName ? `Club: ${request.clubName}` : "",
      request.coachName ? `Coach: ${request.coachName}` : "",
      request.customerName ? `Customer: ${request.customerName}` : "",
      request.email ? `Email: ${request.email}` : "",
      request.mobile ? `Mobile: ${request.mobile}` : ""
    ].filter(Boolean).join("\n");

    return {
      user_id: state.user?.id || null,
      preferred_days: request.preferredDays,
      preferred_times: request.preferredTimes,
      skill_level: request.playerLevel,
      notes: legacyNotes
    };
  }

  async function saveWaitlistRequest(request) {
    if (!client) throw new Error("Supabase is not configured yet.");
    const result = await client
      .from("waitlist")
      .insert(buildWaitlistInsertPayload(request))
      .select("id")
      .single();

    if (!result.error) return result.data;
    if (/column|schema cache/i.test(result.error.message || "")) {
      const legacyResult = await client
        .from("waitlist")
        .insert(buildLegacyWaitlistPayload(request))
        .select("id")
        .single();
      if (legacyResult.error) throw legacyResult.error;
      return legacyResult.data;
    }
    throw result.error;
  }

  async function submitWaitlistRequest(event) {
    event.preventDefault();
    if (!waitlistFormEl) return;
    if (!waitlistFormEl.checkValidity()) {
      waitlistFormEl.reportValidity();
      return;
    }

    const submitButton = waitlistFormEl.querySelector("button[type='submit']");
    const request = buildWaitlistRequest(new FormData(waitlistFormEl));
    if (submitButton) submitButton.disabled = true;
    setWaitlistStatus("Sending your request...", "neutral");

    try {
      const savedRequest = await saveWaitlistRequest(request);
      const emailPayload = {
        ...request,
        relatedId: savedRequest?.id || "",
        traceId: `waitlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      };
      await Promise.allSettled([
        window.KimsEmailService?.sendWaitlistNotification(emailPayload),
        request.email ? window.KimsEmailService?.sendWaitlistCustomerConfirmation(emailPayload) : Promise.resolve({ status: "skipped" })
      ]);
      waitlistFormEl.reset();
      populateWaitlistSelects();
      prefillWaitlistForm();
      if (waitlistOpenEl) waitlistOpenEl.hidden = false;
      waitlistFormEl.hidden = true;
      setWaitlistStatus("Thanks, your request has been received. Kim will be in touch soon.", "success");
    } catch (error) {
      console.error("Could not submit waitlist request", error);
      setWaitlistStatus(error.message || "Could not submit the request. Please try again.", "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
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

  function renderBundleOptions() {
    if (!bundleSelectEl) return;
    const lesson = getSlotLesson();
    if (lesson.payAsYouGoOnly) {
      bundleSelectEl.innerHTML = '<option value="">Single lesson</option>';
      bundleSelectEl.value = "";
      return;
    }
    const current = bundleSelectEl.value;
    const matchingBundles = state.bundles.filter((bundle) => !bundle.lesson_type_id || bundle.lesson_type_id === lesson.id);
    bundleSelectEl.innerHTML = [
      '<option value="">Single lesson</option>',
      ...matchingBundles.map((bundle) => `<option value="${escapeHtml(bundle.id)}">${escapeHtml(bundle.name)} · ${Number(bundle.lesson_count || 0)} lessons · ${Number(bundle.discount_percent || 0)}% off</option>`)
    ].join("");
    if (matchingBundles.some((bundle) => bundle.id === current)) bundleSelectEl.value = current;
  }

  function renderPaymentPolicy() {
    const lesson = getSlotLesson();
    const isPayAsYouGoOnly = lesson.payAsYouGoOnly;
    if (paymentOptionRowEl) paymentOptionRowEl.hidden = isPayAsYouGoOnly;
    if (bundleRowEl) bundleRowEl.hidden = isPayAsYouGoOnly;
    if (paymentOptionEl) {
      paymentOptionEl.required = !isPayAsYouGoOnly;
      if (isPayAsYouGoOnly) paymentOptionEl.value = "pay_later";
    }
    if (bundleSelectEl && isPayAsYouGoOnly) bundleSelectEl.value = "";
    if (paymentPolicyNoteEl) {
      paymentPolicyNoteEl.hidden = !isPayAsYouGoOnly;
      paymentPolicyNoteEl.textContent = isPayAsYouGoOnly
        ? "Pay as you go only. Payment options are not required for this booking."
        : "";
    }
    if (minimumPlayersNoteEl) {
      const minimumPlayers = Number(lesson.minimumPlayers || 1);
      minimumPlayersNoteEl.hidden = minimumPlayers <= 1;
      minimumPlayersNoteEl.textContent = minimumPlayers > 1
        ? `This class requires a minimum of ${minimumPlayers} players to proceed.`
        : "";
    }
  }

  function renderPriceSummary() {
    if (!priceSummaryEl) return;
    if (!state.selectedSlot) {
      priceSummaryEl.textContent = "";
      return;
    }

    const total = getBookingTotal();
    if (total.lesson.payAsYouGoOnly) {
      priceSummaryEl.textContent = `${total.lesson.name}: ${money(total.lesson.price)}. Pay as you go only.`;
      return;
    }
    const paymentText = paymentOptionEl?.value === "pay_now" ? "Pay now selected" : "Pay later selected";
    priceSummaryEl.textContent = total.bundle
      ? `${total.bundle.name}: ${total.lessonCount} lessons, ${total.discount}% off. Total ${money(total.total)}. ${paymentText}.`
      : `${total.lesson.name}: ${money(total.lesson.price)}. ${paymentText}.`;
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

    const lesson = getSlotLesson(state.selectedSlot);
    selectedSlotTitleEl.textContent = `${lesson.name}`;
    const effectiveCoach = getEffectiveCoach(state.selectedSlot);
    const context = [state.selectedSlot.club_name, effectiveCoach?.name ? `Coach ${effectiveCoach.name}` : ""].filter(Boolean).join(" · ");
    selectedSlotCopyEl.textContent = `${formatDate(state.selectedSlot.start_time, { weekday: "long", month: "short", day: "numeric" })} · ${formatTime(state.selectedSlot.start_time)} start${context ? ` · ${context}` : ""} · ${getRequiredDurationMinutes(state.selectedSlot)} minute lesson`;
    if (authRequiredEl) authRequiredEl.hidden = Boolean(state.user);
    if (bookingFormEl) bookingFormEl.hidden = !state.user;
    if (bookingSuccessEl) bookingSuccessEl.hidden = true;
    renderDurationOptions();
    renderPaymentPolicy();
    renderBundleOptions();
    renderPriceSummary();
    prefillBookingForm();
    renderCalendar();
  }

  function buildNotes(formData) {
    const rawNotes = formData.get("notes")?.trim() || "";
    return [
      `Coaching booking`,
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
    if (!state.selectedSlot.lesson_type_id && !state.lessonType?.id) {
      setStatus("Lesson type is not configured yet.", "error");
      return;
    }
    if (!isHalfHourStart(state.selectedSlot.start_time)) {
      setStatus(invalidStartMessage, "error");
      await loadAvailableSlots();
      return;
    }

    const formData = new FormData(bookingFormEl);
    const lesson = getSlotLesson(state.selectedSlot);
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

    const bookingTotal = getBookingTotal();
    const effectiveCoach = getEffectiveCoach(state.selectedSlot);
    const payload = {
      user_id: state.user.id,
      lesson_type_id: state.selectedSlot.lesson_type_id || state.lessonType.id,
      availability_id: state.selectedSlot.id,
      club_id: state.selectedSlot.club_id || null,
      coach_id: effectiveCoach?.id || null,
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
      duration_minutes: selectedDuration,
      payment_option: lesson.payAsYouGoOnly ? "pay_later" : formData.get("payment_option") || "pay_later",
      bundle_id: lesson.payAsYouGoOnly ? null : formData.get("bundle_id") || null,
      bundle_lessons_count: bookingTotal.bundle ? bookingTotal.lessonCount : null,
      bundle_discount_percent: bookingTotal.bundle ? bookingTotal.discount : null,
      total_price: bookingTotal.total
    };

    const emailTraceId = createEmailTraceId();
    console.info("[Kim's Coaching booking email] booking save starting", {
      traceId: emailTraceId,
      availabilityId: payload.availability_id,
      lessonTypeId: payload.lesson_type_id,
      customerEmail: payload.customer_email,
      startTime: payload.start_time,
      endTime: payload.end_time
    });
    setStatus("Saving your coaching booking...", "neutral");
    const submitButton = bookingFormEl.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;

    let result = await client.rpc("create_private_lesson_booking", {
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
      p_notes: payload.notes,
      p_payment_option: payload.payment_option,
      p_bundle_id: payload.bundle_id,
      p_bundle_lessons_count: payload.bundle_lessons_count,
      p_bundle_discount_percent: payload.bundle_discount_percent,
      p_total_price: payload.total_price,
      p_club_id: payload.club_id,
      p_coach_id: payload.coach_id
    });

    if (result.error && /function .*create_private_lesson_booking|schema cache|PGRST202/i.test(result.error.message || result.error.code || "")) {
      console.warn("New booking RPC is not installed yet; retrying with legacy booking parameters.");
      result = await client.rpc("create_private_lesson_booking", {
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
    }

    if (submitButton) submitButton.disabled = false;

    if (result.error) {
      console.error("[Kim's Coaching booking email] booking save failed", {
        traceId: emailTraceId,
        error: result.error.message,
        code: result.error.code
      });
      const message = result.error.code === "23505"
        ? "That time has just been booked. Please choose another coaching time."
        : result.error.message;
      setStatus(message, "error");
      await loadAvailableSlots();
      return;
    }
    console.info("[Kim's Coaching booking email] booking saved", {
      traceId: emailTraceId,
      bookingId: result.data?.id || "",
      customerEmail: payload.customer_email
    });

    const notificationPayload = {
      traceId: emailTraceId,
      relatedType: "booking",
      relatedId: result.data?.id || "",
      customerName: payload.parent_name,
      playerName: payload.player_name,
      playerLevel: payload.player_level,
      player_level: payload.player_level,
      email: payload.customer_email,
      mobile: payload.mobile,
      dateTime: payload.start_time,
      startTime: payload.start_time,
      endTime: payload.end_time,
      durationMinutes: payload.duration_minutes,
      lessonTypeName: bookingTotal.lesson.name,
      paymentOption: payload.payment_option,
      totalPrice: payload.total_price,
      bundleName: bookingTotal.bundle?.name || "",
      clubName: state.selectedSlot.club_name || "",
      coachName: effectiveCoach?.name || "",
      location: state.selectedSlot.club_name || state.selectedSlot.club_address || "Kim Jones Coaching",
      notes: formData.get("notes")?.trim() || ""
    };
    console.info("[Kim's Coaching booking email] notification dispatch starting", {
      traceId: emailTraceId,
      bookingId: notificationPayload.relatedId,
      customerEmail: notificationPayload.email
    });
    const emailStatus = await window.KimsBookingServices?.notifyAdminOfNewBooking(notificationPayload);
    console.info("[Kim's Coaching booking email] notification dispatch finished", {
      traceId: emailTraceId,
      emailStatus
    });

    setStatus("", "success");
    bookingFormEl.hidden = true;
    bookingSuccessEl.hidden = false;
    bookingSuccessEl.innerHTML = `
      <strong>Your coaching booking has been booked.</strong>
      <p>${escapeHtml(bookingTotal.lesson.name)}</p>
      ${state.selectedSlot.club_name ? `<p>Club: ${escapeHtml(state.selectedSlot.club_name)}</p>` : ""}
      ${effectiveCoach?.name ? `<p>Coach: ${escapeHtml(effectiveCoach.name)}</p>` : ""}
      <p>${formatDate(payload.start_time, { weekday: "long", month: "long", day: "numeric" })}</p>
      <p>${formatTime(payload.start_time)} · ${payload.duration_minutes} minutes</p>
      <p>${payload.payment_option === "pay_now" ? "Pay now" : "Pay later"} · ${money(payload.total_price)}</p>
      <p>Player: ${escapeHtml(payload.player_name)}</p>
    `;
    sessionStorage.setItem("kims_last_booking_confirmation", JSON.stringify({
      startTime: payload.start_time,
      endTime: payload.end_time,
      duration: payload.duration_minutes,
      playerName: payload.player_name,
      paymentOption: payload.payment_option,
      totalPrice: payload.total_price,
      bundleName: bookingTotal.bundle?.name || "",
      clubName: state.selectedSlot.club_name || "",
      coachName: effectiveCoach?.name || "",
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
      myBookingsEl.innerHTML = '<p class="helper-text">Log in to view your coaching bookings.</p>';
      return;
    }

    const { data, error } = await client
      .from("bookings")
      .select("*, availability:availability_id(start_time,end_time), lesson_type:lesson_type_id(name,duration), club:club_id(name,address), coach:coach_id(display_name)")
      .eq("user_id", state.user.id)
      .in("booking_status", ["pending", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      myBookingsEl.innerHTML = '<p class="helper-text">Could not load bookings yet.</p>';
      return;
    }

    if (!data?.length) {
      myBookingsEl.innerHTML = '<p class="helper-text">No coaching bookings yet.</p>';
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
          <p>${escapeHtml(booking.lesson_type?.name || "Coaching")}</p>
          ${booking.club?.name ? `<p>${escapeHtml(booking.club.name)}</p>` : ""}
          ${booking.coach?.display_name ? `<p>Coach ${escapeHtml(booking.coach.display_name)}</p>` : ""}
          <p>${startTime ? formatDate(startTime, { weekday: "short", month: "short", day: "numeric" }) : "Coaching"}</p>
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
    await loadLessonTypes();
    await loadBundles();
    await loadPublicClubs();
    await loadPublicCoaches();
    await loadAvailableSlots();
    populateWaitlistSelects();
    prefillBookingForm();
    prefillWaitlistForm();
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
      selectedSlotCopyEl.textContent = `${formatDate(state.selectedSlot.start_time, { weekday: "long", month: "short", day: "numeric" })} · ${formatTime(state.selectedSlot.start_time)} start · ${state.selectedDuration} minutes`;
    }
    renderPriceSummary();
  });

  if (bundleSelectEl) bundleSelectEl.addEventListener("change", renderPriceSummary);
  if (paymentOptionEl) paymentOptionEl.addEventListener("change", renderPriceSummary);
  if (bookingPersonSelectEl) bookingPersonSelectEl.addEventListener("change", applySelectedBookingPerson);
  [lessonFilterEl, clubFilterEl, coachFilterEl].forEach((filter) => filter?.addEventListener("change", () => {
    state.selectedSlot = null;
    renderCalendar();
  }));

  if (bookingFormEl) bookingFormEl.addEventListener("submit", createBooking);
  if (waitlistOpenEl) waitlistOpenEl.addEventListener("click", openWaitlistForm);
  if (waitlistPlayerSelectEl) waitlistPlayerSelectEl.addEventListener("change", applyWaitlistPlayerSelection);
  if (waitlistFormEl) waitlistFormEl.addEventListener("submit", submitWaitlistRequest);

  if (calendarEl) initBookingPage();
  if (myBookingsEl) renderMyBookings();
})();
