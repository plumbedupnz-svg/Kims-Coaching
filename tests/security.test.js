const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const emailHandler = require("../api/send-email.js");
const stripeHelpers = require("../api/stripe/_helpers.js");
const webhookHandler = require("../api/stripe/webhook.js");
const rateLimiter = require("../api/_rate-limit.js");

const root = path.resolve(__dirname, "..");

function createResponse() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    }
  };
}

test("send-email rejects unauthenticated customer email requests", async (context) => {
  const originalEnv = { ...process.env };
  context.after(() => {
    process.env = originalEnv;
  });
  process.env.EMAIL_INTERNAL_SECRET = "internal-only";

  const response = createResponse();
  await emailHandler({
    method: "POST",
    headers: {},
    body: {
      type: "booking_customer_confirmation",
      payload: { relatedId: "11111111-1111-1111-1111-111111111111", email: "victim@example.com" }
    }
  }, response);

  assert.equal(response.statusCode, 401);
  assert.match(response.body.error, /log in/i);
});

test("send-email rejects oversized request bodies", async () => {
  const response = createResponse();
  await emailHandler({
    method: "POST",
    headers: {},
    body: JSON.stringify({ type: "admin_alert", payload: { message: "x".repeat(300 * 1024) } })
  }, response);
  assert.equal(response.statusCode, 413);
});

test("Stripe signatures require a valid recent timestamp", (context) => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
  context.after(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const raw = Buffer.from('{"id":"evt_test"}');
  const now = 2_000_000_000;
  const signature = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${now}.${raw.toString("utf8")}`)
    .digest("hex");

  assert.doesNotThrow(() => stripeHelpers.verifyStripeSignature(raw, `t=${now},v1=${signature}`, { nowSeconds: now }));
  assert.throws(
    () => stripeHelpers.verifyStripeSignature(raw, `t=${now - 301},v1=${signature}`, { nowSeconds: now }),
    /timestamp/i
  );
  assert.throws(
    () => stripeHelpers.verifyStripeSignature(raw, `t=${now},v1=${"0".repeat(64)}`, { nowSeconds: now }),
    /invalid/i
  );
});

test("Stripe JSON parser enforces the request size cap", async () => {
  await assert.rejects(
    () => stripeHelpers.readJsonBody({ headers: {}, body: { value: "x".repeat(300 * 1024) } }),
    (error) => error.statusCode === 413
  );
});

test("Stripe webhook event claims do not reprocess an active duplicate", async (context) => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  context.after(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });
  Object.assign(process.env, {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  });

  global.fetch = async (url, options = {}) => {
    if (options.method === "POST") return new Response("duplicate key value violates unique constraint", { status: 409 });
    if (String(url).includes("stripe_webhook_events")) {
      return new Response(JSON.stringify([{ id: "evt_duplicate", status: "processing" }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const claimed = await webhookHandler._test.createEventLog({
    id: "evt_duplicate",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test" } }
  });
  assert.equal(claimed, false);
});

test("security migration uses trusted totals and removes unsafe direct writes", () => {
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20260719000000_security_hardening.sql"),
    "utf8"
  );
  const privateFunction = migration.slice(
    migration.indexOf("create or replace function public.create_private_lesson_booking"),
    migration.indexOf("create or replace function public.create_junior_group_pending_booking")
  );

  assert.equal((privateFunction.match(/p_total_price/g) || []).length, 1);
  assert.match(privateFunction, /selected_lesson\.price[\s\S]*selected_bundle\.discount_percent/);
  assert.match(privateFunction, /trusted_total/);
  assert.match(migration, /revoke insert on public\.bookings from authenticated/);
  assert.match(migration, /revoke insert on public\.junior_group_members from authenticated/);
  assert.match(migration, /revoke insert, update on public\.junior_group_pending_bookings from authenticated/);
  assert.match(migration, /revoke insert on public\.shop_orders from authenticated/);
  assert.match(migration, /revoke all on function public\.apply_stock_movement[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.create_shop_order_with_stock[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /create trigger protect_player_workflow_fields/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
});

test("deployment config includes clickjacking, CSP, and no-store protections", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const serialized = JSON.stringify(config);
  assert.match(serialized, /Content-Security-Policy/);
  assert.match(serialized, /frame-ancestors 'none'/);
  assert.match(serialized, /X-Content-Type-Options/);
  assert.match(serialized, /no-store/);
});

test("endpoint throttling returns 429 after the configured allowance", () => {
  rateLimiter._test.buckets.clear();
  const request = { headers: { "x-forwarded-for": "203.0.113.10" } };
  const firstResponse = createResponse();
  const blockedResponse = createResponse();
  assert.equal(rateLimiter.enforceRateLimit(request, firstResponse, { scope: "test", limit: 1, windowMs: 60_000 }), true);
  assert.equal(rateLimiter.enforceRateLimit(request, blockedResponse, { scope: "test", limit: 1, windowMs: 60_000 }), false);
  assert.equal(blockedResponse.statusCode, 429);
  assert.equal(blockedResponse.headers["RateLimit-Remaining"], "0");
});
