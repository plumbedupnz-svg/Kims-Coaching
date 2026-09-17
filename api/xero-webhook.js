const { getRawBody } = require("./stripe/_helpers");
const x = require("../lib/xero/client");
const { processJobs, runInBackground } = require("../lib/xero/invoices");
module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      if (
        !process.env.CRON_SECRET ||
        req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
      )
        return res.status(401).json({ error: "Unauthorised" });
      if (!x.configured()) return res.status(200).json({ disabled: true });
      // Daily recovery in addition to live webhook updates and the admin refresh action.
      const queued = await x.rpc("enqueue_xero_recovery", {});
      runInBackground(processJobs(10));
      return res.status(200).json({ queued });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const raw = await getRawBody(req);
    if (raw.length > 1048576) return res.status(413).end();
    if (!x.verifyWebhook(raw, req.headers["x-xero-signature"]))
      return res.status(401).end();
    const body = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(body.events)) return res.status(400).end();
    const events = body.events.filter(
      (e) =>
        e.eventCategory === "INVOICE" &&
        x.uuid(e.resourceId) &&
        x.uuid(e.tenantId),
    );
    // A signed webhook only schedules work. The worker retrieves authoritative invoice state.
    if (events.length)
      await x.rpc("enqueue_xero_events", {
        p_events: events.map((e) => ({
          invoice_id: e.resourceId,
          tenant_id: e.tenantId,
        })),
      });
    if (events.length) runInBackground(processJobs());
    return res.status(200).json({ received: true });
  } catch (e) {
    return res
      .status(503)
      .json({ error: "Invoice update could not be queued. Please retry." });
  }
};

module.exports.config = { api: { bodyParser: false } };
