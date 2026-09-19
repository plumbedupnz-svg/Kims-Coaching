const test = require("node:test");
const assert = require("node:assert/strict");

const handler = require("../api/send-email.js");

function createResponse() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    }
  };
}

test("legacy live provider settings are sent through Resend", async (context) => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const calls = [];

  context.after(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  Object.assign(process.env, {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    RESEND_API_KEY: "re_test",
    EMAIL_PROVIDER: "resend",
    EMAIL_INTERNAL_SECRET: "test-internal-secret"
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    if (url.includes("/email_settings")) {
      return new Response(JSON.stringify([{
        provider: "outlook_smtp",
        enabled: true,
        from_name: "Kim Jones Coaching",
        from_email: "notify@example.com",
        reply_to_email: "kim@example.com"
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/notification_logs") && options.method === "POST") {
      return new Response(JSON.stringify([{ id: "11111111-1111-1111-1111-111111111111" }]), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.includes("/notification_logs") && options.method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    if (url === "https://api.resend.com/emails") {
      return new Response(JSON.stringify({ id: "resend-message-id" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const request = {
    method: "POST",
    headers: { "x-kims-email-internal": "test-internal-secret" },
    body: {
      type: "booking_customer_confirmation",
      payload: { email: "customer@example.com", playerName: "Player" }
    }
  };
  const response = createResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.sent, true);
  assert.equal(response.body.provider, "resend");
  const resendCall = calls.find((call) => call.url === "https://api.resend.com/emails");
  assert.ok(resendCall);
  assert.deepEqual(resendCall.body.to, ["customer@example.com"]);
  assert.equal(resendCall.body.from, "Kim Jones Coaching <notify@example.com>");
  assert.equal(calls.some((call) => /smtp/i.test(call.url)), false);
});

test("shop customer confirmation includes a professional HTML receipt", async (context) => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const calls = [];

  context.after(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  Object.assign(process.env, {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    RESEND_API_KEY: "re_test",
    EMAIL_PROVIDER: "resend",
    EMAIL_INTERNAL_SECRET: "test-internal-secret"
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    if (url.includes("/email_settings")) {
      return new Response(JSON.stringify([{
        provider: "resend",
        enabled: true,
        from_name: "Kim Jones Coaching",
        from_email: "notify@example.com",
        reply_to_email: "kim@example.com"
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/notification_logs") && options.method === "POST") {
      return new Response(JSON.stringify([{ id: "22222222-2222-2222-2222-222222222222" }]), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.includes("/notification_logs") && options.method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    if (url === "https://api.resend.com/emails") {
      return new Response(JSON.stringify({ id: "resend-message-id" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const request = {
    method: "POST",
    headers: { "x-kims-email-internal": "test-internal-secret" },
    body: {
      type: "shop_order_customer_confirmation",
      payload: {
        relatedId: "12345678-90ab-cdef-1234-567890abcdef",
        customerName: "Alex <script>alert(1)</script> Customer",
        email: "alex@example.com",
        fulfilmentLabel: "Pick up from coaching / club",
        pickupInstructions: "Kim will confirm collection details shortly.",
        items: [{
          name: "Tourna Grip Blue",
          category: "Tennis Grips",
          quantity: 2,
          price: "$22.99",
          lineTotal: 45.98,
          availability_note: "We will confirm arrival once stock levels have been checked."
        }],
        subtotal: "$45.98",
        shipping: "$0.00",
        total: "$45.98"
      }
    }
  };
  const response = createResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.sent, true);
  const resendCall = calls.find((call) => call.url === "https://api.resend.com/emails");
  assert.ok(resendCall);
  assert.equal(resendCall.body.subject, "Your Kim Jones Coaching order confirmation");
  assert.match(resendCall.body.html, /Thanks for your order, Alex/);
  assert.doesNotMatch(resendCall.body.html, /<script>alert\(1\)<\/script>/);
  assert.match(resendCall.body.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(resendCall.body.html, /Order summary/);
  assert.match(resendCall.body.html, /Tourna Grip Blue/);
  assert.match(resendCall.body.html, /Some items are ordered in as needed/);
  assert.match(resendCall.body.text, /Tourna Grip Blue/);
});
