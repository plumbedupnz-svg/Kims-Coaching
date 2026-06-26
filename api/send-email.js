const defaultEmailSettings = {
  provider: "disabled",
  from_name: "Kim Jones Coaching",
  from_email: "kim@kimjonescoaching.co.nz",
  reply_to_email: "kim@kimjonescoaching.co.nz",
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

const publicSupabaseAnonKey = "sb_publishable_34HW1F0Asg7kEk8vEYCiLQ_9jO1jl4m";

function safeError(error) {
  return error?.message || String(error || "Unknown error");
}

function normalizeProvider(value = "") {
  const provider = String(value || "disabled").toLowerCase();
  if (provider === "disabled" || provider === "test" || !provider) return "disabled";
  // Resend is the project's only live provider. Legacy saved provider values
  // are intentionally routed through Resend so an old row cannot revive SMTP.
  return "resend";
}

function normalizeSupabaseRestUrl(url = "") {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/rest/v1") ? trimmed : `${trimmed}/rest/v1`;
}

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    restUrl: normalizeSupabaseRestUrl(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || publicSupabaseAnonKey
  };
}

async function loadEmailSettings() {
  const { restUrl, serviceRoleKey } = getSupabaseConfig();

  if (!restUrl || !serviceRoleKey) {
    const fallbackSettings = getFallbackSettings();
    console.info("Email settings loaded from Vercel environment fallback", {
      provider: fallbackSettings.provider,
      enabled: fallbackSettings.enabled,
      hasSupabaseUrl: Boolean(restUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey)
    });
    return fallbackSettings;
  }

  console.info("Loading email settings from Supabase", {
    restUrlHost: restUrl.replace(/^https?:\/\//, "").split("/")[0],
    hasServiceRoleKey: Boolean(serviceRoleKey)
  });

  const response = await fetch(`${restUrl}/email_settings?select=*&limit=1`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!response.ok) throw new Error(`Could not load email_settings: ${response.status}`);
  const rows = await response.json();
  const loadedSettings = { ...defaultEmailSettings, ...(rows?.[0] || {}) };
  console.info("Email settings loaded", {
    provider: loadedSettings.provider,
    enabled: loadedSettings.enabled,
    hasFromEmail: Boolean(loadedSettings.from_email),
    hasReplyToEmail: Boolean(loadedSettings.reply_to_email)
  });
  return loadedSettings;
}

function fromHeader(settings) {
  return `${settings.from_name || defaultEmailSettings.from_name} <${settings.from_email || defaultEmailSettings.from_email}>`;
}

function getCustomerEmail(payload = {}) {
  return payload.email || payload.customerEmail || payload.customer_email || "";
}

function getRecipients(type, payload = {}, settings = defaultEmailSettings) {
  const adminEmail = type === "waitlist_notification"
    ? process.env.EMAIL_ADMIN_TO || payload.adminEmail || "kim@kimjonescoaching.co.nz"
    : process.env.EMAIL_ADMIN_TO || settings.reply_to_email || settings.from_email;
  if (adminTypes.has(type)) return [adminEmail].filter(Boolean);
  return [getCustomerEmail(payload)].filter(Boolean);
}

function getFallbackSettings() {
  const provider = normalizeProvider(process.env.EMAIL_PROVIDER);
  return {
    ...defaultEmailSettings,
    provider,
    from_name: process.env.EMAIL_FROM_NAME || defaultEmailSettings.from_name,
    from_email: process.env.EMAIL_FROM_ADDRESS || defaultEmailSettings.from_email,
    reply_to_email: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM_ADDRESS || defaultEmailSettings.reply_to_email,
    enabled: provider !== "disabled"
  };
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

function lineIf(label, value) {
  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).join(", ");
    return joined ? `${label}: ${joined}` : "";
  }
  return value ? `${label}: ${value}` : "";
}

function formatEmailDate(value, options) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function getPlayerLevel(payload = {}) {
  return payload.playerLevel || payload.player_level || "Not specified";
}

