(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const lessonTypeFormEl = document.querySelector("[data-lesson-type-form]");
  const lessonTypeListEl = document.querySelector("[data-lesson-type-list]");
  const lessonTypeMessageEl = document.querySelector("[data-lesson-type-message]");
  const clearLessonTypeEl = document.querySelector("[data-clear-lesson-type]");
  const availabilityLessonTypeEl = document.querySelector("[data-availability-lesson-type]");
  const quickLessonTypeNameEl = document.querySelector("[data-quick-lesson-type-name]");
  const quickLessonTypeAddEl = document.querySelector("[data-add-quick-lesson-type]");
  const quickLessonTypeMessageEl = document.querySelector("[data-quick-lesson-type-message]");
  const bundleFormEl = document.querySelector("[data-bundle-form]");
  const bundleListEl = document.querySelector("[data-bundle-list]");
  const bundleMessageEl = document.querySelector("[data-bundle-message]");
  const clearBundleEl = document.querySelector("[data-clear-bundle]");
  const bundleLessonTypeEl = document.querySelector("[data-bundle-lesson-type]");

  if (!lessonTypeFormEl && !bundleFormEl) return;

  const lessonRulesMigration = "supabase/migrations/20260626060000_lesson_type_age_level_rules.sql";
  let lessonTypes = [];
  let bundles = [];
  window.KimsLessonTypes = window.KimsLessonTypes || [];

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

  function setMessage(target, message, tone = "neutral") {
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
  }

  function isLessonRulesSchemaError(error) {
    return /minimum_players|pay_as_you_go_only|minimum_age|minimum_level|schema cache|PGRST204|42703/i.test(error?.message || error?.code || "");
  }

  function getLessonRulesSchemaMessage(error) {
    const detail = error?.message ? ` Supabase said: ${error.message}` : "";
    return `Lesson type rules are not fully set up in Supabase yet. Run ${lessonRulesMigration} in Supabase SQL Editor, then refresh this page.${detail}`;
  }

  function getLessonName(id) {
    return lessonTypes.find((lesson) => lesson.id === id)?.name || "Any lesson type";
  }

  function renderLessonTypeOptions() {
    const activeLessonTypes = lessonTypes.filter((lesson) => lesson.is_active !== false);
    const options = activeLessonTypes
      .map((lesson) => `<option value="${escapeHtml(lesson.id)}">${escapeHtml(lesson.name)} · ${Number(lesson.duration || 0)} min · ${money(lesson.price)}</option>`)
      .join("");

    if (availabilityLessonTypeEl) {
      const current = availabilityLessonTypeEl.value;
      availabilityLessonTypeEl.innerHTML = `<option value="">Select lesson type</option>${options}`;
      if (activeLessonTypes.some((lesson) => lesson.id === current)) availabilityLessonTypeEl.value = current;
    }

    if (bundleLessonTypeEl) {
      const current = bundleLessonTypeEl.value;
      bundleLessonTypeEl.innerHTML = `<option value="">Any lesson type</option>${options}`;
      if (activeLessonTypes.some((lesson) => lesson.id === current)) bundleLessonTypeEl.value = current;
    }

    window.dispatchEvent(new CustomEvent("kims:lesson-types-ready", { detail: { lessonTypes: [...lessonTypes] } }));
  }

  function renderLessonTypes() {
    renderLessonTypeOptions();
    if (!lessonTypeListEl) return;
    if (!lessonTypes.length) {
      lessonTypeListEl.innerHTML = '<div class="empty-state">No lesson types yet.</div>';
      return;
    }

    lessonTypeListEl.innerHTML = lessonTypes.map((lesson) => `
      <article class="availability-row">
        <div class="availability-row-main">
          <span class="status-pill ${lesson.is_active === false ? "blocked" : "available"}">${lesson.is_active === false ? "Inactive" : "Active"}</span>
          <h3>${escapeHtml(lesson.name)}</h3>
          <p>${Number(lesson.duration || 0)} min · ${money(lesson.price)} · capacity ${Number(lesson.capacity || 1)} · minimum ${Number(lesson.minimum_players || 1)}</p>
          <p>Minimum age ${lesson.minimum_age ? Number(lesson.minimum_age) : "any"} · level ${lesson.minimum_level || "any"}</p>
          ${lesson.pay_as_you_go_only ? '<p>Pay as you go only</p>' : ""}
          ${lesson.description ? `<p>${escapeHtml(lesson.description)}</p>` : ""}
        </div>
        <div class="availability-actions">
          <button class="btn btn-secondary" type="button" data-lesson-type-action="edit" data-id="${escapeHtml(lesson.id)}">Edit</button>
          <button class="btn btn-secondary" type="button" data-lesson-type-action="toggle" data-id="${escapeHtml(lesson.id)}">${lesson.is_active === false ? "Activate" : "Deactivate"}</button>
          <button class="btn btn-secondary" type="button" data-lesson-type-action="delete" data-id="${escapeHtml(lesson.id)}">Delete</button>
        </div>
      </article>
    `).join("");
  }

  function renderBundles() {
    if (!bundleListEl) return;
    if (!bundles.length) {
      bundleListEl.innerHTML = '<p class="helper-text">No coaching bundles yet.</p>';
      return;
    }

    bundleListEl.innerHTML = bundles.map((bundle) => `
      <article class="admin-data-row">
        <div>
          <strong>${escapeHtml(bundle.name)}</strong>
          <p>${Number(bundle.lesson_count || 0)} lessons · ${Number(bundle.discount_percent || 0)}% discount · ${escapeHtml(getLessonName(bundle.lesson_type_id))}</p>
          ${bundle.description ? `<p>${escapeHtml(bundle.description)}</p>` : ""}
        </div>
        <div class="availability-actions">
          <span class="status-pill ${bundle.is_active === false ? "blocked" : "available"}">${bundle.is_active === false ? "Inactive" : "Active"}</span>
          <button class="btn btn-secondary" type="button" data-bundle-action="edit" data-id="${escapeHtml(bundle.id)}">Edit</button>
          <button class="btn btn-secondary" type="button" data-bundle-action="toggle" data-id="${escapeHtml(bundle.id)}">${bundle.is_active === false ? "Activate" : "Deactivate"}</button>
        </div>
      </article>
    `).join("");
  }

  async function loadLessonTypes() {
    if (!client) return;
    const { data, error } = await client
      .from("lesson_types")
      .select("id,name,duration,price,description,capacity,minimum_players,minimum_age,minimum_level,pay_as_you_go_only,is_active")
      .order("name", { ascending: true });

    if (error) {
      console.warn("Could not load lesson types.", error.message);
      setMessage(
        lessonTypeMessageEl,
        isLessonRulesSchemaError(error) ? getLessonRulesSchemaMessage(error) : `Could not load lesson types: ${error.message}`,
        "error"
      );
      renderLessonTypeOptions();
      return;
    }

    lessonTypes = data || [];
    window.KimsLessonTypes = [...lessonTypes];
    renderLessonTypes();
  }

  async function loadBundles() {
    if (!client) return;
    const { data, error } = await client
      .from("lesson_bundles")
      .select("id,name,lesson_type_id,lesson_count,discount_percent,description,is_active")
      .order("lesson_count", { ascending: true });

    if (error) {
      console.warn("Could not load lesson bundles.", error.message);
      setMessage(bundleMessageEl, `Could not load bundles: ${error.message}`, "error");
      return;
    }

    bundles = data || [];
    renderBundles();
  }

  function resetLessonTypeForm() {
    lessonTypeFormEl?.reset();
    if (lessonTypeFormEl?.elements.lesson_type_id) lessonTypeFormEl.elements.lesson_type_id.value = "";
    if (lessonTypeFormEl?.elements.is_active) lessonTypeFormEl.elements.is_active.checked = true;
    setMessage(lessonTypeMessageEl, "");
  }

  function resetBundleForm() {
    bundleFormEl?.reset();
    if (bundleFormEl?.elements.bundle_id) bundleFormEl.elements.bundle_id.value = "";
    if (bundleFormEl?.elements.is_active) bundleFormEl.elements.is_active.checked = true;
    setMessage(bundleMessageEl, "");
  }

  async function saveLessonType(event) {
    event.preventDefault();
    const formData = new FormData(lessonTypeFormEl);
    const id = formData.get("lesson_type_id");
    const payload = {
      name: formData.get("name")?.trim(),
      duration: Number(formData.get("duration") || 60),
      price: Number(formData.get("price") || 0),
      capacity: Math.max(1, Number(formData.get("capacity") || 1)),
      minimum_players: Math.max(1, Number(formData.get("minimum_players") || 1)),
      minimum_age: formData.get("minimum_age") ? Math.max(0, Number(formData.get("minimum_age"))) : null,
      minimum_level: formData.get("minimum_level") || "",
      pay_as_you_go_only: formData.get("pay_as_you_go_only") === "on",
      description: formData.get("description")?.trim() || "",
      is_active: formData.get("is_active") === "on"
    };

    if (!payload.name) {
      setMessage(lessonTypeMessageEl, "Enter a lesson type name.", "error");
      return;
    }

    setMessage(lessonTypeMessageEl, "Saving lesson type...");
    const query = id
      ? client.from("lesson_types").update(payload).eq("id", id)
      : client.from("lesson_types").insert(payload);
    const { error } = await query;
    if (error) {
      setMessage(
        lessonTypeMessageEl,
        isLessonRulesSchemaError(error) ? getLessonRulesSchemaMessage(error) : `Could not save lesson type: ${error.message}`,
        "error"
      );
      return;
    }

    resetLessonTypeForm();
    setMessage(lessonTypeMessageEl, "Lesson type saved.", "success");
    await loadLessonTypes();
  }

  async function addQuickLessonType() {
    const name = quickLessonTypeNameEl?.value?.trim() || "";
    if (!name) {
      setMessage(quickLessonTypeMessageEl, "Enter a lesson type name.", "error");
      quickLessonTypeNameEl?.focus();
      return;
    }

    quickLessonTypeAddEl.disabled = true;
    setMessage(quickLessonTypeMessageEl, "Saving lesson type...");

    const { data: existing, error: existingError } = await client
      .from("lesson_types")
      .select("id,name")
      .ilike("name", name)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      quickLessonTypeAddEl.disabled = false;
      setMessage(quickLessonTypeMessageEl, `Could not check lesson types: ${existingError.message}`, "error");
      return;
    }

    let lessonTypeId = existing?.id || "";
    if (!lessonTypeId) {
      const { data, error } = await client
        .from("lesson_types")
        .insert({ name, duration: 60, price: 0, capacity: 1, minimum_players: 1, minimum_age: null, minimum_level: "", pay_as_you_go_only: false, description: "", is_active: true })
        .select("id")
        .single();

      if (error) {
        quickLessonTypeAddEl.disabled = false;
        setMessage(
          quickLessonTypeMessageEl,
          isLessonRulesSchemaError(error) ? getLessonRulesSchemaMessage(error) : `Could not save lesson type: ${error.message}`,
          "error"
        );
        return;
      }
      lessonTypeId = data.id;
    }

    await loadLessonTypes();
    availabilityLessonTypeEl.value = lessonTypeId;
    availabilityLessonTypeEl.dispatchEvent(new Event("change", { bubbles: true }));
    quickLessonTypeNameEl.value = "";
    quickLessonTypeAddEl.disabled = false;
    setMessage(quickLessonTypeMessageEl, existing ? "Existing lesson type selected." : "Lesson type saved and selected.", "success");
  }

  async function saveBundle(event) {
    event.preventDefault();
    const formData = new FormData(bundleFormEl);
    const id = formData.get("bundle_id");
    const payload = {
      name: formData.get("name")?.trim(),
      lesson_type_id: formData.get("lesson_type_id") || null,
      lesson_count: Math.max(1, Number(formData.get("lesson_count") || 1)),
      discount_percent: Math.min(100, Math.max(0, Number(formData.get("discount_percent") || 0))),
      description: formData.get("description")?.trim() || "",
      is_active: formData.get("is_active") === "on"
    };

    if (!payload.name) {
      setMessage(bundleMessageEl, "Enter a bundle name.", "error");
      return;
    }

    setMessage(bundleMessageEl, "Saving bundle...");
    const query = id
      ? client.from("lesson_bundles").update(payload).eq("id", id)
      : client.from("lesson_bundles").insert(payload);
    const { error } = await query;
    if (error) {
      setMessage(bundleMessageEl, `Could not save bundle: ${error.message}`, "error");
      return;
    }

    resetBundleForm();
    setMessage(bundleMessageEl, "Bundle saved.", "success");
    await loadBundles();
  }

  function fillLessonType(id) {
    const lesson = lessonTypes.find((item) => item.id === id);
    if (!lesson || !lessonTypeFormEl) return;
    lessonTypeFormEl.elements.lesson_type_id.value = lesson.id;
    lessonTypeFormEl.elements.name.value = lesson.name || "";
    lessonTypeFormEl.elements.duration.value = lesson.duration || 60;
    lessonTypeFormEl.elements.price.value = Number(lesson.price || 0).toFixed(2);
    lessonTypeFormEl.elements.capacity.value = lesson.capacity || 1;
    lessonTypeFormEl.elements.minimum_players.value = lesson.minimum_players || 1;
    lessonTypeFormEl.elements.minimum_age.value = lesson.minimum_age ?? "";
    lessonTypeFormEl.elements.minimum_level.value = lesson.minimum_level || "";
    lessonTypeFormEl.elements.pay_as_you_go_only.checked = lesson.pay_as_you_go_only === true;
    lessonTypeFormEl.elements.description.value = lesson.description || "";
    lessonTypeFormEl.elements.is_active.checked = lesson.is_active !== false;
    lessonTypeFormEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function fillBundle(id) {
    const bundle = bundles.find((item) => item.id === id);
    if (!bundle || !bundleFormEl) return;
    bundleFormEl.elements.bundle_id.value = bundle.id;
    bundleFormEl.elements.name.value = bundle.name || "";
    bundleFormEl.elements.lesson_type_id.value = bundle.lesson_type_id || "";
    bundleFormEl.elements.lesson_count.value = bundle.lesson_count || 1;
    bundleFormEl.elements.discount_percent.value = Number(bundle.discount_percent || 0).toFixed(2);
    bundleFormEl.elements.description.value = bundle.description || "";
    bundleFormEl.elements.is_active.checked = bundle.is_active !== false;
    bundleFormEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleLessonTypeAction(event) {
    const button = event.target.closest("[data-lesson-type-action]");
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.lessonTypeAction === "edit") {
      fillLessonType(id);
      return;
    }
    const lesson = lessonTypes.find((item) => item.id === id);
    if (button.dataset.lessonTypeAction === "delete") {
      if (!lesson) return;
      const confirmed = window.confirm(`Delete ${lesson.name}? If this lesson type has existing lesson times or bookings, use Deactivate instead.`);
      if (!confirmed) return;
      const { error } = await client.from("lesson_types").delete().eq("id", id);
      if (error) {
        const blocked = /foreign key|violates|23503|referenced|constraint/i.test(error.message || error.code || "");
        setMessage(
          lessonTypeMessageEl,
          blocked
            ? "This lesson type is linked to existing lesson times or bookings and cannot be deleted. Use Deactivate instead."
            : `Could not delete lesson type: ${error.message}`,
          "error"
        );
        return;
      }
      if (lessonTypeFormEl?.elements.lesson_type_id?.value === id) resetLessonTypeForm();
      setMessage(lessonTypeMessageEl, "Lesson type deleted.", "success");
      await loadLessonTypes();
      return;
    }
    const { error } = await client.from("lesson_types").update({ is_active: lesson?.is_active === false }).eq("id", id);
    if (error) setMessage(lessonTypeMessageEl, `Could not update lesson type: ${error.message}`, "error");
    await loadLessonTypes();
  }

  async function handleBundleAction(event) {
    const button = event.target.closest("[data-bundle-action]");
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.bundleAction === "edit") {
      fillBundle(id);
      return;
    }
    const bundle = bundles.find((item) => item.id === id);
    const { error } = await client.from("lesson_bundles").update({ is_active: bundle?.is_active === false }).eq("id", id);
    if (error) setMessage(bundleMessageEl, `Could not update bundle: ${error.message}`, "error");
    await loadBundles();
  }

  lessonTypeFormEl?.addEventListener("submit", saveLessonType);
  clearLessonTypeEl?.addEventListener("click", resetLessonTypeForm);
  lessonTypeListEl?.addEventListener("click", handleLessonTypeAction);
  quickLessonTypeAddEl?.addEventListener("click", addQuickLessonType);
  quickLessonTypeNameEl?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addQuickLessonType();
  });
  bundleFormEl?.addEventListener("submit", saveBundle);
  clearBundleEl?.addEventListener("click", resetBundleForm);
  bundleListEl?.addEventListener("click", handleBundleAction);

  if (!client) {
    setMessage(lessonTypeMessageEl, "Supabase is not configured.", "error");
    setMessage(bundleMessageEl, "Supabase is not configured.", "error");
    return;
  }

  Promise.all([loadLessonTypes(), loadBundles()]);
})();
