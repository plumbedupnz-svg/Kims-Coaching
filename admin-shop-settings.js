(function () {
  const formEl = document.querySelector("[data-shop-checkout-settings-form]");
  const messageEl = document.querySelector("[data-shop-checkout-settings-message]");
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  if (!formEl) return;

  function setMessage(message, tone = "neutral") {
    if (!messageEl) return;
    messageEl.textContent = message || "";
    messageEl.dataset.tone = tone;
  }

  function numberValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function applySettings(data = {}) {
    formEl.elements.pickup_label.value = data.pickup_label || "Pick up from coaching / club";
    formEl.elements.pickup_instructions.value = data.pickup_instructions || "";
    formEl.elements.local_delivery_enabled.checked = data.local_delivery_enabled !== false;
    formEl.elements.local_delivery_fee.value = numberValue(data.local_delivery_fee, 0).toFixed(2);
    formEl.elements.courier_delivery_enabled.checked = data.courier_delivery_enabled !== false;
    formEl.elements.courier_delivery_fee.value = numberValue(data.courier_delivery_fee, 0).toFixed(2);
    formEl.elements.free_shipping_threshold.value = data.free_shipping_threshold ?? "";
  }

  async function loadSettings() {
    if (!client) return setMessage("Supabase is not configured.", "error");
    setMessage("Loading shop checkout settings...");
    const { data, error } = await client
      .from("shop_inventory_settings")
      .select("pickup_label,pickup_instructions,local_delivery_enabled,local_delivery_fee,courier_delivery_enabled,courier_delivery_fee,free_shipping_threshold")
      .eq("id", true)
      .maybeSingle();
    if (error) return setMessage(`Could not load shop settings: ${error.message}`, "error");
    applySettings(data || {});
    setMessage("");
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!client) return;
    const threshold = formEl.elements.free_shipping_threshold.value;
    const payload = {
      id: true,
      pickup_label: formEl.elements.pickup_label.value.trim() || "Pick up from coaching / club",
      pickup_instructions: formEl.elements.pickup_instructions.value.trim(),
      local_delivery_enabled: formEl.elements.local_delivery_enabled.checked,
      local_delivery_fee: numberValue(formEl.elements.local_delivery_fee.value, 0),
      courier_delivery_enabled: formEl.elements.courier_delivery_enabled.checked,
      courier_delivery_fee: numberValue(formEl.elements.courier_delivery_fee.value, 0),
      free_shipping_threshold: threshold === "" ? null : numberValue(threshold, 0)
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
