(function () {
  const calendarEl = document.querySelector("[data-booking-calendar]");
  if (!calendarEl) return;

  let selectedDayKey = "";
  let isRenderingCompactView = false;

  function getDayKey(dayEl) {
    return [
      dayEl.querySelector("h3")?.textContent?.trim() || "",
      dayEl.querySelector(".booking-day-date")?.textContent?.trim() || ""
    ].join("|");
  }

  function renderCompactView() {
    if (isRenderingCompactView) return;
    const dayEls = Array.from(calendarEl.querySelectorAll(":scope > .booking-day"));
    if (!dayEls.length) return;

    const days = dayEls.map((dayEl) => {
      const title = dayEl.querySelector("h3")?.textContent?.trim() || "";
      const date = dayEl.querySelector(".booking-day-date")?.textContent?.trim() || "";
      const slots = Array.from(dayEl.querySelectorAll("[data-slot-id]"));
      return {
        key: getDayKey(dayEl),
        title,
        date,
        slots
      };
    });

    const firstAvailable = days.find((day) => day.slots.length);
    const selectedDay = days.find((day) => day.key === selectedDayKey && day.slots.length) || firstAvailable;
    selectedDayKey = selectedDay?.key || "";

    isRenderingCompactView = true;
    calendarEl.classList.add("compact-booking-calendar");
    calendarEl.innerHTML = `
      <div class="compact-date-grid" aria-label="Select lesson date">
        ${days.map((day) => `
          <button
            class="compact-date-button ${day.key === selectedDayKey ? "selected" : ""}"
            type="button"
            data-compact-day="${day.key}"
            ${day.slots.length ? "" : "disabled"}
          >
            <span>${day.title.slice(0, 3)}</span>
            <strong>${day.date.replace(/[^0-9]/g, "") || day.date}</strong>
            <small>${day.slots.length ? `${day.slots.length} times` : "No times"}</small>
          </button>
        `).join("")}
      </div>
      <div class="compact-time-panel">
        <h3>Available Times${selectedDay ? ` · ${selectedDay.title} ${selectedDay.date}` : ""}</h3>
        <div class="compact-time-grid">
          ${selectedDay?.slots.length ? selectedDay.slots.map((slot) => slot.outerHTML).join("") : '<p class="helper-text">No open times for this date.</p>'}
        </div>
      </div>
    `;
    isRenderingCompactView = false;
  }

  calendarEl.addEventListener("click", (event) => {
    const dayButton = event.target.closest("[data-compact-day]");
    if (!dayButton) return;
    selectedDayKey = dayButton.dataset.compactDay;
    renderCompactView();
  });

  new MutationObserver(renderCompactView).observe(calendarEl, { childList: true });
  renderCompactView();
})();
