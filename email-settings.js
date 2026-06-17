(function () {
  const formEl = document.querySelector("[data-email-settings-form]");
  const messageEl = document.querySelector("[data-email-settings-message]");
  const diagnosticsListEl = document.querySelector("[data-email-diagnostics-list]");
  const diagnosticsMessageEl = document.querySelector("[data-email-diagnostics-message]");
  const smtpTestButton = document.querySelector("[data-email-test-smtp]");
  const refreshDiagnosticsButton = document.querySelector("[data-email-refresh-diagnostics]");
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

  function setDiagnosticsMessage(message, tone = "neutral") {
    if (!diagnosticsMessageEl) return;
    diagnosticsMessageEl.textContent = message;
    diagnosticsMessageEl.dataset.tone = tone;
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function yesNo(value) {
    return value ? "Yes" : "No";
  }

  function renderDiagnosticRow(label, value) {
    return `
      <div class="admin-data-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || "Not available")}</strong>
      </div>
    `;
  }

  function renderDiagnostics(data = {}) {
    if (!diagnosticsListEl) return;
    const smtp = data.smtp || {};
    const logging = data.supabaseLogging || {};
    const lastLog = data.lastLog || {};
    const missing = smtp.missing?.length ? smtp.missing.join(", ") : "None";
    diagnosticsListEl.innerHTML = [
      renderDiagnosticRow("Current mode", data.mode || "Unknown"),
      renderDiagnosticRow("Provider detected", data.provider || "Unknown"),
      renderDiagnosticRow("Provider enabled", yesNo(data.settingsEnabled)),
      renderDiagnosticRow("SMTP configured", yesNo(smtp.configured)),
      renderDiagnosticRow("SMTP host", smtp.host || ""),
      renderDiagnosticRow("SMTP port", smtp.port ? String(smtp.port) : ""),
      renderDiagnosticRow("SMTP username set", yesNo(smtp.hasUsername)),
      renderDiagnosticRow("SMTP password set", yesNo(smtp.hasPassword)),
      renderDiagnosticRow("Missing SMTP/env vars", missing),
      renderDiagnosticRow("Notification logging configured", yesNo(logging.configured)),
      renderDiagnosticRow("Last email attempt", lastLog.created_at ? `${lastLog.notification_type || "email"} · ${lastLog.status || ""} · ${lastLog.created_at}` : "No attempts logged"),
      renderDiagnosticRow("Last email error", lastLog.error_message || data.settingsError || "None")
    ].join("");
  }

  async function loadDiagnostics() {
    if (!diagnosticsListEl) return;
    if (!(await ensureAdminSession())) {
      diagnosticsListEl.innerHTML = '<p class="helper-text">Diagnostics could not confirm your admin session.</p>';
      setDiagnosticsMessage("Diagnostics could not confirm your admin session. Sign out and back in, then try again.", "error");
      return;
    }
    try {
      setDiagnosticsMessage("Refreshing diagnostics...", "neutral");
      const response = await fetch("/api/send-email", {
        headers: await getAdminAuthHeaders()
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Diagnostics returned ${response.status}`);
      renderDiagnostics(data);
      setDiagnosticsMessage("", "neutral");
    } catch (error) {
      diagnosticsListEl.innerHTML = '<p class="helper-text">Could not load email diagnostics.</p>';
      const message = normalizeDiagnosticsError(error?.message || "Could not load email diagnostics.");
      setDiagnosticsMessage(message, "error");
    }
  }

  async function testSmtpConnection() {
    if (!smtpTestButton) return;
    if (!(await ensureAdminSession())) {
      setDiagnosticsMessage("Diagnostics could not confirm your admin session. Sign out and back in, then try again.", "error");
      return;
    }
    smtpTestButton.disabled = true;
    if (refreshDiagnosticsButton) refreshDiagnosticsButton.disabled = true;
    setDiagnosticsMessage("Testing SMTP connection...", "neutral");
    try {
      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAdminAuthHeaders()) },
        body: JSON.stringify({ action: "test_smtp" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `SMTP test returned ${response.status}`);
      renderDiagnostics(data);
      const test = data.connectionTest || {};
      if (test.status === "success") {
        setDiagnosticsMessage("SMTP connection test passed.", "success");
      } else if (test.status === "skipped") {
        setDiagnosticsMessage(test.error || "SMTP test skipped.", "neutral");
      } else {
        setDiagnosticsMessage(normalizeDiagnosticsError(test.error || "SMTP connection test failed."), "error");
      }
    } catch (error) {
      setDiagnosticsMessage(normalizeDiagnosticsError(error?.message || "SMTP connection test failed."), "error");
    } finally {
      smtpTestButton.disabled = false;
      if (refreshDiagnosticsButton) refreshDiagnosticsButton.disabled = false;
    }
  }

  function normalizeDiagnosticsError(message = "") {
    if (/authenticated admin session|verify admin diagnostics|diagnostics access|admin users only/i.test(message)) {
      return "Diagnostics could not confirm your admin session. Sign out and back in, then try again.";
    }
    return message;
  }

  function applySettings(data = {}) {
    if (!formEl) return;
    formEl.elements.provider.value = data.provider || "disabled";
    formEl.elements.from_name.value = data.from_name || "Kim Jones Coaching";
    formEl.elements.from_email.value = data.from_email || "kimjonescoaching@outlook.com";
    formEl.elements.reply_to_email.value = data.reply_to_email || "kimjonescoaching@outlook.com";
    formEl.elements.enabled.checked = Boolean(data.enabled);
  }

  async function ensureAdminSession() {
    if (!client) return false;
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) return false;
    const user = sessionData?.session?.user;
    if (!user) return false;
    const { data: profile, error: profileError } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profileError) return false;
    return profile?.role === "admin";
  }

  async function getAdminAuthHeaders() {
    if (!client) return {};
    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadSettings() {
    if (!formEl) return;
    if (!client) {
      setMessage("Supabase is not configured. Email settings cannot be saved yet.", "error");
      return;
    }
    if (!(await ensureAdminSession())) {
      setMessage("Only admin users can load email settings. Sign out and back in, then try again.", "error");
      await loadDiagnostics();
      return;
    }

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
    await loadDiagnostics();
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
    await loadDiagnostics();
  }

  formEl?.addEventListener("submit", saveSettings);
  smtpTestButton?.addEventListener("click", testSmtpConnection);
  refreshDiagnosticsButton?.addEventListener("click", loadDiagnostics);
  loadSettings();
})();
