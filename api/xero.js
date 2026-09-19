const crypto = require("node:crypto");
const {
  readJsonBody,
  restInsert,
  restSelect,
  restUpdate,
  getSiteUrl,
} = require("./stripe/_helpers");
const x = require("../lib/xero/client");
const { processJobs, runInBackground } = require("../lib/xero/invoices");
function redirect(res, message) {
  res.setHeader(
    "Location",
    `${getSiteUrl()}/admin.html?xero=${encodeURIComponent(message)}#settings`,
  );
  res.status(303).end();
}
module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, getSiteUrl());
  if (req.method === "GET" && url.searchParams.get("action") === "callback") {
    try {
      const state = url.searchParams.get("state") || "";
      const cookie =
        String(req.headers.cookie || "")
          .split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith("kims_xero_state="))
          ?.slice(16) || "";
      if (!state || !cookie)
        throw new Error("Connection session expired. Try Connect Xero again.");
      const row = await restUpdate(
        "xero_oauth_states",
        {
          state_hash: `eq.${x.hash(state)}`,
          cookie_hash: `eq.${x.hash(cookie)}`,
          consumed_at: "is.null",
          expires_at: `gt.${new Date().toISOString()}`,
        },
        { consumed_at: new Date().toISOString() },
      );
      if (!row)
        throw new Error("Connection session expired. Try Connect Xero again.");
      const [profile] = await restSelect("profiles", "role", {
        id: `eq.${row.user_id}`,
        limit: "1",
      });
      if (profile?.role !== "admin") throw new Error("Admin access required.");
      if (url.searchParams.has("error"))
        throw new Error("Xero connection was cancelled.");
      const tokens = await x.tokenRequest({
        grant_type: "authorization_code",
        code: url.searchParams.get("code") || "",
        redirect_uri: x.callbackUrl(),
      });
      const connections = await x.request("/connections", {
        token: tokens.access_token,
      });
      const previous = await x.connection();
      if (
        previous.tenant_id &&
        !connections.some((c) => c.tenantId === previous.tenant_id)
      )
        throw new Error(
          "Reconnect the same Xero organisation used by existing orders.",
        );
      await restUpdate(
        "xero_connection",
        { id: "eq.true" },
        {
          token_ciphertext: x.seal(tokens),
          expires_at: new Date(
            Date.now() + tokens.expires_in * 1000,
          ).toISOString(),
          connected_by: row.user_id,
          refresh_lock: null,
          refresh_until: null,
        },
        "",
      );
      res.setHeader(
        "Set-Cookie",
        "kims_xero_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/xero; Max-Age=0",
      );
      return redirect(
        res,
        "Connected. Choose the organisation and invoice settings below.",
      );
    } catch (e) {
      return redirect(res, e.message);
    }
  }
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const user = await x.requireAdmin(req);
    if (req.method === "GET") {
      if (!x.configured())
        return res
          .status(200)
          .json({
            configured: false,
            message:
              "One-time server setup is needed before Connect Xero is available.",
          });
      const [s, c] = await Promise.all([x.settings(), x.connection()]);
      let organisations = [],
        accounts = [],
        themes = [];
      if (c.token_ciphertext) {
        organisations = await x.request("/connections");
        if (c.tenant_id) {
          const [a, t] = await Promise.all([
            x.request("/Accounts"),
            x.request("/BrandingThemes"),
          ]);
          accounts = (a.Accounts || [])
            .filter(
              (a) =>
                a.Status === "ACTIVE" &&
                ["REVENUE", "SALES", "OTHERINCOME"].includes(a.Type),
            )
            .map((a) => ({ code: a.Code, name: a.Name }));
          themes = (t.BrandingThemes || []).map((t) => ({
            id: t.BrandingThemeID,
            name: t.Name,
          }));
        }
      }
      return res
        .status(200)
        .json({
          configured: true,
          connected: Boolean(c.token_ciphertext),
          tenant_id: c.tenant_id,
          tenant_name: c.tenant_name,
          settings: s,
          organisations: organisations.map((c) => ({
            id: c.tenantId,
            name: c.tenantName,
          })),
          accounts,
          themes,
          webhook_configured: Boolean(process.env.XERO_WEBHOOK_KEY),
        });
    }
    const body = await readJsonBody(req);
    if (body.action === "connect") {
      if (!x.configured())
        throw new Error("Complete the Xero server setup first.");
      const state = crypto.randomBytes(32).toString("hex"),
        cookie = crypto.randomBytes(32).toString("hex");
      await restInsert("xero_oauth_states", {
        state_hash: x.hash(state),
        cookie_hash: x.hash(cookie),
        user_id: user.id,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      });
      res.setHeader(
        "Set-Cookie",
        `kims_xero_state=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/api/xero; Max-Age=600`,
      );
      const auth = new URL("https://login.xero.com/identity/connect/authorize");
      Object.entries({
        response_type: "code",
        client_id: process.env.XERO_CLIENT_ID,
        redirect_uri: x.callbackUrl(),
        scope:
          "offline_access accounting.invoices accounting.contacts accounting.settings.read",
        state,
      }).forEach(([k, v]) => auth.searchParams.set(k, v));
      return res.status(200).json({ url: auth.href });
    }
    if (body.action === "select_organisation") {
      if (!x.uuid(body.tenant_id))
        throw new Error("Choose a valid organisation.");
      const c = await x.connection();
      if (c.tenant_id && c.tenant_id !== body.tenant_id)
        throw new Error(
          "This shop is already linked to another organisation. Do not switch organisations while orders are linked.",
        );
      const list = await x.request("/connections"),
        selected = list.find((c) => c.tenantId === body.tenant_id);
      if (!selected)
        throw new Error("This organisation has not authorised the connection.");
      await restUpdate(
        "xero_connection",
        { id: "eq.true" },
        {
          tenant_id: selected.tenantId,
          tenant_name: selected.tenantName,
          connection_id: selected.id,
        },
        "",
      );
      return res.status(200).json({ saved: true });
    }
    if (body.action === "save_settings") {
      const s = body.settings || {},
        c = await x.connection();
      const due = Number(s.due_days),
        bank = String(s.bank_number || "").trim(),
        bankName = String(s.bank_name || "").trim();
      if (!Number.isInteger(due) || due < 0 || due > 90)
        throw new Error("Payment terms must be between 0 and 90 days.");
      if (
        !/^\d{2}-\d{4}-\d{7}-\d{2,3}$/.test(bank) ||
        !bankName ||
        bankName.length > 150
      )
        throw new Error("Enter the bank account name and number.");
      if (s.enabled) {
        if (
          !c.token_ciphertext ||
          !c.tenant_id ||
          !process.env.XERO_WEBHOOK_KEY
        )
          throw new Error(
            "Connect Xero and configure its webhook before enabling invoice checkout.",
          );
        if (!s.stripe_ready)
          throw new Error(
            "Connect Stripe to the selected Xero invoice template before enabling both payment options.",
          );
        const [accounts, themes, tax] = await Promise.all([
          x.request("/Accounts"),
          x.request("/BrandingThemes"),
          restSelect("shop_inventory_settings", "tax_mode", {
            id: "eq.true",
            limit: "1",
          }),
        ]);
        if (tax[0]?.tax_mode !== "none")
          throw new Error(
            "This business is not GST registered. Choose No GST in shop tax settings first.",
          );
        if (
          !accounts.Accounts?.some(
            (a) =>
              a.Code === s.sales_account_code &&
              a.Status === "ACTIVE" &&
              ["REVENUE", "SALES", "OTHERINCOME"].includes(a.Type),
          )
        )
          throw new Error("Choose an active Xero sales account.");
        if (
          !themes.BrandingThemes?.some(
            (t) => t.BrandingThemeID === s.branding_theme_id,
          )
        )
          throw new Error(
            "Choose the Xero invoice template with the bank details and Stripe payments.",
          );
      }
      await restUpdate(
        "shop_invoice_settings",
        { id: "eq.true" },
        {
          enabled: s.enabled === true,
          bank_name: bankName,
          bank_number: bank,
          due_days: due,
          sales_account_code: String(s.sales_account_code || "").slice(0, 20),
          branding_theme_id: x.uuid(s.branding_theme_id)
            ? s.branding_theme_id
            : null,
          stripe_ready: s.stripe_ready === true,
          updated_at: new Date().toISOString(),
        },
        "",
      );
      return res.status(200).json({ saved: true });
    }
    if (body.action === "sync_order") {
      if (!x.uuid(body.order_id)) throw new Error("Invalid order.");
      const [o] = await restSelect("shop_orders", "id,payment_provider", {
        id: `eq.${body.order_id}`,
        limit: "1",
      });
      if (o?.payment_provider !== "xero")
        throw new Error("This order has no Xero invoice.");
      await x.rpc("enqueue_xero_order", { p_order_id: o.id });
      runInBackground(processJobs());
      return res.status(200).json({ queued: true });
    }
    if (body.action === "fulfilment") {
      if (
        !x.uuid(body.order_id) ||
        ![
          "unfulfilled",
          "in_progress",
          "ready",
          "completed",
          "cancelled",
        ].includes(body.status)
      )
        throw new Error("Invalid fulfilment update.");
      await restUpdate(
        "shop_orders",
        { id: `eq.${body.order_id}` },
        { fulfilment_status: body.status },
        "",
      );
      return res.status(200).json({ saved: true });
    }
    throw new Error("Unknown action.");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
};
