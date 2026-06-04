const nodemailer = require("nodemailer");

const provider = (process.env.EMAIL_PROVIDER || "disabled").toLowerCase();
const fromName = process.env.EMAIL_FROM_NAME || "Kim Jones Coaching";
const fromAddress = process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USERNAME || "kimjonescoaching@outlook.com";
const replyTo = process.env.EMAIL_REPLY_TO || fromAddress;

function fromHeader() {
  return `${fromName} <${fromAddress}>`;
}

function safeLogEmailFailure(type, error) {
  console.error("Email failed safely", {
    type,
    provider,
    message: error?.message || String(error || "Unknown error")
  });
}

function getRecipients(type, payload = {}) {
  const adminEmail = process.env.EMAIL_ADMIN_TO || replyTo || fromAddress;
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

async function sendWithResend(message) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromHeader(),
      to: message.to,
      reply_to: replyTo,
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
    from: fromHeader(),
    to: message.to,
    replyTo,
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
  const to = getRecipients(type || "", payload);
  const message = {
    to,
    subject: getSubject(type, payload),
    text: renderText(type, payload),
    ics: payload.ics || ""
  };

  if (!to.length) {
    res.status(200).json({ sent: false, reason: "No recipient configured" });
    return;
  }

  try {
    if (provider === "disabled" || provider === "test") {
      console.info("Email test mode", { type, to, subject: message.subject });
      res.status(200).json({ sent: false, testMode: true });
      return;
    }

    if (provider === "resend") {
      await sendWithResend(message);
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
    safeLogEmailFailure(type, error);
    res.status(200).json({ sent: false, error: "Email failed safely" });
  }
};
