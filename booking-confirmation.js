(function () {
  const confirmationEl = document.querySelector("[data-booking-confirmation]");
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderConfirmation() {
    if (!confirmationEl) return;
    const raw = sessionStorage.getItem("kims_last_booking_confirmation");
    if (!raw) {
      confirmationEl.innerHTML = "<p>Your booking has been saved. Open My Account to view the latest details.</p>";
      return;
    }

    let booking = {};
    try {
      booking = JSON.parse(raw);
    } catch {
      confirmationEl.innerHTML = "<p>Your booking has been saved. Open My Account to view the latest details.</p>";
      return;
    }
    const startTime = booking.startTime ? new Date(booking.startTime) : null;
    confirmationEl.innerHTML = `
      <strong>Your private lesson request has been booked.</strong>
      <p>Date: ${startTime ? formatter.format(startTime) : "Private lesson"}</p>
      <p>Start time: ${startTime ? timeFormatter.format(startTime) : ""}</p>
      <p>Duration: ${escapeHtml(booking.duration || "")} minutes</p>
      <p>Player: ${escapeHtml(booking.playerName || "")}</p>
      <p>Coach: Kim Jones</p>
    `;
  }

  renderConfirmation();
})();
