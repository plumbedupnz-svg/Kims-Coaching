(function () {
  const settings = window.KIMS_SUPABASE || {};
  const statusEl = document.querySelector("[data-coach-access-status]");
  const resourcesEl = document.querySelector("[data-coach-resources]");
  const adminReturnEl = document.querySelector("[data-admin-return]");
  const signOutEl = document.querySelector("[data-coach-sign-out]");
  const printEl = document.querySelector("[data-print-manual]");

  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  function setStatus(message, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (tone) statusEl.dataset.tone = tone;
    else statusEl.removeAttribute("data-tone");
  }

  async function load() {
    if (!client) {
      setStatus("Coach Resources is not configured yet.", "error");
      return;
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      setStatus("Could not check your login. Please log in again.", "error");
      return;
    }

    const session = sessionData?.session;
    if (!session?.user || !session?.access_token) {
      window.location.replace("/account");
      return;
    }

    const response = await fetch("/api/coach-resource-access", {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const access = await response.json().catch(() => ({}));

    if (!response.ok || !access.allowed) {
      setStatus(access.error || "This resource area is available to active coaches and admins only.", "error");
      return;
    }

    if (adminReturnEl) adminReturnEl.hidden = !access.admin;
    if (statusEl) statusEl.hidden = true;
    if (resourcesEl) resourcesEl.hidden = false;
  }

  signOutEl?.addEventListener("click", async () => {
    if (client) await client.auth.signOut();
    window.location.replace("/account");
  });

  printEl?.addEventListener("click", () => window.print());

  load().catch((error) => {
    console.error(error);
    setStatus("Could not load Coach Resources. Please try again.", "error");
  });
})();
