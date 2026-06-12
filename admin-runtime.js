(function () {
  const isAdminPage = Boolean(document.getElementById("owner-panel"));
  if (!isAdminPage) return;

  function showAdminRuntimeError(error) {
    const statusEl = document.getElementById("owner-status");
    const panelEl = document.getElementById("owner-panel");
    const message = error?.message || String(error || "Unknown admin script error.");

    if (statusEl) {
      statusEl.textContent = `Admin page error: ${message}`;
      statusEl.classList.add("form-message");
      statusEl.dataset.tone = "error";
    }

    if (panelEl) panelEl.hidden = false;
  }

  window.KimsShowAdminRuntimeError = showAdminRuntimeError;

  window.addEventListener("error", (event) => {
    showAdminRuntimeError(event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    showAdminRuntimeError(event.reason);
  });
})();
