(function () {
  const admin = window.KimsAvailability;
  if (!admin?.formEl || !admin?.listEl) return;
  const { client, state, formEl, listEl } = admin;

  function renderSlots() {
    if (!state.slots.length) {
      listEl.innerHTML = '<div class="empty-state">No lesson times have been created yet.</div>';
      return;
    }

    listEl.innerHTML = state.slots.map((slot) => {
      const statusClass = slot.is_available ? "available" : "blocked";
      const statusText = slot.is_available ? "Available" : "Blocked";
      const label = admin.escapeHtml(slot.recurrence_label || "");
      const seriesButton = slot.recurrence_group_id
        ? `<button class="btn btn-secondary" type="button" data-availability-action="delete-series" data-series-id="${slot.recurrence_group_id}">Delete series</button>`
        : "";

      return `
        <article class="availability-row">
          <div class="availability-row-main">
            <span class="status-pill ${statusClass}">${statusText}</span>
            <h3>${admin.formatDateTime(slot.start_time)} - ${admin.formatTimeInput(slot.end_time)}</h3>
            ${label ? `<p>${label}</p>` : ""}
            ${slot.recurrence_group_id ? '<p class="owner-meta">Weekly recurring slot</p>' : ""}
          </div>
          <div class="availability-actions">
            <button class="btn btn-secondary" type="button" data-availability-action="edit" data-id="${slot.id}">Edit</button>
            <button class="btn btn-secondary" type="button" data-availability-action="toggle" data-id="${slot.id}" data-next="${slot.is_available ? "false" : "true"}">${slot.is_available ? "Block" : "Open"}</button>
            <button class="btn btn-secondary" type="button" data-availability-action="delete" data-id="${slot.id}">Delete</button>
            ${seriesButton}
          </div>
        </article>
      `;
    }).join("");
  }

  async function loadSlots() {
    if (!client || !admin.isAdmin()) return;
    listEl.innerHTML = '<div class="empty-state">Loading lesson times...</div>';
    const { data, error } = await client
      .from("availability")
      .select("*")
      .order("start_time", { ascending: true })
      .limit(150);

    if (error) {
      console.error("Could not load availability", error);
      listEl.innerHTML = '<div class="empty-state">Could not load lesson times.</div>';
      return;
    }

    state.slots = data || [];
    renderSlots();
  }

  async function saveAvailability(event) {
    event.preventDefault();
    if (!client || !state.user || !admin.isAdmin()) return;
    const formData = new FormData(formEl);
    const editingId = formData.get("availability_id");

    try {
      if (editingId) {
        const payload = admin.getPayloads(formData)[0];
        const existingSlot = state.slots.find((slot) => slot.id === editingId);
        delete payload.created_by;
        payload.recurrence_group_id = existingSlot?.recurrence_group_id || null;
        payload.recurrence_weekly = Boolean(existingSlot?.recurrence_weekly);
        const { error } = await client.from("availability").update(payload).eq("id", editingId);
        if (error) throw error;
        admin.resetForm();
        admin.setMessage("Lesson time updated.", "success");
      } else {
        const payloads = admin.getPayloads(formData);
        const { error } = await client.from("availability").insert(payloads);
        if (error) throw error;
        admin.resetForm();
        admin.setMessage(`Created ${payloads.length} lesson time${payloads.length === 1 ? "" : "s"}.`, "success");
      }
      await loadSlots();
    } catch (error) {
      console.error("Could not save availability", error);
      admin.setMessage(error.message || "Could not save lesson time.", "error");
    }
  }

  async function handleAction(event) {
    const button = event.target.closest("[data-availability-action]");
    if (!button || !client || !admin.isAdmin()) return;
    const action = button.dataset.availabilityAction;
    const id = button.dataset.id;
    const seriesId = button.dataset.seriesId;

    try {
      if (action === "edit") {
        admin.fillForm(state.slots.find((slot) => slot.id === id));
        return;
      }
      if (action === "toggle") {
        const { error } = await client.from("availability").update({ is_available: button.dataset.next === "true" }).eq("id", id);
        if (error) throw error;
      }
      if (action === "delete") {
        const { error } = await client.from("availability").delete().eq("id", id);
        if (error) throw error;
      }
      if (action === "delete-series" && seriesId) {
        const { error } = await client.from("availability").delete().eq("recurrence_group_id", seriesId);
        if (error) throw error;
      }
      admin.resetForm();
      await loadSlots();
    } catch (error) {
      console.error("Could not update availability", error);
      admin.setMessage(error.message || "Could not update lesson time.", "error");
    }
  }

  async function initAvailability() {
    admin.setRepeatControls();
    if (!client) {
      listEl.innerHTML = '<div class="empty-state">Supabase is not configured yet.</div>';
      return;
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) console.error("Could not load admin session", sessionError);
    state.user = sessionData?.session?.user || null;
    if (!state.user) return;

    const { data: profile, error: profileError } = await client.from("profiles").select("*").eq("id", state.user.id).single();
    if (profileError) {
      console.error("Could not load admin profile", profileError);
      return;
    }

    state.profile = profile;
    if (!admin.isAdmin()) return;
    if (admin.statusEl) admin.statusEl.textContent = `Signed in as ${state.user.email}. Create, edit, block, and manage lesson availability.`;
    await loadSlots();
  }

  formEl.addEventListener("submit", saveAvailability);
  listEl.addEventListener("click", handleAction);
  if (admin.cancelEditEl) admin.cancelEditEl.addEventListener("click", admin.resetForm);
  if (admin.recurringEl) admin.recurringEl.addEventListener("change", admin.setRepeatControls);
  initAvailability();
})();