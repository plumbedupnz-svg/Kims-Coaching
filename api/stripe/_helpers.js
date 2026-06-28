const crypto = require("crypto");

const publicSupabaseAnonKey = "sb_publishable_34HW1F0Asg7kEk8vEYCiLQ_9jO1jl4m";

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.kimjonescoaching.co.nz").replace(/\/+$/, "");
}

function trimUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getSupabaseProjectUrl(value = "") {
  const trimmed = trimUrl(value);
  return trimmed.endsWith("/rest/v1") ? trimmed.slice(0, -"/rest/v1".length) : trimmed;
}

function getSupabaseRestUrl(value = "") {
  const projectUrl = getSupabaseProjectUrl(value);
  return projectUrl ? `${projectUrl}/rest/v1` : "";
}

function getSupabaseConfig() {
  const configuredUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tbvfpaikyxqhncjvnusr.supabase.co";
  const projectUrl = getSupabaseProjectUrl(configuredUrl);
  return {
    projectUrl,
    restUrl: getSupabaseRestUrl(configuredUrl),
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || publicSupabaseAnonKey,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

function requireStripeSecret() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return process.env.STRIPE_SECRET_KEY;
}

function getServiceHeaders(prefer = "") {
  const { serviceRoleKey } = getSupabaseConfig();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function verifyUser(authHeader = "") {
  const token = String(authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Please log in before checkout.");
  const { projectUrl, anonKey } = getSupabaseConfig();
  const response = await fetch(`${projectUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) throw new Error("Could not verify your login session.");
  return response.json();
}

async function restSelect(table, select, params = {}) {
  const { restUrl } = getSupabaseConfig();
  const url = new URL(`${restUrl}/${table}`);
  url.searchParams.set("select", select);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  const response = await fetch(url, { headers: getServiceHeaders() });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} select failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

async function restInsert(table, payload, select = "*") {
  const { restUrl } = getSupabaseConfig();
  const response = await fetch(`${restUrl}/${table}?select=${encodeURIComponent(select)}`, {
    method: "POST",
    headers: getServiceHeaders("return=representation"),
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} insert failed: ${response.status} ${text}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) ? rows[0] : rows;
}

async function restUpdate(table, params, payload, select = "*") {
  const { restUrl } = getSupabaseConfig();
  const url = new URL(`${restUrl}/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  if (select) url.searchParams.set("select", select);
  const response = await fetch(url, {
    method: "PATCH",
    headers: getServiceHeaders(select ? "return=representation" : "return=minimal"),
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} update failed: ${response.status} ${text}`);
  if (!select) return null;
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) ? rows[0] : rows;
}

function cents(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}

function moneyText(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function calculateDiscountedPrice(price, discount) {
  return Math.max(0, Number(price || 0) * (1 - Number(discount || 0) / 100));
}

function formAppend(params, key, value) {
  if (value !== undefined && value !== null && value !== "") params.append(key, String(value));
}

async function createStripeCheckoutSession({ lineItems, metadata, customerEmail, successPath = "/payment-success.html", cancelPath = "/payment-cancelled.html" }) {
  const secret = requireStripeSecret();
  const siteUrl = getSiteUrl();
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", `${siteUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url", `${siteUrl}${cancelPath}`);
  formAppend(params, "customer_email", customerEmail);
  Object.entries(metadata || {}).forEach(([key, value]) => formAppend(params, `metadata[${key}]`, value));

  lineItems.forEach((item, index) => {
    params.append(`line_items[${index}][quantity]`, String(item.quantity || 1));
    params.append(`line_items[${index}][price_data][currency]`, "nzd");
    params.append(`line_items[${index}][price_data][unit_amount]`, String(cents(item.unitAmount)));
    params.append(`line_items[${index}][price_data][product_data][name]`, item.name || "Kim Jones Coaching");
    formAppend(params, `line_items[${index}][price_data][product_data][description]`, item.description);
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || `Stripe returned ${response.status}`;
    throw new Error(message);
  }
  return json;
}

function verifyStripeSignature(rawBody, signatureHeader = "") {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  const parts = String(signatureHeader || "").split(",").reduce((acc, item) => {
    const [key, value] = item.split("=");
    if (key && value) {
      if (!acc[key]) acc[key] = [];
      acc[key].push(value);
    }
    return acc;
  }, {});
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) throw new Error("Missing Stripe signature.");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const valid = signatures.some((signature) => {
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
  if (!valid) throw new Error("Invalid Stripe signature.");
}

function uuidList(values = []) {
  const ids = values.filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "")));
  return ids.length ? `in.(${ids.join(",")})` : "in.()";
}

function textList(values = []) {
  const escaped = values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`);
  return escaped.length ? `in.(${escaped.join(",")})` : "in.()";
}

async function callEmail(type, payload) {
  const siteUrl = getSiteUrl();
  try {
    const response = await fetch(`${siteUrl}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error || json?.message || `Email API returned ${response.status}`;
      console.error("[Stripe webhook] email API returned an error", { type, status: response.status, message });
      return { ...json, sent: false, status: "failed", statusCode: response.status, error: message };
    }
    return { ...json, statusCode: response.status };
  } catch (error) {
    console.error("[Stripe webhook] email failed safely", { type, message: error.message });
    return { sent: false, status: "failed", error: error.message };
  }
}

module.exports = {
  calculateDiscountedPrice,
  callEmail,
  cents,
  createStripeCheckoutSession,
  getRawBody,
  getSiteUrl,
  getSupabaseConfig,
  moneyText,
  readJsonBody,
  restInsert,
  restSelect,
  restUpdate,
  textList,
  uuidList,
  verifyStripeSignature,
  verifyUser
};
