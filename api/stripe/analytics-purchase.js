const { readJsonBody } = require("./_helpers");
const { checkoutMeasurement, verifyAnalyticsToken, transactionId } = require("./_analytics");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = await readJsonBody(req);
    // A session URL alone is not enough: require the short-lived proof issued
    // to the browser that started this checkout after allowing analytics.
    if (!verifyAnalyticsToken(body.session_id, body.token)) return res.status(403).json({ error: "Invalid checkout proof" });
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(body.session_id)}`, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return res.status(502).json({ error: "Payment verification unavailable" });
    const session = await response.json();
    if (session.id !== body.session_id || session.status !== "complete" || session.payment_status !== "paid" || !session.livemode) {
      return res.status(409).json({ error: "No verified live payment" });
    }
    const measurement = await checkoutMeasurement(session);
    if (!measurement) return res.status(409).json({ error: "Payment measurement unavailable" });
    return res.status(200).json({ ...measurement, transaction_id: transactionId(session.id) });
  } catch (_) {
    // Never expose upstream Stripe or database responses containing customer data.
    return res.status(503).json({ error: "Payment measurement unavailable" });
  }
};
