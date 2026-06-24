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
    EMAIL_PROVIDER: "resend"
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
    headers: {},
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
