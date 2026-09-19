const crypto = require("node:crypto");
const {
  getSupabaseConfig,
  restSelect,
  restUpdate,
  verifyUser,
  getSiteUrl,
} = require("../../api/stripe/_helpers");
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value),
  );
function encryptionKey() {
  const key = Buffer.from(
    process.env.XERO_TOKEN_ENCRYPTION_KEY || "",
    "base64",
  );
  if (key.length !== 32)
    throw new Error("Xero token encryption is not configured.");
  return key;
}
function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function unseal(value) {
  const data = Buffer.from(value, "base64");
  const cipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
}
function configured() {
  return Boolean(
    process.env.XERO_CLIENT_ID &&
      process.env.XERO_CLIENT_SECRET &&
      process.env.XERO_TOKEN_ENCRYPTION_KEY,
  );
}
async function rpc(name, body) {
  const c = getSupabaseConfig();
  if (!c.serviceRoleKey)
    throw new Error("Database server credentials are not configured.");
  const r = await fetch(`${c.restUrl}/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: c.serviceRoleKey,
      Authorization: `Bearer ${c.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.message || `Database operation failed (${r.status}).`);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
async function requireAdmin(req) {
  const user = await verifyUser(req.headers.authorization || "");
  const [profile] = await restSelect("profiles", "role", {
    id: `eq.${user.id}`,
    limit: "1",
  });
  if (profile?.role !== "admin") throw new Error("Admin access required.");
  return user;
}
async function connection() {
  return (
    await restSelect("xero_connection", "*", { id: "eq.true", limit: "1" })
  )[0];
}
async function settings() {
  return (
    await restSelect("shop_invoice_settings", "*", {
      id: "eq.true",
      limit: "1",
    })
  )[0];
}
async function tokenRequest(params) {
  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token || !data.refresh_token)
    throw new Error(
      "Xero authorisation expired or was refused. Reconnect Xero in Settings.",
    );
  return data;
}
async function accessToken() {
  let c = await connection();
  if (!c?.token_ciphertext) throw new Error("Connect Xero in Settings first.");
  if (Date.parse(c.expires_at) > Date.now() + 90000)
    return { token: unseal(c.token_ciphertext).access_token, connection: c };
  const lease = crypto.randomUUID();
  const locked = await restUpdate(
    "xero_connection",
    {
      id: "eq.true",
      or: `(refresh_until.is.null,refresh_until.lt.${new Date().toISOString()})`,
    },
    {
      refresh_lock: lease,
      refresh_until: new Date(Date.now() + 30000).toISOString(),
    },
  );
  if (!locked)
    throw new Error("Xero connection is refreshing. Please retry shortly.");
  try {
    c = await connection();
    if (Date.parse(c.expires_at) > Date.now() + 90000)
      return { token: unseal(c.token_ciphertext).access_token, connection: c };
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: unseal(c.token_ciphertext).refresh_token,
    });
    const saved = await restUpdate(
      "xero_connection",
      { id: "eq.true", refresh_lock: `eq.${lease}` },
      {
        token_ciphertext: seal(tokens),
        expires_at: new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString(),
      },
    );
    if (!saved) throw new Error("Xero connection changed while refreshing.");
    return { token: tokens.access_token, connection: saved };
  } finally {
    await restUpdate(
      "xero_connection",
      { id: "eq.true", refresh_lock: `eq.${lease}` },
      { refresh_lock: null, refresh_until: null },
      "",
    );
  }
}
async function request(
  path,
  { method = "GET", body, tenant, token, key } = {},
) {
  const auth = token
    ? { token, connection: { tenant_id: tenant } }
    : await accessToken();
  const tenantId = tenant || auth.connection.tenant_id;
  if (!tenantId && path !== "/connections")
    throw new Error("Choose the Xero organisation in Settings.");
  const root =
    path === "/connections"
      ? "https://api.xero.com"
      : "https://api.xero.com/api.xro/2.0";
  const response = await fetch(root + path, {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(tenantId ? { "Xero-tenant-id": tenantId } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  if (!response.ok || data.Invoices?.some((i) => i.HasErrors)) {
    // Never echo OAuth tokens, contact payloads or raw provider responses to customers/logs.
    const error = new Error(
      response.status === 429
        ? "Xero is rate limiting requests. The order will retry."
        : `Xero request failed (${response.status}). Check the invoice and account settings.`,
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
async function publicOptions() {
  let s;
  try {
    s = await settings();
  } catch (error) {
    // Deploying code before the additive migration must preserve existing checkout.
    if (!configured() && /42P01|PGRST205/.test(error.message))
      return { provider: "stripe", bank_transfer: false };
    throw new Error(
      "Payment settings could not be loaded. Please try again shortly.",
    );
  }
  if (!s?.enabled) return { provider: "stripe", bank_transfer: false };
  if (!configured())
    throw new Error(
      "Invoice payments are temporarily unavailable. Please contact Kim.",
    );
  const c = await connection();
  if (!c?.tenant_id || !c.token_ciphertext)
    throw new Error(
      "Invoice payments are temporarily unavailable. Please contact Kim.",
    );
  return {
    provider: "xero",
    bank_transfer: true,
    card: s.stripe_ready,
    bank_name: s.bank_name,
    bank_number: s.bank_number,
    due_days: s.due_days,
  };
}
function callbackUrl() {
  return `${getSiteUrl()}/api/xero?action=callback`;
}
function verifyWebhook(raw, signature, secret = process.env.XERO_WEBHOOK_KEY) {
  if (!secret || typeof signature !== "string") return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("base64");
  const a = Buffer.from(expected),
    b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = {
  hash,
  uuid,
  seal,
  unseal,
  configured,
  rpc,
  requireAdmin,
  connection,
  settings,
  tokenRequest,
  accessToken,
  request,
  publicOptions,
  callbackUrl,
  verifyWebhook,
};
