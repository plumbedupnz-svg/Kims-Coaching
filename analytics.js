(function () {
  "use strict";

  // Kim's own GA4 web stream. Never use the Plumbed Up measurement ID here.
  const measurementId = "G-QG6T2RRY6J";
  const consentKey = "kims_analytics_consent_v1";
  const consentLifetime = 180 * 24 * 60 * 60 * 1000;
  const pageTitles = {
    "/": "Private Tennis Coaching | Kim Jones Coaching",
    "/booking": "Book Tennis Coaching | Kim Jones Coaching",
    "/shop": "Tennis Shop | Kim Jones Coaching",
    "/product": "Product | Kim Jones Coaching",
    "/privacy": "Privacy Policy | Kim Jones Coaching",
    "/delivery": "NZ Delivery & Pickup | Kim Jones Coaching",
    "/returns": "Returns & Order Help | Kim Jones Coaching",
    "/contact": "Contact Kim | Kim Jones Coaching",
    "/guides/junior-racket-size": "Junior Racket Guide | Kim Jones Coaching",
    "/guides/tennis-grips": "Tennis Grip Guide | Kim Jones Coaching"
  };
  for (const [slug, title] of Object.entries({
    "junior-tennis-rackets": "Junior Tennis Rackets NZ", "tennis-rackets": "Tennis Rackets NZ",
    "pickleball-paddles": "Pickleball Paddles NZ", "tennis-grips": "Tennis Grips NZ",
    "tennis-balls": "Tennis Balls NZ", "tennis-bags": "Tennis Bags NZ",
    "tennis-strings": "Tennis Strings NZ", "dampeners": "Tennis Dampeners NZ",
    "pickleball-accessories": "Pickleball Accessories NZ", "training": "Tennis Training NZ",
    "accessories": "Tennis Accessories NZ", "racket-services": "Racket Services"
  })) pageTitles["/shop/" + slug] = title + " | Kim Jones Coaching";
  const path = window.location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  const pagePath = path === "/index" ? "/" : path === "/book-private-lesson" ? "/booking" : path;
  const paymentReturn = pagePath === "/payment-success";
  // Public production pages only; payment returns require separate server verification.
  if (!["www.kimjonescoaching.co.nz", "kimjonescoaching.co.nz"].includes(window.location.hostname)
      || (!pageTitles[pagePath] && !paymentReturn) || !/^G-[A-Z0-9]+$/.test(measurementId)) return;

  let consent = readConsent();
  let started = false;
  let banner;
  let settingsButton;
  const sent = new Set();
  let viewedProduct;
  let cartVisible = false;
  let lastCartView = "";

  function readConsent() {
    try {
      const saved = JSON.parse(localStorage.getItem(consentKey));
      if (saved && Date.now() - saved.at < consentLifetime && ["granted", "denied"].includes(saved.value)) return saved.value;
    } catch (_) { /* Storage is optional; the site still works without it. */ }
    return "";
  }

  function referrerOrigin() {
    try {
      const url = new URL(document.referrer);
      if (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com")) return "";
      return url.origin + "/";
    } catch (_) { return ""; }
  }

  function campaign() {
    const query = new URL(window.location.href).searchParams;
    const values = {};
    // Use campaign codes, never customer names/contact details, in UTM links.
    for (const [parameter, field] of [["utm_source", "campaign_source"], ["utm_medium", "campaign_medium"], ["utm_campaign", "campaign_name"], ["utm_id", "campaign_id"], ["utm_content", "campaign_content"]]) {
      const value = query.get(parameter);
      if (value && /^[a-z][a-z0-9_-]{0,99}$/i.test(value)) values[field] = value;
    }
    return values;
  }

  function gtag() { window.dataLayer.push(arguments); }

  function publicPageLocation() {
    const base = "https://www.kimjonescoaching.co.nz";
    // Product identity comes from server-rendered catalogue metadata, never an
    // arbitrary query string. Search queries, tokens and customer data stay out.
    if (pagePath === "/product") {
      try {
        const canonical = new URL(document.querySelector('link[rel="canonical"]')?.href);
        if (canonical.origin === base && canonical.pathname === "/product"
            && [...canonical.searchParams.keys()].length === 1
            && /^[a-z0-9-]{1,90}$/.test(canonical.searchParams.get("slug") || "")) return canonical.href;
      } catch (_) {}
    }
    return base + (paymentReturn ? "/checkout-complete" : pagePath);
  }

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
      page_location: publicPageLocation(),
      page_referrer: referrerOrigin(),
      page_title: paymentReturn ? "Checkout complete | Kim Jones Coaching" : pageTitles[pagePath]
    };
    gtag("set", page);
    gtag("config", measurementId, {
      ...page, ...campaign(), send_page_view: false, allow_google_signals: false,
      ...(paymentReturn ? { ignore_referrer: true } : {}),
      ...(new URL(window.location.href).searchParams.get("analytics_debug") === "1" ? { debug_mode: true } : {}),
      allow_ad_personalization_signals: false, cookie_expires: consentLifetime / 1000
    });
    if (!paymentReturn) gtag("event", "page_view", page);
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
    document.head.appendChild(script);
    if (!paymentReturn && (viewedProduct || window.KimsAnalyticsProduct)) viewProduct(viewedProduct || window.KimsAnalyticsProduct);
    if (!paymentReturn) viewCart();
  }

  // Accept only known event names and fixed labels. Never forward form data.
  function track(name, label, dedupeId) {
    if (consent !== "granted" || !started) return;
    const labels = {
      generate_lead: ["private_lesson", "waitlist", "junior_group"],
      booking_click: ["booking"],
      contact_click: ["email", "phone"]
    };
    if (!labels[name]?.includes(label)) return;
    // IDs are used only locally to prevent duplicates; they are never sent to Google.
    const key = dedupeId ? name + ":" + dedupeId : "";
    if (key && sent.has(key)) return;
    if (key) sent.add(key);
    gtag("event", name, { event_category: label, ...(name === "generate_lead" ? { lead_type: label } : {}), transport_type: "beacon" });
  }

  function cleanItems(items) {
    if (!Array.isArray(items) || !items.length || items.length > 200) return [];
    return items.map((item) => {
      const id = String(item.item_id || item.id || "");
      const price = Number(item.price);
      const quantity = Number(item.quantity ?? 1);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !Number.isFinite(price) || price < 0
          || !Number.isInteger(quantity) || quantity < 1) return null;
      return { item_id: id, item_name: String(item.item_name || item.name || "Shop product").slice(0, 100), price, quantity };
    }).filter(Boolean);
  }

  function sendCommerce(name, data, extra = {}) {
    if (consent !== "granted" || !started) return;
    const items = cleanItems(data.items);
    if (!items.length || items.length !== data.items.length) return;
    const value = Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
    gtag("event", name, { currency: "NZD", value, items, ...extra, transport_type: "beacon" });
  }

  function commerce(name, items) {
    if (!["add_to_cart", "remove_from_cart", "view_cart"].includes(name)) return;
    sendCommerce(name, { items });
  }

  function viewCart() {
    if (!cartVisible || consent !== "granted" || !started) return;
    const items = cleanItems(window.KimsShop?.loadCart?.() || []);
    const signature = JSON.stringify(items);
    if (!items.length || signature === lastCartView) return;
    lastCartView = signature;
    sendCommerce("view_cart", { items });
  }

  function viewProduct(product) {
    viewedProduct = product;
    if (consent !== "granted" || !started || !product) return;
    const key = "view_item:" + product.id;
    if (sent.has(key)) return;
    sent.add(key);
    sendCommerce("view_item", { items: [product] });
  }

  function checkout(data, kind) {
    if (consent !== "granted" || !started || !["private_lesson", "shop_order", "junior_group"].includes(kind)
        || !/^cs_live_[A-Za-z0-9]{12,240}$/.test(data?.id || "") || !data.analytics?.commerce) return;
    try { sessionStorage.setItem("kims_analytics_checkout:" + data.id, data.analytics.token); } catch (_) {}
    const key = "begin_checkout:" + data.id;
    if (sent.has(key)) return;
    sent.add(key);
    sendCommerce("begin_checkout", data.analytics.commerce, { checkout_type: kind });
  }

  async function purchaseReturn() {
    if (consent !== "granted") return;
    try {
      const sessionId = new URL(window.location.href).searchParams.get("session_id");
      if (!/^cs_live_[A-Za-z0-9]{12,240}$/.test(sessionId || "")) return;
      const token = sessionStorage.getItem("kims_analytics_checkout:" + sessionId);
      if (!token) return;
      const response = await fetch("/api/stripe/analytics-purchase", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, token })
      });
      if (!response.ok) return;
      const purchase = await response.json();
      if (readConsent() !== "granted" || !/^kj_[a-f0-9]{32}$/.test(purchase.transaction_id || "") || purchase.currency !== "NZD") return;
      const key = "kims_analytics_purchase:" + purchase.transaction_id;
      if (sessionStorage.getItem(key) || sent.has(key)) return;
      const items = cleanItems(purchase.items);
      const value = Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
      if (!items.length || items.length !== purchase.items.length || !Number.isFinite(purchase.value) || Math.abs(value - purchase.value) > 0.01
          || ![purchase.tax, purchase.shipping].every((amount) => Number.isFinite(amount) && amount >= 0)) return;
      start();
      sent.add(key);
      sendCommerce("purchase", purchase, {
        transaction_id: purchase.transaction_id, tax: purchase.tax, shipping: purchase.shipping,
        event_callback: () => { try { sessionStorage.setItem(key, "sent"); } catch (_) {} }
      });
    } catch (_) { /* Optional analytics must never affect payment confirmation. */ }
  }

  window.KimsAnalytics = { track, commerce, viewProduct, checkout, isAllowed: () => consent === "granted" };

  function clearAnalyticsCookies() {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key?.startsWith("kims_analytics_checkout:")) sessionStorage.removeItem(key);
      }
    } catch (_) {}
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
    banner.innerHTML = '<div><strong>Help us improve the website</strong><p>Allow Google Analytics cookies to measure visits, booking enquiries and purchases? Your choice does not affect bookings or shopping. <a href="/privacy#analytics">Privacy details</a></p></div><div class="analytics-consent-actions"><button type="button" data-analytics-accept>Allow analytics</button><button type="button" data-analytics-decline>No thanks</button></div>';
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
    const cart = document.querySelector("#cart");
    if (cart && typeof IntersectionObserver !== "undefined") {
      new IntersectionObserver((entries) => {
        cartVisible = entries.some((entry) => entry.isIntersecting);
        viewCart();
      }).observe(cart);
    }
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
      if (paymentReturn) purchaseReturn();
      else start();
      if (banner) banner.hidden = Boolean(consent);
    }
  });
  window.addEventListener("kims:cart-rendered", viewCart);
  if (paymentReturn) purchaseReturn();
  else {
    start();
    mountPreferences();
  }
})();
