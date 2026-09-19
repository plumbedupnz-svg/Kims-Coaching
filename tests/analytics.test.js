const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../analytics.js"), "utf8")
  .replace(/const measurementId = "[^"]*";/, 'const measurementId = "G-TEST123";');

function load({ url = "https://www.kimjonescoaching.co.nz/booking?email=private@example.com#access_token=secret", choice, blockedStorage = false, referrer = "https://www.google.com/search?q=private", session = new Map(), fetchResponse, cart } = {}) {
  const scripts = [];
  const elements = [];
  const listeners = {};
  const requests = [];
  let intersection;
  const storage = new Map();
  if (choice) storage.set("kims_analytics_consent_v1", JSON.stringify({ value: choice, at: Date.now() }));
  let reloads = 0;
  function element() {
    const children = new Map();
    const events = {};
    return {
      events, hidden: false, setAttribute() {}, focus() {},
      addEventListener(name, callback) { events[name] = callback; },
      appendChild(child) { elements.push(child); },
      querySelector(selector) { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); }
    };
  }
  const document = {
    referrer, cookie: "", head: { appendChild(script) { scripts.push(script); } },
    body: element(), createElement: element, querySelector: (selector) => selector === "#cart" && cart ? element() : null,
    addEventListener(name, callback) { listeners[name] = callback; }
  };
  const window = {
    location: Object.assign(new URL(url), { reload() { reloads++; } }),
    ...(cart ? { KimsShop: { loadCart: () => cart } } : {}),
    addEventListener(name, callback) { listeners[name] = callback; }
  };
  const localStorage = {
    getItem(key) { if (blockedStorage) throw new Error("Storage blocked"); return storage.get(key) || null; },
    setItem(key, value) { if (blockedStorage) throw new Error("Storage blocked"); storage.set(key, value); }
  };
  const sessionStorage = {
    get length() { return session.size; },
    key(index) { return [...session.keys()][index]; },
    getItem(key) { return session.get(key) || null; },
    setItem(key, value) { session.set(key, value); },
    removeItem(key) { session.delete(key); }
  };
  const fetch = async (...args) => { requests.push(args); return fetchResponse ? fetchResponse(...args) : { ok: false }; };
  class IntersectionObserver { constructor(callback) { intersection = callback; } observe() {} }
  vm.runInNewContext(source, { window, document, localStorage, sessionStorage, fetch, IntersectionObserver, URL, Date, Set });
  const commands = () => (window.dataLayer || []).map((args) => Array.from(args));
  return { window, scripts, elements, listeners, commands, storage, session, requests, intersection: (visible) => intersection?.([{ isIntersecting: visible }]), reloads: () => reloads };
}

test("no Google requests or events until analytics is allowed", () => {
  const app = load();
  assert.equal(app.scripts.length, 0);
  assert.equal(app.commands().length, 0);
  app.window.KimsAnalytics.track("generate_lead", "private_lesson");
  assert.equal(app.commands().length, 0);
  app.elements[0].querySelector("[data-analytics-decline]").events.click();
  assert.equal(app.scripts.length, 0);
  assert.equal(app.commands().length, 0);
});

