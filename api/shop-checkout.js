const stripe = require("./stripe/create-checkout-session");
const {
  readJsonBody,
  verifyUser,
  restSelect,
  getSiteUrl,
} = require("./stripe/_helpers");
const x = require("../lib/xero/client");
const { processJobs, runInBackground } = require("../lib/xero/invoices");
function dueDate(created, days) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(created);
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function digest(body, user) {
  return x.hash(
    JSON.stringify({
      user_id: user?.id || null,
      cart: body.cart,
      checkout: body.checkout,
    }),
  );
}
function orderUrl(key) {
  return `${getSiteUrl()}/order-payment.html#${encodeURIComponent(key)}`;
}
module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET")
      return res.status(200).json(await x.publicOptions());
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const body = await readJsonBody(req);
    if (body.action === "status") {
      if (!x.uuid(body.key))
        return res.status(404).json({ error: "Order not found." });
      const [o] = await restSelect("shop_orders", "*", {
        checkout_key_hash: `eq.${x.hash(body.key)}`,
        limit: "1",
      });
      if (!o) return res.status(404).json({ error: "Order not found." });
      // Only return the payment record for the unguessable capability; no address/contact details.
      if (
        !o.xero_synced_at ||
        Date.parse(o.xero_synced_at) < Date.now() - 60000
      ) {
        await x.rpc("enqueue_xero_order", { p_order_id: o.id });
        runInBackground(processJobs(1));
      }
      return res
        .status(200)
        .json({
          reference: o.order_reference,
          total: o.total_amount,
          status: o.payment_status,
          invoice_status: o.xero_invoice_status,
          due: o.xero_amount_due ?? o.total_amount,
          paid: o.xero_amount_paid || 0,
          due_date: o.xero_due_date,
          invoice_url: o.xero_invoice_url,
          email_status: o.invoice_email_status,
          needs_review: Boolean(o.xero_error),
          bank_name: o.invoice_bank_name,
          bank_number: o.invoice_bank_number,
          method: o.payment_method,
          fulfilment_status: o.fulfilment_status,
        });
    }
    const key = body.checkout_key;
    const user = req.headers.authorization
      ? await verifyUser(req.headers.authorization)
      : null;
    const requestDigest = digest(body, user);
    // Resolve a previous invoice before choosing a provider, even if invoicing was disabled.
    if (x.uuid(key)) {
      let existing;
      try {
        [existing] = await restSelect("shop_orders", "id,checkout_digest", {
          checkout_key_hash: `eq.${x.hash(key)}`,
          limit: "1",
        });
      } catch (e) {
        if (
          x.configured() ||
          !/42703/.test(e.message) ||
          !/checkout_key_hash|checkout_digest/.test(e.message)
        )
          throw e;
      }
      if (existing) {
        if (existing.checkout_digest !== requestDigest)
          throw new Error(
            "Checkout details changed. Please start a new checkout.",
          );
        runInBackground(processJobs(1));
        return res.status(200).json({ url: orderUrl(key), provider: "xero" });
      }
    }
    const options = await x.publicOptions();
    if (options.provider !== "xero") {
      if (body.checkout?.payment_method === "bank_transfer")
        throw new Error("Bank-transfer invoices are not enabled yet.");
      req.body = body;
      return stripe(req, res, true);
    }
    if (!x.uuid(key))
      throw new Error("Refresh the page and try checkout again.");
    const method = body.checkout?.payment_method || "card";
    if (
      !["card", "bank_transfer"].includes(method) ||
      (method === "card" && !options.card)
    )
      throw new Error("Choose an available payment method.");
    const { payload } = await stripe.prepareShopOrder({
      user,
      body,
      strictSettings: true,
    });
    if (payload.tax_mode !== "none")
      throw new Error(
        "Invoice checkout requires a GST settings review. Please contact Kim.",
      );
    if (
      !/^\S+@\S+\.\S+$/.test(payload.customer_email) ||
      payload.customer_email.length > 254 ||
      payload.customer_name.length > 150
    )
      throw new Error("Enter valid customer contact details.");
    const c = await x.connection(),
      s = await x.settings();
    const hasService = payload.items.some(
      (i) => i.fulfilment_type === "service",
    );
    const details = hasService
      ? String(body.checkout?.service_details || "")
          .trim()
          .slice(0, 1000)
      : "";
    await x.rpc("create_invoiced_shop_order", {
      p_order: {
        ...payload,
        payment_method: method,
        payment_provider: "xero",
        service_details: details,
        invoice_bank_name: s.bank_name,
        invoice_bank_number: s.bank_number,
        checkout_key_hash: x.hash(key),
        checkout_digest: requestDigest,
        xero_tenant_id: c.tenant_id,
        xero_due_date: dueDate(new Date(), s.due_days),
      },
    });
    runInBackground(processJobs(1));
    return res.status(200).json({ url: orderUrl(key), provider: "xero" });
  } catch (e) {
    return res
      .status(400)
      .json({ error: e.message || "Could not create your order." });
  }
};
module.exports.dueDate = dueDate;
