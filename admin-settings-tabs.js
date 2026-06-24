(function () {
  const tabs = Array.from(document.querySelectorAll("[data-settings-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-settings-panel]"));
  if (!tabs.length || !panels.length) return;

  const storageKey = "kims_admin_settings_tab";
  const validTabs = new Set(tabs.map((tab) => tab.dataset.settingsTab));

  function setActiveSettingsTab(tabName, { focus = false } = {}) {
    const activeTab = validTabs.has(tabName) ? tabName : tabs[0].dataset.settingsTab;

    tabs.forEach((tab) => {
      const isActive = tab.dataset.settingsTab === activeTab;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.setAttribute("tabindex", isActive ? "0" : "-1");
      if (focus && isActive) tab.focus();
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== activeTab;
    });

    sessionStorage.setItem(storageKey, activeTab);
  }

  tabs.forEach((tab, index) => {
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", () => setActiveSettingsTab(tab.dataset.settingsTab));
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (index + direction + tabs.length) % tabs.length;
      setActiveSettingsTab(tabs[nextIndex].dataset.settingsTab, { focus: true });
    });
  });

  setActiveSettingsTab(sessionStorage.getItem(storageKey) || "clubs");
})();
