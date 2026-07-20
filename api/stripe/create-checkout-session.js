const {
  calculateDiscountedPrice,
  createStripeCheckoutSession,
  moneyText,
  readJsonBody,
  restInsert,
  restSelect,
  restUpdate,
  textList,
  uuidList,
  verifyUser
} = require("./_helpers");
const { enforceRateLimit } = require("../_rate-limit");

const ORDER_TO_SALE_NOTICE = "We'll confirm arrival once stock levels have been checked.";
const SHOP_SETTINGS_DEFAULTS = {
  pickup_label: "Pick up from coaching / club",
  pickup_instructions: "Kim will confirm the pickup details with you.",
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

function formatTaxRate(rate) {
  const number = Number(rate || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeTaxMode(value) {
  return ["gst_inclusive", "gst_exclusive"].includes(value) ? value : "none";
}

function normalizeShopSettings(row = {}) {
  const taxMode = normalizeTaxMode(row.tax_mode);
  const taxRate = row.tax_rate_percent === null || row.tax_rate_percent === undefined || row.tax_rate_percent === ""
    ? SHOP_SETTINGS_DEFAULTS.tax_rate_percent
    : Number(row.tax_rate_percent);
  return {
    ...SHOP_SETTINGS_DEFAULTS,
    ...row,
    tax_mode: taxMode,
    tax_label: String(row.tax_label || SHOP_SETTINGS_DEFAULTS.tax_label).trim() || SHOP_SETTINGS_DEFAULTS.tax_label,
    tax_rate_percent: Number.isFinite(taxRate) ? taxRate : SHOP_SETTINGS_DEFAULTS.tax_rate_percent,
    prices_include_tax: taxMode === "gst_inclusive",
    stripe_automatic_tax: taxMode === "none" ? false : Boolean(row.stripe_automatic_tax)
  };
}

function calculateShopTaxSummary(subtotal, settings) {
  const normalized = normalizeShopSettings(settings);
  const base = Math.max(0, Number(subtotal || 0));
  const rate = Math.max(0, Number(normalized.tax_rate_percent || 0));
  const label = normalized.tax_label || "GST";
  if (normalized.tax_mode === "gst_exclusive") {
    const amount = Number((base * rate / 100).toFixed(2));
    return {
      mode: normalized.tax_mode,
      label: `${label} (${formatTaxRate(rate)}%)`,
      amount,
      includedAmount: 0,
      ratePercent: rate,
      pricesIncludeTax: false
    };
  }
  if (normalized.tax_mode === "gst_inclusive") {
    const includedAmount = rate > 0 ? Number((base * rate / (100 + rate)).toFixed(2)) : 0;
    return {
      mode: normalized.tax_mode,
      label: `${label} included`,
      amount: 0,
      includedAmount,
      ratePercent: rate,
      pricesIncludeTax: true
    };
  }
  return {
    mode: "none",
    label: "Tax",
    amount: 0,
    includedAmount: 0,
    ratePercent: rate,
    pricesIncludeTax: false
  };
}

function getCustomerName(profile, user) {
  return `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || profile?.email || user?.email || "Kim Jones Coaching customer";
}

async function getProfile(userId) {
  if (!userId) return null;
  const rows = await restSelect("profiles", "*", { id: `eq.${userId}`, limit: "1" });
  return rows[0] || null;
}

function hasBearerToken(authHeader = "") {
  return /^Bearer\s+\S+/i.test(String(authHeader || ""));
}

function firstPositiveAmount(...values) {
  for (const value of values) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

function juniorPaymentSetupError() {
  return "Online payment is required for junior group coaching, but this group does not have a positive price set. Please ask Kim to add a price to the group, programme, or lesson type.";
}

async function createBookingCheckout({ user, body }) {
  const bookingId = body.booking_id || body.bookingId;
  if (!bookingId) throw new Error("booking_id is required.");
  const rows = await restSelect(
    "bookings",
    "*,lesson_type:lesson_type_id(name,price,duration),club:club_id(name),coach:coach_id(display_name)",
    { id: `eq.${bookingId}`, limit: "1" }
  );
  const booking = rows[0];
  if (!booking || booking.user_id !== user.id) throw new Error("Booking was not found.");

  const amount = Number(booking.total_price ?? booking.lesson_type?.price ?? 0);
  if (amount <= 0) throw new Error("This booking does not require online payment.");

  await restUpdate("bookings", { id: `eq.${booking.id}` }, {
    booking_status: "pending_payment",
    payment_status: "pending",
    payment_option: "pay_now"
  });

  const lineName = booking.lesson_type?.name || "Kim Jones Coaching";
  const session = await createStripeCheckoutSession({
    lineItems: [{
      name: lineName,
      description: `${booking.player_name || "Player"} · ${booking.duration_minutes || booking.lesson_type?.duration || ""} minutes`,
      quantity: 1,
      unitAmount: amount
    }],
    customerEmail: booking.customer_email || user.email,
    successPath: "/payment-success.html",
    cancelPath: `/payment-cancelled.html?booking_id=${encodeURIComponent(booking.id)}`,
    metadata: {
      booking_type: "private_lesson",
      booking_id: booking.id,
      user_id: user.id,
      player_id: body.player_id || body.playerId || ""
    }
  });

  await restUpdate("bookings", { id: `eq.${booking.id}` }, { stripe_session_id: session.id }, "");
  return session;
}

async function createJuniorCheckout({ user, body }) {
  const pendingBookingId = body.pending_booking_id || body.pendingBookingId || body.member_id || body.memberId;
  if (!pendingBookingId) throw new Error("pending booking id is required.");

  const pendingRows = await restSelect(
    "junior_group_pending_bookings",
    "*,group:group_id(id,group_name,price,programme:programme_id(programme_name,price),lesson_type:lesson_type_id(name,price),club:club_id(name),coach:coach_id(display_name))",
    { id: `eq.${pendingBookingId}`, limit: "1" }
  ).catch((error) => {
    if (/junior_group_pending_bookings|schema cache|PGRST205|42P01/i.test(error.message || "")) return [];
    throw error;
  });
  const pending = pendingRows[0];

  if (pending) {
    if (pending.profile_id !== user.id) throw new Error("Junior group booking was not found.");
    if (pending.payment_status === "paid" || pending.completed_member_id) throw new Error("This junior group booking has already been paid.");
    const amount = firstPositiveAmount(
      pending.amount,
      pending.group?.price,
      pending.group?.programme?.price,
      pending.group?.lesson_type?.price
    );
    if (amount <= 0) throw new Error(juniorPaymentSetupError());

    const payment = await restInsert("payments", {
      profile_id: user.id,
      player_id: pending.player_id || null,
      related_type: "junior_group_pending",
      related_id: pending.id,
      amount,
      currency: "NZD",
      payment_status: "pending",
      provider: "stripe",
      metadata: {
        pending_booking_id: pending.id,
        group_id: pending.group_id,
        player_name: pending.player_name || ""
      }
    });

    const session = await createStripeCheckoutSession({
      lineItems: [{
        name: pending.group?.group_name || "Junior Group Coaching",
        description: `${pending.player_name || "Player"} · Kim Jones Coaching`,
        quantity: 1,
        unitAmount: amount
      }],
      customerEmail: pending.email || user.email,
      successPath: "/payment-success.html",
      cancelPath: `/payment-cancelled.html?pending_booking_id=${encodeURIComponent(pending.id)}`,
      metadata: {
        booking_type: "junior_group",
        booking_id: pending.id,
        pending_booking_id: pending.id,
        payment_id: payment.id,
        user_id: user.id,
        player_id: pending.player_id || ""
      }
    });

    await Promise.all([
      restUpdate("junior_group_pending_bookings", { id: `eq.${pending.id}` }, {
        payment_status: "pending",
        stripe_session_id: session.id,
        invoice_url: session.url || ""
      }, ""),
      restUpdate("payments", { id: `eq.${payment.id}` }, {
        provider_reference: session.id,
        stripe_session_id: session.id,
        invoice_url: session.url || "",
        payment_link_url: session.url || ""
      }, "")
    ]);
    return session;
  }

  const memberId = pendingBookingId;
  const rows = await restSelect(
    "junior_group_members",
    "*,group:group_id(id,group_name,price,programme:programme_id(programme_name,price),lesson_type:lesson_type_id(name,price),club:club_id(name),coach:coach_id(display_name))",
    { id: `eq.${memberId}`, limit: "1" }
  );
  const member = rows[0];
  if (!member || member.profile_id !== user.id) throw new Error("Junior group booking was not found.");
  const amount = firstPositiveAmount(
    member.group?.price,
    member.group?.programme?.price,
    member.group?.lesson_type?.price
  );
  if (amount <= 0) throw new Error(juniorPaymentSetupError());

  const paymentRows = await restSelect("payments", "*", {
    junior_group_member_id: `eq.${member.id}`,
    order: "created_at.desc",
    limit: "1"
  });
  const payment = paymentRows[0] || await restInsert("payments", {
    profile_id: user.id,
    junior_group_member_id: member.id,
    related_type: "junior_group",
    related_id: member.group_id,
    amount,
    currency: "NZD",
    payment_status: "pending",
    provider: "stripe"
  });

  const session = await createStripeCheckoutSession({
    lineItems: [{
      name: member.group?.group_name || "Junior Group Coaching",
      description: `${member.player_name || "Player"} · Kim Jones Coaching`,
      quantity: 1,
      unitAmount: amount
    }],
    customerEmail: member.email || user.email,
    successPath: "/payment-success.html",
    cancelPath: `/payment-cancelled.html?member_id=${encodeURIComponent(member.id)}`,
    metadata: {
      booking_type: "junior_group",
      booking_id: member.id,
      member_id: member.id,
      payment_id: payment.id,
      user_id: user.id,
      player_id: member.player_id || ""
    }
  });

  await Promise.all([
    restUpdate("junior_group_members", { id: `eq.${member.id}` }, {
      booking_status: "pending_payment",
      payment_status: "pending"
    }, ""),
    restUpdate("payments", { id: `eq.${payment.id}` }, {
      provider: "stripe",
      provider_reference: session.id,
      stripe_session_id: session.id,
      related_type: "junior_group",
      related_id: member.group_id,
      amount,
      currency: "NZD",
      payment_status: "pending"
    }, "")
  ]);
  return session;
}

async function createAdminJuniorPaymentRequest({ user, body }) {
  const profile = await getProfile(user.id);
  if (profile?.role !== "admin") throw new Error("Only admin users can create junior coaching payment requests.");

  let memberId = body.member_id || body.memberId;
  const playerId = body.player_id || body.playerId;
  if (!memberId && playerId) {
    const playerRows = await restSelect("players", "id,junior_group_member_id", { id: `eq.${playerId}`, limit: "1" });
    memberId = playerRows[0]?.junior_group_member_id;
  }
  if (!memberId) throw new Error("member_id is required.");

  const memberRows = await restSelect(
    "junior_group_members",
    "*,group:group_id(id,group_name,price,start_date,session_count,session_duration_minutes,programme:programme_id(programme_name,price),lesson_type:lesson_type_id(name,price),club:club_id(name),coach:coach_id(display_name))",
    { id: `eq.${memberId}`, limit: "1" }
  );
  const member = memberRows[0];
  if (!member) throw new Error("Junior group placement was not found.");

  const amount = firstPositiveAmount(
    member.group?.price,
    member.group?.programme?.price,
    member.group?.lesson_type?.price
  );
  if (amount <= 0) throw new Error(juniorPaymentSetupError());

  const paymentId = body.payment_id || body.paymentId;
  const paymentRows = paymentId
    ? await restSelect("payments", "*", { id: `eq.${paymentId}`, limit: "1" })
    : await restSelect("payments", "*", {
        junior_group_member_id: `eq.${member.id}`,
        order: "created_at.desc",
        limit: "1"
      });
  const payment = paymentRows[0] || await restInsert("payments", {
    profile_id: member.profile_id || null,
    junior_group_member_id: member.id,
    player_id: member.player_id || playerId || null,
    related_type: "junior_group",
    related_id: member.group_id,
    amount,
    currency: "NZD",
    payment_status: "pending",
    provider: "stripe"
  });

  const session = await createStripeCheckoutSession({
    lineItems: [{
      name: member.group?.group_name || "Junior Group Coaching",
      description: `${member.player_name || "Player"} · ${member.group?.programme?.programme_name || "Kim Jones Coaching"}`,
      quantity: 1,
      unitAmount: amount
    }],
    customerEmail: member.email || "",
    successPath: "/payment-success.html",
    cancelPath: `/payment-cancelled.html?member_id=${encodeURIComponent(member.id)}`,
    metadata: {
      booking_type: "junior_group",
      booking_id: member.id,
      member_id: member.id,
      payment_id: payment.id,
      user_id: member.profile_id || "",
      player_id: member.player_id || playerId || ""
    }
  });

  await Promise.all([
    restUpdate("junior_group_members", { id: `eq.${member.id}` }, {
      booking_status: "pending_payment",
      payment_status: "pending",
      invoice_url: session.url || "",
      stripe_session_id: session.id
    }, ""),
    restUpdate("payments", { id: `eq.${payment.id}` }, {
      provider: "stripe",
      provider_reference: session.id,
      stripe_session_id: session.id,
      related_type: "junior_group",
      related_id: member.group_id,
      amount,
      currency: "NZD",
      invoice_url: session.url || "",
      payment_link_url: session.url || "",
      payment_status: "pending"
    }, ""),
    member.player_id || playerId ? restUpdate("players", { id: `eq.${member.player_id || playerId}` }, {
      payment_status: "pending",
      placement_status: "payment_pending",
      invoice_url: session.url || "",
      stripe_session_id: session.id
    }, "") : Promise.resolve()
  ]);

  return session;
}

async function getShopLineItems(cart) {
  if (cart.length > 50) throw new Error("Your cart contains too many line items.");
  const ids = [...new Set(cart.map((item) => String(item.id || "")).filter(Boolean))];
  const inventoryIds = [...new Set(cart.map((item) => String(item.inventory_item_id || item.id || "")).filter(Boolean))];
  async function selectProductsForShop() {
    if (!ids.length) return [];
    return restSelect("products", "id,name,category,description,price,purchase_price,cost_price,discount,fulfilment_type,inventory_item_id,is_active,archived_at", { id: textList(ids) })
      .catch((error) => {
        if (/purchase_price|cost_price|schema cache|PGRST|42703/i.test(error.message || "")) {
          console.warn("[Stripe checkout] product cost columns are not available yet; continuing without cost snapshots.", { message: error.message });
          return restSelect("products", "id,name,category,description,price,discount,fulfilment_type,inventory_item_id,is_active,archived_at", { id: textList(ids) });
        }
        throw error;
      });
  }
  async function selectInventoryForShop() {
    if (!inventoryIds.length) return [];
    return restSelect("inventory_items", "id,product_name,sku,category,description,short_description,full_description,sell_price,cost_price,purchase_price,quantity_on_hand,status,visible_in_shop,is_active,track_stock,is_order_to_sale,archived_at", { id: uuidList(inventoryIds) })
      .catch((error) => {
        if (/cost_price|schema cache|PGRST|42703/i.test(error.message || "")) {
          console.warn("[Stripe checkout] inventory cost columns are not available yet; continuing without cost snapshots.", { message: error.message });
          return restSelect("inventory_items", "id,product_name,sku,category,description,sell_price,quantity_on_hand,status,visible_in_shop,is_active,archived_at", { id: uuidList(inventoryIds) });
        }
        throw error;
      });
  }
  const [productRows, inventoryRows] = await Promise.all([
    selectProductsForShop(),
    selectInventoryForShop()
  ]);
  const productsById = new Map(productRows.map((row) => [String(row.id), row]));
  const inventoryById = new Map(inventoryRows.map((row) => [String(row.id), row]));

  return cart.map((item) => {
    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error("Choose a quantity between 1 and 99 for each product.");
    }
    const product = productsById.get(String(item.id));
    const inventory = inventoryById.get(String(item.inventory_item_id || item.id));
    if (product) {
      if (product.is_active === false || product.archived_at) throw new Error(`${product.name} is not available.`);
      const isStock = product.fulfilment_type === "stock" || Boolean(product.inventory_item_id);
      if (isStock) {
        const linked = inventoryById.get(String(product.inventory_item_id)) || inventory;
        const linkedTracksStock = linked && linked.track_stock !== false && linked.is_order_to_sale !== true;
        if (!linked || (linkedTracksStock && linked.quantity_on_hand < quantity)) throw new Error(`Not enough stock available for ${product.name}.`);
      }
      const unitAmount = calculateDiscountedPrice(product.price, product.discount);
      const linked = product.inventory_item_id ? inventoryById.get(String(product.inventory_item_id)) : null;
      const purchasePrice = Number(product.purchase_price ?? product.cost_price ?? linked?.cost_price ?? 0);
      const lineTotal = unitAmount * quantity;
      const costTotal = purchasePrice * quantity;
      return {
        id: product.id,
        inventory_item_id: product.inventory_item_id || "",
        name: product.name,
        category: product.category || linked?.category || "Uncategorized",
        description: product.description || linked?.full_description || linked?.description || "",
        price: moneyText(unitAmount),
        quantity,
        unitAmount,
        lineTotal,
        sale_price_at_sale: Number(unitAmount.toFixed(2)),
        purchase_price_at_sale: Number(purchasePrice.toFixed(2)),
        cost_price_at_sale: Number(purchasePrice.toFixed(2)),
        gross_profit_at_sale: Number((lineTotal - costTotal).toFixed(2)),
        gross_margin_percent_at_sale: lineTotal > 0 ? Number(((lineTotal - costTotal) / lineTotal * 100).toFixed(2)) : 0,
        sku: linked?.sku || "",
        fulfilment_type: isStock && linked?.is_order_to_sale !== true && linked?.track_stock !== false ? "stock" : "order_to_sale",
        availability_note: isStock && linked?.is_order_to_sale !== true && linked?.track_stock !== false ? "" : ORDER_TO_SALE_NOTICE
      };
    }

    if (!inventory) throw new Error(`${item.name || "Product"} is not available.`);
    if (inventory.visible_in_shop !== true || inventory.is_active === false || inventory.archived_at) throw new Error(`${inventory.product_name} is not available.`);
    const tracksStock = inventory.track_stock !== false && inventory.is_order_to_sale !== true;
    if (tracksStock && Number(inventory.quantity_on_hand || 0) < quantity) throw new Error(`Not enough stock available for ${inventory.product_name}.`);
    const unitAmount = Number(inventory.sell_price || 0);
    const purchasePrice = Number(inventory.purchase_price ?? inventory.cost_price ?? 0);
    const lineTotal = unitAmount * quantity;
    const costTotal = purchasePrice * quantity;
    return {
      id: inventory.id,
      inventory_item_id: inventory.id,
      name: inventory.product_name,
      category: inventory.category || "Uncategorized",
      description: inventory.full_description || inventory.description || inventory.short_description || "",
      price: moneyText(unitAmount),
      quantity,
      unitAmount,
      lineTotal,
      sale_price_at_sale: Number(unitAmount.toFixed(2)),
      purchase_price_at_sale: Number(purchasePrice.toFixed(2)),
      cost_price_at_sale: Number(purchasePrice.toFixed(2)),
      gross_profit_at_sale: Number((lineTotal - costTotal).toFixed(2)),
      gross_margin_percent_at_sale: lineTotal > 0 ? Number(((lineTotal - costTotal) / lineTotal * 100).toFixed(2)) : 0,
      sku: inventory.sku || "",
      fulfilment_type: tracksStock ? "stock" : "order_to_sale",
      availability_note: tracksStock ? "" : ORDER_TO_SALE_NOTICE
    };
  });
}

async function getShopSettings() {
  const baseColumns = "pickup_label,pickup_instructions,local_delivery_enabled,local_delivery_fee,courier_delivery_enabled,courier_delivery_fee,free_shipping_threshold";
  const taxColumns = "tax_mode,tax_label,tax_rate_percent,prices_include_tax,stripe_automatic_tax";
  try {
    const rows = await restSelect("shop_inventory_settings", `${baseColumns},${taxColumns}`, { id: "eq.true", limit: "1" })
      .catch(async (error) => {
        if (/tax_mode|tax_label|tax_rate_percent|prices_include_tax|stripe_automatic_tax|schema cache|PGRST|42703/i.test(error.message || "")) {
          console.warn("[Stripe checkout] shop tax settings are not available yet; defaulting to no tax.", { message: error.message });
          return restSelect("shop_inventory_settings", baseColumns, { id: "eq.true", limit: "1" });
        }
        throw error;
      });
    return normalizeShopSettings(rows[0] || {});
  } catch (error) {
    console.warn("[Stripe checkout] using default shop settings", { message: error.message });
    return normalizeShopSettings();
  }
}

function normalizeShopCustomer({ checkout = {}, profile, user }) {
  const customer = checkout.customer || {};
  const profileName = getCustomerName(profile, user);
  const name = String(customer.full_name || customer.name || profile?.delivery_full_name || profileName || "").trim();
  const email = String(customer.email || user?.email || profile?.email || "").trim();
  const phone = String(customer.phone || profile?.delivery_phone || profile?.phone || profile?.mobile || "").trim();
  if (!name) throw new Error("Customer name is required.");
  if (!email) throw new Error("Customer email is required.");
  if (!phone) throw new Error("Customer phone is required.");
  return { name, email, phone };
}

function normalizeDeliveryAddress(checkout = {}, customer = {}) {
  const source = checkout.delivery_address || checkout.deliveryAddress || {};
  return {
    full_name: String(source.full_name || customer.name || "").trim(),
    phone: String(source.phone || customer.phone || "").trim(),
    address_line1: String(source.address_line1 || source.addressLine1 || "").trim(),
    address_line2: String(source.address_line2 || source.addressLine2 || "").trim(),
    suburb: String(source.suburb || "").trim(),
    city: String(source.city || "").trim(),
    postcode: String(source.postcode || source.postal_code || "").trim(),
    country: String(source.country || "New Zealand").trim() || "New Zealand"
  };
}

function getFulfilmentLabel(method, settings) {
  if (method === "local_delivery") return "Local delivery";
  if (method === "courier") return "NZ courier delivery";
  return settings.pickup_label || "Pick up from coaching / club";
}

function calculateShippingAmount(method, subtotal, settings) {
  if (method === "pickup") return 0;
  if (method === "local_delivery" && settings.local_delivery_enabled === false) throw new Error("Local delivery is not currently available.");
  if (method === "courier" && settings.courier_delivery_enabled === false) throw new Error("NZ courier delivery is not currently available.");
  const threshold = Number(settings.free_shipping_threshold || 0);
  if (threshold > 0 && Number(subtotal || 0) >= threshold) return 0;
  if (method === "local_delivery") return Number(settings.local_delivery_fee || 0);
  if (method === "courier") return Number(settings.courier_delivery_fee || 0);
  return 0;
}

function validateFulfilment(method, address) {
  if (!["pickup", "local_delivery", "courier"].includes(method)) throw new Error("Choose a valid fulfilment option.");
  if (method !== "pickup") {
    if (!address.address_line1) throw new Error("Delivery address is required.");
    if (!address.city) throw new Error("Delivery city is required.");
    if (!address.postcode) throw new Error("Delivery postcode is required.");
  }
}

async function insertShopOrder(payload) {
  try {
    return await restInsert("shop_orders", payload);
  } catch (error) {
    if (!/tax_mode|tax_label|tax_rate_percent|prices_include_tax|tax_included_amount|schema cache|PGRST|42703/i.test(error.message || "")) {
      throw error;
    }
    console.warn("[Stripe checkout] shop order tax columns are not available yet; inserting legacy order shape.", { message: error.message });
    const legacyPayload = { ...payload };
    delete legacyPayload.tax_mode;
    delete legacyPayload.tax_label;
    delete legacyPayload.tax_rate_percent;
    delete legacyPayload.prices_include_tax;
    delete legacyPayload.tax_included_amount;
    return restInsert("shop_orders", legacyPayload);
  }
}

async function createShopCheckout({ user, body }) {
  const cart = Array.isArray(body.cart) ? body.cart : [];
  if (!cart.length) throw new Error("Your cart is empty.");
  const profile = await getProfile(user?.id);
  const checkout = body.checkout || {};
  const settings = await getShopSettings();
  const customer = normalizeShopCustomer({ checkout, profile, user });
  const deliveryAddress = normalizeDeliveryAddress(checkout, customer);
  const fulfilmentMethod = checkout.fulfilment_method || checkout.fulfilmentMethod || "pickup";
  validateFulfilment(fulfilmentMethod, deliveryAddress);
  const items = await getShopLineItems(cart);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxSummary = calculateShopTaxSummary(subtotal, settings);
  const tax = taxSummary.amount;
  const discount = 0;
  const shipping = calculateShippingAmount(fulfilmentMethod, subtotal, settings);
  const total = Math.max(0, subtotal + tax + shipping - discount);
  const order = await insertShopOrder({
    user_id: user?.id || null,
    customer_name: customer.name,
    customer_email: customer.email,
    customer_phone: customer.phone,
    mobile: customer.phone,
    delivery_address: deliveryAddress,
    fulfilment_method: fulfilmentMethod,
    pickup_instructions: fulfilmentMethod === "pickup" ? settings.pickup_instructions || "" : "",
    shipping_amount: Number(shipping.toFixed(2)),
    subtotal_amount: Number(subtotal.toFixed(2)),
    tax_amount: Number(tax.toFixed(2)),
    tax_included_amount: Number(taxSummary.includedAmount.toFixed(2)),
    tax_mode: taxSummary.mode,
    tax_label: settings.tax_label || "GST",
    tax_rate_percent: Number(taxSummary.ratePercent.toFixed(2)),
    prices_include_tax: taxSummary.pricesIncludeTax,
    discount_amount: Number(discount.toFixed(2)),
    total_amount: Number(total.toFixed(2)),
    payment_status: "pending",
    items,
    subtotal,
    total,
    order_status: "pending_payment"
  });
  console.info("[Stripe checkout] pending shop order created", {
    orderId: order.id,
    fulfilmentMethod,
    shipping,
    itemCount: items.length,
    total
  });

  const lineItems = items.map((item) => ({
    name: item.name,
    description: [item.description, item.availability_note].filter(Boolean).join(" "),
    quantity: item.quantity,
    unitAmount: item.unitAmount
  }));
  if (tax > 0) {
    lineItems.push({
      name: taxSummary.label || "Tax",
      description: "Kim Jones Coaching shop order tax",
      quantity: 1,
      unitAmount: tax
    });
  }
  if (shipping > 0) {
    lineItems.push({
      name: getFulfilmentLabel(fulfilmentMethod, settings),
      description: fulfilmentMethod === "pickup" ? settings.pickup_instructions : "Shop order delivery",
      quantity: 1,
      unitAmount: shipping
    });
  }

  const session = await createStripeCheckoutSession({
    lineItems,
    customerEmail: order.customer_email || user?.email,
    successPath: "/payment-success.html",
    cancelPath: `/payment-cancelled.html?order_id=${encodeURIComponent(order.id)}`,
    metadata: {
      booking_type: "shop_order",
      order_id: order.id,
      booking_id: order.id,
      user_id: user?.id || "",
      player_id: ""
    }
  });

  await restUpdate("shop_orders", { id: `eq.${order.id}` }, { stripe_session_id: session.id }, "");
  return session;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!enforceRateLimit(req, res, {
    scope: "stripe-checkout",
    limit: 60,
    windowMs: 5 * 60 * 1000
  })) return;

  try {
    const body = await readJsonBody(req);
    const bookingType = body.booking_type || body.type;
    const authHeader = req.headers.authorization || req.headers.Authorization || "";
    let session;
    if (bookingType === "shop_order") {
      const user = hasBearerToken(authHeader) ? await verifyUser(authHeader) : null;
      session = await createShopCheckout({ user, body });
    } else {
      const user = await verifyUser(authHeader);
      if (bookingType === "private_lesson") session = await createBookingCheckout({ user, body });
      else if (bookingType === "junior_group") session = await createJuniorCheckout({ user, body });
      else if (bookingType === "junior_group_admin_payment_request") session = await createAdminJuniorPaymentRequest({ user, body });
      else throw new Error("Unknown checkout type.");
    }

    res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("[Stripe checkout] failed", { message: error.message });
    const internalError = /(?:select|insert|update) failed:|not configured|Stripe returned|schema cache|PGRST|SUPABASE_/i.test(error.message || "");
    const message = internalError ? "Could not start Stripe Checkout. Please try again." : (error.message || "Could not start Stripe Checkout.");
    res.status(error.statusCode || 400).json({ error: message });
  }
};
