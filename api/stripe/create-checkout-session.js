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
  const memberId = body.member_id || body.memberId;
  if (!memberId) throw new Error("member_id is required.");
  const rows = await restSelect(
    "junior_group_members",
    "*,group:group_id(id,group_name,price,club:club_id(name),coach:coach_id(display_name))",
    { id: `eq.${memberId}`, limit: "1" }
  );
  const member = rows[0];
  if (!member || member.profile_id !== user.id) throw new Error("Junior group booking was not found.");
  const amount = Number(member.group?.price || 0);
  if (amount <= 0) throw new Error("This junior group booking does not require online payment.");

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
      player_id: Number.isInteger(member.profile_player_index) ? `player-${member.profile_player_index}` : ""
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
      payment_status: "pending"
    }, "")
  ]);
  return session;
}

async function getShopLineItems(cart) {
  const ids = [...new Set(cart.map((item) => String(item.id || "")).filter(Boolean))];
  const inventoryIds = [...new Set(cart.map((item) => String(item.inventory_item_id || item.id || "")).filter(Boolean))];
  const [productRows, inventoryRows] = await Promise.all([
    ids.length ? restSelect("products", "id,name,description,price,discount,fulfilment_type,inventory_item_id,is_active,archived_at", { id: textList(ids) }) : [],
    inventoryIds.length ? restSelect("inventory_items", "id,product_name,description,sell_price,quantity_on_hand,status,visible_in_shop,is_active,archived_at", { id: uuidList(inventoryIds) }) : []
  ]);
  const productsById = new Map(productRows.map((row) => [String(row.id), row]));
  const inventoryById = new Map(inventoryRows.map((row) => [String(row.id), row]));

  return cart.map((item) => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const product = productsById.get(String(item.id));
    const inventory = inventoryById.get(String(item.inventory_item_id || item.id));
    if (product) {
      if (product.is_active === false || product.archived_at) throw new Error(`${product.name} is not available.`);
      const isStock = product.fulfilment_type === "stock" || Boolean(product.inventory_item_id);
      if (isStock) {
        const linked = inventoryById.get(String(product.inventory_item_id)) || inventory;
        if (!linked || linked.quantity_on_hand < quantity) throw new Error(`Not enough stock available for ${product.name}.`);
      }
      const unitAmount = calculateDiscountedPrice(product.price, product.discount);
      return {
        id: product.id,
        inventory_item_id: product.inventory_item_id || "",
        name: product.name,
        description: product.description || "",
        price: moneyText(unitAmount),
        quantity,
        unitAmount,
        lineTotal: unitAmount * quantity,
        fulfilment_type: isStock ? "stock" : "order_to_sale"
      };
    }

    if (!inventory) throw new Error(`${item.name || "Product"} is not available.`);
    if (inventory.visible_in_shop !== true || inventory.is_active === false || inventory.archived_at) throw new Error(`${inventory.product_name} is not available.`);
    if (Number(inventory.quantity_on_hand || 0) < quantity) throw new Error(`Not enough stock available for ${inventory.product_name}.`);
    const unitAmount = Number(inventory.sell_price || 0);
    return {
      id: inventory.id,
      inventory_item_id: inventory.id,
      name: inventory.product_name,
      description: inventory.description || "",
      price: moneyText(unitAmount),
      quantity,
      unitAmount,
      lineTotal: unitAmount * quantity,
      fulfilment_type: "stock"
    };
  });
}

async function getShopSettings() {
  try {
    const rows = await restSelect(
      "shop_inventory_settings",
      "pickup_label,pickup_instructions,local_delivery_enabled,local_delivery_fee,courier_delivery_enabled,courier_delivery_fee,free_shipping_threshold",
      { id: "eq.true", limit: "1" }
    );
    return {
      pickup_label: "Pick up from coaching / club",
      pickup_instructions: "Kim will confirm the pickup details with you.",
      local_delivery_enabled: true,
      local_delivery_fee: 0,
      courier_delivery_enabled: true,
      courier_delivery_fee: 0,
      free_shipping_threshold: null,
      ...(rows[0] || {})
    };
  } catch (error) {
    console.warn("[Stripe checkout] using default shop settings", { message: error.message });
    return {
      pickup_label: "Pick up from coaching / club",
      pickup_instructions: "Kim will confirm the pickup details with you.",
      local_delivery_enabled: true,
      local_delivery_fee: 0,
      courier_delivery_enabled: true,
      courier_delivery_fee: 0,
      free_shipping_threshold: null
    };
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
  const tax = subtotal * 0.1;
  const discount = 0;
  const shipping = calculateShippingAmount(fulfilmentMethod, subtotal, settings);
  const total = Math.max(0, subtotal + tax + shipping - discount);
  const order = await restInsert("shop_orders", {
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
    customerEmail: order.customer_email || "",
    fulfilmentMethod,
    shipping,
    itemCount: items.length,
    total
  });

  const lineItems = items.map((item) => ({
    name: item.name,
    description: item.description,
    quantity: item.quantity,
    unitAmount: item.unitAmount
  }));
  if (tax > 0) {
    lineItems.push({
      name: "Estimated tax",
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
      else throw new Error("Unknown checkout type.");
    }

    res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("[Stripe checkout] failed", { message: error.message });
    res.status(400).json({ error: error.message || "Could not start Stripe Checkout." });
  }
};
