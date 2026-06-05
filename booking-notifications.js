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
      window.KimsEmailService?.sendBookingConfirmation(emailPayload)
    ]).then((results) => {
      const [adminResult, customerResult] = results.map((result) => result.status === "fulfilled" ? result.value : { status: "failed", error: result.reason?.message || "Email failed" });
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

  async function getCurrentUserEmail() {
    const settings = window.KIMS_SUPABASE || {};
    if (!settings.url || !settings.anonKey || !window.supabase) return "";
    const client = window.supabase.createClient(settings.url, settings.anonKey);
    const { data } = await client.auth.getSession();
    return data?.session?.user?.email || "";
  }

  async function handleWaitlistRequest(event) {
    const link = event.target.closest('a[href^="mailto:"][href*="waitlist"]');
    if (!link || !window.KimsEmailService) return;
    event.preventDefault();
    const email = await getCurrentUserEmail();
    const payload = {
      relatedType: "waitlist",
      customerName: email || "Website visitor",
      email,
      notes: "Customer clicked the private lesson waitlist/request-a-time link."
    };
    await Promise.allSettled([
      window.KimsEmailService.sendWaitlistNotification(payload),
      email ? window.KimsEmailService.sendWaitlistCustomerConfirmation(payload) : Promise.resolve({ status: "skipped" })
    ]);
    window.location.href = link.href;
  }

  document.addEventListener("click", handleWaitlistRequest, true);

  window.KimsBookingServices = {
    notifyAdminOfNewBooking,
    generateCalendarInviteData,
    sendBookingAdminNotification: (payload) => window.KimsEmailService?.sendBookingAdminNotification(payload),
    sendBookingCustomerConfirmation: (payload) => window.KimsEmailService?.sendBookingCustomerConfirmation(payload),
    smsReminderNotes
  };
})();
