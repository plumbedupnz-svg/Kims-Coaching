(function () {
  const endpoint = "/api/send-email";

  function logEmailFailure(type, error) {
    console.warn("Email send failed safely", {
      type,
      message: error?.message || String(error || "Unknown email error")
    });
  }

  async function sendEmail(type, payload = {}) {
    try {
      console.info("[Kim's Coaching email] API request starting", {
        traceId: payload.traceId,
        type,
        endpoint,
        recipient: payload.email || payload.customerEmail || payload.customer_email || ""
      });
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload }),
        keepalive: true
      });

      const result = await response.json().catch(() => ({}));
      console.info("[Kim's Coaching email] API response returned", {
        traceId: payload.traceId,
        type,
        httpStatus: response.status,
        ok: response.ok,
        result
      });
      if (!response.ok) {
        throw new Error(result.error || `Email endpoint returned ${response.status}`);
      }
      return {
        sent: Boolean(result.sent),
        status: result.status || (result.sent ? "sent" : result.testMode ? "test_mode" : "failed"),
        provider: result.provider || "unknown",
        error: result.error || result.reason || "",
        traceId: result.traceId || payload.traceId || "",
        logIds: result.logIds || []
      };
    } catch (error) {
      logEmailFailure(type, error);
      return {
        sent: false,
        status: "failed",
        provider: "unknown",
        error: error?.message || "Email failed",
        traceId: payload.traceId || ""
      };
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

  function generateICSInvite({ title, description, startTime, endTime, location = "Kim Jones Coaching" }) {
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "METHOD:REQUEST",
      "PRODID:-//Kim Jones Coaching//Notifications//EN",
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

  function withBookingIcs(payload = {}) {
    if (payload.ics || !payload.startTime || !payload.endTime) return payload;
    return {
      ...payload,
      ics: generateICSInvite({
        ...payload,
        title: payload.title || `Private lesson with ${payload.playerName || "player"}`,
        description: payload.description || payload.notes || ""
      })
    };
  }

  function sendAdminNotification(payload) {
    return sendEmail("admin_notification", payload);
  }

  function sendCustomerConfirmation(payload) {
    return sendEmail("customer_confirmation", payload);
  }

  function sendBookingConfirmation(payload) {
    return sendEmail("booking_customer_confirmation", withBookingIcs(payload));
  }

  function sendBookingAdminNotification(payload) {
    return sendEmail("booking_admin_notification", withBookingIcs(payload));
  }

  function sendBookingChangedEmail(payload) {
    return sendEmail("booking_changed", withBookingIcs(payload));
  }

  function sendBookingCancelledEmail(payload) {
    return sendEmail("booking_cancelled", withBookingIcs(payload));
  }

  function sendShopOrderCustomerConfirmation(payload) {
    return sendEmail("shop_order_customer_confirmation", payload);
  }

  function sendShopOrderAdminNotification(payload) {
    return sendEmail("shop_order_admin_notification", payload);
  }

  function sendProductEnquiryNotification(payload) {
    return sendEmail("product_enquiry_notification", payload);
  }

  function sendPurchaseOrderEmail(payload) {
    // TODO: Wire this to an admin purchase-order UI when supplier ordering is built.
    return sendEmail("purchase_order_email", payload);
  }

  function sendWaitlistNotification(payload) {
    return sendEmail("waitlist_notification", payload);
  }

  function sendWaitlistCustomerConfirmation(payload) {
    return sendEmail("waitlist_customer_confirmation", payload);
  }

  window.KimsEmailService = {
    sendEmail,
    sendAdminNotification,
    sendCustomerConfirmation,
    sendBookingConfirmation,
    sendBookingAdminNotification,
    sendBookingCustomerConfirmation: sendBookingConfirmation,
    sendBookingChangedEmail,
    sendBookingCancelledEmail,
    sendShopOrderCustomerConfirmation,
    sendShopOrderAdminNotification,
    sendProductAdminNotification: sendShopOrderAdminNotification,
    sendProductCustomerConfirmation: sendShopOrderCustomerConfirmation,
    sendProductEnquiryNotification,
    sendPurchaseOrderEmail,
    sendWaitlistNotification,
    sendWaitlistCustomerConfirmation,
    generateICSInvite,
    generateBookingICS: generateICSInvite
  };
})();