function renderBookingText(title, payload = {}) {
  const startTime = payload.startTime || payload.dateTime;
  return [
    title,
    "",
    line("Player", payload.playerName || payload.player_name),
    line("Player level", getPlayerLevel(payload)),
    line("Lesson type", payload.lessonTypeName || payload.lesson_type_name),
    line("Duration", payload.durationMinutes ? `${payload.durationMinutes} minutes` : ""),
    line("Date", formatEmailDate(startTime, { weekday: "long", month: "long", day: "numeric", year: "numeric" })),
    line("Start time", formatEmailDate(startTime, { hour: "numeric", minute: "2-digit" })),
    line("Club", payload.clubName || payload.club_name),
    line("Coach", payload.coachName || payload.coach_name || "Kim Jones"),
    line("Customer", payload.customerName || payload.customer_name),
    line("Email", getCustomerEmail(payload)),
    line("Mobile", payload.mobile),
    line("End time", formatEmailDate(payload.endTime, { hour: "numeric", minute: "2-digit" })),
    line("Status", payload.bookingStatus || payload.booking_status),
    line("Notes", payload.notes)
  ].join("\n");
}

function renderWaitlistText(title, payload = {}) {
  const preferredDuration = payload.preferredDuration || payload.preferred_duration;
  return [
    title,
    "",
    lineIf("Player", payload.playerName || payload.player_name),
    lineIf("Player level", payload.playerLevel || payload.player_level || payload.skill_level),
    lineIf("Preferred lesson type", payload.lessonTypeName || payload.lesson_type_name || payload.preferred_lesson_type),
    lineIf("Preferred duration", preferredDuration ? `${preferredDuration} minutes` : ""),
    lineIf("Preferred days", payload.preferredDays || payload.preferred_days),
    lineIf("Preferred times", payload.preferredTimes || payload.preferred_times),
    lineIf("Club", payload.clubName || payload.club_name || payload.club),
    lineIf("Coach", payload.coachName || payload.coach_name || payload.coach),
    lineIf("Customer", payload.customerName || payload.customer_name),
    lineIf("Email", getCustomerEmail(payload)),
    lineIf("Mobile", payload.mobile),
    lineIf("Notes", payload.notes)
  ].filter(Boolean).join("\n");
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
  if (type === "booking_admin_notification") return renderBookingText("New Kim Jones Coaching booking", payload);
  if (type === "booking_customer_confirmation") return renderBookingText("Your coaching booking has been booked", payload);
  if (type === "booking_changed") return renderBookingText("Your Kim Jones Coaching booking has been updated", payload);
  if (type === "booking_cancelled") return renderBookingText("Your Kim Jones Coaching booking has been cancelled", payload);
  if (type === "waitlist_notification") return renderWaitlistText("New waitlist request", payload);
  if (type === "waitlist_customer_confirmation") return renderWaitlistText("Your waitlist request has been received", payload);
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
  if (provider === "resend") {
    return ["RESEND_API_KEY"].filter((key) => !process.env[key]);
  }
  return [];
}

function buildLogPayload({ type, recipient, relatedType, relatedId, status, provider, errorMessage }) {
  return {
    notification_type: type || "unknown",
    recipient_email: recipient || null,
    related_type: relatedType || null,
    related_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(relatedId || "") ? relatedId : null,
    status,
    provider,
    error_message: errorMessage || null
  };
}

