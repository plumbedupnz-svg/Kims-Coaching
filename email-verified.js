(function () {
  const settings = window.KIMS_SUPABASE || {};
  const statusEl = document.querySelector("[data-email-verified-status]");
  const accountLinkEl = document.querySelector("[data-email-account-link]");
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  function setStatus(message, tone = "neutral") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  }

  function setAccountHref(session) {
    if (!accountLinkEl) return;
    accountLinkEl.href = session?.user ? "account.html#customer-account" : "account.html";
  }

  async function finishVerification() {
    if (!client) {
      setStatus("Account verified. Log in to continue.", "success");
      setAccountHref(null);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn("Could not exchange verification code.", error.message);
        setStatus("Email verified. Please log in to continue.", "success");
      }
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
      console.warn("Could not load verified session.", error.message);
      setStatus("Email verified. Please log in to continue.", "success");
      setAccountHref(null);
      return;
    }

    const session = data?.session || null;
    setAccountHref(session);
    setStatus(
      session ? "You are signed in and ready to continue." : "Email verified. Please log in to continue.",
      "success"
    );
  }

  finishVerification();
})();
