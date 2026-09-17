(function () {
  "use strict";

  // Kim's own GA4 web stream. Never use the Plumbed Up measurement ID here.
  const measurementId = "";
  const consentKey = "kims_analytics_consent_v1";
  const consentLifetime = 180 * 24 * 60 * 60 * 1000;
  const pageTitles = {
    "/": "Private Tennis Coaching | Kim Jones Coaching",
    "/booking": "Book Tennis Coaching | Kim Jones Coaching",
    "/shop": "Tennis Shop | Kim Jones Coaching",
    "/product": "Product | Kim Jones Coaching",
    "/privacy": "Privacy Policy | Kim Jones Coaching"
  };
  const path = window.location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  const pagePath = path === "/index" ? "/" : path === "/book-private-lesson" ? "/booking" : path;
  // Never collect from preview deployments, private accounts, payment returns or admin pages.
  if (!["www.kimjonescoaching.co.nz", "kimjonescoaching.co.nz"].includes(window.location.hostname)
      || !pageTitles[pagePath] || !/^G-[A-Z0-9]+$/.test(measurementId)) return;

  let consent = readConsent();
  let started = false;
  let banner;
  let settingsButton;
  const sent = new Set();

  function readConsent() {
    try {
      const saved = JSON.parse(localStorage.getItem(consentKey));
      if (saved && Date.now() - saved.at < consentLifetime && ["granted", "denied"].includes(saved.value)) return saved.value;
    } catch (_) { /* Storage is optional; the site still works without it. */ }
    return "";
  }

  function referrerOrigin() {
    try { return new URL(document.referrer).origin + "/"; } catch (_) { return ""; }
  }

  function gtag() { window.dataLayer.push(arguments); }

  function start() {
    if (started || consent !== "granted") return;
    started = true;
    window["ga-disable-" + measurementId] = false;
    window.dataLayer = window.dataLayer || [];
    gtag("consent", "default", {
      analytics_storage: "denied", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied"
    });
    gtag("consent", "update", { analytics_storage: "granted" });
    gtag("js", new Date());
    // Fixed titles and clean URLs keep names, emails, auth tokens, search terms,
    // order IDs and booking details out of automatic page and engagement events.
    const page = {
      page_location: "https://www.kimjonescoaching.co.nz" + pagePath,
      page_referrer: referrerOrigin(),
      page_title: pageTitles[pagePath]
    };
    gtag("set", page);
    gtag("config", measurementId, {
      ...page, send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false, cookie_expires: consentLifetime / 1000
    });
    gtag("event", "page_view", page);
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
    document.head.appendChild(script);
  }

  // Accept only known event names and fixed labels. Never forward form data.
  function track(name, label, dedupeId) {
    if (consent !== "granted" || !started) return;
    const labels = {
      generate_lead: ["private_lesson", "waitlist"],
      begin_checkout: ["private_lesson", "shop_order", "junior_group"],
      booking_click: ["booking"],
      contact_click: ["email", "phone"]
    };
    if (!labels[name]?.includes(label)) return;
    // IDs are used only locally to prevent duplicates; they are never sent to Google.
    const key = dedupeId ? name + ":" + dedupeId : "";
    if (key && sent.has(key)) return;
    if (key) sent.add(key);
    gtag("event", name, { event_category: label, transport_type: "beacon" });
  }
  window.KimsAnalytics = { track };

  function clearAnalyticsCookies() {
    const domains = ["", window.location.hostname, "kimjonescoaching.co.nz", ".kimjonescoaching.co.nz"];
    document.cookie.split(";").forEach((entry) => {
      const name = entry.split("=")[0].trim();
      if (name !== "_ga" && !name.startsWith("_ga_")) return;
      domains.forEach((domain) => {
        document.cookie = name + "=; Max-Age=0; path=/" + (domain ? "; domain=" + domain : "");
      });
    });
  }

  function choose(value) {
    consent = value;
    try { localStorage.setItem(consentKey, JSON.stringify({ value, at: Date.now() })); } catch (_) {}
    banner.hidden = true;
    if (value === "granted") start();
    else {
      window["ga-disable-" + measurementId] = true;
      clearAnalyticsCookies();
      if (started) { window.location.reload(); return; }
    }
    settingsButton?.focus();
  }

  function mountPreferences() {
    banner = document.createElement("section");
    banner.className = "analytics-consent";
    banner.setAttribute("aria-label", "Analytics cookie preferences");
    banner.innerHTML = '<div><strong>Help us improve the website</strong><p>Allow Google Analytics cookies to measure visits and booking enquiries? Your choice does not affect bookings or shopping. <a href="/privacy#analytics">Privacy details</a></p></div><div class="analytics-consent-actions"><button type="button" data-analytics-accept>Allow analytics</button><button type="button" data-analytics-decline>No thanks</button></div>';
    banner.hidden = Boolean(consent);
    document.body.appendChild(banner);
    banner.querySelector("[data-analytics-accept]").addEventListener("click", () => choose("granted"));
    banner.querySelector("[data-analytics-decline]").addEventListener("click", () => choose("denied"));
    settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "analytics-settings";
    settingsButton.textContent = "Cookie preferences";
    settingsButton.addEventListener("click", () => {
      banner.hidden = false;
      banner.querySelector("[data-analytics-accept]").focus();
    });
    (document.querySelector(".footer-inner") || document.body).appendChild(settingsButton);
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      const url = new URL(link.href, window.location.href);
      if (url.protocol === "mailto:") track("contact_click", "email");
      else if (url.protocol === "tel:") track("contact_click", "phone");
      else if (url.origin === window.location.origin && /^\/(booking(?:\.html)?|book-private-lesson)$/.test(url.pathname)) track("booking_click", "booking");
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== consentKey && event.key !== null) return;
    const updated = readConsent();
    if (updated === consent) return;
    consent = updated;
    if (consent !== "granted" && started) {
      window["ga-disable-" + measurementId] = true;
      clearAnalyticsCookies();
      window.location.reload();
    } else {
      start();
      if (banner) banner.hidden = Boolean(consent);
    }
  });
  start();
  mountPreferences();
})();