test("consent starts one page view with no personal URL or referrer data", () => {
  const app = load();
  const accept = app.elements[0].querySelector("[data-analytics-accept]").events.click;
  accept();
  accept();
  assert.equal(app.scripts.length, 1);
  assert.equal(app.commands().filter((args) => args[1] === "page_view").length, 1);
  const page = app.commands().find((args) => args[1] === "page_view")[2];
  assert.equal(page.page_location, "https://www.kimjonescoaching.co.nz/booking");
  assert.equal(page.page_referrer, "https://www.google.com/");
  assert.doesNotMatch(JSON.stringify(app.commands()), /private@example|access_token|secret|search\?q/);
  const config = app.commands().find((args) => args[0] === "config")[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
});

test("only allowlisted conversion labels are sent; booking identifiers stay local", () => {
  const app = load({ choice: "granted" });
  app.window.KimsAnalytics.track("generate_lead", "private_lesson", "private-booking-id");
  app.window.KimsAnalytics.track("generate_lead", "private_lesson", "private-booking-id");
  app.window.KimsAnalytics.track("generate_lead", { email: "private@example.com" });
  app.window.KimsAnalytics.track("purchase", "shop_order");
  const leads = app.commands().filter((args) => args[1] === "generate_lead");
  assert.equal(leads.length, 1);
  assert.equal(leads[0][2].event_category, "private_lesson");
  assert.doesNotMatch(JSON.stringify(app.commands()), /private-booking-id|private@example|purchase/);
});

test("private pages and preview hosts never load analytics even with consent", () => {
  for (const route of ["account", "login", "admin", "owner", "payment-cancelled", "booking-confirmation", "email-verified"]) {
    for (const suffix of ["", ".html"]) {
      const app = load({ url: "https://www.kimjonescoaching.co.nz/" + route + suffix, choice: "granted" });
      assert.equal(app.scripts.length, 0, route + suffix);
      assert.equal(app.window.KimsAnalytics, undefined);
    }
  }
  for (const host of ["localhost", "kims-coaching.vercel.app", "kims-coaching-git-example.vercel.app"]) {
    assert.equal(load({ url: "https://" + host + "/", choice: "granted" }).scripts.length, 0);
  }
});

const paidSessionId = "cs_live_abcdefghijklmnopqrstuvwxyz123456";
const publicItem = { item_id: "product-1", item_name: "Tennis balls", price: 20, quantity: 2 };
const purchase = { currency: "NZD", value: 40, tax: 6, shipping: 5, items: [publicItem], transaction_id: "kj_" + "a".repeat(32) };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const returnOptions = (extra = {}) => ({
  url: "https://www.kimjonescoaching.co.nz/payment-success.html?session_id=" + paidSessionId,
  choice: "granted", session: new Map([["kims_analytics_checkout:" + paidSessionId, "signed-proof"]]),
  fetchResponse: async () => ({ ok: true, json: async () => purchase }), ...extra
});

test("safe campaign codes survive sanitising URLs; search terms and contacts do not", () => {
  const app = load({ choice: "granted", url: "https://www.kimjonescoaching.co.nz/?utm_source=newsletter&utm_medium=email&utm_campaign=spring_2026&utm_content=private%40example.com&utm_term=child-name&email=private%40example.com" });
  const config = app.commands().find((args) => args[0] === "config")[2];
  assert.equal(config.campaign_source, "newsletter");
  assert.equal(config.campaign_medium, "email");
  assert.equal(config.campaign_name, "spring_2026");
  assert.doesNotMatch(JSON.stringify(app.commands()), /private|child-name|utm_|@/);
});

test("product views wait for consent; ecommerce forwards only catalog fields and rejects invalid baskets", () => {
  const app = load();
  const product = { id: "product-1", name: "Tennis balls", price: 20, quantity: 2, email: "private@example.com", cost: 5 };
  app.window.KimsAnalytics.viewProduct(product);
  app.window.KimsAnalytics.commerce("add_to_cart", [product]);
  assert.equal(app.commands().length, 0);
  app.elements[0].querySelector("[data-analytics-accept]").events.click();
  app.window.KimsAnalytics.viewProduct(product);
  app.window.KimsAnalytics.commerce("add_to_cart", [product]);
  app.window.KimsAnalytics.commerce("add_to_cart", [product, { ...product, quantity: -1 }]);
  assert.equal(app.commands().filter((args) => args[1] === "view_item").length, 1);
  const cartEvents = app.commands().filter((args) => args[1] === "add_to_cart");
  assert.equal(cartEvents.length, 1);
  assert.equal(cartEvents[0][2].value, 40);
  assert.equal(cartEvents[0][2].currency, "NZD");
  assert.deepEqual(JSON.parse(JSON.stringify(cartEvents[0][2].items)), [publicItem]);
  assert.doesNotMatch(JSON.stringify(app.commands()), /private@example|cost/);
});

test("cart views require a visible nonempty cart and do not repeat on unrelated renders", () => {
  const cart = [{ ...publicItem }];
  const app = load({ choice: "granted", cart });
  app.listeners["kims:cart-rendered"]();
  assert.equal(app.commands().filter((args) => args[1] === "view_cart").length, 0);
  app.intersection(true);
  app.listeners["kims:cart-rendered"]();
  assert.equal(app.commands().filter((args) => args[1] === "view_cart").length, 1);
  cart[0].quantity++;
  app.listeners["kims:cart-rendered"]();
  assert.equal(app.commands().filter((args) => args[1] === "view_cart").length, 2);
});

test("checkout uses verified commerce data once, keeps proofs local and forgets them on withdrawal", () => {
  const app = load({ choice: "granted" });
  const checkout = { id: paidSessionId, analytics: { token: "private-proof", commerce: purchase } };
  app.window.KimsAnalytics.checkout(checkout, "shop_order");
  app.window.KimsAnalytics.checkout(checkout, "shop_order");
  assert.equal(app.commands().filter((args) => args[1] === "begin_checkout").length, 1);
  assert.equal(app.session.get("kims_analytics_checkout:" + paidSessionId), "private-proof");
  assert.doesNotMatch(JSON.stringify(app.commands()), /cs_live_|private-proof|transaction_id/);
  app.elements[0].querySelector("[data-analytics-decline]").events.click();
  assert.equal(app.session.size, 0);
});

test("payment success URLs alone, test sessions and denied consent never load Google or verify payments", async () => {
  for (const options of [{ session: new Map() }, { choice: "denied" }, { url: "https://www.kimjonescoaching.co.nz/payment-success?session_id=cs_test_abcdefghijklmnopqrstuvwxyz" }]) {
    const app = load(returnOptions(options));
    await tick();
    assert.equal(app.requests.length, 0);
    assert.equal(app.scripts.length, 0);
    assert.equal(app.commands().length, 0);
  }
});

test("verified purchase has no raw session, pageview or Stripe referral and deduplicates after reload", async () => {
  const options = returnOptions({ referrer: "https://checkout.stripe.com/c/pay/secret" });
  const app = load(options);
  assert.equal(app.scripts.length, 0);
  await tick();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0][0], "/api/stripe/analytics-purchase");
  const events = app.commands().filter((args) => args[0] === "event");
  assert.equal(events.length, 1);
  assert.equal(events[0][1], "purchase");
  assert.equal(events[0][2].value, 40);
  assert.equal(events[0][2].tax, 6);
  assert.equal(events[0][2].shipping, 5);
  assert.equal(events[0][2].transaction_id, purchase.transaction_id);
  assert.doesNotMatch(JSON.stringify(app.commands()), /cs_live|session_id|signed-proof|stripe.com/);
  events[0][2].event_callback();
  const reloaded = load(options);
  await tick();
  assert.equal(reloaded.scripts.length, 0);
  assert.equal(reloaded.commands().length, 0);
});

