(function () {
  const panel = document.querySelector("[data-xero-panel]");
  if (!panel) return;
  const cfg = window.KIMS_SUPABASE || {};
  const client = window.supabase?.createClient(cfg.url, cfg.anonKey);
  const message = panel.querySelector("[data-xero-message]"),
    form = panel.querySelector("form");
  const organisation = panel.querySelector("[data-xero-organisation]");
  async function api(body) {
    const { data } = await client.auth.getSession();
    if (!data.session) throw new Error("Please log in as an administrator.");
    const r = await fetch("/api/xero", {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || "Xero connection failed.");
    return result;
  }
  function options(select, rows, value) {
    select.replaceChildren(new Option("Select…", ""));
    rows.forEach((row) => select.add(new Option(row.name, row.id || row.code)));
    select.value = value || "";
  }
  async function refresh() {
    message.textContent = "Checking Xero connection…";
    try {
      const data = await api();
      panel.querySelector("[data-xero-connect]").disabled = !data.configured;
      panel.querySelector("[data-xero-select]").disabled = !data.connected;
      form.querySelector("button").disabled = !data.connected;
      if (!data.configured) {
        message.textContent = data.message;
        return;
      }
      options(organisation, data.organisations, data.tenant_id);
      options(
        form.elements.sales_account_code,
        data.accounts,
        data.settings?.sales_account_code,
      );
      options(
        form.elements.branding_theme_id,
        data.themes,
        data.settings?.branding_theme_id,
      );
      for (const name of ["bank_name", "bank_number", "due_days"])
        form.elements[name].value = data.settings?.[name] ?? "";
      for (const name of ["enabled", "stripe_ready"])
        form.elements[name].checked = data.settings?.[name] === true;
      message.textContent = data.tenant_name
        ? `Connected to ${data.tenant_name}. ${data.settings.enabled ? "Invoice checkout is enabled." : "Invoice checkout is off; existing Stripe checkout remains available."}${data.webhook_configured ? "" : " The invoice webhook key still needs to be configured."}`
        : data.connected
          ? "Xero authorised. Choose Kim’s organisation below."
          : "Connect Kim’s Xero account to continue.";
    } catch (e) {
      message.textContent = e.message;
    }
  }
  panel
    .querySelector("[data-xero-connect]")
    .addEventListener("click", async () => {
      try {
        const data = await api({ action: "connect" });
        location.href = data.url;
      } catch (e) {
        message.textContent = e.message;
      }
    });
  panel.querySelector("[data-xero-refresh]").addEventListener("click", refresh);
  panel
    .querySelector("[data-xero-select]")
    .addEventListener("click", async () => {
      try {
        await api({
          action: "select_organisation",
          tenant_id: organisation.value,
        });
        await refresh();
      } catch (e) {
        message.textContent = e.message;
      }
    });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const settings = Object.fromEntries(new FormData(form));
      settings.enabled = form.elements.enabled.checked;
      settings.stripe_ready = form.elements.stripe_ready.checked;
      await api({ action: "save_settings", settings });
      await refresh();
    } catch (error) {
      message.textContent = error.message;
    }
  });
  document
    .querySelector('[data-settings-tab="xero"]')
    ?.addEventListener("click", refresh);
  const callbackMessage = new URLSearchParams(location.search).get("xero");
  if (callbackMessage) {
    document.querySelector('[data-settings-tab="xero"]')?.click();
    message.textContent = callbackMessage;
  } else if (!panel.hidden && !panel.closest("[hidden]")) refresh();
})();
