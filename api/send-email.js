const defaultEmailSettings = {
  provider: "disabled",
  from_name: "Kim Jones Coaching",
  from_email: "kimjonescoaching@outlook.com",
  reply_to_email: "kimjonescoaching@outlook.com",
  enabled: false
};

const adminTypes = new Set([
  "admin_notification",
  "booking_admin_notification",
  "shop_order_admin_notification",
  "product_admin_notification",
  "product_enquiry_notification",
  "purchase_order_email",
  "waitlist_notification",
  "admin_alert"
]);

function normalizeProvider(value = "") {
  const provider = String(value || "disabled").toLowerCase();
  if (provider === "outlook") return "outlook_smtp";
  if (provider === "test") return "disabled";
  return provider;
}

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

async function loadEmailSettings() {
  const { url: supabaseUrl, serviceRoleKey } = getSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ...defaultEmailSettings,
      provider: normalizeProvider(process.env.EMAIL_PROVIDER),
      from_name: process.env.EMAIL_FROM_NAME || defaultEmailSettings.from_name,
      from_email: process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USERNAME || defaultEmailSettings.from_email,
      reply_to_email: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM_ADDRESS || defaultEmailSettings.reply_to_email,
      enabled: normalizeProvider(process.env.EMAIL_PROVIDER) !== "disabled"
    };
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/email_settings?select=*&limit=1`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!response.ok) throw new Error(`Could not load email_settings: ${response.status}`);
  const rows = await response.json();
  return { ...defaultEmailSettings, ...(rows?.[0] || {}) };
}

function fromHeader(settings) {
  return `${settings.from_name || defaultEmailSettings.from_name} <${settings.from_email || defaultEmailSettings.from_email}>`;
}

function getCustomerEmail(payload = {}) {
  return payload.email || payload.customerEmail || payload.customer_email || "";
}

function getRecipients(type, payload = {}, settings = defaultEmailSettings) {
  const adminEmail = process.env.EMAIL_ADMIN_TO || settings.reply_to_email || settings.from_email;
  if (adminTypes.has(type)) return [adminEmail].filter(Boolean);
  return [getCustomerEmail(payload)].filter(Boolean);
}

function getSubject(type, payload = {}) {
  const playerName = payload.playerName || payload.player_name || "player";
  const customerName = payload.customerName || payload.customer_name || "customer";
  const productName = payload.productName || payload.product_name || payload.items?.[0]?.name || "shop item";

  const subjects = {
    admin_notification: "Kim Jones Coaching admin alert",
    admin_alert: "Kim Jones Coaching admin alert",
    booking_admin_notification: `New private lesson booking: ${playerName}`,
    booking_customer_confirmation: "Your private lesson request has been booked",
    booking_changed: "Your Kim Jones Coaching booking has been updated",
    booking_cancelled: "Your Kim Jones Coaching booking has been cancelled",
    shop_order_admin_notification: `New shop order from ${customerName}`,
    shop_order_customer_confirmation: "Your Kim Jones Coaching shop order",
    product_admin_notification: `New shop order from ${customerName}`,
    product_customer_confirmation: "Your Kim Jones Coaching shop order",
    product_enquiry_notification: `Product enquiry: ${productName}`,
    purchase_order_email: `Purchase order: ${productName}`,
    waitlist_notification: `New waitlist request from ${customerName}`,
    waitlist_customer_confirmation: "Kim Jones Coaching waitlist request received"
  };

  return subjects[type] || "Kim Jones Coaching notification";
}

function line(label, value) {
  return `${label}: ${value || ""}`;
}

function renderBookingText(title, payload = {}) {
  return [
    title,
    "",
    line("Customer", payload.customerName || payload.customer_name),
    line("Player", payload.playerName || payload.player_name),
    line("Email", getCustomerEmail(payload)),
    line("Mobile", payload.mobile),
    line("Start", payload.startTime || payload.dateTime),
    line("End", payload.endTime),
    line("Duration", payload.durationMinutes ? `${payload.durationMinutes} minutes` : ""),
    line("Player level", payload.playerLevel || payload.player_level),
    line("Status", payload.bookingStatus || payload.booking_status),
    line("Notes", payload.notes)
  ].join("\n");
}

function renderItems(payload = {}) {
  if (Array.isArray(payload.items)) {
    return payload.items
      .map((item) => `- ${item.name || item.product_name || "Product"} x ${item.quantity || 1} (${item.category || "Uncategorized"}) ${item.price || ""}`)
      .join("\n");
  }
  return [
    payload.productName || payload.product_name ? line("Product", payload.productName || payload.product_name) : "",
    payload.category ? line("Category", payload.category) : "",
    payload.price ? line("Price", payload.price) : "",
    payload.quantity ? line("Quantity", payload.quantity) : ""
  ].filter(Boolean).join("\n");
}

function renderShopText(title, payload = {}) {
  return [
    title,
    "",
    line("Customer", payload.customerName || payload.customer_name),
    line("Email", getCustomerEmail(payload)),
    line("Mobile", payload.mobile),
    line("Order status", payload.orderStatus || payload.order_status),
    "",
    renderItems(payload),
    "",
    line("Subtotal", payload.subtotal),
    line("Total", payload.total),
    line("Notes", payload.notes)
  ].join("\n");
}

function renderText(type, payload = {}) {
  if (type === "booking_admin_notification") return renderBookingText("New Kim Jones Coaching private lesson booking", payload);
  if (type === "booking_customer_confirmation") return renderBookingText("Your private lesson request has been booked", payload);
  if (type === "booking_changed") return renderBookingText("Your Kim Jones Coaching booking has been updated", payload);
  if (type === "booking_cancelled") return renderBookingText("Your Kim Jones Coaching booking has been cancelled", payload);
  if (type === "waitlist_notification") return renderBookingText("New waitlist request", payload);
  if (type === "waitlist_customer_confirmation") return renderBookingText("Your waitlist request has been received", payload);
  if (type === "purchase_order_email") return renderShopText("Kim Jones Coaching purchase order", payload);
  if (type === "product_enquiry_notification") return renderShopText("Kim Jones Coaching product enquiry", payload);
  if (type.includes("shop_order") || type.includes("product_")) return renderShopText("Kim Jones Coaching shop notification", payload);
  return [
    "Kim Jones Coaching notification",
    "",
    JSON.stringify({ ...payload, ics: payload.ics ? "[calendar invite omitted from log text]" : undefined }, null, 2)
  ].join("\n");
}

function getMissingEnv(provider) {
  if (provider === "outlook_smtp") {
    return ["SMTP_USERNAME", "SMTP_PASSWORD"].filter((key) => !process.env[key]);
  }
  if (provider === "resend") {
    return ["RESEND_API_KEY"].filter((key) => !process.env[key]);
  }
  return [];
}

async function logNotification({ type, recipient, relatedType, relatedId, status, provider, errorMessage }) {
  const { url: supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  if (!supabaseUrl || !serviceRoleKey) return;

  try {
    await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/notification_logs`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        notification_type: type || "unknown",
        recipient_email: recipient || null,
        related_type: relatedType || null,
        related_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(relatedId || "") ? relatedId : null,
        status,
        provider,
        error_message: errorMessage || null
      })
    });
  } catch (error) {
    console.error("Notification log failed safely", { message: error?.message || String(error) });
  }
}