async function createNotificationLog({ type, recipient, relatedType, relatedId, status, provider, errorMessage }) {
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  if (!restUrl) {
    console.warn("Notification log skipped because Supabase URL is missing", {
      hasSupabaseUrl: Boolean(restUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      hasAnonKey: Boolean(anonKey),
      type,
      recipient,
      status,
      provider
    });
    return null;
  }

  const body = buildLogPayload({ type, recipient, relatedType, relatedId, status, provider, errorMessage });

  try {
    console.info("Creating notification log", {
      type,
      recipient,
      status,
      provider,
      relatedType,
      hasRelatedId: Boolean(body.related_id),
      method: "direct"
    });
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for direct notification log insert");
    const response = await fetch(`${restUrl}/notification_logs?select=id`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`notification_logs insert returned ${response.status}: ${text}`);
    }
    const rows = await response.json().catch(() => []);
    const id = rows?.[0]?.id || null;
    console.info("Notification log insert result", { id: id || "none", status, method: "direct" });
    return id;
  } catch (error) {
    console.error("Notification log direct insert failed safely", { message: safeError(error), type, recipient, status, provider });
  }

  try {
    console.info("Creating notification log", {
      type,
      recipient,
      status,
      provider,
      relatedType,
      hasRelatedId: Boolean(body.related_id),
      method: "rpc"
    });
    const response = await fetch(`${restUrl}/rpc/log_notification_attempt`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey || anonKey,
        Authorization: `Bearer ${serviceRoleKey || anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_log_id: null,
        p_notification_type: body.notification_type,
        p_recipient_email: body.recipient_email,
        p_related_type: body.related_type,
        p_related_id: body.related_id,
        p_status: body.status,
        p_provider: body.provider,
        p_error_message: body.error_message
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`log_notification_attempt insert returned ${response.status}: ${text}`);
    }
    const id = await response.json().catch(() => null);
    console.info("Notification log insert result", { id: id || "none", status, method: "rpc" });
    return id;
  } catch (error) {
    console.error("Notification log RPC insert failed safely", { message: safeError(error), type, recipient, status, provider });
    return null;
  }
}

async function updateNotificationLog(id, { status, errorMessage }) {
  if (!id) return;
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  if (!restUrl) return;

  try {
    console.info("Updating notification log", { id, status, hasError: Boolean(errorMessage), method: "direct" });
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for direct notification log update");
    const response = await fetch(`${restUrl}/notification_logs?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        status,
        error_message: errorMessage || null
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`notification_logs update returned ${response.status}: ${text}`);
    }
    console.info("Notification log update result", { id, status, method: "direct" });
    return;
  } catch (error) {
    console.error("Notification log direct update failed safely", { id, status, message: safeError(error) });
  }

  try {
    console.info("Updating notification log", { id, status, hasError: Boolean(errorMessage), method: "rpc" });
    const response = await fetch(`${restUrl}/rpc/log_notification_attempt`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey || anonKey,
        Authorization: `Bearer ${serviceRoleKey || anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_log_id: id,
        p_notification_type: null,
        p_recipient_email: null,
        p_related_type: null,
        p_related_id: null,
        p_status: status,
        p_provider: null,
        p_error_message: errorMessage || null
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`log_notification_attempt update returned ${response.status}: ${text}`);
    }
    console.info("Notification log update result", { id, status, method: "rpc" });
  } catch (error) {
    console.error("Notification log RPC update failed safely", { id, status, message: safeError(error) });
  }
}

async function createPendingLogs(type, recipients, payload, provider) {
  const list = recipients.length ? recipients : [""];
  return Promise.all(list.map(async (recipient) => ({
    recipient,
    id: await createNotificationLog({
      type,
      recipient,
      relatedType: payload.relatedType,
      relatedId: payload.relatedId,
      status: "pending",
      provider
    })
  })));
}

function getLogIds(logs = []) {
  return logs.map((log) => log.id).filter(Boolean);
}

async function finalizeLogs(logs, status, errorMessage = "") {
  await Promise.all((logs || []).map((log) => {
    if (log.id) return updateNotificationLog(log.id, { status, errorMessage });
    return createNotificationLog({
      type: log.type,
      recipient: log.recipient,
      relatedType: log.relatedType,
      relatedId: log.relatedId,
      status,
      provider: log.provider,
      errorMessage
    });
  }));
}

function attachLogContext(logs, type, payload, provider) {
  return (logs || []).map((log) => ({
    ...log,
    type,
    provider,
    relatedType: payload.relatedType,
    relatedId: payload.relatedId
  }));
}

async function sendWithResend(message, settings) {
  console.info("[Kim's Coaching email] Resend send attempted", {
    traceId: message.traceId,
    recipients: message.to,
    subject: message.subject,
    hasIcs: Boolean(message.ics)
  });
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
        ? [{ filename: "coaching-booking.ics", content: Buffer.from(message.ics).toString("base64") }]
        : undefined
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result?.message || result?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Resend returned ${response.status}: ${detail}`);
  }
  console.info("[Kim's Coaching email] Resend response returned", {
    traceId: message.traceId,
    messageId: result?.id || ""
  });
  return result;
}

