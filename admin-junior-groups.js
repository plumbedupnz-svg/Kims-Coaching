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
  const planFormEl = document.querySelector("[data-session-plan-form]");
  const planListEl = document.querySelector("[data-session-plan-list]");
  const planMessageEl = document.querySelector("[data-session-plan-message]");
  const copyPlanEl = document.querySelector("[data-copy-session-plan]");
  const paymentListEl = document.querySelector("[data-junior-payment-list]");

  if (!programmeFormEl && !groupFormEl && !calendarListEl && !planFormEl && !paymentListEl) return;

  const levelOrder = ["Beginner", "Developing", "Interclub", "Tournament"];
  let programmes = [];
  let groups = [];
  let sessions = [];
  let members = [];
  let plans = [];
  let payments = [];
  let privateBookings = [];
  let lessonTypes = [];
  let clubs = [];
  let coaches = [];

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
    if (["paid", "confirmed", "scheduled", "active"].includes(status)) return "available";
    if (["overdue", "pending", "pending_payment"].includes(status)) return "warning";
    return "blocked";
  }

  function getDayName(day) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(day || 0)] || "Weekly";
  }

  function getNameById(items, id, key = "name") {
    return items.find((item) => item.id === id)?.[key] || "";
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
    populatePlanSessions();
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
      const memberRows = groupMembers.length ? groupMembers.map((member) => `
        <div class="junior-member-row">
          <div>
            <strong>${escapeHtml(member.player_name)}</strong>
            <p>${escapeHtml(member.email)} · ${escapeHtml(member.player_level || "No level")} · ${member.player_age ? `${member.player_age} yrs` : "Age not set"}</p>
          </div>
          <span class="status-pill ${statusClass(member.payment_status)}">${escapeHtml(member.payment_status)}</span>
          <span class="status-pill ${statusClass(member.booking_status)}">${escapeHtml(member.booking_status)}</span>
          <button class="btn btn-secondary" type="button" data-member-action="paid" data-id="${escapeHtml(member.id)}">Mark paid</button>
          <button class="btn btn-secondary" type="button" data-member-action="move" data-id="${escapeHtml(member.id)}">Move</button>
          <button class="btn btn-secondary" type="button" data-member-action="remove" data-id="${escapeHtml(member.id)}">Remove</button>
        </div>
      `).join("") : '<p class="helper-text">No players in this group yet.</p>';

      return `
        <article class="admin-data-row junior-group-row">
          <div>
            <span class="status-pill ${spaces > 0 ? "available" : "blocked"}">${spaces > 0 ? `${spaces} spaces available` : "Full"}</span>
            ${group.is_public ? '<span class="status-pill available">Public</span>' : '<span class="status-pill warning">Draft</span>'}
            <strong>${escapeHtml(group.group_name)}</strong>
            <p>${escapeHtml(group.term_name || "No term")} · ${getDayName(group.recurring_day)} ${escapeHtml(String(group.start_time || "").slice(0, 5))} · ${Number(group.session_count || 0)} sessions</p>
            <p>${money(group.price)} · capacity ${Number(group.capacity || 0)} · ${escapeHtml(getNameById(coaches, group.coach_id, "display_name") || "No coach")}</p>
            <div class="junior-member-list">${memberRows}</div>
          </div>
          <div class="availability-actions">
            <button class="btn btn-secondary" type="button" data-group-action="edit" data-id="${escapeHtml(group.id)}">Edit</button>
            <button class="btn btn-secondary" type="button" data-group-action="add-player" data-id="${escapeHtml(group.id)}">Add player</button>
            <button class="btn btn-secondary" type="button" data-group-action="sessions" data-id="${escapeHtml(group.id)}">Generate sessions</button>
            <button class="btn btn-secondary" type="button" data-group-action="toggle" data-id="${escapeHtml(group.id)}">${group.is_active ? "Deactivate" : "Activate"}</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderCalendar() {
    if (!calendarListEl) return;
    const groupSessionRows = sessions.map((session) => {
      const group = groups.find((item) => item.id === session.group_id) || {};
      const playerCount = members.filter((member) => member.group_id === session.group_id && member.booking_status === "confirmed").length;
      const hasPlan = plans.some((plan) => plan.session_id === session.id || plan.group_id === session.group_id);
      return `
        <article class="admin-data-row">
          <div>
            <strong>${escapeHtml(group.group_name || "Junior group")}</strong>
            <p>${formatDate(session.start_time, { weekday: "short", hour: "numeric", minute: "2-digit" })} · ${escapeHtml(getNameById(coaches, session.coach_id || group.coach_id, "display_name") || "No coach")}</p>
            <p>${escapeHtml(getNameById(clubs, session.club_id || group.club_id) || "No club")} · ${playerCount} player${playerCount === 1 ? "" : "s"}</p>
          </div>
          <span class="status-pill ${hasPlan ? "available" : "warning"}">${hasPlan ? "Plan ready" : "Needs plan"}</span>
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
    const [programmeResult, groupResult, sessionResult, memberResult, planResult, paymentResult, bookingResult] = await Promise.all([
      client.from("junior_programmes").select("*").order("created_at", { ascending: false }),
      client.from("junior_groups").select("*").order("start_date", { ascending: true }),
      client.from("junior_group_sessions").select("*").order("start_time", { ascending: true }),
      client.from("junior_group_members").select("*").order("created_at", { ascending: false }),
      client.from("session_plans").select("*").order("session_date", { ascending: true }),
      client.from("payments").select("*").eq("related_type", "junior_group").order("created_at", { ascending: false }),
      client.from("bookings").select("id,player_name,email,start_time,end_time,booking_status,created_at").order("start_time", { ascending: true })
    ]);

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
    plans = planResult.data || [];
    payments = paymentResult.data || [];
    privateBookings = bookingResult.error ? [] : (bookingResult.data || []);
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

  async function moveMember(id) {
    const member = members.find((item) => item.id === id);
    if (!member) return;
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
    const target = groups.find((group) => group.id !== member.group_id && group.group_name.toLowerCase() === response.trim().toLowerCase());
    if (!target) return alert("Could not find that target group name.");
    const { error } = await client.rpc("admin_move_junior_group_member", { p_member_id: id, p_target_group_id: target.id });
    if (error) return alert(`Could not move player: ${error.message}`);
    await refreshAll();
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

  window.addEventListener("kims:lesson-types-ready", (event) => {
    lessonTypes = (event.detail?.lessonTypes || []).filter((lesson) => lesson.is_active !== false);
    populateAllSelects();
  });

  window.addEventListener("kims:coaching-settings-ready", (event) => {
    clubs = event.detail?.clubs || clubs;
    coaches = event.detail?.coaches || coaches;
    populateAllSelects();
  });

  refreshAll();
})();
