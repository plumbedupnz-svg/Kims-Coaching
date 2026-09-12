const { timingSafeEqual } = require("node:crypto");
const { loadEmailSettings } = require("./send-email.js");
const { formatDate, tension } = require("../racket-stringing.js");

function authorized(header, secret) {
  if (!secret || typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function buildMessage(record, settings) {
  const text = [
    `Hi ${record.first_name || record.player_name},`, "",
    `A friendly reminder that ${record.player_name}’s ${record.racket_type} is due for a restring, based on the reminder interval you chose.`, "",
    `Last strung: ${formatDate(record.strung_on)}`,
    `Strings: ${record.strings_main}${record.strings_cross ? ` / ${record.strings_cross}` : ""}`,
    `Tension: ${tension(record)}`,
    `Reminder due: ${formatDate(record.due_on)}`, "",
    "Reply to this email to arrange a restring with Kim.",
    "To change your reminder interval or stop these reminders, just reply and let us know.", "",
    "Kim Jones Coaching"
  ].join("\n");
  return {
    from: `${settings.from_name || "Kim Jones Coaching"} <${settings.from_email}>`,
    to: [record.email],
    reply_to: settings.reply_to_email || settings.from_email,
    subject: "Your racket restring reminder · Kim Jones Coaching",
    text,
    html: `<div style="font-family:Arial,sans-serif;color:#172540;max-width:600px;margin:auto;line-height:1.6"><h2>Time for a restring?</h2>${text.split("\n\n").map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("")}</div>`
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req.headers?.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: "Unauthorized" });
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) return res.status(503).json({ error: "Reminder database is not configured" });
  const startedAt = Date.now();
  let lastSendAt = 0;
  const counts = { sent: 0, skipped: 0, failed: 0 };

  async function database(path, method = "GET", body) {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Reminder database request failed (${response.status})`);
    return response.status === 204 ? [] : response.json();
  }

  function deliveryPath(delivery) {
    return `racket_reminder_deliveries?id=eq.${delivery.id}&lease_token=eq.${delivery.lease_token}`;
  }

  try {
    const settings = await loadEmailSettings();
    if (!settings.enabled || ["disabled", "test"].includes(settings.provider || "disabled")) {
      return res.status(200).json({ status: "disabled", ...counts });
    }
    if (!process.env.RESEND_API_KEY) return res.status(503).json({ error: "Reminder email provider is not configured" });
    const deliveries = await database("rpc/claim_racket_reminders", "POST", { p_limit: 20 });
    for (const delivery of deliveries) {
      // Leave unprocessed claims for the next run when this invocation is near its time limit.
      if (Date.now() - startedAt > 40000) break;
      try {
        // Recheck consent, the latest stringing and due date immediately before sending.
        const [record] = await database(`racket_reminders_due?racket_id=eq.${delivery.racket_id}&stringing_id=eq.${delivery.stringing_id}&due_on=eq.${delivery.due_on}`);
        if (!record || (delivery.email_payload && delivery.email_payload.to[0] !== record.email)) {
          await database(deliveryPath(delivery), "PATCH", { status: "cancelled", locked_until: null });
          counts.skipped++;
          continue;
        }
        if (delivery.first_attempt_at && Date.now() - Date.parse(delivery.first_attempt_at) >= 23 * 3600000) {
          await database(deliveryPath(delivery), "PATCH", { status: "needs_review", error_message: "Delivery could not be confirmed. Check Resend before sending again." });
          counts.skipped++;
          continue;
        }
        // Persist the exact payload before contacting Resend so retries use identical content.
        const payload = delivery.email_payload || buildMessage(record, settings);
        const prepared = await database(`${deliveryPath(delivery)}&locked_until=gt.${encodeURIComponent(new Date().toISOString())}&status=in.(pending,sending)`, "PATCH", {
          status: "sending", email_payload: payload, first_attempt_at: delivery.first_attempt_at || new Date().toISOString(), error_message: null
        });
        if (!prepared.length) { counts.skipped++; continue; }
        // Pace reminder batches to leave capacity for booking and shop emails.
        const delay = 600 - (Date.now() - lastSendAt);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        lastSendAt = Date.now();
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "User-Agent": "KimsCoaching-RacketReminders/1.0", "Idempotency-Key": `racket-reminder/${delivery.id}` },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000)
        });
        const result = await response.json();
        if (!response.ok || !result.id) throw new Error(`Reminder email send could not be confirmed (${response.status})`);
        const completed = await database(deliveryPath(delivery), "PATCH", {
          status: "sent", sent_at: new Date().toISOString(), provider_id: result.id, locked_until: null, error_message: null
        });
        if (!completed.length) throw new Error("Reminder delivery confirmation could not be saved");
        counts.sent++;
      } catch (error) {
        counts.failed++;
        console.error("Racket reminder failed", { deliveryId: delivery.id, message: error.message });
        // Keep the lease and first attempt timestamp. A repeated run can safely retry within 23 hours.
        await database(deliveryPath(delivery), "PATCH", { error_message: error.message }).catch(() => {});
      }
    }
    return res.status(counts.failed ? 500 : 200).json(counts);
  } catch (error) {
    console.error("Racket reminders unavailable", { message: error.message });
    return res.status(503).json({ error: "Racket reminders could not be processed", ...counts });
  }
};
module.exports.buildMessage = buildMessage;