test("failed verification or inconsistent purchase totals never start Google", async () => {
  for (const result of [{ ok: false }, { ok: true, json: async () => ({ ...purchase, value: 900 }) }, { ok: true, json: async () => ({ ...purchase, value: undefined }) }]) {
    const app = load(returnOptions({ fetchResponse: async () => result }));
    await tick();
    assert.equal(app.scripts.length, 0);
    assert.equal(app.commands().length, 0);
  }
});

test("consent withdrawn while payment verification is pending prevents collection", async () => {
  let finish;
  const app = load(returnOptions({ fetchResponse: () => new Promise((resolve) => { finish = resolve; }) }));
  app.storage.set("kims_analytics_consent_v1", JSON.stringify({ value: "denied", at: Date.now() }));
  finish({ ok: true, json: async () => purchase });
  await tick();
  assert.equal(app.scripts.length, 0);
  assert.equal(app.commands().length, 0);
});

test("denial persists and consent works when browser storage is unavailable", () => {
  assert.equal(load({ choice: "denied" }).scripts.length, 0);
  const app = load({ blockedStorage: true });
  assert.equal(app.scripts.length, 0);
  app.elements[0].querySelector("[data-analytics-accept]").events.click();
  assert.equal(app.scripts.length, 1);
});

test("revoking consent disables the active tag and subsequent conversion events", () => {
  const app = load({ choice: "granted" });
  app.elements[0].querySelector("[data-analytics-decline]").events.click();
  assert.equal(app.window["ga-disable-G-TEST123"], true);
  assert.equal(app.reloads(), 1);
  app.window.KimsAnalytics.track("generate_lead", "waitlist");
  assert.equal(app.commands().filter((args) => args[1] === "generate_lead").length, 0);
});

test("revocation in another tab stops measurement in this tab", () => {
  const app = load({ choice: "granted" });
  app.storage.set("kims_analytics_consent_v1", JSON.stringify({ value: "denied", at: Date.now() }));
  app.listeners.storage({ key: "kims_analytics_consent_v1" });
  assert.equal(app.reloads(), 1);
  assert.equal(app.window["ga-disable-G-TEST123"], true);
});
