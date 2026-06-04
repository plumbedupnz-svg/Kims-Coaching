(function () {
  const endpoint = "/api/send-email";

  function logEmailFailure(type, error) {
    console.warn("Email send failed", {
      type,
      message: error?.message || String(error || "Unknown email error")
    });
  }

  async function sendEmail(type, payload = {}) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload }),
        keepalive: true
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Email endpoint returned ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      logEmailFailure(type, error);
      return { sent: false, error: error?.message || "Email failed" };
    }
  }

  function escapeIcsText(value = "") {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }

  function formatIcsDate(value) {
    return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  function generateBookingICS({ title, description, startTime, endTime, location = "Kim Jones Coaching" }) {
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Kim Jones Coaching//Bookings//EN",
      "BEGIN:VEVENT",
      `UID:${window.crypto?.randomUUID?.() || Date.now()}@kimjonescoaching`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(startTime)}`,
      `DTEND:${formatIcsDate(endTime)}`,
      `SUMMARY:${escapeIcsText(title || "Private tennis lesson")}`,
      `DESCRIPTION:${escapeIcsText(description || "")}`,
      `LOCATION:${escapeIcsText(location)}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
  }

  function sendBookingAdminNotification(payload) {
    return sendEmail("booking_admin_notification", {
      ...payload,
      ics: payload.ics || (payload.startTime && payload.endTime ? generateBookingICS(payload) : "")
    });
  }

  function sendBookingCustomerConfirmation(payload) {
    return sendEmail("booking_customer_confirmation", {
      ...payload,
      ics: payload.ics || (payload.startTime && payload.endTime ? generateBookingICS(payload) : "")
    });
  }

  function sendProductAdminNotification(payload) {
    return sendEmail("product_admin_notification", payload);
  }

  function sendProductCustomerConfirmation(payload) {
    return sendEmail("product_customer_confirmation", payload);
  }

  window.KimsEmailService = {
    sendBookingAdminNotification,
    sendBookingCustomerConfirmation,
    sendProductAdminNotification,
    sendProductCustomerConfirmation,
    generateBookingICS
  };
})();
