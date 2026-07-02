(function () {
  const tabs = Array.from(document.querySelectorAll("[data-booking-mode-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-booking-mode-panel]"));
  const links = Array.from(document.querySelectorAll("[data-booking-mode-link]"));

  if (!tabs.length || !panels.length) return;

  function modeFromHash() {
    const hash = window.location.hash.replace("#", "");
    if (hash === "junior-group-coaching") return "junior";
    return "adult";
  }

  function setMode(mode, options = {}) {
    const activeMode = mode === "junior" ? "junior" : "adult";

    tabs.forEach((tab) => {
      const isActive = tab.dataset.bookingModeTab === activeMode;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.bookingModePanel !== activeMode;
    });

    if (options.updateHash) {
      const nextHash = activeMode === "junior" ? "junior-group-coaching" : "calendar";
      if (window.location.hash.replace("#", "") !== nextHash) {
        history.replaceState(null, "", `#${nextHash}`);
      }
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setMode(tab.dataset.bookingModeTab, { updateHash: true });
    });
  });

  links.forEach((link) => {
    link.addEventListener("click", () => {
      setMode(link.dataset.bookingModeLink, { updateHash: true });
    });
  });

  window.addEventListener("hashchange", () => setMode(modeFromHash()));
  setMode(modeFromHash());
})();
