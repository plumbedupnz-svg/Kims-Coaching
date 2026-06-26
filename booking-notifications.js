(function () {
  function notifyAdminOfNewBooking(payload) {
    console.info("[Kim's Coaching booking email] notifyAdminOfNewBooking called", {
      traceId: payload.traceId,
      relatedId: payload.relatedId,
      customerEmail: payload.email
    });
    const emailPayload = {
      ...payload,
      title: `Coaching with ${payload.playerName || "player"}`,
      startTime: payload.startTime || payload.dateTime,
      endTime: payload.endTime,
      description: payload.notes || ""
    };

    console.info("[Kim's Coaching booking email] booking email calls starting", {
      traceId: payload.traceId,
      hasEmailService: Boolean(window.KimsEmailService),
      customerEmail: emailPayload.email
    });
    return Promise.allSettled([
      window.KimsEmailService?.sendBookingAdminNotification(emailPayload),
      window.KimsEmailService?.sendBookingConfirmation(emailPayload)
    ]).then((results) => {
      const [adminResult, customerResult] = results.map((result) => result.status === "fulfilled" ? result.value : { status: "failed", error: result.reason?.message || "Email failed" });
      console.info("[Kim's Coaching booking email] booking email calls finished", {
        traceId: payload.traceId,
        adminResult,
        customerResult
      });
      const emailStatus = {
        queued: true,
        payload,
        admin: adminResult || { status: "skipped" },
        customer: customerResult || { status: "skipped" },
        calendarInvite: emailPayload.ics || window.KimsEmailService?.generateICSInvite?.(emailPayload) ? "generated" : "not_available"
      };
      sessionStorage.setItem("kims_last_email_status", JSON.stringify(emailStatus));
      return emailStatus;
    });
  }

  function generateCalendarInviteData({ title, description, startTime, endTime, location = "Kim Jones Coaching" }) {
    if (window.KimsEmailService?.generateBookingICS) {
      return window.KimsEmailService.generateBookingICS({ title, description, startTime, endTime, location });
    }

    const formatDate = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Kim Jones Coaching//Coaching//EN",
      "BEGIN:VEVENT",
      `UID:${window.crypto?.randomUUID?.() || Date.now()}@kimjonescoaching`,
      `DTSTAMP:${formatDate(new Date())}`,
      `DTSTART:${formatDate(startTime)}`,
      `DTEND:${formatDate(endTime)}`,
      `SUMMARY:${title || "Coaching session"}`,
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