async function getLastNotificationLog(authToken = "") {
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  const apiKey = serviceRoleKey || anonKey;
  const bearer = serviceRoleKey || authToken;
  if (!restUrl || !apiKey || !bearer) return null;
  try {
    const response = await fetch(`${restUrl}/notification_logs?select=*&order=created_at.desc&limit=1`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${bearer}`
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`notification_logs diagnostics returned ${response.status}: ${text}`);
    }
    const rows = await response.json();
    return rows?.[0] || null;
  } catch (error) {
    console.error("Could not load last notification log", { message: safeError(error) });
    return null;
  }
}

async function requireAdminForDiagnostics(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = String(authHeader).replace(/^Bearer\s+/i, "");
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  const apiKey = serviceRoleKey || anonKey;
  if (!token || !restUrl || !apiKey) {
    return { ok: false, status: 401, error: "Admin diagnostics require an authenticated admin session." };
  }

  try {
    const projectUrl = restUrl.replace(/\/rest\/v1$/, "");
    const userResponse = await fetch(`${projectUrl}/auth/v1/user`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${token}`
      }
    });
    if (!userResponse.ok) {
      return { ok: false, status: 401, error: "Could not verify admin session." };
    }
    const user = await userResponse.json();
    const profileResponse = await fetch(`${restUrl}/profiles?select=role&id=eq.${encodeURIComponent(user.id)}&limit=1`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${serviceRoleKey || token}`
      }
    });
    if (!profileResponse.ok) {
      return { ok: false, status: 403, error: "Could not verify admin profile." };
    }
    const profiles = await profileResponse.json();
    if (profiles?.[0]?.role !== "admin") {
      return { ok: false, status: 403, error: "Email diagnostics are available to admin users only." };
    }
    return { ok: true, token };
  } catch (error) {
    console.error("Admin diagnostics auth failed", { message: safeError(error) });
    return { ok: false, status: 500, error: "Could not verify admin diagnostics access." };
  }
}

async function buildDiagnostics({ includeConnectionTest = false, authToken = "" } = {}) {
  let settings = defaultEmailSettings;
  let settingsError = "";
  try {
    settings = await loadEmailSettings();
  } catch (error) {
    settingsError = safeError(error);
    console.error("Email diagnostics settings load failed", { message: settingsError });
    settings = getFallbackSettings();
  }

  const provider = normalizeProvider(settings.provider);
  const missingEnv = getMissingEnv(provider);
  const mode = settings.enabled && provider !== "disabled" ? "LIVE" : "TEST";
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  const diagnostics = {
    mode,
    provider,
    settingsEnabled: Boolean(settings.enabled),
    settingsError,
    supabaseLogging: {
      configured: Boolean(restUrl && (serviceRoleKey || anonKey)),
      hasSupabaseUrl: Boolean(restUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      hasAnonKey: Boolean(anonKey)
    },
    resend: {
      configured: provider !== "resend" || missingEnv.length === 0,
      hasApiKey: Boolean(process.env.RESEND_API_KEY),
      missing: missingEnv
    },
    authEmail: {
      provider: "Resend SMTP",
      verification: "Verify in Supabase Dashboard > Authentication > Email > SMTP Settings"
    },
    lastLog: await getLastNotificationLog(authToken),
    connectionTest: null
  };

  if (includeConnectionTest) {
    if (!settings.enabled || provider === "disabled") {
      diagnostics.connectionTest = {
        status: "skipped",
        error: "Enable Resend before sending a test email."
      };
    } else if (missingEnv.length) {
      diagnostics.connectionTest = {
        status: "failed",
        error: `Missing Vercel email environment variables: ${missingEnv.join(", ")}`
      };
    } else {
      try {
        const recipient = process.env.EMAIL_ADMIN_TO || settings.reply_to_email || settings.from_email;
        const response = await sendWithResend({
          traceId: `resend-test-${Date.now()}`,
          to: [recipient],
          subject: "Kim Jones Coaching Resend test",
          text: "Resend is configured for Kim Jones Coaching application emails.",
          ics: ""
        }, settings);
        diagnostics.connectionTest = { status: "success", error: "", messageId: response?.id || "" };
      } catch (error) {
        diagnostics.connectionTest = { status: "failed", error: safeError(error) };
        console.error("Resend test email failed", { message: safeError(error) });
      }
    }
  }

  return diagnostics;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const adminCheck = await requireAdminForDiagnostics(req);
    if (!adminCheck.ok) {
      res.status(adminCheck.status).json({ error: adminCheck.error });
      return;
    }
    const diagnostics = await buildDiagnostics({ authToken: adminCheck.token });
    res.status(200).json(diagnostics);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (body.action === "test_resend" || body.action === "test_smtp") {
    const adminCheck = await requireAdminForDiagnostics(req);
    if (!adminCheck.ok) {
      res.status(adminCheck.status).json({ error: adminCheck.error });
      return;
    }
    const diagnostics = await buildDiagnostics({ includeConnectionTest: true, authToken: adminCheck.token });
    res.status(200).json(diagnostics);
    return;
  }

  const { type = "admin_notification", payload = {} } = body;
  const traceId = payload.traceId || `email-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let settings = getFallbackSettings();
  let provider = normalizeProvider(settings.provider);
  const to = getRecipients(type, payload, settings);
  let logs = [];

  try {
    console.info("[Kim's Coaching email] API handler entered before settings load", {
      traceId,
      type,
      provider,
      recipients: to,
      hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
      hasSupabaseUrl: Boolean(getSupabaseConfig().restUrl),
      hasServiceRoleKey: Boolean(getSupabaseConfig().serviceRoleKey),
      hasAnonKey: Boolean(getSupabaseConfig().anonKey)
    });
    logs = attachLogContext(await createPendingLogs(type, to, payload, provider), type, payload, provider);
    console.info("[Kim's Coaching email] notification log created", {
      traceId,
      type,
      provider,
      logIds: getLogIds(logs),
      recipients: to
    });

    settings = await loadEmailSettings();
    provider = normalizeProvider(settings.provider);
    console.info("[Kim's Coaching email] email settings loaded", {
      traceId,
      provider,
      enabled: Boolean(settings.enabled),
      fromEmail: settings.from_email || "",
      replyToEmail: settings.reply_to_email || ""
    });
    const settingsRecipients = getRecipients(type, payload, settings);
    if (settingsRecipients.length && settingsRecipients.join(",") !== to.join(",")) {
      console.info("[Kim's Coaching email] recipients updated from Admin email settings", {
        traceId,
        type,
        previousRecipients: to,
        settingsRecipients
      });
      to.splice(0, to.length, ...settingsRecipients);
    }
    console.info("[Kim's Coaching email] email send stage ready", {
      traceId,
      type,
      provider,
      enabled: Boolean(settings.enabled),
      recipients: to,
      relatedType: payload.relatedType || null,
      relatedId: payload.relatedId || null,
      hasResendApiKey: Boolean(process.env.RESEND_API_KEY)
    });
    logs = attachLogContext(logs, type, payload, provider);

    if (!to.length) {
      await finalizeLogs(logs, "skipped", "No recipient configured");
      res.status(200).json({ sent: false, status: "skipped", reason: "No recipient configured", traceId, logIds: getLogIds(logs) });
      return;
    }

    if (!settings.enabled || provider === "disabled") {
      console.info("[Kim's Coaching email] email disabled/test mode", { traceId, type, to });
      await finalizeLogs(logs, "test_mode");
      res.status(200).json({ sent: false, status: "test_mode", provider, traceId, logIds: getLogIds(logs) });
      return;
    }

    const missingEnv = getMissingEnv(provider);
    if (missingEnv.length) {
      const message = `Missing Vercel email environment variables: ${missingEnv.join(", ")}`;
      console.error("[Kim's Coaching email] email environment validation failed", { traceId, type, provider, missingEnv });
      await finalizeLogs(logs, "failed", message);
      res.status(200).json({ sent: false, status: "failed", provider, error: message, traceId, logIds: getLogIds(logs) });
      return;
    }

    const message = {
      traceId,
      to,
      settings,
      subject: getSubject(type, payload),
      text: renderText(type, payload),
      ics: payload.ics || ""
    };

    console.info("[Kim's Coaching email] sending email through Resend", { traceId, type, recipients: to });
    await sendWithResend(message, settings);

    await finalizeLogs(logs, "sent");
    console.info("[Kim's Coaching email] email send succeeded", { traceId, type, provider, recipients: to, logIds: getLogIds(logs) });
    res.status(200).json({ sent: true, status: "sent", provider, traceId, logIds: getLogIds(logs) });
  } catch (error) {
    const safeMessage = safeError(error) || "Email failed safely";
    console.error("[Kim's Coaching email] email failed safely", { traceId, type, provider, recipients: to, message: safeMessage });
    if (!logs.length) {
      logs = attachLogContext(await createPendingLogs(type, to, payload, provider), type, payload, provider);
      console.info("[Kim's Coaching email] notification log created in catch", {
        traceId,
        type,
        provider,
        logIds: getLogIds(logs),
        recipients: to
      });
    }
    await finalizeLogs(logs, "failed", safeMessage);
    res.status(200).json({ sent: false, status: "failed", provider, error: safeMessage, traceId, logIds: getLogIds(logs) });
  }
};
