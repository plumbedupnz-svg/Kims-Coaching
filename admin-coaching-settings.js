(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const clubFormEl = document.querySelector("[data-club-form]");
  const clubListEl = document.querySelector("[data-club-list]");
  const clubMessageEl = document.querySelector("[data-club-message]");
  const clearClubEl = document.querySelector("[data-clear-club]");
  const coachFormEl = document.querySelector("[data-coach-form]");
  const coachListEl = document.querySelector("[data-coach-list]");
  const coachMessageEl = document.querySelector("[data-coach-message]");
  const clearCoachEl = document.querySelector("[data-clear-coach]");
  const clubSelectEls = document.querySelectorAll("[data-availability-club]");
  const coachSelectEls = document.querySelectorAll("[data-availability-coach]");

  if (!clubFormEl && !coachFormEl && !clubSelectEls.length && !coachSelectEls.length) return;

  let clubs = [];
  let coaches = [];
  window.KimsCoachingSettings = window.KimsCoachingSettings || { clubs: [], coaches: [] };

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setMessage(target, message = "", tone = "") {
    if (!target) return;
    target.textContent = message;
    if (tone) target.dataset.tone = tone;
    else target.removeAttribute("data-tone");
  }

  function populateSelects(selectorEls, items, placeholder, labelKey) {
    selectorEls.forEach((select) => {
      const current = select.value;
      const activeItems = items.filter((item) => item.is_active !== false);
      select.innerHTML = [
        `<option value="">${escapeHtml(placeholder)}</option>`,
        ...activeItems.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item[labelKey])}</option>`)
      ].join("");
      if (activeItems.some((item) => item.id === current)) select.value = current;
    });
  }

  function publishSettings() {
    window.KimsCoachingSettings = { clubs: [...clubs], coaches: [...coaches] };
    populateSelects(clubSelectEls, clubs, "Select club", "name");
    populateSelects(coachSelectEls, coaches, "Select coach", "display_name");
    window.dispatchEvent(new CustomEvent("kims:coaching-settings-ready", {
      detail: window.KimsCoachingSettings
    }));
  }

  function renderClubs() {
    if (!clubListEl) return;
    if (!clubs.length) {
      clubListEl.innerHTML = '<p class="helper-text">No clubs saved yet.</p>';
      return;
    }
    clubListEl.innerHTML = clubs.map((club) => `
      <article class="admin-data-row">
        <div>
          <strong>${escapeHtml(club.name)}</strong>
          ${club.address ? `<p>${escapeHtml(club.address)}</p>` : ""}
          ${club.notes ? `<p>${escapeHtml(club.notes)}</p>` : ""}
        </div>
        <div class="availability-actions">
          <span class="status-pill ${club.is_active === false ? "blocked" : "available"}">${club.is_active === false ? "Inactive" : "Active"}</span>
          <button class="btn btn-secondary" type="button" data-club-action="edit" data-id="${escapeHtml(club.id)}">Edit</button>
          <button class="btn btn-secondary" type="button" data-club-action="toggle" data-id="${escapeHtml(club.id)}">${club.is_active === false ? "Activate" : "Deactivate"}</button>
        </div>
      </article>
    `).join("");
  }

  function renderCoaches() {
    if (!coachListEl) return;
    if (!coaches.length) {
      coachListEl.innerHTML = '<p class="helper-text">No coaches saved yet.</p>';
      return;
    }
    coachListEl.innerHTML = coaches.map((coach) => `
      <article class="admin-data-row">
        <div>
          <strong>${escapeHtml(coach.display_name)}</strong>
          ${coach.email ? `<p>${escapeHtml(coach.email)}</p>` : ""}
          ${coach.mobile ? `<p>${escapeHtml(coach.mobile)}</p>` : ""}
          ${coach.profile_id ? '<p class="owner-meta">Coach login linked</p>' : '<p class="owner-meta">Ready to link to a future coach login</p>'}
        </div>
        <div class="availability-actions">
          <span class="status-pill ${coach.is_active === false ? "blocked" : "available"}">${coach.is_active === false ? "Inactive" : "Active"}</span>
          <button class="btn btn-secondary" type="button" data-coach-action="edit" data-id="${escapeHtml(coach.id)}">Edit</button>
          <button class="btn btn-secondary" type="button" data-coach-action="toggle" data-id="${escapeHtml(coach.id)}">${coach.is_active === false ? "Activate" : "Deactivate"}</button>
        </div>
      </article>
    `).join("");
  }

  async function loadClubs() {
    if (!client) return [];
    const { data, error } = await client
      .from("coaching_clubs")
      .select("id,name,address,notes,is_active,created_at,updated_at")
      .order("name", { ascending: true });
    if (error) {
      console.warn("Could not load coaching clubs.", error.message);
      setMessage(clubMessageEl, `Could not load clubs: ${error.message}`, "error");
      return [];
    }
    clubs = data || [];
    renderClubs();
    publishSettings();
    return clubs;
  }

  async function loadCoaches() {
    if (!client) return [];
    const { data, error } = await client
      .from("coaches")
      .select("id,profile_id,display_name,email,mobile,bio,is_active,created_at,updated_at")
      .order("display_name", { ascending: true });
    if (error) {
      console.warn("Could not load coaches.", error.message);
      setMessage(coachMessageEl, `Could not load coaches: ${error.message}`, "error");
      return [];
    }
    coaches = data || [];
    renderCoaches();
    publishSettings();
    return coaches;
  }

  function resetClubForm() {
    clubFormEl?.reset();
    if (clubFormEl?.elements.club_id) clubFormEl.elements.club_id.value = "";
    if (clubFormEl?.elements.is_active) clubFormEl.elements.is_active.checked = true;
    setMessage(clubMessageEl);
  }

  function resetCoachForm() {
    coachFormEl?.reset();
    if (coachFormEl?.elements.coach_id) coachFormEl.elements.coach_id.value = "";
    if (coachFormEl?.elements.is_active) coachFormEl.elements.is_active.checked = true;
    setMessage(coachMessageEl);
  }

  async function saveClub(event) {
    event.preventDefault();
    const formData = new FormData(clubFormEl);
    const id = formData.get("club_id");
    const payload = {
      name: formData.get("name")?.trim(),
      address: formData.get("address")?.trim() || "",
      notes: formData.get("notes")?.trim() || "",
      is_active: formData.get("is_active") === "on",
      updated_at: new Date().toISOString()
    };
    if (!payload.name) return setMessage(clubMessageEl, "Enter a club name.", "error");
    setMessage(clubMessageEl, "Saving club...");
    const query = id
      ? client.from("coaching_clubs").update(payload).eq("id", id)
      : client.from("coaching_clubs").insert(payload);
    const { error } = await query;
    if (error) return setMessage(clubMessageEl, `Could not save club: ${error.message}`, "error");
    resetClubForm();
    setMessage(clubMessageEl, "Club saved.", "success");
    await loadClubs();
  }

  async function saveCoach(event) {
    event.preventDefault();
    const formData = new FormData(coachFormEl);
    const id = formData.get("coach_id");
    const payload = {
      display_name: formData.get("display_name")?.trim(),
      email: formData.get("email")?.trim() || null,
      mobile: formData.get("mobile")?.trim() || null,
      bio: formData.get("bio")?.trim() || "",
      is_active: formData.get("is_active") === "on",
      updated_at: new Date().toISOString()
    };
    if (!payload.display_name) return setMessage(coachMessageEl, "Enter a coach name.", "error");
    setMessage(coachMessageEl, "Saving coach...");
    const query = id
      ? client.from("coaches").update(payload).eq("id", id)
      : client.from("coaches").insert(payload);
    const { error } = await query;
    if (error) return setMessage(coachMessageEl, `Could not save coach: ${error.message}`, "error");
    resetCoachForm();
    setMessage(coachMessageEl, "Coach saved.", "success");
    await loadCoaches();
  }

  function editClub(id) {
    const club = clubs.find((item) => item.id === id);
    if (!club || !clubFormEl) return;
    clubFormEl.elements.club_id.value = club.id;
    clubFormEl.elements.name.value = club.name || "";
    clubFormEl.elements.address.value = club.address || "";
    clubFormEl.elements.notes.value = club.notes || "";
    clubFormEl.elements.is_active.checked = club.is_active !== false;
    clubFormEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function editCoach(id) {
    const coach = coaches.find((item) => item.id === id);
    if (!coach || !coachFormEl) return;
    coachFormEl.elements.coach_id.value = coach.id;
    coachFormEl.elements.display_name.value = coach.display_name || "";
    coachFormEl.elements.email.value = coach.email || "";
    coachFormEl.elements.mobile.value = coach.mobile || "";
    coachFormEl.elements.bio.value = coach.bio || "";
    coachFormEl.elements.is_active.checked = coach.is_active !== false;
    coachFormEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleClubAction(event) {
    const button = event.target.closest("[data-club-action]");
    if (!button) return;
    const club = clubs.find((item) => item.id === button.dataset.id);
    if (!club) return;
    if (button.dataset.clubAction === "edit") return editClub(club.id);
    const { error } = await client.from("coaching_clubs").update({ is_active: club.is_active === false, updated_at: new Date().toISOString() }).eq("id", club.id);
    if (error) setMessage(clubMessageEl, `Could not update club: ${error.message}`, "error");
    await loadClubs();
  }

  async function handleCoachAction(event) {
    const button = event.target.closest("[data-coach-action]");
    if (!button) return;
    const coach = coaches.find((item) => item.id === button.dataset.id);
    if (!coach) return;
    if (button.dataset.coachAction === "edit") return editCoach(coach.id);
    const { error } = await client.from("coaches").update({ is_active: coach.is_active === false, updated_at: new Date().toISOString() }).eq("id", coach.id);
    if (error) setMessage(coachMessageEl, `Could not update coach: ${error.message}`, "error");
    await loadCoaches();
  }

  clubFormEl?.addEventListener("submit", saveClub);
  clearClubEl?.addEventListener("click", resetClubForm);
  clubListEl?.addEventListener("click", handleClubAction);
  coachFormEl?.addEventListener("submit", saveCoach);
  clearCoachEl?.addEventListener("click", resetCoachForm);
  coachListEl?.addEventListener("click", handleCoachAction);

  if (!client) {
    setMessage(clubMessageEl, "Supabase is not configured.", "error");
    setMessage(coachMessageEl, "Supabase is not configured.", "error");
    return;
  }

  Promise.all([loadClubs(), loadCoaches()]);
})();
