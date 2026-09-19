(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey) : null;
  const { today, dueDate, formatDate, tension } = window.KimsStringing;
  const esc = (value = "") => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  function messageFor(error) {
    if (/schema cache|does not exist|could not find|PGRST20[245]|42P01/i.test(`${error.code || ""} ${error.message || ""}`)) {
      return "Racket records need to be enabled for this site. Please ask the site administrator to complete the stringing setup.";
    }
    return error.message || "Could not save racket details. Please try again.";
  }

  function mount(customers) {
    document.querySelectorAll("[data-racket-customer]").forEach((panel) => {
      const customer = customers.find((item) => item.id === panel.dataset.racketCustomer);
      if (!customer) return;
      const content = panel.querySelector("[data-racket-content]");
      let rackets = [], deliveries = [], loaded = false, loading = false;
      const name = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Account holder";
      const players = [...new Set([name, customer.player_name, ...(customer.players || []).map((p) => p.name)].filter(Boolean))];

      function status(racket, latest) {
        if (!racket.reminder_enabled) return '<span class="racket-status">Reminders off</span>';
        if (!latest) return '<span class="racket-status">Waiting for first stringing</span>';
        const delivery = deliveries.find((d) => d.stringing_id === latest.id && d.racket_id === racket.id);
        if (delivery?.status === "sent") return `<span class="racket-status sent">Reminder sent ${esc(formatDate(delivery.sent_at))}</span>`;
        if (delivery?.status === "needs_review" || delivery?.error_message) return '<span class="racket-status review">Email delivery needs checking</span>';
        const due = dueDate(latest.strung_on, racket.reminder_interval, racket.reminder_unit);
        return `<span class="racket-status ${due <= today() ? "due" : ""}">${due <= today() ? "Restring due" : "Reminder due"} ${esc(formatDate(due))}</span>`;
      }

      function render(success = "") {
        content.innerHTML = `
          <div class="racket-toolbar"><p class="helper-text">${rackets.length} racket${rackets.length === 1 ? "" : "s"} saved · Email reminders go to ${esc(customer.email || "the customer’s email once added")}.</p>
            <button type="button" class="btn btn-primary" data-racket-action="add">Add racket</button></div>
          <p class="form-message" data-racket-message role="status" data-tone="success">${esc(success)}</p>
          <div data-racket-editor></div>
          ${rackets.length ? rackets.map((r) => {
            const latest = r.stringings[0];
            return `<article class="racket-card">
              <div class="racket-card-head"><div><h3>${esc(r.racket_type)}</h3><p class="helper-text">${esc(r.player_name)}</p></div>${status(r, latest)}</div>
              ${latest ? `<dl class="racket-facts"><div><dt>Last strung</dt><dd>${esc(formatDate(latest.strung_on))}</dd></div><div><dt>Strings${latest.strings_cross ? " · mains / crosses" : ""}</dt><dd>${esc(latest.strings_main)}${latest.strings_cross ? ` / ${esc(latest.strings_cross)}` : ""}</dd></div><div><dt>Tension${latest.tension_cross == null ? "" : " · mains / crosses"}</dt><dd>${esc(tension(latest))}</dd></div></dl>` : '<p class="helper-text">No stringing recorded yet.</p>'}
              ${r.notes ? `<p class="helper-text">${esc(r.notes)}</p>` : ""}
              ${r.reminder_enabled ? `<p class="helper-text">Reminder after ${r.reminder_interval} ${esc(r.reminder_unit)} from the latest stringing. One email per restring.</p>` : ""}
              <div class="racket-actions"><button type="button" class="btn btn-primary" data-racket-action="string" data-id="${esc(r.id)}">Record stringing</button><button type="button" class="btn btn-secondary" data-racket-action="edit" data-id="${esc(r.id)}">Edit racket &amp; reminders</button></div>
              ${r.stringings.length ? `<details class="racket-history"><summary>Stringing history (${r.stringings.length})</summary>${r.stringings.map((s) => `<div class="racket-history-entry"><strong>${esc(formatDate(s.strung_on))}</strong><p>${esc(s.strings_main)}${s.strings_cross ? ` / ${esc(s.strings_cross)}` : ""} · ${esc(tension(s))}</p>${s.notes ? `<p class="helper-text">${esc(s.notes)}</p>` : ""}<button type="button" class="btn btn-secondary" data-racket-action="history" data-id="${esc(r.id)}" data-stringing="${esc(s.id)}">Edit entry</button></div>`).join("")}</details>` : ""}
            </article>`;
          }).join("") : '<p class="helper-text">Add a racket to keep its strings, tension and restring history together.</p>'}`;
      }

      async function load(success = "") {
        if (loading) return;
        loading = true;
        try {
          if (!client) throw new Error("Supabase is not configured yet.");
          const result = await client.from("customer_rackets").select("*, stringings:racket_stringings(*)").eq("customer_id", customer.id).order("created_at");
          if (result.error) throw result.error;
          rackets = (result.data || []).map((r) => ({ ...r, stringings: (r.stringings || []).sort((a, b) => b.strung_on.localeCompare(a.strung_on) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)) }));
          if (rackets.length) {
            const reminders = await client.from("racket_reminder_deliveries").select("id,racket_id,stringing_id,due_on,status,sent_at,error_message").in("racket_id", rackets.map((r) => r.id));
            if (reminders.error) throw reminders.error;
            deliveries = reminders.data || [];
          } else deliveries = [];
          loaded = true;
          render(success);
        } catch (error) {
          loaded = false;
          content.innerHTML = `<p class="form-message" role="alert" data-tone="error">${esc(messageFor(error))}</p><button type="button" class="btn btn-secondary" data-racket-action="reload">Retry loading rackets</button>`;
        } finally { loading = false; }
      }

      function openEditor(action, id, stringingId) {
        const existing = rackets.find((r) => r.id === id);
        const racket = existing || { id: window.crypto.randomUUID(), customer_id: customer.id, player_name: name, racket_type: "", notes: "", reminder_enabled: false, reminder_interval: 3, reminder_unit: "months" };
        const editingHistory = action === "history";
        const previous = editingHistory ? existing.stringings.find((s) => s.id === stringingId) : existing?.stringings[0];
        const stringing = { ...(previous || {}), id: editingHistory ? previous.id : window.crypto.randomUUID(), strung_on: editingHistory ? previous.strung_on : today(), notes: editingHistory ? previous.notes : "" };
        const onlyStringing = ["string", "history"].includes(action);
        const editor = content.querySelector("[data-racket-editor]");
        editor.innerHTML = `<form class="racket-form">
          <h3>${action === "add" ? "Add racket" : action === "edit" ? "Edit racket & reminders" : editingHistory ? "Edit stringing entry" : "Record stringing"}</h3>
          ${onlyStringing ? `<p class="helper-text">${esc(racket.racket_type)} · ${esc(racket.player_name)}</p>` : `
          <div class="racket-form-grid">
            <label>Player / racket owner<input name="player_name" list="racket-players-${esc(customer.id)}" value="${esc(racket.player_name)}" maxlength="120" required /><datalist id="racket-players-${esc(customer.id)}">${players.map((p) => `<option value="${esc(p)}"></option>`).join("")}</datalist></label>
            <label>Racket type / brand &amp; model<input name="racket_type" value="${esc(racket.racket_type)}" placeholder="e.g. Wilson Blade 100 · racket 1" maxlength="160" required /></label>
            <label class="racket-wide">Racket notes (optional)<textarea name="racket_notes" rows="2" maxlength="2000" placeholder="Grip size, colour or another detail to identify this racket">${esc(racket.notes)}</textarea></label>
          </div>`}
          ${action === "add" ? '<label class="racket-consent"><input type="checkbox" name="include_stringing" checked />Record the latest stringing now</label>' : ""}
          ${action !== "edit" ? `<fieldset data-stringing-fields><legend>Stringing details</legend><div class="racket-form-grid">
            <label>Date strung<input name="strung_on" type="date" value="${esc(stringing.strung_on)}" max="${today()}" required /></label>
            <label>Tension unit<select name="tension_unit"><option value="lb" ${stringing.tension_unit !== "kg" ? "selected" : ""}>Pounds (lb)</option><option value="kg" ${stringing.tension_unit === "kg" ? "selected" : ""}>Kilograms (kg)</option></select></label>
            <label>Strings / main strings<input name="strings_main" value="${esc(stringing.strings_main)}" placeholder="e.g. Luxilon ALU Power 1.25" maxlength="160" required /></label>
            <label>Cross strings (if different)<input name="strings_cross" value="${esc(stringing.strings_cross)}" placeholder="Leave blank for the same strings" maxlength="160" /></label>
            <label>Tension / main tension<input name="tension_main" type="number" min="0.01" max="100" step="0.01" value="${esc(stringing.tension_main)}" placeholder="e.g. 52" required /></label>
            <label>Cross tension (if different)<input name="tension_cross" type="number" min="0.01" max="100" step="0.01" value="${esc(stringing.tension_cross)}" placeholder="Leave blank for the same tension" /></label>
            <label class="racket-wide">Stringing notes (optional)<textarea name="stringing_notes" rows="2" maxlength="2000">${esc(stringing.notes)}</textarea></label>
          </div></fieldset>` : ""}
          ${!onlyStringing ? `
          <label class="racket-consent"><input type="checkbox" name="reminder_enabled" ${racket.reminder_enabled ? "checked" : ""} ${!customer.email ? "disabled" : ""} />Customer has agreed to email reminders for this racket</label>
          <p class="helper-text">${customer.email ? `Send to ${esc(customer.email)}. Uncheck to stop future reminders.` : "Add an email address to this customer’s profile before enabling reminders."}</p>
          <fieldset data-reminder-fields><div class="racket-form-grid"><label>Remind after<input name="reminder_interval" type="number" min="1" max="104" step="1" value="${racket.reminder_interval}" required /></label><label>Interval<select name="reminder_unit"><option value="months" ${racket.reminder_unit === "months" ? "selected" : ""}>Months</option><option value="weeks" ${racket.reminder_unit === "weeks" ? "selected" : ""}>Weeks</option></select></label></div></fieldset>` : ""}
          <p class="helper-text" data-due-preview></p>
          <p class="form-message" data-save-message role="status"></p>
          <div class="racket-actions"><button type="submit" class="btn btn-primary">Save ${onlyStringing ? "stringing" : "racket"}</button><button type="button" class="btn btn-secondary" data-cancel-racket>Cancel</button></div>
        </form>`;
        const form = editor.querySelector("form");
        const fields = form.elements;
        function updatePreview() {
          const include = !fields.include_stringing || fields.include_stringing.checked;
          const stringFields = form.querySelector("[data-stringing-fields]");
          if (stringFields) { stringFields.disabled = !include; stringFields.hidden = !include; }
          const enabled = onlyStringing ? racket.reminder_enabled : fields.reminder_enabled.checked;
          const reminderFields = form.querySelector("[data-reminder-fields]");
          if (reminderFields) { reminderFields.disabled = !enabled; reminderFields.hidden = !enabled; }
          const dates = (existing?.stringings || []).filter((s) => s.id !== stringing.id).map((s) => s.strung_on);
          if (include && fields.strung_on?.value) dates.push(fields.strung_on.value);
          const latest = dates.sort().at(-1);
          const due = dueDate(latest, fields.reminder_interval?.value || racket.reminder_interval, fields.reminder_unit?.value || racket.reminder_unit);
          form.querySelector("[data-due-preview]").textContent = enabled
            ? due ? `Reminder due ${formatDate(due)}${due <= today() ? " — eligible at the next daily email check." : "."}` : "The reminder date will be calculated when a stringing is recorded."
            : "Email reminders are off for this racket.";
        }
        form.addEventListener("input", updatePreview);
        form.querySelector("[data-cancel-racket]").addEventListener("click", () => { editor.innerHTML = ""; });
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const submit = form.querySelector('[type="submit"]');
          if (submit.disabled) return;
          const message = form.querySelector("[data-save-message]");
          const payload = { id: racket.id, customer_id: customer.id, player_name: racket.player_name, racket_type: racket.racket_type, notes: racket.notes,
            reminder_enabled: racket.reminder_enabled, reminder_interval: racket.reminder_interval, reminder_unit: racket.reminder_unit };
          if (!onlyStringing) Object.assign(payload, { player_name: fields.player_name.value.trim(), racket_type: fields.racket_type.value.trim(), notes: fields.racket_notes.value.trim(),
            reminder_enabled: fields.reminder_enabled.checked, reminder_interval: Number(fields.reminder_interval.value), reminder_unit: fields.reminder_unit.value });
          const include = action !== "edit" && (!fields.include_stringing || fields.include_stringing.checked);
          const record = include ? { id: stringing.id, strung_on: fields.strung_on.value, strings_main: fields.strings_main.value.trim(), strings_cross: fields.strings_cross.value.trim(),
            tension_main: Number(fields.tension_main.value), tension_cross: fields.tension_cross.value === "" ? null : Number(fields.tension_cross.value), tension_unit: fields.tension_unit.value, notes: fields.stringing_notes.value.trim() } : null;
          submit.disabled = true;
          form.querySelector('[data-cancel-racket]').disabled = true;
          message.textContent = "Saving…";
          message.dataset.tone = "neutral";
          try {
            const result = await client.rpc("admin_save_racket", { p_racket: payload, p_stringing: record, p_expected_updated_at: existing?.updated_at || null });
            if (result.error) throw result.error;
            await load(include ? "Stringing saved. Racket history is up to date." : "Racket and reminder preferences saved.");
          } catch (error) {
            message.textContent = messageFor(error);
            message.dataset.tone = "error";
            submit.disabled = false;
            form.querySelector('[data-cancel-racket]').disabled = false;
          }
        });
        updatePreview();
        editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
        form.querySelector("input:not([type=checkbox]), select")?.focus({ preventScroll: true });
      }

      content.addEventListener("click", (event) => {
        const button = event.target.closest("[data-racket-action]");
        if (!button) return;
        if (button.dataset.racketAction === "reload") load();
        else openEditor(button.dataset.racketAction, button.dataset.id, button.dataset.stringing);
      });
      panel.addEventListener("toggle", () => { if (panel.open && !loaded) load(); });
    });
  }
  window.KimsRackets = { mount };
})();
