const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const crypto = require("node:crypto");
function load(file, mocks = {}, extras = {}) {
  const filename = path.resolve(file),
    module = { exports: {} },
    real = createRequire(filename);
  const context = {
    module,
    exports: module.exports,
    require: (name) => (name in mocks ? mocks[name] : real(name)),
    Buffer,
    URL,
    URLSearchParams,
    AbortSignal,
    Intl,
    Date,
    console,
    process: { env: {} },
    fetch: async () => {
      throw new Error("Unexpected external request");
    },
    ...extras,
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return module.exports;
}
const response = () => ({
  headers: {},
  code: 200,
  setHeader(k, v) {
    this.headers[k] = v;
  },
  status(n) {
    this.code = n;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  end() {
    return this;
  },
});
const key = "12345678-1234-4234-8234-123456789012";
const client = require("../lib/xero/client");
const order = {
  id: key,
  order_reference: "KJC-000123",
  xero_tenant_id: key,
  created_at: "2026-09-17T14:00:00Z",
  xero_due_date: "2026-09-18",
  tax_mode: "none",
  total_amount: 75,
  shipping_amount: 5,
  discount_amount: 0,
  customer_name: "Demo",
  customer_email: "demo@example.com",
  items: [
    { name: "Labour", quantity: 1, unitAmount: 50 },
    { name: "Strings", quantity: 1, unitAmount: 20 },
  ],
};
const settings = {
  enabled: true,
  sales_account_code: "200",
  branding_theme_id: key,
};
const invoice = {
  InvoiceID: key,
  InvoiceNumber: order.order_reference,
  Reference: order.id,
  Type: "ACCREC",
  CurrencyCode: "NZD",
  Total: 75,
  AmountDue: 75,
  AmountPaid: 0,
  Status: "AUTHORISED",
};

test("invoice lines contain labour, strings and delivery with no GST; unsafe links and mismatches fail", () => {
  const lib = load("lib/xero/invoices.js", {
    "../../api/stripe/_helpers": { getSiteUrl: () => "https://shop.example" },
  });
  const result = lib.invoicePayload(order, settings, key);
  assert.equal(result.Date, "2026-09-18");
  assert.equal(result.LineAmountTypes, "NoTax");
  assert.equal(
    result.LineItems.reduce((sum, l) => sum + l.Quantity * l.UnitAmount, 0),
    75,
  );
  assert.ok(
    result.LineItems.every(
      (l) => l.TaxType === "NONE" && l.AccountCode === "200",
    ),
  );
  assert.throws(
    () =>
      lib.invoicePayload(
        { ...order, tax_mode: "gst_inclusive" },
        settings,
        key,
      ),
    /GST/,
  );
  assert.throws(
    () => lib.checkInvoice(order, { ...invoice, Reference: "other" }),
    /does not match/,
  );
  assert.throws(
    () => lib.checkInvoice(order, { ...invoice, Total: 74.99 }),
    /does not match/,
  );
  for (const value of [
    "javascript:alert(1)",
    "https://xero.com.attacker.example/invoice",
    "http://in.xero.com/a",
  ])
    assert.throws(() => lib.safeInvoiceUrl(value), /invalid/);
});

test("lost invoice-create response recovers the same invoice; uncertain email is not resent", async () => {
  let stored = { ...order },
    posts = [],
    attempts = 0;
  const x = {
    ...client,
    connection: async () => ({ tenant_id: key }),
    settings: async () => settings,
    rpc: async (name, p) => {
      assert.equal(name, "apply_xero_invoice_state");
      stored = { ...stored, xero_invoice_status: p.p_status };
      return stored;
    },
    request: async (url, opts = {}) => {
      if (opts.method === "POST") {
        posts.push(url);
        if (url.endsWith("/Email")) {
          attempts++;
          throw new Error("response lost");
        }
        throw new Error("Unexpected duplicate invoice");
      }
      if (url.endsWith("/OnlineInvoice"))
        return {
          OnlineInvoices: [{ OnlineInvoiceUrl: "https://in.xero.com/demo" }],
        };
      if (url.startsWith("/Invoices")) return { Invoices: [invoice] };
      throw new Error(url);
    },
  };
  const lib = load("lib/xero/invoices.js", {
    "./client": x,
    "../../api/stripe/_helpers": {
      restUpdate: async (table, where, payload) => {
        stored = { ...stored, ...payload };
        return stored;
      },
      getSiteUrl: () => "https://shop.example",
    },
  });
  await lib.syncOrder(stored);
  await lib.syncOrder(stored);
  assert.equal(stored.xero_invoice_id, key);
  assert.equal(stored.invoice_email_status, "needs_review");
  assert.equal(attempts, 1);
  assert.deepEqual(posts, [`/Invoices/${key}/Email`]);
});

test("webhooks require a signature, accept intent validation, and only queue events for a verified fetch", async () => {
  let jobs = 0,
    queued;
  const secret = "test-webhook-key";
  const handler = load("api/xero-webhook.js", {
    "./stripe/_helpers": { getRawBody: async (req) => req.body },
    "../lib/xero/client": {
      ...client,
      verifyWebhook: (r, s) => client.verifyWebhook(r, s, secret),
      rpc: async (name, p) => {
        queued = { name, p };
      },
    },
    "../lib/xero/invoices": {
      processJobs: async () => {
        jobs++;
      },
      runInBackground: (p) => p,
    },
  });
  for (const valid of [false, true]) {
    const raw = Buffer.from('{"events":[]}'),
      res = response();
    await handler(
      {
        method: "POST",
        headers: {
          "x-xero-signature": valid
            ? crypto.createHmac("sha256", secret).update(raw).digest("base64")
            : "bad",
        },
        body: raw,
      },
      res,
    );
    assert.equal(res.code, valid ? 200 : 401);
  }
  assert.equal(jobs, 0);
  const raw = Buffer.from(
      JSON.stringify({
        events: [
          { eventCategory: "INVOICE", resourceId: key, tenantId: key },
          { eventCategory: "CONTACT", resourceId: key, tenantId: key },
        ],
      }),
    ),
    res = response();
  await handler(
    {
      method: "POST",
      headers: {
        "x-xero-signature": crypto
          .createHmac("sha256", secret)
          .update(raw)
          .digest("base64"),
      },
      body: raw,
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(jobs, 1);
  assert.equal(queued.name, "enqueue_xero_events");
  assert.equal(queued.p.p_events.length, 1);
  const get = response();
  await handler({ method: "GET", headers: {} }, get);
  assert.equal(get.code, 401);
});

test("existing invoice retries stay on Xero after checkout is disabled; changed details cannot reuse the key", async () => {
  const body = {
    checkout_key: key,
    cart: [{ id: key, quantity: 1 }],
    checkout: { email: "demo@example.com", payment_method: "bank_transfer" },
  };
  const digest = client.hash(
    JSON.stringify({ user_id: null, cart: body.cart, checkout: body.checkout }),
  );
  let legacy = 0,
    options = 0;
  const handler = load("api/shop-checkout.js", {
    "./stripe/create-checkout-session": () => {
      legacy++;
    },
    "./stripe/_helpers": {
      readJsonBody: async (r) => r.body,
      restSelect: async () => [{ id: key, checkout_digest: digest }],
      getSiteUrl: () => "https://shop.example",
    },
    "../lib/xero/client": {
      ...client,
      publicOptions: async () => {
        options++;
        return { provider: "stripe" };
      },
    },
    "../lib/xero/invoices": {
      processJobs: async () => {},
      runInBackground: (p) => p,
    },
  });
  const res = response();
  await handler({ method: "POST", headers: {}, body }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.provider, "xero");
  assert.equal(legacy, 0);
  assert.equal(options, 0);
  const changed = response();
  await handler(
    {
      method: "POST",
      headers: {},
      body: { ...body, cart: [{ id: key, quantity: 2 }] },
    },
    changed,
  );
  assert.equal(changed.code, 400);
  assert.match(changed.body.error, /details changed/);
});

test("enabling invoicing fails closed on missing credentials or database outages", async () => {
  const make = (restSelect) =>
    load(
      "lib/xero/client.js",
      { "../../api/stripe/_helpers": { restSelect } },
      { process: { env: {} } },
    );
  await assert.rejects(
    make(async () => [{ enabled: true }]).publicOptions(),
    /temporarily unavailable/,
  );
  await assert.rejects(
    make(async () => {
      throw new Error("timeout");
    }).publicOptions(),
    /could not be loaded/,
  );
  assert.equal(
    (
      await make(async () => {
        throw new Error("42P01 missing table");
      }).publicOptions()
    ).provider,
    "stripe",
  );
});

test("tokens are encrypted with authenticated encryption and tampering fails", () => {
  const x = load(
    "lib/xero/client.js",
    {},
    {
      process: {
        env: {
          XERO_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
        },
      },
    },
  );
  const sealed = x.seal({ refresh_token: "test-private-token" });
  assert.ok(!sealed.includes("test-private-token"));
  assert.equal(x.unseal(sealed).refresh_token, "test-private-token");
  const bytes = Buffer.from(sealed, "base64");
  bytes[30] ^= 1;
  assert.throws(() => x.unseal(bytes.toString("base64")));
});

test("server prices override cart prices; service-only orders do not charge delivery", async () => {
  const helpers = require("../api/stripe/_helpers");
  const fn = load("api/stripe/create-checkout-session.js", {
    "./_helpers": {
      ...helpers,
      restSelect: async (table) => {
        if (table === "products") return [];
        if (table === "inventory_items")
          return [
            {
              id: key,
              product_name: "Stringing labour",
              sell_price: 50,
              discount: 10,
              item_kind: "service",
              track_stock: false,
              is_order_to_sale: false,
              visible_in_shop: true,
              is_active: true,
              quantity_on_hand: 0,
            },
          ];
        if (table === "shop_inventory_settings")
          return [
            {
              tax_mode: "none",
              courier_delivery_fee: 10,
              courier_delivery_enabled: true,
            },
          ];
        throw new Error(table);
      },
    },
  });
  const { payload } = await fn.prepareShopOrder({
    body: {
      cart: [{ id: key, quantity: 2, price: 1, fulfilment_type: "stock" }],
      checkout: {
        customer: {
          full_name: "Demo Customer",
          email: "demo@example.com",
          phone: "0210000000",
        },
        fulfilment_method: "courier",
      },
    },
  });
  assert.equal(payload.total_amount, 90);
  assert.equal(payload.shipping_amount, 0);
  assert.equal(payload.fulfilment_method, "pickup");
  assert.equal(payload.items[0].fulfilment_type, "service");
  await assert.rejects(
    fn.getShopLineItems([{ id: key, quantity: 0.5 }]),
    /whole quantity/,
  );
});

test("old Stripe shop endpoint cannot bypass invoice routing", async () => {
  let routed = 0;
  const handler = load("api/stripe/create-checkout-session.js", {
    "./_helpers": { readJsonBody: async (req) => req.body },
    "../shop-checkout": async (req, res) => {
      routed++;
      res.status(200).json({ provider: "xero" });
    },
  });
  const res = response();
  await handler(
    { method: "POST", headers: {}, body: { booking_type: "shop_order" } },
    res,
  );
  assert.equal(routed, 1);
  assert.equal(res.body.provider, "xero");
});

test("OAuth callback cannot exchange a code without matching state, cookie and active admin", async () => {
  let exchanged = 0;
  const helpers = {
    getSiteUrl: () => "https://shop.example",
    restUpdate: async () => null,
  };
  const x = {
    ...client,
    tokenRequest: async () => {
      exchanged++;
    },
  };
  const handler = load("api/xero.js", {
    "./stripe/_helpers": helpers,
    "../lib/xero/client": x,
    "../lib/xero/invoices": {},
  });
  for (const cookie of ["", "kims_xero_state=incorrect"]) {
    const res = response();
    await handler(
      {
        method: "GET",
        url: "/api/xero?action=callback&state=incorrect&code=bad",
        headers: { cookie },
      },
      res,
    );
    assert.equal(res.code, 303);
    assert.match(res.headers.Location, /expired/);
  }
  assert.equal(exchanged, 0);
  const noAdmin = load("api/xero.js", {
    "./stripe/_helpers": {
      ...helpers,
      restUpdate: async () => ({ user_id: key }),
      restSelect: async () => [{ role: "customer" }],
    },
    "../lib/xero/client": x,
    "../lib/xero/invoices": {},
  });
  const res = response();
  await noAdmin(
    {
      method: "GET",
      url: "/api/xero?action=callback&state=matching&code=bad",
      headers: { cookie: "kims_xero_state=matching" },
    },
    res,
  );
  assert.match(res.headers.Location, /Admin/);
  assert.equal(exchanged, 0);
});

test("admin invoice actions reject unauthenticated requests before doing work", async () => {
  const handler = load("api/xero.js", {
    "./stripe/_helpers": { getSiteUrl: () => "https://shop.example" },
    "../lib/xero/client": {
      requireAdmin: async () => {
        throw new Error("Admin access required.");
      },
    },
    "../lib/xero/invoices": {},
  });
  for (const method of ["GET", "POST"]) {
    const res = response();
    await handler(
      {
        method,
        url: "/api/xero",
        headers: {},
        body: { action: "save_settings" },
      },
      res,
    );
    assert.equal(res.code, 400);
    assert.match(res.body.error, /Admin/);
  }
});

test("both payment choices save server totals and the configured bank and due date", async () => {
  for (const method of ["card", "bank_transfer"]) {
    let saved;
    const stripe = Object.assign(
      () => {
        throw new Error("Must not start a separate Stripe charge");
      },
      {
        prepareShopOrder: async (args) => {
          assert.equal(args.strictSettings, true);
          return {
            payload: {
              ...order,
              customer_email: "demo@example.com",
              customer_name: "Demo",
              items: [
                {
                  name: "Labour",
                  quantity: 1,
                  unitAmount: 50,
                  fulfilment_type: "service",
                },
              ],
              total_amount: 50,
            },
          };
        },
      },
    );
    const handler = load("api/shop-checkout.js", {
      "./stripe/create-checkout-session": stripe,
      "./stripe/_helpers": {
        readJsonBody: async (r) => r.body,
        restSelect: async () => [],
        getSiteUrl: () => "https://shop.example",
      },
      "../lib/xero/client": {
        ...client,
        publicOptions: async () => ({ provider: "xero", card: true }),
        connection: async () => ({ tenant_id: key }),
        settings: async () => ({
          bank_name: "KIM JONES COACHING LTD",
          bank_number: "01-0286-0978708-00",
          due_days: 0,
        }),
        rpc: async (name, p) => {
          assert.equal(name, "create_invoiced_shop_order");
          saved = p.p_order;
        },
      },
      "../lib/xero/invoices": {
        processJobs: async () => {},
        runInBackground: (p) => p,
      },
    });
    const res = response();
    await handler(
      {
        method: "POST",
        headers: {},
        body: {
          checkout_key: key,
          cart: [{ id: key, quantity: 1, price: 1 }],
          checkout: { payment_method: method, service_details: "Demo racket" },
        },
      },
      res,
    );
    assert.equal(res.code, 200);
    assert.equal(saved.payment_method, method);
    assert.equal(saved.total_amount, 50);
    assert.equal(saved.invoice_bank_number, "01-0286-0978708-00");
    assert.equal(saved.service_details, "Demo racket");
    assert.equal(saved.checkout_key_hash, client.hash(key));
    assert.match(saved.xero_due_date, /^\d{4}-\d{2}-\d{2}$/);
  }
});
