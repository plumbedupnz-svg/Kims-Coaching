(function () {
  function notifyAdminOfNewBooking(payload) {
    console.info("Admin booking notification placeholder", payload);
    return Promise.resolve({ queued: false, payload });
  }

  function generateCalendarInviteData({ title, description, startTime, endTime, location = "Kim Jones Coaching" }) {
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
    smsReminderNotes
  };
})();
