(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const cardsEl = document.querySelector("[data-junior-group-cards]");
  const panelEl = document.querySelector("[data-junior-group-panel]");
  const titleEl = document.querySelector("[data-junior-selected-title]");
  const copyEl = document.querySelector("[data-junior-selected-copy]");
  const authRequiredEl = document.querySelector("[data-junior-auth-required]");
  const formEl = document.querySelector("[data-junior-group-form]");
  const personSelectEl = document.querySelector("[data-junior-booking-person]");
  const statusEl = document.querySelector("[data-junior-group-status]");
  const eligibilityEl = document.querySelector("[data-junior-eligibility-message]");
  const mySessionsEl = document.querySelector("[data-junior-my-sessions]");
  const mySessionListEl = document.querySelector("[data-junior-my-session-list]");

  if (!cardsEl) return;

  const levelOrder = ["Beginner", "Developing", "Interclub", "Tournament"];
  const state = {
    user: null,
    profile: null,
    groups: [],
    selectedGroup: null
  };

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(value, options = {}) {
    if (!value) return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...options }).format(new Date(value));
  }

  function formatTime(value) {
    if (!value) return "";
    const [hour, minute] = String(value).split(":");
    const date = new Date();
    date.setHours(Number(hour || 0), Number(minute || 0), 0, 0);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function getDayName(day) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(day || 0)] || "Weekly";
  }

  function setStatus(message = "", tone = "") {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (tone) statusEl.dataset.tone = tone;
    else statusEl.removeAttribute("data-tone");
  }

  function setEligibility(message = "") {
    if (!eligibilityEl) return;
    eligibilityEl.hidden = !message;
    eligibilityEl.textContent = message;
    eligibilityEl.dataset.tone = message ? "error" : "";
    const submit = formEl?.querySelector("button[type='submit']");
    if (submit) submit.disabled = Boolean(message);
  }

  function getLevelRank(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return levelOrder.findIndex((level) => level.toLowerCase() === normalized);
  }

  function calculateAgeFromDob(value) {
    if (!value) return null;
    const dob = new Date(value);
    if (Number.isNaN(dob.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
    return age >= 0 ? age : null;
  }

  function normalizePlayerAge(player = {}) {
    const explicitAge = Number(player.age ?? player.player_age ?? "");
    if (!Number.isNaN(explicitAge) && explicitAge > 0) return explicitAge;
    return calculateAgeFromDob(player.dob || player.date_of_birth || player.dateOfBirth);
  }

  function getAccountHolderName(profile = state.profile) {
    return `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
  }

  function getProfilePlayers(profile = state.profile) {
    if (Array.isArray(profile?.players) && profile.players.length) {
      return profile.players
        .map((player, index) => ({
          id: `player-${index}`,
          index,
          label: player?.name || `Player ${index + 1}`,
          name: player?.name || "",
          age: normalizePlayerAge(player),
          level: player?.level || player?.tennis_level || "",
          parentName: player?.parent_name || profile?.parent_name || "",
          notes: player?.notes || ""
        }))
        .filter((player) => player.name);
    }
    if (profile?.player_name) {
      return [{
        id: "profile-player",
        index: 0,
        label: profile.player_name,
        name: profile.player_name,
        age: normalizePlayerAge({ age: profile.player_age }),
        level: profile.tennis_level || "",
        parentName: profile.parent_name || "",
        notes: ""
      }];
    }
    return [];
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
        age: normalizePlayerAge({ age: profile.account_holder_age ?? profile.player_age }),
        level: profile.tennis_level || "",
        parentName: "",
        index: null
      });
    }
    return people.concat(getProfilePlayers(profile));
  }

  function selectedPerson() {
    return getBookingPeople().find((person) => person.id === personSelectEl?.value) || null;
  }

  async function getAccessToken() {
    if (!client) return "";
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || "";
  }

  async function startStripeCheckout(memberId) {
    const token = await getAccessToken();
    const response = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        booking_type: "junior_group",
        member_id: memberId
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(data.error || "Could not start Stripe Checkout.");
    try { sessionStorage.setItem("kims_pending_checkout_type", "junior_group"); } catch (error) {}
    window.location.href = data.url;
  }

  function eligibilityIssue(group = state.selectedGroup) {
    if (!group || !formEl) return "";
    const person = selectedPerson();
    const age = Number(formEl.elements.player_age.value || person?.age || 0);
    const level = formEl.elements.player_level.value || person?.level || "";
    if (group.age_min !== null && group.age_min !== undefined && (!age || age < Number(group.age_min))) {
      return `This programme requires players to be at least ${Number(group.age_min)} years old.`;
    }
    if (group.age_max !== null && group.age_max !== undefined && (!age || age > Number(group.age_max))) {
      return `This programme is for players aged ${Number(group.age_max)} or under.`;
    }
    if (group.level) {
      const requiredRank = getLevelRank(group.level);
      const playerRank = getLevelRank(level);
      if (requiredRank >= 0 && playerRank < requiredRank) return `This programme requires a minimum level of ${group.level}.`;
    }
    if (Number(group.spaces_remaining || 0) <= 0) return "This junior group is full.";
    return "";
  }

  function applyPersonSelection() {
    if (!formEl) return;
    const person = selectedPerson();
    if (!person) return;
    formEl.elements.player_name.value = person.name || "";
    formEl.elements.player_age.value = person.age || "";
    formEl.elements.player_level.value = person.level || "";
    formEl.elements.parent_name.value = person.parentName || "";
    setEligibility(eligibilityIssue());
  }

  function populatePeople() {
    if (!personSelectEl) return;
    const people = getBookingPeople();
    personSelectEl.innerHTML = [
      '<option value="">Select account holder or player</option>',
      ...people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.label)}</option>`)
    ].join("");
    if (people.length) personSelectEl.value = people[0].id;
    applyPersonSelection();
  }

  async function refreshSession() {
    if (!client) return;
    const { data } = await client.auth.getSession();
    state.user = data?.session?.user || null;
    if (!state.user) return;
    const { data: profile, error } = await client.from("profiles").select("*").eq("id", state.user.id).single();
    if (!error) state.profile = profile;
  }

  async function loadGroups() {
    if (!client) {
      cardsEl.innerHTML = '<p class="helper-text">Supabase is not configured yet.</p>';
      return;
    }
    const { data, error } = await client.rpc("get_public_junior_groups");
    if (error) {
      cardsEl.innerHTML = `<p class="form-message" data-tone="error">Junior Group Coaching is not fully set up yet. Run supabase/migrations/20260627010000_junior_group_coaching.sql. Supabase said: ${escapeHtml(error.message)}</p>`;
      return;
    }
    state.groups = data || [];
    renderGroups();
  }

  async function loadMySessions() {
    if (!client || !state.user || !mySessionsEl || !mySessionListEl) return;
    mySessionsEl.hidden = false;
    const { data, error } = await client.rpc("get_my_junior_group_sessions");
    if (error) {
      mySessionListEl.innerHTML = `<p class="form-message" data-tone="error">Could not load your junior group sessions: ${escapeHtml(error.message)}</p>`;
      return;
    }
    const sessions = data || [];
    if (!sessions.length) {
      mySessionListEl.innerHTML = '<p class="helper-text">No confirmed junior group sessions yet.</p>';
      return;
    }
    mySessionListEl.innerHTML = sessions.map((session) => `
      <article class="admin-data-row">
        <div>
          <strong>${escapeHtml(session.programme_name || session.group_name || "Junior Group Coaching")}</strong>
          <p>${escapeHtml(session.player_name || "Player")} · ${formatDateTime(session.start_time)}</p>
          <p>${escapeHtml(session.coach_name || "Coach TBC")} · ${escapeHtml(session.club_name || "Club TBC")}</p>
          ${session.plan_title ? `<p>Plan: ${escapeHtml(session.plan_title)}</p>` : ""}
        </div>
        <span class="status-pill available">Confirmed</span>
      </article>
    `).join("");
  }

  function renderGroups() {
    if (!state.groups.length) {
      cardsEl.innerHTML = '<p class="helper-text">No junior group programmes are currently open for booking.</p>';
      return;
    }
    cardsEl.innerHTML = state.groups.map((group) => {
      const isFull = Number(group.spaces_remaining || 0) <= 0;
      const ageText = group.age_min || group.age_max
        ? `${group.age_min ?? "any"}-${group.age_max ?? "any"} years`
        : "All ages";
      const dateText = [formatDate(group.start_date), group.end_date ? formatDate(group.end_date) : ""].filter(Boolean).join(" - ");
      return `
        <article class="junior-programme-card">
          <div>
            <span class="status-pill ${isFull ? "blocked" : "available"}">${isFull ? "Full" : `${Number(group.spaces_remaining || 0)} spaces available`}</span>
            <h3>${escapeHtml(group.programme_name || group.group_name)}</h3>
            <p>${escapeHtml(ageText)} · ${escapeHtml(group.level || "Any level")}</p>
            <p>${escapeHtml(group.coach_name || "Coach TBC")} · ${escapeHtml(group.club_name || "Club TBC")}</p>
            <p>${getDayName(group.recurring_day)} ${formatTime(group.start_time)} · ${Number(group.session_count || 0)} sessions · ${Number(group.session_duration_minutes || 0)} min</p>
            <p>${escapeHtml(dateText)} · ${money(group.price)}</p>
            ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ""}
          </div>
          <button class="btn btn-primary" type="button" data-junior-group-id="${escapeHtml(group.group_id)}" ${isFull ? "disabled" : ""}>Book Group</button>
        </article>
      `;
    }).join("");
  }

  function selectGroup(id) {
    state.selectedGroup = state.groups.find((group) => group.group_id === id);
    if (!state.selectedGroup) return;
    if (panelEl) panelEl.hidden = false;
    if (titleEl) titleEl.textContent = state.selectedGroup.programme_name || state.selectedGroup.group_name || "Junior Group Coaching";
    if (copyEl) {
      copyEl.textContent = `${getDayName(state.selectedGroup.recurring_day)} ${formatTime(state.selectedGroup.start_time)} · ${money(state.selectedGroup.price)} · ${Number(state.selectedGroup.spaces_remaining || 0)} spaces remaining`;
    }
    if (authRequiredEl) authRequiredEl.hidden = Boolean(state.user);
    if (formEl) formEl.hidden = !state.user;
    if (state.user) {
      formEl.elements.email.value = state.user.email || state.profile?.email || "";
      formEl.elements.mobile.value = state.profile?.mobile || state.profile?.phone || "";
      populatePeople();
    }
    setStatus("");
    setEligibility(eligibilityIssue());
    panelEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitGroupBooking(event) {
    event.preventDefault();
    if (!client || !state.user || !state.selectedGroup) return;
    if (!formEl.checkValidity()) {
      formEl.reportValidity();
      return;
    }
    const issue = eligibilityIssue();
    if (issue) {
      setEligibility(issue);
      return;
    }
    const person = selectedPerson();
    const submitButton = formEl.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    setStatus("Creating pending place and preparing payment...", "neutral");

    const params = {
      p_group_id: state.selectedGroup.group_id,
      p_player_name: formEl.elements.player_name.value.trim(),
      p_player_age: Number(formEl.elements.player_age.value || 0) || null,
      p_player_level: formEl.elements.player_level.value,
      p_parent_name: formEl.elements.parent_name.value.trim(),
      p_email: formEl.elements.email.value.trim(),
      p_mobile: formEl.elements.mobile.value.trim(),
      p_notes: formEl.elements.notes.value.trim(),
      p_profile_player_index: Number.isInteger(person?.index) ? person.index : null
    };

    const { data, error } = await client.rpc("create_junior_group_pending_booking", params);
    if (submitButton) submitButton.disabled = false;

    if (error) {
      setStatus(error.message || "Could not start this group booking.", "error");
      await loadGroups();
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    const emailPayload = {
      email: params.p_email,
      customerName: params.p_parent_name,
      playerName: params.p_player_name,
      playerAge: params.p_player_age,
      playerLevel: params.p_player_level,
      programmeName: state.selectedGroup.programme_name || state.selectedGroup.group_name,
      groupName: state.selectedGroup.group_name,
      coachName: state.selectedGroup.coach_name,
      clubName: state.selectedGroup.club_name,
      startDate: state.selectedGroup.start_date,
      sessionCount: state.selectedGroup.session_count,
      durationMinutes: state.selectedGroup.session_duration_minutes,
      amount: result?.amount || state.selectedGroup.price,
      paymentLinkUrl: "",
      relatedId: result?.member_id || "",
      traceId: `junior-group-${Date.now()}`
    };

    console.info("[Kim Junior Group] pending member created before Stripe checkout", emailPayload);
    setStatus("Your place is held temporarily. Redirecting to secure Stripe Checkout...", "success");
    try {
      await startStripeCheckout(result?.member_id);
    } catch (checkoutError) {
      setStatus(checkoutError.message || "Could not start Stripe Checkout. Your place is pending payment.", "error");
    }
    await loadGroups();
    await loadMySessions();
  }

  cardsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-junior-group-id]");
    if (!button) return;
    selectGroup(button.dataset.juniorGroupId);
  });
  personSelectEl?.addEventListener("change", applyPersonSelection);
  formEl?.elements.player_age?.addEventListener("input", () => setEligibility(eligibilityIssue()));
  formEl?.elements.player_level?.addEventListener("change", () => setEligibility(eligibilityIssue()));
  formEl?.addEventListener("submit", submitGroupBooking);

  (async function init() {
    await refreshSession();
    await loadGroups();
    await loadMySessions();
  })();
})();
