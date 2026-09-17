const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../analytics.js"), "utf8")
  .replace(/const measurementId = "[^"]*";/, 'const measurementId = "G-TEST123";');

function load({ url = "https://www.kimjonescoaching.co.nz/booking?email=private@example.com#access_token=secret", choice, blockedStorage = false, referrer = "https://www.google.com/search?q=private" } = {}) {
  const scripts = [];
  const elements = [];
  const listeners = {};
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
    body: element(), createElement: element, querySelector: () => null,
    addEventListener(name, callback) { listeners[name] = callback; }
  };
  const window = {
    location: Object.assign(new URL(url), { reload() { reloads++; } }),
    addEventListener(name, callback) { listeners[name] = callback; }
  };
  const localStorage = {
    getItem(key) { if (blockedStorage) throw new Error("Storage blocked"); return storage.get(key) || null; },
    setItem(key, value) { if (blockedStorage) throw new Error("Storage blocked"); storage.set(key, value); }
  };
  vm.runInNewContext(source, { window, document, localStorage, URL, Date, Set });
  const commands = () => (window.dataLayer || []).map((args) => Array.from(args));
  return { window, scripts, elements, listeners, commands, storage, reloads: () => reloads };
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
  for (const route of ["account", "login", "admin", "owner", "payment-success", "payment-cancelled", "booking-confirmation", "email-verified"]) {
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
