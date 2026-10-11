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

    const user = sessionData?.session?.user;
    if (!user) {
      window.location.replace("/account");
      return;
    }

    const [{ data: profile }, { data: canAccess, error: accessError }] = await Promise.all([
      client.from("profiles").select("role").eq("id", user.id).single(),
      client.rpc("current_user_is_coach")
    ]);

    if (accessError) {
      setStatus("Coach access is still being configured. Please try again shortly.", "error");
      return;
    }

    const isAdmin = profile?.role === "admin";
    if (!isAdmin && !canAccess) {
      setStatus("This resource area is available to linked coaches and admins only.", "error");
      return;
    }

    if (adminReturnEl) adminReturnEl.hidden = !isAdmin;
    setStatus("");
    if (statusEl) statusEl.hidden = true;
    if (resourcesEl) resourcesEl.hidden = false;
  }

  signOutEl?.addEventListener("click", async () => {
    if (client) await client.auth.signOut();
    window.location.replace("/account");
  });

  printEl?.addEventListener("click", () => window.print());

  load();
})();
