(function () {
  const formEl = document.querySelector("[data-email-settings-form]");
  const messageEl = document.querySelector("[data-email-settings-message]");
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;
  let settingsId = null;

  function setMessage(message, tone = "neutral") {
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.dataset.tone = tone;
  }

  function applySettings(data = {}) {
    if (!formEl) return;
    formEl.elements.provider.value = data.provider || "disabled";
    formEl.elements.from_name.value = data.from_name || "Kim Jones Coaching";
    formEl.elements.from_email.value = data.from_email || "kimjonescoaching@outlook.com";
    formEl.elements.reply_to_email.value = data.reply_to_email || "kimjonescoaching@outlook.com";
    formEl.elements.smtp_host.value = data.smtp_host || "smtp.office365.com";
    formEl.elements.smtp_port.value = data.smtp_port || 587;
    formEl.elements.smtp_username.value = data.smtp_username || "kimjonescoaching@outlook.com";
    formEl.elements.enabled.checked = Boolean(data.enabled);
  }

  async function ensureAdminSession() {
    if (!client) return false;
    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return false;
    const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
    return profile?.role === "admin";
  }

  async function loadSettings() {
    if (!formEl) return;
    if (!client) {
      setMessage("Supabase is not configured. Email settings cannot be saved yet.", "error");
      return;
    }
    if (!(await ensureAdminSession())) return;

    const { data, error } = await client
      .from("email_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (error) {
      setMessage(`Could not load email settings: ${error.message}`, "error");
      return;
    }

    if (data) {
      settingsId = data.id;
      applySettings(data);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!client || !formEl) return;
    if (!(await ensureAdminSession())) {
      setMessage("Only admin users can save email settings.", "error");
      return;
    }

    const formData = new FormData(formEl);
    const payload = {
      provider: formData.get("provider") || "disabled",
      from_name: formData.get("from_name")?.trim() || "Kim Jones Coaching",
      from_email: formData.get("from_email")?.trim() || "kimjonescoaching@outlook.com",
      reply_to_email: formData.get("reply_to_email")?.trim() || "kimjonescoaching@outlook.com",
      smtp_host: formData.get("smtp_host")?.trim() || "smtp.office365.com",
      smtp_port: Number(formData.get("smtp_port") || 587),
      smtp_username: formData.get("smtp_username")?.trim() || "",
      encrypted_secret_placeholder: "Secrets are stored in Vercel environment variables.",
      enabled: formData.get("enabled") === "on"
    };

    setMessage("Saving email settings...", "neutral");

    const query = settingsId
      ? client.from("email_settings").update(payload).eq("id", settingsId).select().single()
      : client.from("email_settings").insert(payload).select().single();
    const { data, error } = await query;

    if (error) {
      setMessage(`Could not save email settings: ${error.message}`, "error");
      return;
    }

    settingsId = data.id;
    applySettings(data);
    setMessage("Email settings saved. Add real secrets in Vercel environment variables before enabling live sending.", "success");
  }

  formEl?.addEventListener("submit", saveSettings);
  loadSettings();
})();
