(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const programmeFormEl = document.querySelector("[data-junior-programme-form]");
  const programmeListEl = document.querySelector("[data-junior-programme-list]");
  const programmeMessageEl = document.querySelector("[data-junior-programme-message]");
  const programmeClearEl = document.querySelector("[data-junior-programme-clear]");
  const groupFormEl = document.querySelector("[data-junior-group-form]");
  const groupListEl = document.querySelector("[data-junior-group-list]");
  const groupMessageEl = document.querySelector("[data-junior-group-message]");
  const groupClearEl = document.querySelector("[data-junior-group-clear]");
  const calendarListEl = document.querySelector("[data-junior-calendar-list]");
  const playerListEl = document.querySelector("[data-junior-player-list]");
  const playerSearchEl = document.querySelector("[data-junior-player-search]");
  const playerLevelFilterEl = document.querySelector("[data-junior-player-level-filter]");
  const playerProgrammeFilterEl = document.querySelector("[data-junior-player-programme-filter]");
  const playerGroupFilterEl = document.querySelector("[data-junior-player-group-filter]");
  const playerStatusFilterEl = document.querySelector("[data-junior-player-status-filter]");
  const playerPaymentFilterEl = document.querySelector("[data-junior-player-payment-filter]");
  const playerBulkActionEl = document.querySelector("[data-junior-player-bulk-action]");
  const playerBulkApplyEl = document.querySelector("[data-junior-player-bulk-apply]");
  const playerMessageEl = document.querySelector("[data-junior-player-message]");
  const planFormEl = document.querySelector("[data-session-plan-form]");
  const planListEl = document.querySelector("[data-session-plan-list]");
  const planMessageEl = document.querySelector("[data-session-plan-message]");
  const copyPlanEl = document.querySelector("[data-copy-session-plan]");
  const paymentListEl = document.querySelector("[data-junior-payment-list]");

  if (!programmeFormEl && !groupFormEl && !calendarListEl && !playerListEl && !planFormEl && !paymentListEl) return;

  const levelOrder = ["Beginner", "Developing", "Interclub", "Tournament"];
  let programmes = [];
  let groups = [];
  let sessions = [];
  let players = [];
  let members = [];
  let plans = [];
  let payments = [];
  let privateBookings = [];
  let lessonTypes = [];
  let clubs = [];
  let coaches = [];
  const expandedCalendarGroups = new Set();
  const selectedJuniorPlayerIds = new Set();

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

  function setMessage(target, message = "", tone = "") {
    if (!target) return;
    target.textContent = message;
    if (tone) target.dataset.tone = tone;
    else target.removeAttribute("data-tone");
  }

  function statusClass(status = "") {
    if (["paid", "confirmed", "scheduled", "active", "active_in_group"].includes(status)) return "available";
    if (["overdue", "pending", "pending_payment"].includes(status)) return "warning";
    return "blocked";
  }

  function getDayName(day) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(day || 0)] || "Weekly";
  }

  function formatTime(value) {
    if (!value) return "";
    const [hour, minute] = String(value).split(":");
    const date = new Date();
    date.setHours(Number(hour || 0), Number(minute || 0), 0, 0);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function getFirstSession(groupId) {
    return sessions
      .filter((session) => session.group_id === groupId)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0] || null;
  }

  function getNameById(items, id, key = "name") {
    return items.find((item) => item.id === id)?.[key] || "";
  }

  function isPublicGroup(group = {}) {
    const linkedProgramme = programmes.find((item) => item.id === group.programme_id);
    return group.is_public === true || linkedProgramme?.is_public === true;
  }

  function isActiveHold(member) {
    if (!member || member.booking_status !== "pending_payment" || member.payment_status !== "pending") return false;
    return !member.expires_at || new Date(member.expires_at).getTime() > Date.now();
  }

  function activeGroupMemberCount(groupId, exceptMemberId = "") {
    return members.filter((member) => (
      member.group_id === groupId
      && member.id !== exceptMemberId
      && (
        (member.booking_status === "confirmed" && member.payment_status === "paid")
        || isActiveHold(member)
      )
    )).length;
  }

  function toNullableNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function populateSelect(select, items, placeholder, labelKey = "name") {
    if (!select) return;
    const current = select.value;
    select.innerHTML = [
      `<option value="">${escapeHtml(placeholder)}</option>`,
      ...items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item[labelKey] || item.name || "")}</option>`)
    ].join("");
    if (items.some((item) => item.id === current)) select.value = current;
  }

  function populateFilterSelect(select, items, placeholder, labelKey = "name") {
    if (!select) return;
    const current = select.value;
    select.innerHTML = [
      `<option value="">${escapeHtml(placeholder)}</option>`,
      ...items.map((item) => `<option value="${escapeHtml(item.id || item.value)}">${escapeHtml(item[labelKey] || item.label || item.name || "")}</option>`)
    ].join("");
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function populateAllSelects() {
    document.querySelectorAll("[data-junior-lesson-type]").forEach((select) => {
      populateSelect(select, lessonTypes, "Select lesson type", "name");
    });
    document.querySelectorAll("[data-junior-programme-select]").forEach((select) => {
      populateSelect(select, programmes, "Select programme", "programme_name");
    });
    document.querySelectorAll("[data-junior-club]").forEach((select) => {
      populateSelect(select, clubs, "Select club", "name");
    });
    document.querySelectorAll("[data-junior-coach]").forEach((select) => {
      populateSelect(select, coaches, "Select coach", "display_name");
    });
    document.querySelectorAll("[data-session-plan-group]").forEach((select) => {
      populateSelect(select, groups, "Select group", "group_name");
    });
    const levelItems = [...new Set([
      ...levelOrder,
      ...players.flatMap((player) => [player.customer_selected_level, player.admin_confirmed_level]).filter(Boolean),
      ...members.map((member) => member.player_level).filter(Boolean)
    ])].map((level) => ({ value: level, label: level }));
    populateFilterSelect(playerLevelFilterEl, levelItems, "All levels", "label");
    populateFilterSelect(playerProgrammeFilterEl, programmes, "All programmes", "programme_name");
    populateFilterSelect(playerGroupFilterEl, groups, "All groups", "group_name");
    populatePlanSessions();
  }

  function getProgrammeName(id) {
    return getNameById(programmes, id, "programme_name") || "";
  }

  function getGroupName(id) {
    return getNameById(groups, id, "group_name") || "";
  }

  function getGroupProgrammeId(groupId) {
    return groups.find((group) => group.id === groupId)?.programme_id || "";
  }

  function getPlayerMember(player) {
    if (!player) return null;
    return members.find((member) => member.player_id === player.id)
      || (player.junior_group_member_id ? members.find((member) => member.id === player.junior_group_member_id) : null)
      || null;
  }

  function getPaymentForPlayer(player, member) {
    if (!player && !member) return null;
    return payments.find((payment) => payment.player_id === player?.id)
      || payments.find((payment) => payment.junior_group_member_id === member?.id)
      || null;
  }

  function formatAgeDob(player = {}) {
    const age = player.age ?? player.player_age;
    const dob = player.date_of_birth || player.dob;
    if (age && dob) return `${age} yrs · ${dob}`;
    if (age) return `${age} yrs`;
    if (dob) return dob;
    return "Age not set";
  }

  function formatPlacementStatus(status = "") {
    return String(status || "awaiting_placement").replace(/_/g, " ");
  }

  function formatPaymentStatus(status = "") {
    return String(status || "not_required").replace(/_/g, " ");
  }

  function buildLevelOptions(current = "") {
    const options = [...new Set([current, ...levelOrder].filter(Boolean))];
    return [
      '<option value="">Select level</option>',
      ...options.map((level) => `<option value="${escapeHtml(level)}" ${level === current ? "selected" : ""}>${escapeHtml(level)}</option>`)
    ].join("");
  }

  function buildProgrammeOptions(current = "") {
    return [
      '<option value="">Select programme</option>',
      ...programmes.map((programme) => `<option value="${escapeHtml(programme.id)}" ${programme.id === current ? "selected" : ""}>${escapeHtml(programme.programme_name || "Programme")}</option>`)
    ].join("");
  }

  function buildGroupOptionsForPlayer(player, member, current = "") {
    const currentGroupId = current || player?.junior_group_id || member?.group_id || "";
    return [
      '<option value="">Select group</option>',
      ...groups.map((group) => {
        const spaces = Math.max(0, Number(group.capacity || 0) - activeGroupMemberCount(group.id, member?.id || ""));
        const selected = group.id === currentGroupId ? "selected" : "";
        const inactive = group.is_active === false ? " - inactive" : "";
        return `<option value="${escapeHtml(group.id)}" ${selected}>${escapeHtml(group.group_name)}${inactive} (${spaces} space${spaces === 1 ? "" : "s"})</option>`;
      })
    ].join("");
  }

  function getJuniorPlayerRows() {
    if (players.length) return players.filter((player) => player.is_active !== false);
    return members
      .filter((member) => member.booking_status !== "cancelled")
      .map((member) => ({
        id: `member:${member.id}`,
        isLegacyMember: true,
        player_name: member.player_name,
        age: member.player_age,
        parent_name: member.parent_name,
        parent_email: member.email,
        parent_phone: member.mobile,
        customer_selected_level: member.player_level,
        admin_confirmed_level: member.admin_confirmed_level || "",
        notes: member.notes || "",
        admin_notes: member.admin_notes || "",
        junior_programme_id: member.programme_id || getGroupProgrammeId(member.group_id),
        junior_group_id: member.group_id,
        junior_group_member_id: member.id,
        placement_status: member.placement_status || member.booking_status || "placement_confirmed",
        payment_status: member.payment_status || "not_required",
        is_active: true
      }));
  }

  function populateJuniorGroupTimes() {
    if (!groupFormEl) return;
    const populateSharedTimes = window.KimsAvailability?.populateTimeSelectors;
    if (typeof populateSharedTimes === "function") {
      populateSharedTimes(groupFormEl, { startTime: "08:00", endTime: "21:00" });
      return;
    }

    const options = Array.from({ length: 27 }, (_item, index) => {
      const totalMinutes = (8 * 60) + (index * 30);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      const label = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(2000, 0, 1, hours, minutes));
      return `<option value="${value}">${label}</option>`;
    }).join("");

    groupFormEl.querySelectorAll("[data-time-select]").forEach((select) => {
      const current = select.value;
      const placeholder = select.querySelector("option")?.outerHTML || '<option value="">Select time</option>';
      select.innerHTML = `${placeholder}${options}`;
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    });
  }

  function populatePlanSessions() {
    const groupId = planFormEl?.elements.group_id?.value || "";
    const groupSessions = groupId ? sessions.filter((session) => session.group_id === groupId) : sessions;
    document.querySelectorAll("[data-session-plan-session]").forEach((select) => {
      const current = select.value;
      select.innerHTML = [
        '<option value="">Whole group / no specific session</option>',
        ...groupSessions.map((session) => `<option value="${escapeHtml(session.id)}">${escapeHtml(formatDate(session.start_time, { weekday: "short", hour: "numeric", minute: "2-digit" }))}</option>`)
      ].join("");
      if (groupSessions.some((session) => session.id === current)) select.value = current;
    });
  }

  function renderProgrammes() {
    if (!programmeListEl) return;
    if (!programmes.length) {
      programmeListEl.innerHTML = '<p class="helper-text">No junior programmes yet.</p>';
      return;
    }
    programmeListEl.innerHTML = programmes.map((programme) => `
      <article class="admin-data-row">
        <div>
          <span class="status-pill ${programme.is_active ? "available" : "blocked"}">${programme.is_active ? "Active" : "Inactive"}</span>
          ${programme.is_public ? '<span class="status-pill available">Public</span>' : '<span class="status-pill warning">Draft</span>'}
          <strong>${escapeHtml(programme.programme_name)}</strong>
          <p>${escapeHtml(programme.term_name || "No term")} · ${programme.age_min ?? "any"}-${programme.age_max ?? "any"} years · ${escapeHtml(programme.level || "Any level")}</p>
          <p>${escapeHtml(getNameById(coaches, programme.coach_id, "display_name") || "No coach")} · ${escapeHtml(getNameById(clubs, programme.club_id) || "No club")}</p>
        </div>
        <div class="availability-actions">
          <button class="btn btn-secondary" type="button" data-programme-action="edit" data-id="${escapeHtml(programme.id)}">Edit</button>
          <button class="btn btn-secondary" type="button" data-programme-action="toggle" data-id="${escapeHtml(programme.id)}">${programme.is_active ? "Deactivate" : "Activate"}</button>
        </div>
      </article>
    `).join("");
  }

  function renderGroups() {
    if (!groupListEl) return;
    if (!groups.length) {
      groupListEl.innerHTML = '<p class="helper-text">No junior groups yet.</p>';
      return;
    }
    groupListEl.innerHTML = groups.map((group) => {
      const groupMembers = members.filter((member) => member.group_id === group.id);
      const spaces = Math.max(0, Number(group.capacity || 0) - activeGroupMemberCount(group.id));
      const groupIsPublic = isPublicGroup(group);
      const activeMembers = groupMembers.filter((member) => member.booking_status !== "cancelled");
      const confirmedMembers = activeMembers.filter((member) => ["confirmed", "active_in_group"].includes(member.placement_status || member.booking_status));

      return `
        <article class="admin-data-row junior-group-row" data-group-drop-zone="${escapeHtml(group.id)}">
          <div>
            <span class="status-pill ${spaces > 0 ? "available" : "blocked"}">${spaces > 0 ? `${spaces} spaces available` : "Full"}</span>
            ${groupIsPublic ? '<span class="status-pill available">Public</span>' : '<span class="status-pill warning">Draft</span>'}
            <strong>${escapeHtml(group.group_name)}</strong>
            <p>${escapeHtml(group.term_name || "No term")} · ${getDayName(group.recurring_day)} ${escapeHtml(String(group.start_time || "").slice(0, 5))} · ${Number(group.session_count || 0)} sessions</p>
            <p>${money(group.price)} · capacity ${Number(group.capacity || 0)} · ${escapeHtml(getNameById(coaches, group.coach_id, "display_name") || "No coach")}</p>
            <p class="helper-text">${activeMembers.length} player${activeMembers.length === 1 ? "" : "s"} assigned · ${confirmedMembers.length} confirmed</p>
          </div>
          <div class="availability-actions">
            <button class="btn btn-secondary" type="button" data-group-action="edit" data-id="${escapeHtml(group.id)}">Edit</button>
            <button class="btn btn-secondary" type="button" data-group-action="add-player" data-id="${escapeHtml(group.id)}">Add player</button>
            <button class="btn btn-secondary" type="button" data-group-action="sessions" data-id="${escapeHtml(group.id)}">Generate sessions</button>
            <button class="btn btn-secondary" type="button" data-group-action="email-parents" data-id="${escapeHtml(group.id)}">Email parents</button>
            <button class="btn btn-secondary" type="button" data-group-action="toggle" data-id="${escapeHtml(group.id)}">${group.is_active ? "Deactivate" : "Activate"}</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderJuniorPlayers() {
    if (!playerListEl) return;
    const searchTerm = (playerSearchEl?.value || "").trim().toLowerCase();
    const levelFilter = playerLevelFilterEl?.value || "";
    const programmeFilter = playerProgrammeFilterEl?.value || "";
    const groupFilter = playerGroupFilterEl?.value || "";
    const statusFilter = playerStatusFilterEl?.value || "";
    const paymentFilter = playerPaymentFilterEl?.value || "";
    const sourceRows = getJuniorPlayerRows();
    const filteredPlayers = sourceRows.filter((player) => {
      const member = getPlayerMember(player);
      const programmeId = player.junior_programme_id || member?.programme_id || getGroupProgrammeId(player.junior_group_id || member?.group_id);
      const groupId = player.junior_group_id || member?.group_id || "";
      const placementStatus = player.placement_status || member?.placement_status || member?.booking_status || "awaiting_placement";
      const paymentStatus = player.payment_status || member?.payment_status || "not_required";
      const searchable = [
        player.player_name,
        player.parent_name,
        player.parent_email,
        player.parent_phone,
        player.customer_selected_level,
        player.admin_confirmed_level,
        player.notes,
        player.admin_notes,
        getProgrammeName(programmeId),
        getGroupName(groupId),
        placementStatus,
        paymentStatus
      ].join(" ").toLowerCase();
      if (searchTerm && !searchable.includes(searchTerm)) return false;
      if (levelFilter && ![player.customer_selected_level, player.admin_confirmed_level, member?.player_level].includes(levelFilter)) return false;
      if (programmeFilter && programmeId !== programmeFilter) return false;
      if (groupFilter && groupId !== groupFilter) return false;
      if (statusFilter && placementStatus !== statusFilter) return false;
      if (paymentFilter && paymentStatus !== paymentFilter) return false;
      return true;
    });

    if (!filteredPlayers.length) {
      selectedJuniorPlayerIds.clear();
      playerListEl.innerHTML = '<p class="helper-text">No registered junior players found.</p>';
      return;
    }

    const filteredIds = new Set(filteredPlayers.map((player) => player.id));
    selectedJuniorPlayerIds.forEach((id) => {
      if (!filteredIds.has(id)) selectedJuniorPlayerIds.delete(id);
    });

    const rows = filteredPlayers.map((player) => {
      const member = getPlayerMember(player);
      const payment = getPaymentForPlayer(player, member);
      const programmeId = player.junior_programme_id || member?.programme_id || getGroupProgrammeId(player.junior_group_id || member?.group_id);
      const groupId = player.junior_group_id || member?.group_id || "";
      const adminLevel = player.admin_confirmed_level || member?.admin_confirmed_level || "";
      const placementStatus = player.placement_status || member?.placement_status || member?.booking_status || "awaiting_placement";
      const paymentStatus = player.payment_status || member?.payment_status || payment?.payment_status || "not_required";
      const invoiceUrl = player.invoice_url || member?.invoice_url || payment?.invoice_url || payment?.payment_link_url || "";
      const isActiveInGroup = placementStatus === "active_in_group";
      const actionName = player.isLegacyMember ? "assign-legacy" : (isActiveInGroup ? "archive-player" : "confirm-placement");
      const actionLabel = isActiveInGroup ? "Archive" : Number(groups.find((group) => group.id === groupId)?.price || 0) > 0
        ? "Confirm + request payment"
        : "Confirm placement";
      const isSelected = selectedJuniorPlayerIds.has(player.id);
      return `
        <div class="junior-players-table-row" data-junior-player-row="${escapeHtml(player.id)}">
          <span data-label="Select" class="junior-player-select-cell"><input type="checkbox" data-junior-player-select value="${escapeHtml(player.id)}" ${isSelected ? "checked" : ""} ${player.isLegacyMember ? "disabled" : ""} aria-label="Select ${escapeHtml(player.player_name || "junior player")}" /></span>
          <span data-label="Player"><strong>${escapeHtml(player.player_name || "Unnamed player")}</strong><small>${escapeHtml(formatAgeDob(player))}</small></span>
          <span data-label="Parent"><strong>${escapeHtml(player.parent_name || "Not listed")}</strong><small>${escapeHtml(player.parent_email || "No email")} · ${escapeHtml(player.parent_phone || "No phone")}</small></span>
          <span data-label="Suggested level">${escapeHtml(player.customer_selected_level || member?.player_level || "Not specified")}</span>
          <span data-label="Admin level"><select data-junior-player-admin-level ${player.isLegacyMember ? "disabled" : ""}>${buildLevelOptions(adminLevel)}</select></span>
          <span data-label="Programme"><select data-junior-player-programme ${player.isLegacyMember ? "disabled" : ""}>${buildProgrammeOptions(programmeId)}</select></span>
          <span data-label="Group"><select data-junior-player-group ${groups.length && !player.isLegacyMember ? "" : "disabled"}>${buildGroupOptionsForPlayer(player, member, groupId)}</select></span>
          <span data-label="Status"><span class="status-pill ${statusClass(placementStatus)}">${escapeHtml(formatPlacementStatus(placementStatus))}</span><small>${escapeHtml(formatPaymentStatus(paymentStatus))}</small></span>
          <span data-label="Payment">${invoiceUrl ? `<a href="${escapeHtml(invoiceUrl)}" target="_blank" rel="noopener">Payment link</a>` : "No link yet"}</span>
          <span data-label="Notes"><textarea data-junior-player-admin-notes rows="2" ${player.isLegacyMember ? "disabled" : ""}>${escapeHtml(player.admin_notes || member?.admin_notes || "")}</textarea></span>
          <span data-label="Action"><button class="btn btn-secondary" type="button" data-player-action="${actionName}" data-id="${escapeHtml(player.id)}">${player.isLegacyMember ? "Use Groups tab" : actionLabel}</button></span>
        </div>
      `;
    }).join("");

    playerListEl.innerHTML = `
      <div class="junior-players-table-row junior-players-table-head">
        <span><input type="checkbox" data-junior-player-select-all ${selectedJuniorPlayerIds.size && selectedJuniorPlayerIds.size === filteredPlayers.length ? "checked" : ""} aria-label="Select all visible junior players" /></span>
        <span>Player</span>
        <span>Parent</span>
        <span>Suggested level</span>
        <span>Admin level</span>
        <span>Programme</span>
        <span>Group</span>
        <span>Status</span>
        <span>Payment</span>
        <span>Notes</span>
        <span>Action</span>
      </div>
      ${rows}
    `;
  }

  function renderCalendar() {
    if (!calendarListEl) return;
    const sessionsByGroup = sessions.reduce((acc, session) => {
      const key = session.group_id || "ungrouped";
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(session);
      return acc;
    }, new Map());

    const groupSessionRows = Array.from(sessionsByGroup.entries()).map(([groupId, groupSessions]) => {
      const group = groups.find((item) => item.id === groupId) || {};
      const sortedSessions = groupSessions.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
      const firstSession = sortedSessions[0] || {};
      const lastSession = sortedSessions[sortedSessions.length - 1] || firstSession;
      const playerCount = members.filter((member) => member.group_id === groupId && member.booking_status === "confirmed").length;
      const coachName = getNameById(coaches, firstSession.coach_id || group.coach_id, "display_name") || "No coach";
      const clubName = getNameById(clubs, firstSession.club_id || group.club_id) || "No club";
      const plannedCount = sortedSessions.filter((session) => plans.some((plan) => plan.session_id === session.id || plan.group_id === session.group_id)).length;
      const allPlanned = plannedCount === sortedSessions.length && sortedSessions.length > 0;
      const isExpanded = expandedCalendarGroups.has(groupId);
      const dateRange = sortedSessions.length > 1
        ? `${formatDate(firstSession.start_time, { weekday: "short" })} - ${formatDate(lastSession.start_time, { weekday: "short" })}`
        : formatDate(firstSession.start_time, { weekday: "short" });
      const sessionRows = sortedSessions.map((session) => {
        const hasPlan = plans.some((plan) => plan.session_id === session.id || plan.group_id === session.group_id);
        return `
          <div class="junior-calendar-session">
            <div>
              <strong>${formatDate(session.start_time, { weekday: "short", hour: "numeric", minute: "2-digit" })}</strong>
              <p>${escapeHtml(getNameById(clubs, session.club_id || group.club_id) || "No club")} · ${escapeHtml(getNameById(coaches, session.coach_id || group.coach_id, "display_name") || "No coach")}</p>
            </div>
            <span class="status-pill ${hasPlan ? "available" : "warning"}">${hasPlan ? "Plan ready" : "Needs plan"}</span>
          </div>
        `;
      }).join("");
      return `
        <article class="admin-data-row junior-calendar-group ${isExpanded ? "is-expanded" : ""}">
          <button class="junior-calendar-group-toggle" type="button" data-calendar-group-toggle="${escapeHtml(groupId)}" aria-expanded="${isExpanded ? "true" : "false"}">
            <div>
              <span class="status-pill ${allPlanned ? "available" : "warning"}">${allPlanned ? "Plans ready" : `${plannedCount}/${sortedSessions.length} planned`}</span>
              <strong>${escapeHtml(group.group_name || "Junior group")}</strong>
              <p>${escapeHtml(dateRange)} · ${sortedSessions.length} session${sortedSessions.length === 1 ? "" : "s"} · ${escapeHtml(coachName)}</p>
              <p>${escapeHtml(clubName)} · ${playerCount} player${playerCount === 1 ? "" : "s"}</p>
            </div>
            <span class="junior-calendar-toggle-label">${isExpanded ? "Hide events" : "Show events"}</span>
          </button>
          <div class="junior-calendar-sessions" ${isExpanded ? "" : "hidden"}>
            ${sessionRows}
          </div>
        </article>
      `;
    });
    const privateRows = privateBookings.map((booking) => `
      <article class="admin-data-row">
        <div>
          <strong>${escapeHtml(booking.player_name || "Private lesson")}</strong>
          <p>${formatDate(booking.start_time || booking.created_at, { weekday: "short", hour: "numeric", minute: "2-digit" })} · Private lesson</p>
          <p>${escapeHtml(booking.email || "")} · ${escapeHtml(booking.booking_status || "confirmed")}</p>
        </div>
        <span class="status-pill available">Private</span>
      </article>
    `);
    const rows = groupSessionRows.concat(privateRows);
    calendarListEl.innerHTML = rows.length ? rows.join("") : '<p class="helper-text">No group sessions or private lessons yet.</p>';
  }

  function buildPlanWhatsAppMessage(plan) {
    const group = groups.find((item) => item.id === plan.group_id) || {};
    return [
      `${group.group_name || "Junior coaching"} session plan`,
      plan.title ? `Focus: ${plan.title}` : "",
      plan.session_date ? `Date: ${plan.session_date}` : "",
      plan.warm_up ? `Warm-up: ${plan.warm_up}` : "",
      plan.technical_focus ? `Technical focus: ${plan.technical_focus}` : "",
      plan.drills ? `Drills: ${plan.drills}` : "",
      plan.games ? `Games: ${plan.games}` : "",
      plan.equipment_needed ? `Bring: ${plan.equipment_needed}` : "",
      group.whatsapp_group_link ? `WhatsApp group: ${group.whatsapp_group_link}` : ""
    ].filter(Boolean).join("\n");
  }

  function renderPlans() {
    if (!planListEl) return;
    if (!plans.length) {
      planListEl.innerHTML = '<p class="helper-text">No session plans yet.</p>';
      return;
    }
    planListEl.innerHTML = plans.map((plan) => `
      <article class="admin-data-row">
        <div>
          <strong>${escapeHtml(plan.title)}</strong>
          <p>${escapeHtml(getNameById(groups, plan.group_id, "group_name") || "No group")} · ${escapeHtml(plan.session_date || "No date")}</p>
          ${plan.technical_focus ? `<p>${escapeHtml(plan.technical_focus)}</p>` : ""}
        </div>
        <div class="availability-actions">
          <button class="btn btn-secondary" type="button" data-plan-action="edit" data-id="${escapeHtml(plan.id)}">Edit</button>
          <button class="btn btn-secondary" type="button" data-plan-action="copy" data-id="${escapeHtml(plan.id)}">Copy WhatsApp</button>
        </div>
      </article>
    `).join("");
  }

  function renderPayments() {
    if (!paymentListEl) return;
    const paymentRows = members
      .filter((member) => member.payment_status !== "paid" || member.booking_status !== "confirmed")
      .map((member) => {
        const group = groups.find((item) => item.id === member.group_id) || {};
        const payment = payments.find((item) => item.junior_group_member_id === member.id) || {};
        return `
          <article class="admin-data-row">
            <div>
              <strong>${escapeHtml(member.player_name)}</strong>
              <p>${escapeHtml(group.group_name || "Junior group")} · ${escapeHtml(member.email)}</p>
              <p>${money(payment.amount || group.price)} · ${escapeHtml(member.payment_status)} · ${escapeHtml(member.booking_status)}</p>
            </div>
            <div class="availability-actions">
              <button class="btn btn-secondary" type="button" data-payment-action="paid" data-id="${escapeHtml(member.id)}">Mark paid</button>
              <button class="btn btn-secondary" type="button" data-payment-action="resend" data-id="${escapeHtml(member.id)}">Resend payment link</button>
            </div>
          </article>
        `;
      });
    paymentListEl.innerHTML = paymentRows.length ? paymentRows.join("") : '<p class="helper-text">No pending or overdue junior payments.</p>';
  }

  function renderAll() {
    populateAllSelects();
    renderProgrammes();
    renderGroups();
    renderJuniorPlayers();
    renderCalendar();
    renderPlans();
    renderPayments();
  }

  async function loadReferenceData() {
    if (!client) return;
    const [lessonResult, clubResult, coachResult] = await Promise.all([
      client.from("lesson_types").select("*").order("name", { ascending: true }),
      client.from("coaching_clubs").select("id,name,address,is_active").order("name", { ascending: true }),
      client.from("coaches").select("id,display_name,email,mobile,is_active").order("display_name", { ascending: true })
    ]);
    lessonTypes = (lessonResult.data || []).filter((lesson) => lesson.is_active !== false);
    clubs = clubResult.data || [];
    coaches = coachResult.data || [];
  }

  async function loadJuniorData() {
    if (!client) return;
    const [programmeResult, groupResult, sessionResult, memberResult, playerResult, planResult, paymentResult, bookingResult] = await Promise.all([
      client.from("junior_programmes").select("*").order("created_at", { ascending: false }),
      client.from("junior_groups").select("*").order("start_date", { ascending: true }),
      client.from("junior_group_sessions").select("*").order("start_time", { ascending: true }),
      client.from("junior_group_members").select("*").order("created_at", { ascending: false }),
      client.from("players").select("*").order("created_at", { ascending: false }),
      client.from("session_plans").select("*").order("session_date", { ascending: true }),
      client.from("payments").select("*").eq("related_type", "junior_group").order("created_at", { ascending: false }),
      client.from("bookings").select("id,player_name,email,start_time,end_time,booking_status,created_at").order("start_time", { ascending: true })
    ]);

    const missingPlayersTable = playerResult.error && /players|schema cache|PGRST205|42P01/i.test(playerResult.error.message || "");
    const errors = [programmeResult, groupResult, sessionResult, memberResult, planResult, paymentResult].map((result) => result.error).filter(Boolean);
    if (errors.length) {
      const message = `Junior group schema is not fully installed yet. Run supabase/migrations/20260627010000_junior_group_coaching.sql. Supabase said: ${errors[0].message}`;
      setMessage(programmeMessageEl, message, "error");
      setMessage(groupMessageEl, message, "error");
      if (groupListEl) groupListEl.innerHTML = `<p class="form-message" data-tone="error">${escapeHtml(message)}</p>`;
      return;
    }

    programmes = programmeResult.data || [];
    groups = groupResult.data || [];
    sessions = sessionResult.data || [];
    members = memberResult.data || [];
    players = missingPlayersTable ? [] : (playerResult.data || []);
    plans = planResult.data || [];
    payments = paymentResult.data || [];
    privateBookings = bookingResult.error ? [] : (bookingResult.data || []);
    if (missingPlayersTable) {
      setMessage(playerMessageEl, "Run supabase/migrations/20260706000000_player_first_junior_coaching.sql to enable the player-first Junior Coaching table.", "error");
    } else if (playerResult.error) {
      setMessage(playerMessageEl, `Could not load junior players: ${playerResult.error.message}`, "error");
    } else {
      setMessage(playerMessageEl);
    }
    renderAll();
  }

  async function refreshAll() {
    await loadReferenceData();
    await loadJuniorData();
  }

  function resetProgrammeForm() {
    programmeFormEl?.reset();
    if (programmeFormEl?.elements.programme_id) programmeFormEl.elements.programme_id.value = "";
    if (programmeFormEl?.elements.is_active) programmeFormEl.elements.is_active.checked = true;
    if (programmeFormEl?.elements.is_public) programmeFormEl.elements.is_public.checked = false;
    setMessage(programmeMessageEl);
  }

  function resetGroupForm() {
    groupFormEl?.reset();
    if (groupFormEl?.elements.group_id) groupFormEl.elements.group_id.value = "";
    if (groupFormEl?.elements.is_active) groupFormEl.elements.is_active.checked = true;
    if (groupFormEl?.elements.is_public) groupFormEl.elements.is_public.checked = false;
    setMessage(groupMessageEl);
  }

  function fillProgrammeFromLesson(lessonTypeId) {
    const lesson = lessonTypes.find((item) => item.id === lessonTypeId);
    if (!lesson || !programmeFormEl) return;
    if (!programmeFormEl.elements.programme_name.value) programmeFormEl.elements.programme_name.value = lesson.name || "";
    programmeFormEl.elements.age_min.value = lesson.minimum_age ?? "";
    programmeFormEl.elements.age_max.value = lesson.maximum_age ?? "";
    programmeFormEl.elements.level.value = lesson.minimum_level || "";
    programmeFormEl.elements.description.value = lesson.description || "";
  }

  function fillGroupFromProgramme(programmeId) {
    const programme = programmes.find((item) => item.id === programmeId);
    if (!programme || !groupFormEl) return;
    groupFormEl.elements.group_name.value = groupFormEl.elements.group_name.value || programme.programme_name || "";
    groupFormEl.elements.term_name.value = groupFormEl.elements.term_name.value || programme.term_name || "";
    groupFormEl.elements.age_min.value = programme.age_min ?? "";
    groupFormEl.elements.age_max.value = programme.age_max ?? "";
    groupFormEl.elements.level.value = programme.level || "";
    groupFormEl.elements.coach_id.value = programme.coach_id || "";
    groupFormEl.elements.club_id.value = programme.club_id || "";
    groupFormEl.elements.description.value = groupFormEl.elements.description.value || programme.description || "";
    if (programme.is_public === true && groupFormEl.elements.is_public) groupFormEl.elements.is_public.checked = true;
  }

  async function saveProgramme(event) {
    event.preventDefault();
    const form = programmeFormEl;
    const id = form.elements.programme_id.value;
    const payload = {
      lesson_type_id: form.elements.lesson_type_id.value || null,
      programme_name: form.elements.programme_name.value.trim(),
      term_name: form.elements.term_name.value.trim(),
      age_min: toNullableNumber(form.elements.age_min.value),
      age_max: toNullableNumber(form.elements.age_max.value),
      level: form.elements.level.value || "",
      coach_id: form.elements.coach_id.value || null,
      club_id: form.elements.club_id.value || null,
      description: form.elements.description.value.trim(),
      is_active: form.elements.is_active.checked,
      is_public: form.elements.is_public.checked
    };
    if (!payload.programme_name) return setMessage(programmeMessageEl, "Enter a programme name.", "error");
    setMessage(programmeMessageEl, "Saving programme...");
    const query = id ? client.from("junior_programmes").update(payload).eq("id", id) : client.from("junior_programmes").insert(payload);
    const { error } = await query;
    if (error) return setMessage(programmeMessageEl, `Could not save programme: ${error.message}`, "error");
    resetProgrammeForm();
    setMessage(programmeMessageEl, "Programme saved.", "success");
    await refreshAll();
  }

  async function saveGroup(event) {
    event.preventDefault();
    const form = groupFormEl;
    const id = form.elements.group_id.value;
    const programme = programmes.find((item) => item.id === form.elements.programme_id.value);
    const payload = {
      programme_id: form.elements.programme_id.value || null,
      lesson_type_id: programme?.lesson_type_id || null,
      group_name: form.elements.group_name.value.trim(),
      term_name: form.elements.term_name.value.trim(),
      age_min: toNullableNumber(form.elements.age_min.value),
      age_max: toNullableNumber(form.elements.age_max.value),
      level: form.elements.level.value || "",
      coach_id: form.elements.coach_id.value || null,
      club_id: form.elements.club_id.value || null,
      start_date: form.elements.start_date.value,
      end_date: form.elements.end_date.value || null,
      recurring_day: Number(form.elements.recurring_day.value || 1),
      start_time: form.elements.start_time.value,
      session_count: Math.max(1, Number(form.elements.session_count.value || 1)),
      session_duration_minutes: Math.max(15, Number(form.elements.session_duration_minutes.value || 60)),
      capacity: Math.max(1, Number(form.elements.capacity.value || 1)),
      price: Number(form.elements.price.value || 0),
      payment_link_url: form.elements.payment_link_url.value.trim() || null,
      whatsapp_group_link: form.elements.whatsapp_group_link.value.trim() || null,
      description: form.elements.description.value.trim(),
      is_active: form.elements.is_active.checked,
      is_public: form.elements.is_public.checked
    };
    if (!payload.group_name || !payload.start_date || !payload.start_time) return setMessage(groupMessageEl, "Enter a group name, start date, and start time.", "error");
    setMessage(groupMessageEl, "Saving group...");
    const query = id ? client.from("junior_groups").update(payload).eq("id", id).select("id").single() : client.from("junior_groups").insert(payload).select("id").single();
    const { data, error } = await query;
    if (error) return setMessage(groupMessageEl, `Could not save group: ${error.message}`, "error");
    const groupId = id || data?.id;
    if (groupId) await client.rpc("admin_generate_junior_group_sessions", { p_group_id: groupId });
    resetGroupForm();
    setMessage(groupMessageEl, "Group saved and sessions generated.", "success");
    await refreshAll();
  }

  function editProgramme(id) {
    const programme = programmes.find((item) => item.id === id);
    if (!programme || !programmeFormEl) return;
    programmeFormEl.elements.programme_id.value = programme.id;
    programmeFormEl.elements.lesson_type_id.value = programme.lesson_type_id || "";
    programmeFormEl.elements.programme_name.value = programme.programme_name || "";
    programmeFormEl.elements.term_name.value = programme.term_name || "";
    programmeFormEl.elements.age_min.value = programme.age_min ?? "";
    programmeFormEl.elements.age_max.value = programme.age_max ?? "";
    programmeFormEl.elements.level.value = programme.level || "";
    programmeFormEl.elements.coach_id.value = programme.coach_id || "";
    programmeFormEl.elements.club_id.value = programme.club_id || "";
    programmeFormEl.elements.description.value = programme.description || "";
    programmeFormEl.elements.is_active.checked = programme.is_active !== false;
    programmeFormEl.elements.is_public.checked = programme.is_public === true;
    programmeFormEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function editGroup(id) {
    const group = groups.find((item) => item.id === id);
    if (!group || !groupFormEl) return;
    groupFormEl.elements.group_id.value = group.id;
    groupFormEl.elements.programme_id.value = group.programme_id || "";
    groupFormEl.elements.group_name.value = group.group_name || "";
    groupFormEl.elements.term_name.value = group.term_name || "";
    groupFormEl.elements.age_min.value = group.age_min ?? "";
    groupFormEl.elements.age_max.value = group.age_max ?? "";
    groupFormEl.elements.level.value = group.level || "";
    groupFormEl.elements.coach_id.value = group.coach_id || "";
    groupFormEl.elements.club_id.value = group.club_id || "";
    groupFormEl.elements.start_date.value = group.start_date || "";
    groupFormEl.elements.end_date.value = group.end_date || "";
    groupFormEl.elements.recurring_day.value = String(group.recurring_day ?? 1);
    groupFormEl.elements.start_time.value = String(group.start_time || "").slice(0, 5);
    groupFormEl.elements.session_count.value = group.session_count || 1;
    groupFormEl.elements.session_duration_minutes.value = group.session_duration_minutes || 60;
    groupFormEl.elements.capacity.value = group.capacity || 1;
    groupFormEl.elements.price.value = group.price || 0;
    groupFormEl.elements.payment_link_url.value = group.payment_link_url || "";
    groupFormEl.elements.whatsapp_group_link.value = group.whatsapp_group_link || "";
    groupFormEl.elements.description.value = group.description || "";
    groupFormEl.elements.is_active.checked = group.is_active !== false;
    groupFormEl.elements.is_public.checked = group.is_public === true;
    groupFormEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function toggleProgramme(id) {
    const programme = programmes.find((item) => item.id === id);
    if (!programme) return;
    const { error } = await client.from("junior_programmes").update({ is_active: !programme.is_active }).eq("id", id);
    if (error) return alert(`Could not update programme: ${error.message}`);
    await refreshAll();
  }

  async function toggleGroup(id) {
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    const { error } = await client.from("junior_groups").update({ is_active: !group.is_active }).eq("id", id);
    if (error) return alert(`Could not update group: ${error.message}`);
    await refreshAll();
  }

  async function generateSessions(id) {
    const { error } = await client.rpc("admin_generate_junior_group_sessions", { p_group_id: id });
    if (error) return alert(`Could not generate sessions: ${error.message}`);
    await refreshAll();
  }

  async function addPlayerToGroup(id) {
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    const playerName = prompt(`Player name for ${group.group_name}`);
    if (!playerName) return;
    const parentName = prompt("Parent/customer name") || "";
    const email = prompt("Customer email") || "";
    const mobile = prompt("Mobile") || "";
    const ageValue = prompt("Player age") || "";
    const level = prompt("Player level (Beginner, Developing, Interclub, Tournament)") || "";
    const markPaid = confirm("Has this player already paid? OK confirms the place now. Cancel leaves it pending payment.");
    const { error } = await client.rpc("admin_add_junior_group_member", {
      p_group_id: id,
      p_player_name: playerName.trim(),
      p_player_age: Number(ageValue || 0) || null,
      p_player_level: level.trim(),
      p_parent_name: parentName.trim(),
      p_email: email.trim(),
      p_mobile: mobile.trim(),
      p_notes: "Added manually by admin.",
      p_mark_paid: markPaid
    });
    if (error) return alert(`Could not add player: ${error.message}`);
    await refreshAll();
  }

  async function markMemberPaid(id) {
    if (!confirm("Mark this junior group place as paid and confirmed?")) return;
    const { error } = await client.rpc("admin_mark_junior_group_paid", { p_member_id: id, p_payment_reference: "manual-admin-confirmation" });
    if (error) return alert(`Could not mark paid: ${error.message}`);
    await refreshAll();
  }

  async function removeMember(id) {
    if (!confirm("Remove this player from the group? This cancels the group booking record.")) return;
    const { error } = await client.from("junior_group_members").update({ booking_status: "cancelled", payment_status: "cancelled" }).eq("id", id);
    if (error) return alert(`Could not remove player: ${error.message}`);
    await refreshAll();
  }

  async function moveMember(id, targetGroupId = "") {
    const member = members.find((item) => item.id === id);
    if (!member) return;
    let target = groups.find((group) => group.id === targetGroupId && group.id !== member.group_id);
    if (!target) {
      const currentGroup = groups.find((item) => item.id === member.group_id);
      const options = groups
        .filter((group) => group.id !== member.group_id)
        .map((group) => {
          const spaces = Math.max(0, Number(group.capacity || 0) - activeGroupMemberCount(group.id, member.id));
          return `${group.group_name} (${spaces} space${spaces === 1 ? "" : "s"})`;
        })
        .join("\n");
      const response = prompt(`Move ${member.player_name} from ${currentGroup?.group_name || "this group"} to which group?\n\nType the target group name:\n${options}`);
      if (!response) return;
      target = groups.find((group) => group.id !== member.group_id && group.group_name.toLowerCase() === response.trim().toLowerCase());
    }
    if (!target) return alert("Could not find that target group name.");
    setMessage(groupMessageEl, `Moving ${member.player_name} to ${target.group_name}...`);
    const { error } = await client.rpc("admin_move_junior_group_member", { p_member_id: id, p_target_group_id: target.id });
    if (error) return alert(`Could not move player: ${error.message}`);
    setMessage(groupMessageEl, `${member.player_name} moved to ${target.group_name}.`, "success");
    await refreshAll();
  }

  function buildJuniorPlayerEmailPayload(player, group, paymentLinkUrl = "") {
    const firstSession = getFirstSession(group.id);
    const sessionDate = firstSession?.start_time || group.start_date;
    const sessionTime = firstSession?.start_time
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(firstSession.start_time))
      : formatTime(group.start_time);
    return {
      email: player.parent_email,
      customerName: player.parent_name,
      playerName: player.player_name,
      playerAge: player.age,
      playerLevel: player.admin_confirmed_level || player.customer_selected_level,
      programmeName: getProgrammeName(group.programme_id) || group.group_name,
      groupName: group.group_name,
      coachName: getNameById(coaches, group.coach_id, "display_name") || "Kim Jones",
      clubName: getNameById(clubs, group.club_id),
      dayName: getDayName(group.recurring_day),
      sessionTime,
      startDate: sessionDate,
      sessionCount: group.session_count,
      durationMinutes: group.session_duration_minutes,
      amount: group.price,
      paymentLinkUrl,
      notes: player.admin_notes || player.notes || "",
      relatedType: "junior_player",
      relatedId: player.id,
      traceId: `junior-player-${player.id}-${Date.now()}`
    };
  }

  async function createJuniorPaymentRequest({ player, memberId, paymentId }) {
    const sessionResult = await client.auth.getSession();
    const token = sessionResult.data?.session?.access_token;
    if (!token) throw new Error("Your admin session could not be verified. Sign out and back in, then try again.");
    const response = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        booking_type: "junior_group_admin_payment_request",
        player_id: player.id,
        member_id: memberId,
        payment_id: paymentId
      })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "Could not create the Stripe payment request.");
    return json;
  }

  async function confirmPlayerPlacement(id, row) {
    const player = players.find((item) => item.id === id);
    if (!player) {
      setMessage(playerMessageEl, "This older player row can still be managed from Junior Groups. Save the account player profile again to move it into the new player-first table.", "error");
      return;
    }

    const groupId = row?.querySelector("[data-junior-player-group]")?.value || "";
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      setMessage(playerMessageEl, "Choose a junior group before confirming placement.", "error");
      return;
    }
    if (Number(group.price || 0) > 0 && !player.parent_email) {
      setMessage(playerMessageEl, "Add a parent email before confirming a paid placement so the payment request can be sent.", "error");
      return;
    }

    const programmeId = row?.querySelector("[data-junior-player-programme]")?.value || group.programme_id || "";
    const adminLevel = row?.querySelector("[data-junior-player-admin-level]")?.value || "";
    const adminNotes = row?.querySelector("[data-junior-player-admin-notes]")?.value || "";

    setMessage(playerMessageEl, `Confirming ${player.player_name} in ${group.group_name}...`);
    const { data, error } = await client.rpc("admin_confirm_junior_player_placement", {
      p_player_id: player.id,
      p_programme_id: programmeId || null,
      p_group_id: group.id,
      p_admin_confirmed_level: adminLevel || null,
      p_admin_notes: adminNotes || null
    });
    if (error) {
      setMessage(playerMessageEl, `Could not confirm placement: ${error.message}`, "error");
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    const confirmedPlayer = {
      ...player,
      admin_confirmed_level: adminLevel || player.admin_confirmed_level,
      admin_notes: adminNotes || player.admin_notes,
      junior_programme_id: programmeId || group.programme_id,
      junior_group_id: group.id
    };
    const amount = Number(result?.amount || group.price || 0);

    try {
      if (amount > 0) {
        const checkout = await createJuniorPaymentRequest({
          player: confirmedPlayer,
          memberId: result?.member_id,
          paymentId: result?.payment_id
        });
        const payload = buildJuniorPlayerEmailPayload(confirmedPlayer, group, checkout.url || "");
        const emailResult = await window.KimsEmailService?.sendJuniorGroupPaymentRequest?.(payload);
        const emailFailed = emailResult && emailResult.status === "failed";
        setMessage(
          playerMessageEl,
          emailFailed ? "Placement saved and payment link created, but the email failed. Copy the payment link from the table after refresh." : "Placement saved and payment request sent.",
          emailFailed ? "error" : "success"
        );
      } else {
        const payload = buildJuniorPlayerEmailPayload(confirmedPlayer, group);
        await window.KimsEmailService?.sendJuniorGroupAssignmentNotification?.(payload);
        setMessage(playerMessageEl, "Placement confirmed. No payment is required for this group.", "success");
      }
    } catch (requestError) {
      setMessage(playerMessageEl, `Placement was saved, but payment/email setup failed: ${requestError.message}`, "error");
    }

    await refreshAll();
  }

  function getSelectedJuniorPlayers() {
    return Array.from(selectedJuniorPlayerIds)
      .map((id) => players.find((player) => player.id === id))
      .filter(Boolean);
  }

  async function archiveJuniorPlayer(id, options = {}) {
    const player = players.find((item) => item.id === id);
    const member = getPlayerMember(player);
    if (!player) return;
    if (!options.skipConfirm && !confirm(`Archive ${player.player_name || "this junior player"} from their active group?`)) return;

    if (!options.quiet) setMessage(playerMessageEl, `Archiving ${player.player_name || "junior player"}...`);
    if (member?.id) {
      const { error: memberError } = await client
        .from("junior_group_members")
        .update({
          booking_status: "cancelled",
          placement_status: "inactive",
          updated_at: new Date().toISOString()
        })
        .eq("id", member.id);
      if (memberError) {
        throw new Error(`Could not archive ${player.player_name || "junior player"} group membership: ${memberError.message}`);
      }
    }

    const { error: playerError } = await client
      .from("players")
      .update({
        junior_programme_id: null,
        junior_group_id: null,
        junior_group_member_id: null,
        placement_status: "inactive",
        updated_at: new Date().toISOString()
      })
      .eq("id", player.id);
    if (playerError) {
      throw new Error(`Could not archive ${player.player_name || "junior player"}: ${playerError.message}`);
    }

    if (!options.quiet) {
      setMessage(playerMessageEl, `${player.player_name || "Junior player"} archived.`, "success");
      await refreshAll();
    }
  }

  async function archiveSelectedJuniorPlayers() {
    const selectedPlayers = getSelectedJuniorPlayers();
    if (!selectedPlayers.length) {
      setMessage(playerMessageEl, "Select one or more junior players first.", "error");
      return;
    }
    if (!confirm(`Archive ${selectedPlayers.length} selected junior player${selectedPlayers.length === 1 ? "" : "s"}?`)) return;
    setMessage(playerMessageEl, `Archiving ${selectedPlayers.length} junior player${selectedPlayers.length === 1 ? "" : "s"}...`);
    try {
      for (const player of selectedPlayers) {
        await archiveJuniorPlayer(player.id, { skipConfirm: true, quiet: true });
      }
      selectedJuniorPlayerIds.clear();
      setMessage(playerMessageEl, "Selected junior players archived.", "success");
      await refreshAll();
    } catch (error) {
      setMessage(playerMessageEl, error.message, "error");
    }
  }

  async function emailSelectedJuniorParents() {
    const selectedPlayers = getSelectedJuniorPlayers();
    if (!selectedPlayers.length) {
      setMessage(playerMessageEl, "Select one or more junior players first.", "error");
      return;
    }
    if (!window.KimsEmailService?.sendJuniorGroupAssignmentNotification) {
      setMessage(playerMessageEl, "Email service is not ready yet. Refresh the page and try again.", "error");
      return;
    }

    const emailTargets = selectedPlayers.map((player) => {
      const member = getPlayerMember(player);
      const group = groups.find((item) => item.id === (player.junior_group_id || member?.group_id));
      return { player, group };
    }).filter(({ player, group }) => player.parent_email && group);

    if (!emailTargets.length) {
      setMessage(playerMessageEl, "Selected players need a parent email and assigned group before an email can be sent.", "error");
      return;
    }
    if (!confirm(`Email ${emailTargets.length} selected parent${emailTargets.length === 1 ? "" : "s"}?`)) return;

    setMessage(playerMessageEl, `Sending ${emailTargets.length} parent email${emailTargets.length === 1 ? "" : "s"}...`);
    const results = await Promise.all(emailTargets.map(({ player, group }) => {
      const member = getPlayerMember(player);
      const payment = getPaymentForPlayer(player, member);
      return window.KimsEmailService.sendJuniorGroupAssignmentNotification(
        buildJuniorPlayerEmailPayload(player, group, player.invoice_url || member?.invoice_url || payment?.invoice_url || payment?.payment_link_url || "")
      );
    }));
    const failed = results.filter((result) => result?.status === "failed").length;
    setMessage(
      playerMessageEl,
      failed ? `${emailTargets.length - failed} sent, ${failed} failed. Check Email Diagnostics for details.` : "Selected parent emails sent.",
      failed ? "error" : "success"
    );
  }

  async function runJuniorPlayerBulkAction() {
    const action = playerBulkActionEl?.value || "";
    if (action === "archive") {
      await archiveSelectedJuniorPlayers();
      return;
    }
    if (action === "email") {
      await emailSelectedJuniorParents();
      return;
    }
    setMessage(playerMessageEl, "Choose a bulk action first.", "error");
  }

  async function emailGroupParents(id) {
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    const groupMembers = members.filter((member) => (
      member.group_id === id
      && member.booking_status !== "cancelled"
      && member.email
    ));
    if (!groupMembers.length) return alert("There are no parent email addresses for this group yet.");
    if (!window.KimsEmailService?.sendJuniorGroupAssignmentNotification) {
      return alert("Email service is not ready yet. Refresh the page and try again.");
    }
    if (!confirm(`Send group placement email to ${groupMembers.length} parent${groupMembers.length === 1 ? "" : "s"}?`)) return;

    const firstSession = getFirstSession(group.id);
    const sessionDate = firstSession?.start_time || group.start_date;
    const sessionTime = firstSession?.start_time
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(firstSession.start_time))
      : formatTime(group.start_time);

    setMessage(groupMessageEl, "Sending parent placement emails...");
    const results = await Promise.all(groupMembers.map((member) => window.KimsEmailService.sendJuniorGroupAssignmentNotification({
      email: member.email,
      customerName: member.parent_name,
      playerName: member.player_name,
      playerAge: member.player_age,
      playerLevel: member.player_level,
      programmeName: group.programme_name || getNameById(programmes, group.programme_id, "programme_name"),
      groupName: group.group_name,
      coachName: getNameById(coaches, group.coach_id, "display_name") || "Kim Jones",
      clubName: getNameById(clubs, group.club_id),
      dayName: getDayName(group.recurring_day),
      sessionTime,
      startDate: sessionDate,
      sessionCount: group.session_count,
      durationMinutes: group.session_duration_minutes,
      amount: group.price,
      relatedType: "junior_group",
      relatedId: group.id,
      traceId: `junior-assignment-${group.id}-${member.id}-${Date.now()}`
    })));

    const failed = results.filter((result) => result?.status === "failed").length;
    setMessage(
      groupMessageEl,
      failed ? `${results.length - failed} sent, ${failed} failed. Check Email Diagnostics for details.` : "Parent placement emails sent.",
      failed ? "error" : "success"
    );
  }

  async function resendPayment(id) {
    const member = members.find((item) => item.id === id);
    const group = groups.find((item) => item.id === member?.group_id);
    const payment = payments.find((item) => item.junior_group_member_id === id);
    if (!member || !group) return;
    await window.KimsEmailService?.sendJuniorGroupPaymentRequest?.({
      email: member.email,
      customerName: member.parent_name,
      playerName: member.player_name,
      programmeName: group.group_name,
      amount: payment?.amount || group.price,
      paymentLinkUrl: payment?.payment_link_url || group.payment_link_url || "",
      traceId: `junior-payment-${Date.now()}`
    });
    alert("Payment request email attempted. Check email diagnostics/logs if it does not arrive.");
  }

  async function savePlan(event) {
    event.preventDefault();
    const form = planFormEl;
    const id = form.elements.plan_id.value;
    const payload = {
      group_id: form.elements.group_id.value || null,
      session_id: form.elements.session_id.value || null,
      title: form.elements.title.value.trim(),
      session_date: form.elements.session_date.value || null,
      warm_up: form.elements.warm_up.value.trim(),
      technical_focus: form.elements.technical_focus.value.trim(),
      drills: form.elements.drills.value.trim(),
      games: form.elements.games.value.trim(),
      notes: form.elements.notes.value.trim(),
      equipment_needed: form.elements.equipment_needed.value.trim(),
      coach_notes: form.elements.coach_notes.value.trim()
    };
    if (!payload.title) return setMessage(planMessageEl, "Enter a session plan title.", "error");
    setMessage(planMessageEl, "Saving session plan...");
    const query = id ? client.from("session_plans").update(payload).eq("id", id) : client.from("session_plans").insert(payload);
    const { error } = await query;
    if (error) return setMessage(planMessageEl, `Could not save plan: ${error.message}`, "error");
    planFormEl.reset();
    setMessage(planMessageEl, "Session plan saved.", "success");
    await refreshAll();
  }

  function editPlan(id) {
    const plan = plans.find((item) => item.id === id);
    if (!plan || !planFormEl) return;
    planFormEl.elements.plan_id.value = plan.id;
    planFormEl.elements.group_id.value = plan.group_id || "";
    populatePlanSessions();
    planFormEl.elements.session_id.value = plan.session_id || "";
    planFormEl.elements.title.value = plan.title || "";
    planFormEl.elements.session_date.value = plan.session_date || "";
    planFormEl.elements.warm_up.value = plan.warm_up || "";
    planFormEl.elements.technical_focus.value = plan.technical_focus || "";
    planFormEl.elements.drills.value = plan.drills || "";
    planFormEl.elements.games.value = plan.games || "";
    planFormEl.elements.equipment_needed.value = plan.equipment_needed || "";
    planFormEl.elements.notes.value = plan.notes || "";
    planFormEl.elements.coach_notes.value = plan.coach_notes || "";
    planFormEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function copyPlan(id) {
    const plan = id ? plans.find((item) => item.id === id) : Object.fromEntries(new FormData(planFormEl));
    if (!plan) return;
    const message = buildPlanWhatsAppMessage(plan);
    await navigator.clipboard?.writeText(message);
    setMessage(planMessageEl, "WhatsApp message copied.", "success");
  }

  programmeFormEl?.addEventListener("submit", saveProgramme);
  groupFormEl?.addEventListener("submit", saveGroup);
  planFormEl?.addEventListener("submit", savePlan);
  programmeClearEl?.addEventListener("click", resetProgrammeForm);
  groupClearEl?.addEventListener("click", resetGroupForm);
  copyPlanEl?.addEventListener("click", () => copyPlan(""));
  planFormEl?.elements.group_id?.addEventListener("change", populatePlanSessions);
  programmeFormEl?.elements.lesson_type_id?.addEventListener("change", (event) => fillProgrammeFromLesson(event.target.value));
  groupFormEl?.elements.programme_id?.addEventListener("change", (event) => fillGroupFromProgramme(event.target.value));
  playerSearchEl?.addEventListener("input", renderJuniorPlayers);
  [playerLevelFilterEl, playerProgrammeFilterEl, playerGroupFilterEl, playerStatusFilterEl, playerPaymentFilterEl].forEach((select) => {
    select?.addEventListener("change", renderJuniorPlayers);
  });
  playerBulkApplyEl?.addEventListener("click", runJuniorPlayerBulkAction);

  programmeListEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-programme-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "edit") editProgramme(id);
    if (action === "toggle") toggleProgramme(id);
  });

  groupListEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-group-action], [data-member-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (button.dataset.groupAction === "edit") editGroup(id);
    if (button.dataset.groupAction === "toggle") toggleGroup(id);
    if (button.dataset.groupAction === "sessions") generateSessions(id);
    if (button.dataset.groupAction === "add-player") addPlayerToGroup(id);
    if (button.dataset.memberAction === "paid") markMemberPaid(id);
    if (button.dataset.memberAction === "move") moveMember(id);
    if (button.dataset.memberAction === "remove") removeMember(id);
    if (button.dataset.groupAction === "email-parents") emailGroupParents(id);
  });

  groupListEl?.addEventListener("dragstart", (event) => {
    const memberRow = event.target.closest("[data-member-id]");
    if (!memberRow) return;
    event.dataTransfer.setData("text/plain", memberRow.dataset.memberId);
    event.dataTransfer.effectAllowed = "move";
    memberRow.classList.add("dragging");
  });

  groupListEl?.addEventListener("dragend", (event) => {
    event.target.closest("[data-member-id]")?.classList.remove("dragging");
    groupListEl.querySelectorAll("[data-group-drop-zone]").forEach((zone) => zone.classList.remove("drop-target"));
  });

  groupListEl?.addEventListener("dragover", (event) => {
    const zone = event.target.closest("[data-group-drop-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("drop-target");
    event.dataTransfer.dropEffect = "move";
  });

  groupListEl?.addEventListener("dragleave", (event) => {
    const zone = event.target.closest("[data-group-drop-zone]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("drop-target");
  });

  groupListEl?.addEventListener("drop", (event) => {
    const zone = event.target.closest("[data-group-drop-zone]");
    const memberId = event.dataTransfer.getData("text/plain");
    if (!zone || !memberId) return;
    event.preventDefault();
    zone.classList.remove("drop-target");
    moveMember(memberId, zone.dataset.groupDropZone);
  });

  playerListEl?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-player-action]");
    if (!button) return;
    const action = button.dataset.playerAction;
    const { id } = button.dataset;
    const row = button.closest("[data-junior-player-row]");
    if (action === "confirm-placement") {
      await confirmPlayerPlacement(id, row);
      return;
    }
    if (action === "archive-player") {
      try {
        await archiveJuniorPlayer(id);
      } catch (error) {
        setMessage(playerMessageEl, error.message, "error");
      }
      return;
    }
    if (action === "assign-legacy") {
      setMessage(playerMessageEl, "This older row can be managed from Junior Groups. Save the customer player profile again to move it into the player-first table.", "error");
      return;
    }
    const targetGroupId = row?.querySelector("[data-junior-player-group]")?.value || "";
    const member = members.find((item) => item.id === id);
    if (!member) return;
    if (!targetGroupId) {
      setMessage(playerMessageEl, "Choose a junior group before saving.", "error");
      return;
    }
    const targetGroup = groups.find((group) => group.id === targetGroupId);
    if (!targetGroup) {
      setMessage(playerMessageEl, "That junior group could not be found. Refresh and try again.", "error");
      return;
    }
    if (targetGroupId === member.group_id) {
      setMessage(playerMessageEl, `${member.player_name} is already in ${targetGroup.group_name}.`, "success");
      return;
    }
    setMessage(playerMessageEl, `Moving ${member.player_name} to ${targetGroup.group_name}...`);
    const { error } = await client.rpc("admin_move_junior_group_member", {
      p_member_id: id,
      p_target_group_id: targetGroupId
    });
    if (error) {
      setMessage(playerMessageEl, `Could not move player: ${error.message}`, "error");
      return;
    }
    setMessage(playerMessageEl, `${member.player_name} moved to ${targetGroup.group_name}.`, "success");
    await refreshAll();
  });

  playerListEl?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-junior-player-select], [data-junior-player-select-all]");
    if (!checkbox) return;
    if (checkbox.matches("[data-junior-player-select-all]")) {
      playerListEl.querySelectorAll("[data-junior-player-select]:not(:disabled)").forEach((rowCheckbox) => {
        rowCheckbox.checked = checkbox.checked;
        if (checkbox.checked) selectedJuniorPlayerIds.add(rowCheckbox.value);
        else selectedJuniorPlayerIds.delete(rowCheckbox.value);
      });
      return;
    }
    if (checkbox.checked) selectedJuniorPlayerIds.add(checkbox.value);
    else selectedJuniorPlayerIds.delete(checkbox.value);
    const visibleCheckboxes = Array.from(playerListEl.querySelectorAll("[data-junior-player-select]:not(:disabled)"));
    const selectAll = playerListEl.querySelector("[data-junior-player-select-all]");
    if (selectAll) {
      selectAll.checked = visibleCheckboxes.length > 0 && visibleCheckboxes.every((item) => item.checked);
    }
  });

  planListEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "edit") editPlan(id);
    if (action === "copy") copyPlan(id);
  });

  paymentListEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-payment-action]");
    if (!button) return;
    if (button.dataset.paymentAction === "paid") markMemberPaid(button.dataset.id);
    if (button.dataset.paymentAction === "resend") resendPayment(button.dataset.id);
  });

  calendarListEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-group-toggle]");
    if (!button) return;
    const groupId = button.dataset.calendarGroupToggle;
    if (expandedCalendarGroups.has(groupId)) expandedCalendarGroups.delete(groupId);
    else expandedCalendarGroups.add(groupId);
    renderCalendar();
  });

  window.addEventListener("kims:lesson-types-ready", (event) => {
    lessonTypes = (event.detail?.lessonTypes || []).filter((lesson) => lesson.is_active !== false);
    populateAllSelects();
  });

  window.addEventListener("kims:coaching-settings-ready", (event) => {
    clubs = event.detail?.clubs || clubs;
    coaches = event.detail?.coaches || coaches;
    populateAllSelects();
  });

  populateJuniorGroupTimes();
  refreshAll();
})();
