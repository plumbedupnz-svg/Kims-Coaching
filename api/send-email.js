const nodemailer = require("nodemailer");

const defaultEmailSettings = {
  provider: "disabled",
  from_name: "Kim Jones Coaching",
  from_email: "kimjonescoaching@outlook.com",
  reply_to_email: "kimjonescoaching@outlook.com",
  enabled: false
};

async function loadEmailSettings() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ...defaultEmailSettings,
      provider: (process.env.EMAIL_PROVIDER || "disabled").toLowerCase(),
      from_name: process.env.EMAIL_FROM_NAME || defaultEmailSettings.from_name,
      from_email: process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USERNAME || defaultEmailSettings.from_email,
      reply_to_email: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM_ADDRESS || defaultEmailSettings.reply_to_email,
      enabled: (process.env.EMAIL_PROVIDER || "disabled").toLowerCase() !== "disabled"
    };
  }

  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/email_settings?select=*&limit=1`;
  const response = await fetch(url, {
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
  return `${settings.from_name} <${settings.from_email}>`;
}

function safeLogEmailFailure(type, provider, error) {
  console.error("Email failed safely", {
    type,
    provider,
    message: error?.message || String(error || "Unknown error")
  });
}

function getRecipients(type, payload = {}, settings = defaultEmailSettings) {
  const adminEmail = process.env.EMAIL_ADMIN_TO || settings.reply_to_email || settings.from_email;
  const customerEmail = payload.email || payload.customerEmail;

  if (type.includes("admin")) return [adminEmail].filter(Boolean);
  return [customerEmail].filter(Boolean);
}

function getSubject(type, payload = {}) {
  const playerName = payload.playerName || payload.player_name || "player";
  const customerName = payload.customerName || payload.customer_name || "customer";

  const subjects = {
    booking_admin_notification: `New private lesson booking: ${playerName}`,
    booking_customer_confirmation: "Your private lesson request has been booked",
    product_admin_notification: `New shop order from ${customerName}`,
    product_customer_confirmation: "Your Kim Jones Coaching shop order"
  };

  return subjects[type] || "Kim Jones Coaching notification";
}

function renderText(type, payload = {}) {
  if (type.startsWith("booking")) {
    return [
      "Kim Jones Coaching booking notification",
      "",
      `Customer: ${payload.customerName || payload.customer_name || ""}`,
      `Player: ${payload.playerName || payload.player_name || ""}`,
      `Email: ${payload.email || payload.customerEmail || ""}`,
      `Mobile: ${payload.mobile || ""}`,
      `Date/time: ${payload.dateTime || payload.startTime || ""}`,
      `Notes: ${payload.notes || ""}`
    ].join("\n");
  }

  const items = Array.isArray(payload.items)
    ? payload.items.map((item) => `- ${item.name} x ${item.quantity || 1}`).join("\n")
    : "";

  return [
    "Kim Jones Coaching shop notification",
    "",
    `Customer: ${payload.customerName || ""}`,
    `Email: ${payload.email || ""}`,
    `Mobile: ${payload.mobile || ""}`,
    "",
    items,
    "",
    `Subtotal: ${payload.subtotal || ""}`,
    `Total: ${payload.total || ""}`
  ].join("\n");
}

async function sendWithResend(message, settings) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

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
  if (!process.env.SMTP_USERNAME || !process.env.SMTP_PASSWORD) {
    throw new Error("SMTP_USERNAME and SMTP_PASSWORD are required for Outlook SMTP.");
  }

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
      ? [{ filename: "private-lesson.ics", content: message.ics, contentType: "text/calendar" }]
      : []
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { type, payload = {} } = req.body || {};
  let settings = defaultEmailSettings;
  try {
    settings = await loadEmailSettings();
    const provider = (settings.provider || "disabled").toLowerCase();
    const to = getRecipients(type || "", payload, settings);
    const message = {
      to,
      settings,
      subject: getSubject(type, payload),
      text: renderText(type, payload),
      ics: payload.ics || ""
    };

    if (!to.length) {
      res.status(200).json({ sent: false, reason: "No recipient configured" });
      return;
    }

    if (!settings.enabled || provider === "disabled" || provider === "test") {
      console.info("Email test mode", { type, to, subject: message.subject });
      res.status(200).json({ sent: false, testMode: true });
      return;
    }

    if (provider === "resend") {
      await sendWithResend(message, settings);
      res.status(200).json({ sent: true, provider });
      return;
    }

    if (provider === "outlook_smtp") {
      await sendWithSmtp(message);
      res.status(200).json({ sent: true, provider });
      return;
    }

    if (provider === "sendgrid" || provider === "mailgun") {
      res.status(501).json({ sent: false, error: `${provider} is a placeholder provider.` });
      return;
    }

    res.status(400).json({ sent: false, error: "Unknown email provider" });
  } catch (error) {
    safeLogEmailFailure(type, settings.provider, error);
    res.status(200).json({ sent: false, error: "Email failed safely" });
  }
};
