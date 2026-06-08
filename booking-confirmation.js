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
    const storedStatus = booking.emailStatus || JSON.parse(sessionStorage.getItem("kims_last_email_status") || "null");
    const customerStatus = storedStatus?.customer?.status || "";
    const adminStatus = storedStatus?.admin?.status || "";
    const customerError = storedStatus?.customer?.error || "";
    const adminError = storedStatus?.admin?.error || "";
    const traceId = storedStatus?.customer?.traceId || storedStatus?.admin?.traceId || storedStatus?.payload?.traceId || "";
    const logIds = [
      ...(storedStatus?.customer?.logIds || []),
      ...(storedStatus?.admin?.logIds || [])
    ].filter(Boolean);
    const rootError = customerError || adminError;
    const calendarStatus = storedStatus?.calendarInvite || "";
    const emailCopy = customerStatus === "sent"
      ? "Confirmation email sent."
      : customerStatus === "test_mode"
        ? "Email pending/test mode."
        : customerStatus === "failed"
          ? `Email failed but booking saved.${rootError ? ` Error: ${rootError}` : ""}`
          : "Email status pending.";
    const adminCopy = adminStatus === "failed" && adminError
      ? `<p>Admin email error: ${escapeHtml(adminError)}</p>`
      : "";
    const traceCopy = traceId
      ? `<p>Email trace: ${escapeHtml(traceId)}${logIds.length ? ` · Log: ${escapeHtml(logIds.join(", "))}` : ""}</p>`
      : "";
    const calendarCopy = calendarStatus === "generated"
      ? customerStatus === "sent"
        ? "Calendar invite sent."
        : customerStatus === "test_mode"
          ? "Calendar invite pending/test mode."
          : "Calendar invite generated."
      : "Calendar invite pending.";
    confirmationEl.innerHTML = `
      <strong>Your private lesson request has been booked.</strong>
      <p>Date: ${startTime ? formatter.format(startTime) : "Private lesson"}</p>
      <p>Start time: ${startTime ? timeFormatter.format(startTime) : ""}</p>
      <p>Duration: ${escapeHtml(booking.duration || "")} minutes</p>
      <p>Player: ${escapeHtml(booking.playerName || "")}</p>
      <p>Coach: Kim Jones</p>
      <p>${escapeHtml(emailCopy)}</p>
      ${adminCopy}
      ${traceCopy}
      <p>${escapeHtml(calendarCopy)}</p>
    `;
  }

  renderConfirmation();
})();
