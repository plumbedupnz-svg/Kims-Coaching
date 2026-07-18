(function () {
  const formEl = document.querySelector("[data-shop-checkout-settings-form]");
  const messageEl = document.querySelector("[data-shop-checkout-settings-message]");
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  if (!formEl) return;

  const defaults = {
    pickup_label: "Pick up from coaching / club",
    pickup_instructions: "",
    local_delivery_enabled: true,
    local_delivery_fee: 0,
    courier_delivery_enabled: true,
    courier_delivery_fee: 0,
    free_shipping_threshold: null,
    tax_mode: "none",
    tax_label: "GST",
    tax_rate_percent: 15,
    prices_include_tax: false,
    stripe_automatic_tax: false
  };
  const baseColumns = "pickup_label,pickup_instructions,local_delivery_enabled,local_delivery_fee,courier_delivery_enabled,courier_delivery_fee,free_shipping_threshold";
  const taxColumns = "tax_mode,tax_label,tax_rate_percent,prices_include_tax,stripe_automatic_tax";

  function setMessage(message, tone = "neutral") {
    if (!messageEl) return;
    messageEl.textContent = message || "";
    messageEl.dataset.tone = tone;
  }

  function numberValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function taxRateValue(value) {
    if (value === null || value === undefined || value === "") return defaults.tax_rate_percent;
    return numberValue(value, defaults.tax_rate_percent);
  }

  function normalizeTaxMode(value) {
    return ["gst_inclusive", "gst_exclusive"].includes(value) ? value : "none";
  }

  function normalizeSettings(data = {}) {
    const merged = { ...defaults, ...data };
    const taxMode = normalizeTaxMode(merged.tax_mode);
    return {
      ...merged,
      tax_mode: taxMode,
      tax_label: String(merged.tax_label || defaults.tax_label).trim() || defaults.tax_label,
      tax_rate_percent: taxRateValue(merged.tax_rate_percent),
      prices_include_tax: taxMode === "gst_inclusive",
      stripe_automatic_tax: taxMode === "none" ? false : Boolean(merged.stripe_automatic_tax)
    };
  }

  function applySettings(data = {}) {
    const settings = normalizeSettings(data);
    window.KimsShopTaxSettings = settings;
    formEl.elements.pickup_label.value = settings.pickup_label;
    formEl.elements.pickup_instructions.value = settings.pickup_instructions || "";
    formEl.elements.local_delivery_enabled.checked = settings.local_delivery_enabled !== false;
    formEl.elements.local_delivery_fee.value = numberValue(settings.local_delivery_fee, 0).toFixed(2);
    formEl.elements.courier_delivery_enabled.checked = settings.courier_delivery_enabled !== false;
    formEl.elements.courier_delivery_fee.value = numberValue(settings.courier_delivery_fee, 0).toFixed(2);
    formEl.elements.free_shipping_threshold.value = settings.free_shipping_threshold ?? "";
    formEl.elements.tax_mode.value = settings.tax_mode;
    formEl.elements.tax_label.value = settings.tax_label;
    formEl.elements.tax_rate_percent.value = numberValue(settings.tax_rate_percent, 15).toFixed(2);
    formEl.elements.stripe_automatic_tax.checked = settings.stripe_automatic_tax === true;
  }

  async function loadSettings() {
    if (!client) return setMessage("Supabase is not configured.", "error");
    setMessage("Loading shop checkout settings...");
    let { data, error } = await client
      .from("shop_inventory_settings")
      .select(`${baseColumns},${taxColumns}`)
      .eq("id", true)
      .maybeSingle();
    if (error && /tax_mode|tax_label|tax_rate_percent|prices_include_tax|stripe_automatic_tax|schema cache|PGRST|42703/i.test(error.message || "")) {
      const fallback = await client
        .from("shop_inventory_settings")
        .select(baseColumns)
        .eq("id", true)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }
    if (error) return setMessage(`Could not load shop settings: ${error.message}`, "error");
    applySettings(data || {});
    setMessage("");
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!client) return;
    const threshold = formEl.elements.free_shipping_threshold.value;
    const taxMode = normalizeTaxMode(formEl.elements.tax_mode.value);
    const taxRate = Math.max(0, taxRateValue(formEl.elements.tax_rate_percent.value));
    const payload = {
      id: true,
      pickup_label: formEl.elements.pickup_label.value.trim() || defaults.pickup_label,
      pickup_instructions: formEl.elements.pickup_instructions.value.trim(),
      local_delivery_enabled: formEl.elements.local_delivery_enabled.checked,
      local_delivery_fee: numberValue(formEl.elements.local_delivery_fee.value, 0),
      courier_delivery_enabled: formEl.elements.courier_delivery_enabled.checked,
      courier_delivery_fee: numberValue(formEl.elements.courier_delivery_fee.value, 0),
      free_shipping_threshold: threshold === "" ? null : numberValue(threshold, 0),
      tax_mode: taxMode,
      tax_label: formEl.elements.tax_label.value.trim() || defaults.tax_label,
      tax_rate_percent: taxRate,
      prices_include_tax: taxMode === "gst_inclusive",
      stripe_automatic_tax: taxMode === "none" ? false : formEl.elements.stripe_automatic_tax.checked
    };
    setMessage("Saving shop checkout settings...");
    const { data, error } = await client
      .from("shop_inventory_settings")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();
    if (error) return setMessage(`Could not save shop settings: ${error.message}`, "error");
    applySettings(data || payload);
    setMessage("Shop checkout settings saved.", "success");
  }

  formEl.addEventListener("submit", saveSettings);
  loadSettings();
})();
