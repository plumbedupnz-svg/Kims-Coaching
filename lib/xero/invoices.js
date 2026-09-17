const {
  restSelect,
  restUpdate,
  getSiteUrl,
} = require("../../api/stripe/_helpers");
const xero = require("./client");
const amount = (v) => Math.round(Number(v) * 100) / 100;
function invoicePayload(order, settings, contactId) {
  if (order.tax_mode !== "none")
    throw new Error(
      "GST registration requires the Xero tax mapping to be reviewed before invoice checkout can continue.",
    );
  const lines = order.items.map((i) => ({
    Description: i.name,
    Quantity: i.quantity,
    UnitAmount: amount(i.unitAmount),
    AccountCode: settings.sales_account_code,
    TaxType: "NONE",
  }));
  if (Number(order.shipping_amount) > 0)
    lines.push({
      Description: "Delivery",
      Quantity: 1,
      UnitAmount: amount(order.shipping_amount),
      AccountCode: settings.sales_account_code,
      TaxType: "NONE",
    });
  if (Number(order.discount_amount) > 0)
    throw new Error(
      "Order-level discounts need review before issuing this invoice.",
    );
  return {
    Type: "ACCREC",
    Contact: { ContactID: contactId },
    InvoiceNumber: order.order_reference,
    Reference: order.id,
    Date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(order.created_at)),
    DueDate: order.xero_due_date,
    CurrencyCode: "NZD",
    LineAmountTypes: "NoTax",
    Status: "DRAFT",
    BrandingThemeID: settings.branding_theme_id,
    LineItems: lines,
    Url: `${getSiteUrl()}/admin.html#products`,
  };
}
function checkInvoice(order, invoice) {
  if (
    invoice.Type !== "ACCREC" ||
    invoice.Reference !== order.id ||
    invoice.InvoiceNumber !== order.order_reference ||
    invoice.CurrencyCode !== "NZD" ||
    !Number.isFinite(Number(invoice.Total)) ||
    Math.abs(Number(invoice.Total) - Number(order.total_amount)) > 0.009
  )
    throw new Error(
      "Xero invoice does not match this order. Review it before continuing.",
    );
}
function safeInvoiceUrl(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol === "https:" &&
      (u.hostname === "in.xero.com" || u.hostname.endsWith(".xero.com"))
    )
      return u.href;
  } catch {}
  throw new Error("Xero returned an invalid invoice link.");
}
async function getContact(order) {
  const number =
    "KJC-" + xero.hash(order.customer_email.toLowerCase()).slice(0, 32);
  const result = await xero.request(
    "/Contacts?where=" + encodeURIComponent(`ContactNumber=="${number}"`),
  );
  if (result.Contacts?.length === 1) return result.Contacts[0].ContactID;
  const data = await xero.request("/Contacts", {
    method: "POST",
    key: "contact-" + number,
    body: {
      Contacts: [
        {
          Name: `${order.customer_name} (${order.customer_email})`.slice(
            0,
            250,
          ),
          ContactNumber: number,
          EmailAddress: order.customer_email,
        },
      ],
    },
  });
  const id = data.Contacts?.[0]?.ContactID;
  if (!id) throw new Error("Xero did not return a customer contact.");
  return id;
}
async function syncOrder(order) {
  const c = await xero.connection(),
    s = await xero.settings();
  if (c.tenant_id !== order.xero_tenant_id)
    throw new Error("The connected Xero organisation differs from the order.");
  let invoice;
  if (order.xero_invoice_id)
    invoice = (await xero.request(`/Invoices/${order.xero_invoice_id}`))
      .Invoices?.[0];
  else {
    // A deterministic unique invoice number prevents duplicates even after an idempotency key expires.
    invoice = (
      await xero.request(
        "/Invoices?InvoiceNumbers=" + encodeURIComponent(order.order_reference),
      )
    ).Invoices?.[0];
    if (!invoice) {
      if (!s.enabled)
        throw new Error(
          "Invoice checkout is disabled. Review this pending order before issuing its invoice.",
        );
      const contactId = await getContact(order);
      invoice = (
        await xero.request("/Invoices", {
          method: "POST",
          key: "invoice-" + order.id,
          body: { Invoices: [invoicePayload(order, s, contactId)] },
        })
      ).Invoices?.[0];
    }
    if (!invoice) throw new Error("Xero did not return an invoice.");
    checkInvoice(order, invoice);
    order = await restUpdate(
      "shop_orders",
      { id: `eq.${order.id}` },
      { xero_invoice_id: invoice.InvoiceID },
    );
  }
  checkInvoice(order, invoice);
  if (invoice.Status === "DRAFT") {
    if (!s.enabled)
      throw new Error(
        "Invoice checkout is disabled. Review this draft in Xero.",
      );
    invoice = (
      await xero.request(`/Invoices/${invoice.InvoiceID}`, {
        method: "POST",
        key: "authorise-" + order.id,
        body: {
          Invoices: [{ InvoiceID: invoice.InvoiceID, Status: "AUTHORISED" }],
        },
      })
    ).Invoices?.[0];
    checkInvoice(order, invoice);
  }
  order = await xero.rpc("apply_xero_invoice_state", {
    p_order_id: order.id,
    p_tenant: order.xero_tenant_id,
    p_invoice: invoice.InvoiceID,
    p_status: invoice.Status,
    p_total: invoice.Total,
    p_due: invoice.AmountDue ?? null,
    p_paid: invoice.AmountPaid ?? null,
    p_currency: invoice.CurrencyCode,
  });
  if (
    ["AUTHORISED", "PAID"].includes(invoice.Status) &&
    !order.xero_invoice_url
  ) {
    const online = await xero.request(
      `/Invoices/${invoice.InvoiceID}/OnlineInvoice`,
    );
    const url = safeInvoiceUrl(online.OnlineInvoices?.[0]?.OnlineInvoiceUrl);
    order = await restUpdate(
      "shop_orders",
      { id: `eq.${order.id}` },
      { xero_invoice_url: url },
    );
  }
  if (
    ["AUTHORISED", "PAID"].includes(invoice.Status) &&
    !order.invoice_sent_at
  ) {
    if (invoice.SentToContact)
      await restUpdate(
        "shop_orders",
        { id: `eq.${order.id}` },
        {
          invoice_email_status: "sent",
          invoice_sent_at: new Date().toISOString(),
        },
        "",
      );
    else if (order.invoice_email_attempted_at)
      await restUpdate(
        "shop_orders",
        { id: `eq.${order.id}` },
        { invoice_email_status: "needs_review" },
        "",
      );
    else {
      // Persist intent before sending. An uncertain response must not trigger repeated emails.
      const claimed = await restUpdate(
        "shop_orders",
        { id: `eq.${order.id}`, invoice_email_attempted_at: "is.null" },
        {
          invoice_email_attempted_at: new Date().toISOString(),
          invoice_email_status: "sending",
        },
      );
      if (claimed) {
        try {
          await xero.request(`/Invoices/${invoice.InvoiceID}/Email`, {
            method: "POST",
            key: "email-" + order.id,
            body: {},
          });
          await restUpdate(
            "shop_orders",
            { id: `eq.${order.id}` },
            {
              invoice_email_status: "sent",
              invoice_sent_at: new Date().toISOString(),
            },
            "",
          );
        } catch (error) {
          await restUpdate(
            "shop_orders",
            { id: `eq.${order.id}` },
            { invoice_email_status: "needs_review" },
            "",
          );
        }
      }
    }
  }
}
async function processJobs(limit = 5) {
  const started = Date.now();
  for (let count = 0; count < limit && Date.now() - started < 35000; count++) {
    const [job] = await xero.rpc("claim_xero_jobs", { p_limit: 1 });
    if (!job) break;
    let error = null;
    try {
      const [order] = await restSelect("shop_orders", "*", {
        id: `eq.${job.order_id}`,
        limit: "1",
      });
      if (order) await syncOrder(order);
    } catch (e) {
      error = e.message;
      await restUpdate(
        "shop_orders",
        { id: `eq.${job.order_id}` },
        { xero_error: error },
        "",
      );
    }
    await xero.rpc("finish_xero_job", {
      p_order_id: job.order_id,
      p_lease: job.lease_token,
      p_revision: job.revision,
      p_error: error,
    });
  }
}
function runInBackground(promise) {
  require("@vercel/functions").waitUntil(
    promise.catch(() =>
      console.error(
        "Xero background processing failed; pending jobs retained.",
      ),
    ),
  );
}
module.exports = {
  invoicePayload,
  checkInvoice,
  safeInvoiceUrl,
  syncOrder,
  processJobs,
  runInBackground,
};