async function logForRecipients(type, recipients, payload, status, provider, errorMessage = "") {
  await Promise.all((recipients.length ? recipients : [""]).map((recipient) => logNotification({
    type,
    recipient,
    relatedType: payload.relatedType,
    relatedId: payload.relatedId,
    status,
    provider,
    errorMessage
  })));
}

async function sendWithResend(message, settings) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromHeader(settings),
      to: message.to,
      reply_to: settings.reply_to_email,
      subject: message.subject,
      text: message.text,
      attachments: message.ics
        ? [{ filename: "private-lesson.ics", content: Buffer.from(message.ics).toString("base64") }]
        : undefined
    })
  });

  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
  return response.json();
}

async function sendWithSmtp(message) {
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.office365.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USERNAME,
      pass: process.env.SMTP_PASSWORD
    }
  });

  return transporter.sendMail({
    from: fromHeader(message.settings),
    to: message.to,
    replyTo: message.settings.reply_to_email,
    subject: message.subject,
    text: message.text,
    attachments: message.ics
      ? [{ filename: "private-lesson.ics", content: message.ics, contentType: "text/calendar; method=REQUEST" }]
      : []
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { type = "admin_notification", payload = {} } = req.body || {};
  let settings = defaultEmailSettings;
  let provider = "disabled";
  const to = [];

  try {
    settings = await loadEmailSettings();
    provider = normalizeProvider(settings.provider);
    to.push(...getRecipients(type, payload, settings));

    if (!to.length) {
      await logForRecipients(type, to, payload, "skipped", provider, "No recipient configured");
      res.status(200).json({ sent: false, status: "skipped", reason: "No recipient configured" });
      return;
    }

    if (!settings.enabled || provider === "disabled") {
      console.info("Email disabled/test mode", { type, to });
      await logForRecipients(type, to, payload, "test_mode", provider);
      res.status(200).json({ sent: false, status: "test_mode", provider });
      return;
    }

    const missingEnv = getMissingEnv(provider);
    if (missingEnv.length) {
      const message = `Missing Vercel email environment variables: ${missingEnv.join(", ")}`;
      await logForRecipients(type, to, payload, "failed", provider, message);
      res.status(200).json({ sent: false, status: "failed", provider, error: message });
      return;
    }

    const message = {
      to,
      settings,
      subject: getSubject(type, payload),
      text: renderText(type, payload),
      ics: payload.ics || ""
    };

    if (provider === "resend") {
      await sendWithResend(message, settings);
    } else if (provider === "outlook_smtp") {
      await sendWithSmtp(message);
    } else if (provider === "sendgrid" || provider === "mailgun") {
      const placeholderMessage = `${provider} is a placeholder provider. Configure Outlook SMTP or Resend to send live emails.`;
      await logForRecipients(type, to, payload, "failed", provider, placeholderMessage);
      res.status(200).json({ sent: false, status: "failed", provider, error: placeholderMessage });
      return;
    } else {
      const unknownMessage = `Unknown email provider: ${provider}`;
      await logForRecipients(type, to, payload, "failed", provider, unknownMessage);
      res.status(200).json({ sent: false, status: "failed", provider, error: unknownMessage });
      return;
    }

    await logForRecipients(type, to, payload, "sent", provider);
    res.status(200).json({ sent: true, status: "sent", provider });
  } catch (error) {
    const safeMessage = error?.message || "Email failed safely";
    console.error("Email failed safely", { type, provider, message: safeMessage });
    await logForRecipients(type, to, payload, "failed", provider, safeMessage);
    res.status(200).json({ sent: false, status: "failed", provider, error: safeMessage });
  }
};
