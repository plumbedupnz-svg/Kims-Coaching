const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { checkoutMeasurement, createAnalyticsToken, verifyAnalyticsToken, transactionId } = require("../api/stripe/_analytics");
const handler = require("../api/stripe/analytics-purchase");

const id = "cs_live_abcdefghijklmnopqrstuvwxyz123456";
const orderId = "11111111-2222-4333-8444-555555555555";
const session = { id, livemode: true, mode: "payment", currency: "nzd", status: "complete", payment_status: "paid", amount_total: 5000, metadata: { booking_type: "private_lesson", player_name: "Private Player" }, customer_email: "private@example.com" };

function environment(t) {
  const previous = { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_tests_only";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-tests-only";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

async function request(body, method = "POST") {
  const res = { code: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body }, res);
  return res;
}

test("checkout proof is bound to a live session, rejects tampering and expires", (t) => {
  environment(t);
  const token = createAnalyticsToken(id);
  assert.equal(verifyAnalyticsToken(id, token), true);
  assert.equal(verifyAnalyticsToken(id + "x", token), false);
  assert.equal(verifyAnalyticsToken(id, token.slice(0, -1) + (token.endsWith("0") ? "1" : "0")), false);
  assert.equal(createAnalyticsToken(id.replace("live", "test")), "");
  const expired = Date.now() - 1000;
  const signature = crypto.createHmac("sha256", process.env.STRIPE_SECRET_KEY).update(`kims-analytics-v1:${id}:${expired}`).digest("hex");
  assert.equal(verifyAnalyticsToken(id, `${expired}.${signature}`), false);
});

test("purchase endpoint requires valid proof before contacting Stripe", async (t) => {
  environment(t);
  const mock = t.mock.method(global, "fetch", async () => { throw new Error("must not call"); });
  const denied = await request({ session_id: id, token: "fake" });
  assert.equal(denied.code, 403);
  assert.equal(denied.headers["Cache-Control"], "no-store");
  assert.equal((await request({}, "GET")).code, 405);
  assert.equal(mock.mock.callCount(), 0);
});

test("only complete, paid, matching live sessions produce purchase data", async (t) => {
  environment(t);
  let current = session;
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(String(url), "https://api.stripe.com/v1/checkout/sessions/" + id);
    assert.ok(options.signal);
    return { ok: true, json: async () => current };
  });
  const body = { session_id: id, token: createAnalyticsToken(id) };
  for (const overrides of [{ status: "open" }, { payment_status: "unpaid" }, { livemode: false }, { id: id + "x" }, { currency: "usd" }, { amount_total: 1.5 }]) {
    current = { ...session, ...overrides };
    assert.equal((await request(body)).code, 409);
  }
  current = session;
  const paid = await request(body);
  assert.equal(paid.code, 200);
  assert.deepEqual(paid.body, { currency: "NZD", value: 50, tax: 0, shipping: 0, items: [{ item_id: "private_lesson", item_name: "Private tennis coaching", price: 50, quantity: 1 }], transaction_id: transactionId(id) });
  assert.doesNotMatch(JSON.stringify(paid.body), /private@example|Private Player|cs_live|metadata/);
  assert.equal(transactionId(id), transactionId(id));
  assert.notEqual(transactionId(id), transactionId(id + "x"));
});

test("shop purchase uses matching saved order, keeps product IDs stable and separates GST and shipping", async (t) => {
  environment(t);
  const shopSession = { ...session, amount_total: 12000, metadata: { booking_type: "shop_order", order_id: orderId } };
  t.mock.method(global, "fetch", async (url) => {
    if (String(url).startsWith("https://api.stripe.com/")) return { ok: true, json: async () => shopSession };
    const query = new URL(url).searchParams;
    assert.equal(query.get("id"), "eq." + orderId);
    assert.equal(query.get("stripe_session_id"), "eq." + id);
    assert.equal(query.get("select"), "items,shipping_amount,tax_amount,tax_included_amount");
    return { ok: true, text: async () => JSON.stringify([{ items: [{ id: "product-1", inventory_item_id: "inventory-other", name: "Tennis balls", quantity: 2, unitAmount: 57.5, cost_price: 8, description: "private notes" }], shipping_amount: 5, tax_amount: 0, tax_included_amount: 15 }]) };
  });
  const paid = await request({ session_id: id, token: createAnalyticsToken(id) });
  assert.equal(paid.code, 200);
  assert.equal(paid.body.value, 100);
  assert.equal(paid.body.tax, 15);
  assert.equal(paid.body.shipping, 5);
  assert.deepEqual(paid.body.items, [{ item_id: "product-1", item_name: "Tennis balls", price: 50, quantity: 2 }]);
  assert.doesNotMatch(JSON.stringify(paid.body), /cost_price|private notes|inventory-other|customer|cs_live/);
});

test("exclusive GST, tax rounding, invalid quantities and amount mismatches fail safely", async () => {
  const shopSession = { ...session, amount_total: 12000, metadata: { booking_type: "shop_order", order_id: orderId } };
  const order = { items: [{ id: "product-1", name: "Balls", quantity: 2, unitAmount: 50 }], shipping_amount: 5, tax_amount: 15.0000001, tax_included_amount: 0 };
  const data = await checkoutMeasurement(shopSession, order);
  assert.equal(data.value, 100);
  assert.equal(data.tax, 15);
  assert.equal(await checkoutMeasurement({ ...shopSession, amount_total: 20000 }, order), null);
  await assert.rejects(checkoutMeasurement(shopSession, { ...order, items: [{ ...order.items[0], quantity: -1 }] }), /Invalid analytics item/);
  assert.equal(await checkoutMeasurement(shopSession, { ...order, items: Array(201).fill(order.items[0]) }), null);
});

test("Stripe and database errors return generic errors without leaking upstream details", async (t) => {
  environment(t);
  let throwError = false;
  t.mock.method(global, "fetch", async () => {
    if (throwError) throw new Error("private@example.com sk_secret internal database error");
    return { ok: false };
  });
  const body = { session_id: id, token: createAnalyticsToken(id) };
  assert.equal((await request(body)).code, 502);
  throwError = true;
  const failed = await request(body);
  assert.equal(failed.code, 503);
  assert.doesNotMatch(JSON.stringify(failed.body), /private@example|sk_secret|database error/);
});
