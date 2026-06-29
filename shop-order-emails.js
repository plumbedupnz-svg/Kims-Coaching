(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const defaults = {
    pickup_label: "Pick up from coaching / club",
    pickup_instructions: "Kim will confirm the pickup details with you.",
    local_delivery_enabled: true,
    local_delivery_fee: 0,
    courier_delivery_enabled: true,
    courier_delivery_fee: 0,
    free_shipping_threshold: null
  };

  const fields = {
    fullName: document.getElementById("checkout-full-name"),
    email: document.getElementById("checkout-email"),
    phone: document.getElementById("checkout-phone"),
    fulfilment: document.getElementById("fulfilment-method"),
    help: document.querySelector("[data-fulfilment-help]"),
    addressWrap: document.querySelector("[data-delivery-address-fields]"),
    line1: document.getElementById("delivery-address-line1"),
    line2: document.getElementById("delivery-address-line2"),
    suburb: document.getElementById("delivery-suburb"),
    city: document.getElementById("delivery-city"),
    postcode: document.getElementById("delivery-postcode"),
    country: document.getElementById("delivery-country"),
    shipping: document.getElementById("shipping"),
    total: document.getElementById("total"),
    subtotal: document.getElementById("subtotal"),
    tax: document.getElementById("tax"),
    promoDiscount: document.getElementById("promo-discount"),
    message: document.getElementById("checkout-account-message"),
    checkoutButton: document.getElementById("checkout-btn")
  };

  let checkoutSettings = { ...defaults };
  let lastSummary = { subtotal: 0, tax: 0, promoDiscount: 0 };

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem("kims_cart") || "[]");
    } catch (error) {
      return [];
    }
  }

  function readMoney(text = "") {
    const number = Number(String(text || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function refreshSummaryFromDom() {
    lastSummary = {
      subtotal: readMoney(fields.subtotal?.textContent),
      tax: readMoney(fields.tax?.textContent),
      promoDiscount: Math.abs(readMoney(fields.promoDiscount?.textContent))
    };
  }

  async function getSession() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session || null;
  }

  function selectedFulfilment() {
    return fields.fulfilment?.value || "pickup";
  }

  function getShippingAmount(subtotal = lastSummary.subtotal) {
    const method = selectedFulfilment();
    const threshold = Number(checkoutSettings.free_shipping_threshold || 0);
    if (method !== "pickup" && threshold > 0 && Number(subtotal || 0) >= threshold) return 0;
    if (method === "local_delivery") return Number(checkoutSettings.local_delivery_fee || 0);
    if (method === "courier") return Number(checkoutSettings.courier_delivery_fee || 0);
    return 0;
  }

  function updateTotals() {
    if (!lastSummary.subtotal && fields.subtotal?.textContent) refreshSummaryFromDom();
    lastSummary.promoDiscount = 0;
    const shipping = getShippingAmount(lastSummary.subtotal);
    const total = Math.max(0, Number(lastSummary.subtotal || 0) + Number(lastSummary.tax || 0) - Number(lastSummary.promoDiscount || 0) + shipping);
    if (fields.promoDiscount) fields.promoDiscount.textContent = "-$0.00";
    if (fields.shipping) fields.shipping.textContent = money(shipping);
    if (fields.total) fields.total.textContent = money(total);
  }

  function updateFulfilmentHelp() {
    const method = selectedFulfilment();
    if (fields.addressWrap) fields.addressWrap.hidden = method === "pickup";
    if (!fields.help) return;
    if (method === "pickup") {
      fields.help.textContent = checkoutSettings.pickup_instructions || defaults.pickup_instructions;
    } else if (method === "local_delivery") {
      fields.help.textContent = `Local delivery: ${money(checkoutSettings.local_delivery_fee)}${checkoutSettings.free_shipping_threshold ? `, free over ${money(checkoutSettings.free_shipping_threshold)}` : ""}.`;
    } else {
      fields.help.textContent = `NZ courier delivery: ${money(checkoutSettings.courier_delivery_fee)}${checkoutSettings.free_shipping_threshold ? `, free over ${money(checkoutSettings.free_shipping_threshold)}` : ""}.`;
    }
    updateTotals();
  }

  function renderFulfilmentOptions() {
    if (!fields.fulfilment) return;
    const current = fields.fulfilment.value || "pickup";
    const options = [
      `<option value="pickup">${checkoutSettings.pickup_label || defaults.pickup_label} - $0.00</option>`
    ];
    if (checkoutSettings.local_delivery_enabled !== false) {
      options.push(`<option value="local_delivery">Local delivery - ${money(checkoutSettings.local_delivery_fee)}</option>`);
    }
    if (checkoutSettings.courier_delivery_enabled !== false) {
      options.push(`<option value="courier">NZ courier delivery - ${money(checkoutSettings.courier_delivery_fee)}</option>`);
    }
    fields.fulfilment.innerHTML = options.join("");
    fields.fulfilment.value = Array.from(fields.fulfilment.options).some((option) => option.value === current) ? current : "pickup";
    updateFulfilmentHelp();
  }

  async function loadCheckoutSettings() {
    if (!client) {
      renderFulfilmentOptions();
      return;
    }
    const { data, error } = await client
      .from("shop_inventory_settings")
      .select("pickup_label,pickup_instructions,local_delivery_enabled,local_delivery_fee,courier_delivery_enabled,courier_delivery_fee,free_shipping_threshold")
      .eq("id", true)
      .maybeSingle();
    if (error) {
      console.warn("Could not load shop checkout settings.", error.message);
      if (fields.message) fields.message.textContent = "Checkout settings could not be loaded, using pickup by default.";
    } else if (data) {
      checkoutSettings = { ...defaults, ...data };
    }
    renderFulfilmentOptions();
  }

  function setValue(input, value) {
    if (input && !input.value && value) input.value = value;
  }

  async function prefillCheckoutDetails() {
    const session = await getSession();
    if (!session?.user || !client) return null;
    const { data: profile } = await client
      .from("profiles")
      .select("email,first_name,last_name,phone,mobile,delivery_full_name,delivery_phone,delivery_address_line1,delivery_address_line2,delivery_suburb,delivery_city,delivery_postcode,delivery_country")
      .eq("id", session.user.id)
      .maybeSingle();
    const profileName = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
    setValue(fields.fullName, profile?.delivery_full_name || profileName);
    setValue(fields.email, profile?.email || session.user.email);
    setValue(fields.phone, profile?.delivery_phone || profile?.phone || profile?.mobile);
    setValue(fields.line1, profile?.delivery_address_line1);
    setValue(fields.line2, profile?.delivery_address_line2);
    setValue(fields.suburb, profile?.delivery_suburb);
    setValue(fields.city, profile?.delivery_city);
    setValue(fields.postcode, profile?.delivery_postcode);
    setValue(fields.country, profile?.delivery_country || "New Zealand");
    return session;
  }

  function getCheckoutPayload() {
    const method = selectedFulfilment();
    const customer = {
      full_name: fields.fullName?.value.trim() || "",
      email: fields.email?.value.trim() || "",
      phone: fields.phone?.value.trim() || ""
    };
    const delivery_address = {
      full_name: customer.full_name,
      phone: customer.phone,
      address_line1: fields.line1?.value.trim() || "",
      address_line2: fields.line2?.value.trim() || "",
      suburb: fields.suburb?.value.trim() || "",
      city: fields.city?.value.trim() || "",
      postcode: fields.postcode?.value.trim() || "",
      country: fields.country?.value.trim() || "New Zealand"
    };
    return { customer, fulfilment_method: method, delivery_address };
  }

  function validateCheckout(payload) {
    if (!payload.customer.full_name) throw new Error("Enter your full name.");
    if (!payload.customer.email) throw new Error("Enter your email address.");
    if (!payload.customer.phone) throw new Error("Enter your phone number.");
    if (payload.fulfilment_method !== "pickup") {
      if (!payload.delivery_address.address_line1) throw new Error("Enter the delivery address.");
      if (!payload.delivery_address.city) throw new Error("Enter the delivery city.");
      if (!payload.delivery_address.postcode) throw new Error("Enter the delivery postcode.");
    }
  }

  async function startShopCheckout(cart, token, checkout) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers,
      body: JSON.stringify({
        booking_type: "shop_order",
        cart,
        checkout
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(data.error || "Could not start Stripe Checkout.");
    try { sessionStorage.setItem("kims_pending_checkout_type", "shop_order"); } catch (error) {}
    window.location.href = data.url;
  }

  async function handleCheckout(event) {
    if (event.currentTarget?.dataset.stripeCheckoutHandled === "true") return;
    const cart = loadCart();
    if (!cart.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    event.currentTarget.dataset.stripeCheckoutHandled = "true";

    try {
      const checkout = getCheckoutPayload();
      validateCheckout(checkout);
      const session = await getSession();
      if (fields.message) fields.message.textContent = "Redirecting to secure Stripe Checkout...";
      await startShopCheckout(cart, session?.access_token || "", checkout);
    } catch (error) {
      event.currentTarget.dataset.stripeCheckoutHandled = "false";
      if (fields.message) fields.message.textContent = error.message || "Could not start Stripe Checkout.";
      alert(error.message || "Could not start Stripe Checkout. Please try again.");
    }
  }

  window.KimsShopCheckout = { getShippingAmount };

  document.addEventListener("DOMContentLoaded", async () => {
    if (!fields.checkoutButton) return;
    fields.checkoutButton.addEventListener("click", handleCheckout, true);
    fields.fulfilment?.addEventListener("change", updateFulfilmentHelp);
    window.addEventListener("kims:cart-rendered", (event) => {
      lastSummary = { ...lastSummary, ...(event.detail || {}) };
      lastSummary.promoDiscount = 0;
      updateTotals();
    });
    await loadCheckoutSettings();
    await prefillCheckoutDetails();
    updateFulfilmentHelp();
  });
})();
