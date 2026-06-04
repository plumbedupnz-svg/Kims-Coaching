(function () {
  function notifyAdminOfNewBooking(payload) {
    const emailPayload = {
      ...payload,
      title: `Private lesson with ${payload.playerName || "player"}`,
      startTime: payload.startTime || payload.dateTime,
      endTime: payload.endTime,
      description: payload.notes || ""
    };

    return Promise.allSettled([
      window.KimsEmailService?.sendBookingAdminNotification(emailPayload),
      window.KimsEmailService?.sendBookingCustomerConfirmation(emailPayload)
    ]).then((results) => ({ queued: true, payload, results }));
  }

  function generateCalendarInviteData({ title, description, startTime, endTime, location = "Kim Jones Coaching" }) {
    if (window.KimsEmailService?.generateBookingICS) {
      return window.KimsEmailService.generateBookingICS({ title, description, startTime, endTime, location });
    }

    const formatDate = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Kim Jones Coaching//Private Lessons//EN",
      "BEGIN:VEVENT",
      `UID:${window.crypto?.randomUUID?.() || Date.now()}@kimjonescoaching`,
      `DTSTAMP:${formatDate(new Date())}`,
      `DTSTART:${formatDate(startTime)}`,
      `DTEND:${formatDate(endTime)}`,
      `SUMMARY:${title || "Private tennis lesson"}`,
      `DESCRIPTION:${description || ""}`,
      `LOCATION:${location}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
  }

  const smsReminderNotes = {
    provider: "Future SMS provider placeholder",
    implementationNote: "Add Twilio or another SMS provider from a server-side function so customer mobile numbers are not exposed."
  };

  window.KimsBookingServices = {
    notifyAdminOfNewBooking,
    generateCalendarInviteData,
    sendBookingAdminNotification: (payload) => window.KimsEmailService?.sendBookingAdminNotification(payload),
    sendBookingCustomerConfirmation: (payload) => window.KimsEmailService?.sendBookingCustomerConfirmation(payload),
    smsReminderNotes
  };
})();
