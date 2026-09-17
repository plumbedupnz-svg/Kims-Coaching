const crypto = require("node:crypto");
const { restSelect } = require("./_helpers");

const sessionPattern = /^cs_live_[A-Za-z0-9]{12,240}$/;
const round = (value) => Math.round(value * 100) / 100;

function signature(sessionId, expires) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
  return crypto.createHmac("sha256", process.env.STRIPE_SECRET_KEY)
    .update(`kims-analytics-v1:${sessionId}:${expires}`).digest("hex");
}

function createAnalyticsToken(sessionId) {
  if (!sessionPattern.test(sessionId)) return "";
  const expires = Date.now() + 72 * 60 * 60 * 1000;
  return `${expires}.${signature(sessionId, expires)}`;
}

function verifyAnalyticsToken(sessionId, token) {
  if (!sessionPattern.test(sessionId) || !/^\d{13}\.[a-f0-9]{64}$/.test(token || "")) return false;
  const [expires, supplied] = token.split(".");
  if (Number(expires) < Date.now() || Number(expires) > Date.now() + 73 * 60 * 60 * 1000) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(signature(sessionId, expires)));
}

function publicItem(item, priceRatio = 1) {
  const id = String(item.id || item.inventory_item_id || "");
  const quantity = Number(item.quantity);
  const price = Math.round(Number(item.unitAmount) * 100) / 100 * priceRatio;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !Number.isInteger(quantity) || quantity < 1
      || !Number.isFinite(price) || price < 0) throw new Error("Invalid analytics item.");
  return {
    item_id: id,
    item_name: String(item.name || "Shop product").slice(0, 100),
    price: Number(price.toFixed(6)), quantity
  };
}

async function checkoutMeasurement(session, preparedOrder) {
  if (session.livemode !== true || session.mode !== "payment" || session.currency !== "nzd"
      || !Number.isSafeInteger(session.amount_total) || session.amount_total < 0) return null;
  const kind = session.metadata?.booking_type;
  const total = session.amount_total / 100;
  if (["private_lesson", "junior_group", "junior_group_admin_payment_request"].includes(kind)) {
    const category = kind === "private_lesson" ? "private_lesson" : "junior_group";
    return {
      currency: "NZD", value: total, tax: 0, shipping: 0,
      items: [{ item_id: category, item_name: category === "private_lesson" ? "Private tennis coaching" : "Junior group coaching", price: total, quantity: 1 }]
    };
  }
  if (kind !== "shop_order" || !/^[a-f0-9-]{36}$/i.test(session.metadata?.order_id || "")) return null;
  // Select only order measurement fields. Customer/player/contact details never leave this service.
  const order = preparedOrder || (await restSelect("shop_orders", "items,shipping_amount,tax_amount,tax_included_amount", {
    id: `eq.${session.metadata.order_id}`, stripe_session_id: `eq.${session.id}`, limit: "1"
  }))[0];
  if (!order || !Array.isArray(order.items) || !order.items.length || order.items.length > 200) return null;
  const shipping = round(Number(order.shipping_amount || 0));
  const tax = round(Number(order.tax_amount || 0) + Number(order.tax_included_amount || 0));
  if (![shipping, tax].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const grossItems = order.items.map((item) => publicItem(item));
  const gross = round(grossItems.reduce((sum, item) => sum + item.price * item.quantity, 0));
  if (round(gross + Number(order.tax_amount || 0) + shipping) !== round(total)) return null;
  const value = round(total - shipping - tax);
  if (value < 0 || (gross === 0 && value !== 0)) return null;
  const items = order.items.map((item) => publicItem(item, gross ? value / gross : 1));
  return { currency: "NZD", value, shipping, tax, items };
}

function transactionId(sessionId) {
  return "kj_" + crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

module.exports = { checkoutMeasurement, createAnalyticsToken, verifyAnalyticsToken, transactionId };
