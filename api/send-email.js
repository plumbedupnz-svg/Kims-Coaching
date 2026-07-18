const defaultEmailSettings = {
  provider: "disabled",
  from_name: "Kim Jones Coaching",
  from_email: "kim@kimjonescoaching.co.nz",
  reply_to_email: "kim@kimjonescoaching.co.nz",
  enabled: false
};

const adminTypes = new Set([
  "admin_notification",
  "booking_admin_notification",
  "shop_order_admin_notification",
  "product_admin_notification",
  "product_enquiry_notification",
  "purchase_order_email",
  "waitlist_notification",
  "junior_group_admin_notification",
  "junior_group_session_plan",
  "inventory_reorder_notification",
  "report_email",
  "admin_alert"
]);

const publicSupabaseAnonKey = "sb_publishable_34HW1F0Asg7kEk8vEYCiLQ_9jO1jl4m";

function safeError(error) {
  return error?.message || String(error || "Unknown error");
}

function normalizeProvider(value = "") {
  const provider = String(value || "disabled").toLowerCase();
  if (provider === "disabled" || provider === "test" || !provider) return "disabled";
  // Resend is the project's only live provider. Legacy saved provider values
  // are intentionally routed through Resend so an old row cannot revive SMTP.
  return "resend";
}

function normalizeSupabaseRestUrl(url = "") {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/rest/v1") ? trimmed : `${trimmed}/rest/v1`;
}

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    restUrl: normalizeSupabaseRestUrl(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || publicSupabaseAnonKey
  };
}

async function loadEmailSettings() {
  const { restUrl, serviceRoleKey } = getSupabaseConfig();

  if (!restUrl || !serviceRoleKey) {
    const fallbackSettings = getFallbackSettings();
    console.info("Email settings loaded from Vercel environment fallback", {
      provider: fallbackSettings.provider,
      enabled: fallbackSettings.enabled,
      hasSupabaseUrl: Boolean(restUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey)
    });
    return fallbackSettings;
  }

  console.info("Loading email settings from Supabase", {
    restUrlHost: restUrl.replace(/^https?:\/\//, "").split("/")[0],
    hasServiceRoleKey: Boolean(serviceRoleKey)
  });

  const response = await fetch(`${restUrl}/email_settings?select=*&limit=1`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!response.ok) throw new Error(`Could not load email_settings: ${response.status}`);
  const rows = await response.json();
  const loadedSettings = { ...defaultEmailSettings, ...(rows?.[0] || {}) };
  console.info("Email settings loaded", {
    provider: loadedSettings.provider,
    enabled: loadedSettings.enabled,
    hasFromEmail: Boolean(loadedSettings.from_email),
    hasReplyToEmail: Boolean(loadedSettings.reply_to_email)
  });
  return loadedSettings;
}

function fromHeader(settings) {
  return `${settings.from_name || defaultEmailSettings.from_name} <${settings.from_email || defaultEmailSettings.from_email}>`;
}

function getCustomerEmail(payload = {}) {
  return payload.email || payload.customerEmail || payload.customer_email || "";
}

function getRecipients(type, payload = {}, settings = defaultEmailSettings) {
  const adminEmail = type === "waitlist_notification"
    ? process.env.EMAIL_ADMIN_TO || payload.adminEmail || "kim@kimjonescoaching.co.nz"
    : process.env.EMAIL_ADMIN_TO || payload.adminEmail || settings.reply_to_email || settings.from_email;
  if (adminTypes.has(type)) return [adminEmail].filter(Boolean);
  return [getCustomerEmail(payload)].filter(Boolean);
}

function getFallbackSettings() {
  const provider = normalizeProvider(process.env.EMAIL_PROVIDER);
  return {
    ...defaultEmailSettings,
    provider,
    from_name: process.env.EMAIL_FROM_NAME || defaultEmailSettings.from_name,
    from_email: process.env.EMAIL_FROM_ADDRESS || defaultEmailSettings.from_email,
    reply_to_email: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM_ADDRESS || defaultEmailSettings.reply_to_email,
    enabled: provider !== "disabled"
  };
}

function getSubject(type, payload = {}) {
  const playerName = payload.playerName || payload.player_name || "player";
  const customerName = payload.customerName || payload.customer_name || "customer";
  const productName = payload.productName || payload.product_name || payload.items?.[0]?.name || "shop item";

  const subjects = {
    admin_notification: "Kim Jones Coaching admin alert",
    admin_alert: "Kim Jones Coaching admin alert",
    booking_admin_notification: `New private lesson booking: ${playerName}`,
    booking_customer_confirmation: "Your private lesson request has been booked",
    booking_changed: "Your Kim Jones Coaching booking has been updated",
    booking_cancelled: "Your Kim Jones Coaching booking has been cancelled",
    shop_order_admin_notification: `New shop order from ${customerName}`,
    shop_order_customer_confirmation: "Your Kim Jones Coaching order confirmation",
    product_admin_notification: `New shop order from ${customerName}`,
    product_customer_confirmation: "Your Kim Jones Coaching order confirmation",
    product_enquiry_notification: `Product enquiry: ${productName}`,
    purchase_order_email: `Purchase order: ${productName}`,
    waitlist_notification: `New waitlist request from ${customerName}`,
    waitlist_customer_confirmation: "Kim Jones Coaching waitlist request received",
    junior_group_admin_notification: `New junior group booking request: ${playerName}`,
    junior_group_payment_request: "Complete your Kim Jones Coaching group booking",
    junior_group_customer_confirmation: "Your junior group coaching place is confirmed",
    junior_group_assignment_notification: `${playerName} has been placed in a Kim Jones Coaching group`,
    junior_group_session_plan: `Session plan: ${payload.programmeName || payload.groupName || "Junior coaching"}`,
    inventory_reorder_notification: `New order required: ${payload.productName || payload.product_name || "stock item"}`,
    report_email: `${payload.reportName || payload.report_name || "Kim Jones Coaching report"}: ${payload.dateRange || payload.date_range || "report"}`
  };

  return subjects[type] || "Kim Jones Coaching notification";
}

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function moneyNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const number = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function moneyDisplay(value) {
  if (value === null || typeof value === "undefined" || value === "") return "";
  if (typeof value === "number") return `$${value.toFixed(2)}`;
  const text = String(value).trim();
  if (!text) return "";
  if (/^\$/.test(text) || /\bNZD\b/i.test(text)) return text;
  const number = moneyNumber(text);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : text;
}

function line(label, value) {
  return `${label}: ${value || ""}`;
}

function lineIf(label, value) {
  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).join(", ");
    return joined ? `${label}: ${joined}` : "";
  }
  return value ? `${label}: ${value}` : "";
}

function formatEmailDate(value, options) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function getPlayerLevel(payload = {}) {
  return payload.playerLevel || payload.player_level || "Not specified";
}

function renderBookingText(title, payload = {}) {
  const startTime = payload.startTime || payload.dateTime;
  return [
    title,
    "",
    line("Player", payload.playerName || payload.player_name),
    line("Player level", getPlayerLevel(payload)),
    line("Lesson type", payload.lessonTypeName || payload.lesson_type_name),
    line("Duration", payload.durationMinutes ? `${payload.durationMinutes} minutes` : ""),
    line("Date", formatEmailDate(startTime, { weekday: "long", month: "long", day: "numeric", year: "numeric" })),
    line("Start time", formatEmailDate(startTime, { hour: "numeric", minute: "2-digit" })),
    line("Club", payload.clubName || payload.club_name),
    line("Coach", payload.coachName || payload.coach_name || "Kim Jones"),
    line("Customer", payload.customerName || payload.customer_name),
    line("Email", getCustomerEmail(payload)),
    line("Mobile", payload.mobile),
    line("End time", formatEmailDate(payload.endTime, { hour: "numeric", minute: "2-digit" })),
    line("Status", payload.bookingStatus || payload.booking_status),
    line("Notes", payload.notes)
  ].join("\n");
}

function renderWaitlistText(title, payload = {}) {
  const preferredDuration = payload.preferredDuration || payload.preferred_duration;
  return [
    title,
    "",
    lineIf("Player", payload.playerName || payload.player_name),
    lineIf("Player level", payload.playerLevel || payload.player_level || payload.skill_level),
    lineIf("Preferred lesson type", payload.lessonTypeName || payload.lesson_type_name || payload.preferred_lesson_type),
    lineIf("Preferred duration", preferredDuration ? `${preferredDuration} minutes` : ""),
    lineIf("Preferred days", payload.preferredDays || payload.preferred_days),
    lineIf("Preferred times", payload.preferredTimes || payload.preferred_times),
    lineIf("Club", payload.clubName || payload.club_name || payload.club),
    lineIf("Coach", payload.coachName || payload.coach_name || payload.coach),
    lineIf("Customer", payload.customerName || payload.customer_name),
    lineIf("Email", getCustomerEmail(payload)),
    lineIf("Mobile", payload.mobile),
    lineIf("Notes", payload.notes)
  ].filter(Boolean).join("\n");
}

function renderJuniorGroupText(title, payload = {}) {
  return [
    title,
    "",
    lineIf("Programme", payload.programmeName || payload.programme_name),
    lineIf("Group", payload.groupName || payload.group_name),
    lineIf("Player", payload.playerName || payload.player_name),
    lineIf("Player age", payload.playerAge || payload.player_age),
    lineIf("Player level", payload.playerLevel || payload.player_level),
    lineIf("Customer", payload.customerName || payload.customer_name),
    lineIf("Email", getCustomerEmail(payload)),
    lineIf("Mobile", payload.mobile),
    lineIf("Coach", payload.coachName || payload.coach_name),
    lineIf("Club", payload.clubName || payload.club_name),
    lineIf("Day", payload.dayName || payload.day_name),
    lineIf("Time", payload.sessionTime || payload.session_time),
    lineIf("Start date", payload.startDate || payload.start_date),
    lineIf("Sessions", payload.sessionCount || payload.session_count),
    lineIf("Duration", payload.durationMinutes ? `${payload.durationMinutes} minutes` : ""),
    lineIf("Amount", payload.amount ? `$${Number(payload.amount).toFixed(2)}` : ""),
    lineIf("Payment link", payload.paymentLinkUrl || payload.payment_link_url),
    lineIf("Notes", payload.notes)
  ].filter(Boolean).join("\n");
}

function renderSessionPlanText(title, payload = {}) {
  return [
    title,
    "",
    lineIf("Programme", payload.programmeName || payload.groupName),
    lineIf("Session date", payload.sessionDate || payload.session_date),
    lineIf("Warm-up", payload.warmUp || payload.warm_up),
    lineIf("Technical focus", payload.technicalFocus || payload.technical_focus),
    lineIf("Drills", payload.drills),
    lineIf("Games", payload.games),
    lineIf("Equipment needed", payload.equipmentNeeded || payload.equipment_needed),
    lineIf("Notes", payload.notes)
  ].filter(Boolean).join("\n");
}

function renderItems(payload = {}) {
  if (Array.isArray(payload.items)) {
    return payload.items
      .map((item) => {
        const availabilityNote = item.availability_note || item.availabilityNote || "";
        return `- ${item.name || item.product_name || "Product"} x ${item.quantity || 1} (${item.category || "Uncategorized"}) ${item.price || ""}${availabilityNote ? `\n  Note: ${availabilityNote}` : ""}`;
      })
      .join("\n");
  }
  return [
    payload.productName || payload.product_name ? line("Product", payload.productName || payload.product_name) : "",
    payload.category ? line("Category", payload.category) : "",
    payload.price ? line("Price", payload.price) : "",
    payload.quantity ? line("Quantity", payload.quantity) : ""
  ].filter(Boolean).join("\n");
}

function shopItems(payload = {}) {
  if (Array.isArray(payload.items) && payload.items.length) return payload.items;
  if (payload.productName || payload.product_name) {
    return [{
      name: payload.productName || payload.product_name,
      category: payload.category,
      price: payload.price,
      quantity: payload.quantity || 1,
      lineTotal: moneyNumber(payload.price) * Number(payload.quantity || 1)
    }];
  }
  return [];
}

function shopItemUnitPrice(item = {}) {
  return moneyDisplay(item.sale_price_at_sale ?? item.unitAmount ?? item.unit_amount ?? item.price);
}

function shopItemLineTotal(item = {}) {
  const quantity = Math.max(1, Number(item.quantity || 1));
  const directTotal = item.lineTotal ?? item.line_total ?? item.total ?? item.total_amount;
  if (directTotal !== null && typeof directTotal !== "undefined" && directTotal !== "") return moneyDisplay(directTotal);
  const unit = moneyNumber(item.sale_price_at_sale ?? item.unitAmount ?? item.unit_amount ?? item.price);
  return unit ? moneyDisplay(unit * quantity) : "";
}

function renderShopCustomerHtml(payload = {}) {
  const customerName = payload.customerName || payload.customer_name || "there";
  const orderId = payload.orderId || payload.order_id || payload.relatedId || payload.related_id || "";
  const orderDate = formatEmailDate(payload.createdAt || payload.created_at || new Date(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const fulfilment = payload.fulfilmentLabel || payload.fulfilment_label || payload.fulfilment_method || payload.fulfilmentMethod || "";
  const deliveryAddress = payload.deliveryAddress || payload.delivery_address || "";
  const pickupInstructions = payload.pickupInstructions || payload.pickup_instructions || "";
  const items = shopItems(payload);
  const availabilityNotes = items
    .map((item) => item.availability_note || item.availabilityNote || "")
    .filter(Boolean);
  const hasOrderToSaleNote = availabilityNotes.length > 0;
  const itemRows = items.length
    ? items.map((item) => `
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #e5edf8;">
            <div style="font-size:16px;line-height:1.35;font-weight:700;color:#12203a;">${escapeHtml(item.name || item.product_name || "Product")}</div>
            <div style="margin-top:4px;font-size:13px;line-height:1.4;color:#60708c;">${escapeHtml([item.category, item.sku ? `SKU ${item.sku}` : ""].filter(Boolean).join(" | "))}</div>
            ${item.availability_note || item.availabilityNote ? `<div style="margin-top:8px;font-size:13px;line-height:1.45;color:#7a4b00;background:#fff8e6;border:1px solid #ffe0a3;border-radius:8px;padding:8px 10px;">${escapeHtml(item.availability_note || item.availabilityNote)}</div>` : ""}
          </td>
          <td align="center" style="padding:16px 8px;border-bottom:1px solid #e5edf8;font-size:14px;color:#12203a;">${escapeHtml(item.quantity || 1)}</td>
          <td align="right" style="padding:16px 0;border-bottom:1px solid #e5edf8;font-size:14px;color:#12203a;">${escapeHtml(shopItemUnitPrice(item))}</td>
          <td align="right" style="padding:16px 0 16px 12px;border-bottom:1px solid #e5edf8;font-size:15px;font-weight:700;color:#12203a;">${escapeHtml(shopItemLineTotal(item))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="4" style="padding:16px 0;color:#60708c;">Your order details are being prepared.</td></tr>`;
  const discount = moneyNumber(payload.discount);
  const tax = moneyNumber(payload.tax);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#12203a;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">Your Kim Jones Coaching order has been confirmed.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;margin:0;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #d9e3f2;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#09213d;padding:28px 30px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:2.4px;text-transform:uppercase;font-weight:700;color:#69b7ff;">Kim Jones Coaching</div>
                <h1 style="margin:12px 0 8px;font-size:28px;line-height:1.15;color:#ffffff;">Thanks for your order, ${escapeHtml(customerName)}.</h1>
                <p style="margin:0;font-size:15px;line-height:1.55;color:#d9e9ff;">Your payment has been received and Kim is getting your shop order ready.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 30px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:0 0 16px;">
                      <div style="font-size:13px;color:#60708c;">Order</div>
                      <div style="margin-top:3px;font-size:17px;font-weight:800;color:#12203a;">${escapeHtml(orderId ? `#${String(orderId).slice(0, 8)}` : "Confirmed")}</div>
                    </td>
                    <td align="right" style="padding:0 0 16px;">
                      <div style="font-size:13px;color:#60708c;">Date</div>
                      <div style="margin-top:3px;font-size:15px;font-weight:700;color:#12203a;">${escapeHtml(orderDate)}</div>
                    </td>
                  </tr>
                </table>
                <div style="border:1px solid #d9e3f2;border-radius:12px;padding:16px 18px;background:#f8fbff;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="font-size:15px;line-height:1.5;color:#12203a;">
                        <strong style="display:block;margin-bottom:4px;">${escapeHtml(fulfilment || "Fulfilment")}</strong>
                        ${deliveryAddress ? escapeHtml(deliveryAddress) : escapeHtml(pickupInstructions || "Kim will confirm collection details shortly.")}
                      </td>
                      <td align="right" style="vertical-align:top;">
                        <span style="display:inline-block;background:#e7f7ee;color:#137333;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;">Paid</span>
                      </td>
                    </tr>
                  </table>
                </div>
                ${hasOrderToSaleNote ? `<div style="margin-top:14px;border:1px solid #ffe0a3;border-radius:12px;background:#fff8e6;padding:13px 16px;font-size:14px;line-height:1.5;color:#7a4b00;">Some items are ordered in as needed. Kim will confirm arrival once stock levels have been checked.</div>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:10px 30px 4px;">
                <h2 style="margin:0 0 8px;font-size:18px;line-height:1.3;color:#12203a;">Order summary</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <thead>
                    <tr>
                      <th align="left" style="padding:10px 0;border-bottom:2px solid #d9e3f2;font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#60708c;">Item</th>
                      <th align="center" style="padding:10px 8px;border-bottom:2px solid #d9e3f2;font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#60708c;">Qty</th>
                      <th align="right" style="padding:10px 0;border-bottom:2px solid #d9e3f2;font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#60708c;">Price</th>
                      <th align="right" style="padding:10px 0 10px 12px;border-bottom:2px solid #d9e3f2;font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#60708c;">Total</th>
                    </tr>
                  </thead>
                  <tbody>${itemRows}</tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 30px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:320px;margin-left:auto;border-collapse:collapse;">
                  <tr>
                    <td style="padding:7px 0;font-size:14px;color:#60708c;">Subtotal</td>
                    <td align="right" style="padding:7px 0;font-size:14px;color:#12203a;">${escapeHtml(moneyDisplay(payload.subtotal))}</td>
                  </tr>
                  ${moneyDisplay(payload.shipping) ? `<tr><td style="padding:7px 0;font-size:14px;color:#60708c;">Shipping</td><td align="right" style="padding:7px 0;font-size:14px;color:#12203a;">${escapeHtml(moneyDisplay(payload.shipping))}</td></tr>` : ""}
                  ${discount > 0 ? `<tr><td style="padding:7px 0;font-size:14px;color:#60708c;">Discount</td><td align="right" style="padding:7px 0;font-size:14px;color:#137333;">-${escapeHtml(moneyDisplay(discount))}</td></tr>` : ""}
                  ${tax > 0 ? `<tr><td style="padding:7px 0;font-size:14px;color:#60708c;">Tax</td><td align="right" style="padding:7px 0;font-size:14px;color:#12203a;">${escapeHtml(moneyDisplay(tax))}</td></tr>` : ""}
                  <tr>
                    <td style="padding:12px 0 0;border-top:1px solid #d9e3f2;font-size:16px;font-weight:800;color:#12203a;">Order total</td>
                    <td align="right" style="padding:12px 0 0;border-top:1px solid #d9e3f2;font-size:20px;font-weight:800;color:#12203a;">${escapeHtml(moneyDisplay(payload.total))}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fbff;border-top:1px solid #d9e3f2;padding:20px 30px;">
                <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#12203a;"><strong>Need help with this order?</strong></p>
                <p style="margin:0;font-size:14px;line-height:1.5;color:#60708c;">Reply to this email and Kim will help with collection, delivery, sizing, or product questions.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderShopText(title, payload = {}) {
  return [
    title,
    "",
    line("Customer", payload.customerName || payload.customer_name),
    line("Email", getCustomerEmail(payload)),
    line("Mobile", payload.mobile),
    line("Order status", payload.orderStatus || payload.order_status),
    lineIf("Fulfilment", payload.fulfilmentLabel || payload.fulfilment_method || payload.fulfilmentMethod),
    lineIf("Delivery address", payload.deliveryAddress || payload.delivery_address),
    lineIf("Pickup instructions", payload.pickupInstructions || payload.pickup_instructions),
    "",
    renderItems(payload),
    "",
    line("Subtotal", payload.subtotal),
    lineIf("Shipping", payload.shipping),
    lineIf("Tax", payload.tax),
    lineIf("Discount", payload.discount),
    line("Total", payload.total),
    line("Notes", payload.notes)
  ].filter((line) => line !== "").join("\n");
}

function renderInventoryReorderText(title, payload = {}) {
  return [
    title,
    "",
    "A shop purchase has moved this item to or below its reorder threshold.",
    "",
    line("Product", payload.productName || payload.product_name),
    lineIf("SKU", payload.sku),
    line("Quantity before sale", payload.quantityBefore ?? payload.quantity_before),
    line("Quantity sold", payload.quantitySold ?? payload.quantity_sold),
    line("Quantity on hand", payload.quantityAfter ?? payload.quantity_after),
    line("Reorder threshold", payload.reorderThreshold ?? payload.reorder_threshold),
    lineIf("Low stock threshold", payload.lowStockThreshold ?? payload.low_stock_threshold),
    lineIf("Stock status", payload.stockStatus || payload.stock_status),
    lineIf("Shop order", payload.orderId || payload.order_id),
    "",
    "New order required."
  ].filter(Boolean).join("\n");
}

function renderReportText(title, payload = {}) {
  const totals = Array.isArray(payload.totals) ? payload.totals.join("\n") : payload.totals;
  return [
    title,
    "",
    lineIf("Date range", payload.dateRange || payload.date_range),
    lineIf("Totals", totals),
    "",
    payload.reportText || payload.report_text || "Report rows were generated in the admin reports area."
  ].filter(Boolean).join("\n");
}

function renderText(type, payload = {}) {
  if (type === "booking_admin_notification") return renderBookingText("New Kim Jones Coaching booking", payload);
  if (type === "booking_customer_confirmation") return renderBookingText("Your coaching booking has been booked", payload);
  if (type === "booking_changed") return renderBookingText("Your Kim Jones Coaching booking has been updated", payload);
  if (type === "booking_cancelled") return renderBookingText("Your Kim Jones Coaching booking has been cancelled", payload);
  if (type === "waitlist_notification") return renderWaitlistText("New waitlist request", payload);
  if (type === "waitlist_customer_confirmation") return renderWaitlistText("Your waitlist request has been received", payload);
  if (type === "junior_group_admin_notification") return renderJuniorGroupText("New junior group booking request", payload);
  if (type === "junior_group_payment_request") return renderJuniorGroupText("Complete payment to confirm your junior group coaching place", payload);
  if (type === "junior_group_customer_confirmation") return renderJuniorGroupText("Your junior group coaching place is confirmed", payload);
  if (type === "junior_group_assignment_notification") return renderJuniorGroupText("Your child has been placed in a Kim Jones Coaching group", payload);
  if (type === "junior_group_session_plan") return renderSessionPlanText("Junior group session plan", payload);
  if (type === "purchase_order_email") return renderShopText("Kim Jones Coaching purchase order", payload);
  if (type === "product_enquiry_notification") return renderShopText("Kim Jones Coaching product enquiry", payload);
  if (type === "inventory_reorder_notification") return renderInventoryReorderText("Inventory reorder notification", payload);
  if (type === "report_email") return renderReportText(payload.reportName || payload.report_name || "Kim Jones Coaching report", payload);
  if (type.includes("shop_order") || type.includes("product_")) return renderShopText("Kim Jones Coaching shop notification", payload);
  return [
    "Kim Jones Coaching notification",
    "",
    JSON.stringify({ ...payload, ics: payload.ics ? "[calendar invite omitted from log text]" : undefined }, null, 2)
  ].join("\n");
}

function renderHtml(type, payload = {}) {
  if (type === "shop_order_customer_confirmation" || type === "product_customer_confirmation") {
    return renderShopCustomerHtml(payload);
  }
  return "";
}

function getMissingEnv(provider) {
  if (provider === "resend") {
    return ["RESEND_API_KEY"].filter((key) => !process.env[key]);
  }
  return [];
}

function buildLogPayload({ type, recipient, relatedType, relatedId, status, provider, errorMessage }) {
  return {
    notification_type: type || "unknown",
    recipient_email: recipient || null,
    related_type: relatedType || null,
    related_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(relatedId || "") ? relatedId : null,
    status,
    provider,
    error_message: errorMessage || null
  };
}

async function createNotificationLog({ type, recipient, relatedType, relatedId, status, provider, errorMessage }) {
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  if (!restUrl) {
    console.warn("Notification log skipped because Supabase URL is missing", {
      hasSupabaseUrl: Boolean(restUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      hasAnonKey: Boolean(anonKey),
      type,
      recipient,
      status,
      provider
    });
    return null;
  }

  const body = buildLogPayload({ type, recipient, relatedType, relatedId, status, provider, errorMessage });

  try {
    console.info("Creating notification log", {
      type,
      recipient,
      status,
      provider,
      relatedType,
      hasRelatedId: Boolean(body.related_id),
      method: "direct"
    });
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for direct notification log insert");
    const response = await fetch(`${restUrl}/notification_logs?select=id`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`notification_logs insert returned ${response.status}: ${text}`);
    }
    const rows = await response.json().catch(() => []);
    const id = rows?.[0]?.id || null;
    console.info("Notification log insert result", { id: id || "none", status, method: "direct" });
    return id;
  } catch (error) {
    console.error("Notification log direct insert failed safely", { message: safeError(error), type, recipient, status, provider });
  }

  try {
    console.info("Creating notification log", {
      type,
      recipient,
      status,
      provider,
      relatedType,
      hasRelatedId: Boolean(body.related_id),
      method: "rpc"
    });
    const response = await fetch(`${restUrl}/rpc/log_notification_attempt`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey || anonKey,
        Authorization: `Bearer ${serviceRoleKey || anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_log_id: null,
        p_notification_type: body.notification_type,
        p_recipient_email: body.recipient_email,
        p_related_type: body.related_type,
        p_related_id: body.related_id,
        p_status: body.status,
        p_provider: body.provider,
        p_error_message: body.error_message
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`log_notification_attempt insert returned ${response.status}: ${text}`);
    }
    const id = await response.json().catch(() => null);
    console.info("Notification log insert result", { id: id || "none", status, method: "rpc" });
    return id;
  } catch (error) {
    console.error("Notification log RPC insert failed safely", { message: safeError(error), type, recipient, status, provider });
    return null;
  }
}

async function updateNotificationLog(id, { status, errorMessage }) {
  if (!id) return;
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  if (!restUrl) return;

  try {
    console.info("Updating notification log", { id, status, hasError: Boolean(errorMessage), method: "direct" });
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for direct notification log update");
    const response = await fetch(`${restUrl}/notification_logs?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        status,
        error_message: errorMessage || null
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`notification_logs update returned ${response.status}: ${text}`);
    }
    console.info("Notification log update result", { id, status, method: "direct" });
    return;
  } catch (error) {
    console.error("Notification log direct update failed safely", { id, status, message: safeError(error) });
  }

  try {
    console.info("Updating notification log", { id, status, hasError: Boolean(errorMessage), method: "rpc" });
    const response = await fetch(`${restUrl}/rpc/log_notification_attempt`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey || anonKey,
        Authorization: `Bearer ${serviceRoleKey || anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_log_id: id,
        p_notification_type: null,
        p_recipient_email: null,
        p_related_type: null,
        p_related_id: null,
        p_status: status,
        p_provider: null,
        p_error_message: errorMessage || null
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`log_notification_attempt update returned ${response.status}: ${text}`);
    }
    console.info("Notification log update result", { id, status, method: "rpc" });
  } catch (error) {
    console.error("Notification log RPC update failed safely", { id, status, message: safeError(error) });
  }
}

async function createPendingLogs(type, recipients, payload, provider) {
  const list = recipients.length ? recipients : [""];
  return Promise.all(list.map(async (recipient) => ({
    recipient,
    id: await createNotificationLog({
      type,
      recipient,
      relatedType: payload.relatedType,
      relatedId: payload.relatedId,
      status: "pending",
      provider
    })
  })));
}

function getLogIds(logs = []) {
  return logs.map((log) => log.id).filter(Boolean);
}

async function finalizeLogs(logs, status, errorMessage = "") {
  await Promise.all((logs || []).map((log) => {
    if (log.id) return updateNotificationLog(log.id, { status, errorMessage });
    return createNotificationLog({
      type: log.type,
      recipient: log.recipient,
      relatedType: log.relatedType,
      relatedId: log.relatedId,
      status,
      provider: log.provider,
      errorMessage
    });
  }));
}

function attachLogContext(logs, type, payload, provider) {
  return (logs || []).map((log) => ({
    ...log,
    type,
    provider,
    relatedType: payload.relatedType,
    relatedId: payload.relatedId
  }));
}

async function sendWithResend(message, settings) {
  console.info("[Kim's Coaching email] Resend send attempted", {
    traceId: message.traceId,
    recipients: message.to,
    subject: message.subject,
    hasIcs: Boolean(message.ics)
  });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromHeader(settings),
      to: message.to,
      reply_to: settings.reply_to_email,
      subject: message.subject,
      text: message.text,
      html: message.html || undefined,
      attachments: message.ics
        ? [{ filename: "coaching-booking.ics", content: Buffer.from(message.ics).toString("base64") }]
        : undefined
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result?.message || result?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Resend returned ${response.status}: ${detail}`);
  }
  console.info("[Kim's Coaching email] Resend response returned", {
    traceId: message.traceId,
    messageId: result?.id || ""
  });
  return result;
}

async function getLastNotificationLog(authToken = "") {
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  const apiKey = serviceRoleKey || anonKey;
  const bearer = serviceRoleKey || authToken;
  if (!restUrl || !apiKey || !bearer) return null;
  try {
    const response = await fetch(`${restUrl}/notification_logs?select=*&order=created_at.desc&limit=1`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${bearer}`
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`notification_logs diagnostics returned ${response.status}: ${text}`);
    }
    const rows = await response.json();
    return rows?.[0] || null;
  } catch (error) {
    console.error("Could not load last notification log", { message: safeError(error) });
    return null;
  }
}

async function requireAdminForDiagnostics(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = String(authHeader).replace(/^Bearer\s+/i, "");
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  const apiKey = serviceRoleKey || anonKey;
  if (!token || !restUrl || !apiKey) {
    return { ok: false, status: 401, error: "Admin diagnostics require an authenticated admin session." };
  }

  try {
    const projectUrl = restUrl.replace(/\/rest\/v1$/, "");
    const userResponse = await fetch(`${projectUrl}/auth/v1/user`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${token}`
      }
    });
    if (!userResponse.ok) {
      return { ok: false, status: 401, error: "Could not verify admin session." };
    }
    const user = await userResponse.json();
    const profileResponse = await fetch(`${restUrl}/profiles?select=role&id=eq.${encodeURIComponent(user.id)}&limit=1`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${serviceRoleKey || token}`
      }
    });
    if (!profileResponse.ok) {
      return { ok: false, status: 403, error: "Could not verify admin profile." };
    }
    const profiles = await profileResponse.json();
    if (profiles?.[0]?.role !== "admin") {
      return { ok: false, status: 403, error: "Email diagnostics are available to admin users only." };
    }
    return { ok: true, token };
  } catch (error) {
    console.error("Admin diagnostics auth failed", { message: safeError(error) });
    return { ok: false, status: 500, error: "Could not verify admin diagnostics access." };
  }
}

async function buildDiagnostics({ includeConnectionTest = false, authToken = "" } = {}) {
  let settings = defaultEmailSettings;
  let settingsError = "";
  try {
    settings = await loadEmailSettings();
  } catch (error) {
    settingsError = safeError(error);
    console.error("Email diagnostics settings load failed", { message: settingsError });
    settings = getFallbackSettings();
  }

  const provider = normalizeProvider(settings.provider);
  const missingEnv = getMissingEnv(provider);
  const mode = settings.enabled && provider !== "disabled" ? "LIVE" : "TEST";
  const { restUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
  const diagnostics = {
    mode,
    provider,
    settingsEnabled: Boolean(settings.enabled),
    settingsError,
    supabaseLogging: {
      configured: Boolean(restUrl && (serviceRoleKey || anonKey)),
      hasSupabaseUrl: Boolean(restUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      hasAnonKey: Boolean(anonKey)
    },
    resend: {
      configured: provider !== "resend" || missingEnv.length === 0,
      hasApiKey: Boolean(process.env.RESEND_API_KEY),
      missing: missingEnv
    },
    authEmail: {
      provider: "Resend SMTP",
      verification: "Verify in Supabase Dashboard > Authentication > Email > SMTP Settings"
    },
    lastLog: await getLastNotificationLog(authToken),
    connectionTest: null
  };

  if (includeConnectionTest) {
    if (!settings.enabled || provider === "disabled") {
      diagnostics.connectionTest = {
        status: "skipped",
        error: "Enable Resend before sending a test email."
      };
    } else if (missingEnv.length) {
      diagnostics.connectionTest = {
        status: "failed",
        error: `Missing Vercel email environment variables: ${missingEnv.join(", ")}`
      };
    } else {
      try {
        const recipient = process.env.EMAIL_ADMIN_TO || settings.reply_to_email || settings.from_email;
        const response = await sendWithResend({
          traceId: `resend-test-${Date.now()}`,
          to: [recipient],
          subject: "Kim Jones Coaching Resend test",
          text: "Resend is configured for Kim Jones Coaching application emails.",
          ics: ""
        }, settings);
        diagnostics.connectionTest = { status: "success", error: "", messageId: response?.id || "" };
      } catch (error) {
        diagnostics.connectionTest = { status: "failed", error: safeError(error) };
        console.error("Resend test email failed", { message: safeError(error) });
      }
    }
  }

  return diagnostics;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const adminCheck = await requireAdminForDiagnostics(req);
    if (!adminCheck.ok) {
      res.status(adminCheck.status).json({ error: adminCheck.error });
      return;
    }
    const diagnostics = await buildDiagnostics({ authToken: adminCheck.token });
    res.status(200).json(diagnostics);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (body.action === "test_resend" || body.action === "test_smtp") {
    const adminCheck = await requireAdminForDiagnostics(req);
    if (!adminCheck.ok) {
      res.status(adminCheck.status).json({ error: adminCheck.error });
      return;
    }
    const diagnostics = await buildDiagnostics({ includeConnectionTest: true, authToken: adminCheck.token });
    res.status(200).json(diagnostics);
    return;
  }

  const { type = "admin_notification", payload = {} } = body;
  const traceId = payload.traceId || `email-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let settings = getFallbackSettings();
  let provider = normalizeProvider(settings.provider);
  const to = getRecipients(type, payload, settings);
  let logs = [];

  try {
    console.info("[Kim's Coaching email] API handler entered before settings load", {
      traceId,
      type,
      provider,
      recipients: to,
      hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
      hasSupabaseUrl: Boolean(getSupabaseConfig().restUrl),
      hasServiceRoleKey: Boolean(getSupabaseConfig().serviceRoleKey),
      hasAnonKey: Boolean(getSupabaseConfig().anonKey)
    });
    logs = attachLogContext(await createPendingLogs(type, to, payload, provider), type, payload, provider);
    console.info("[Kim's Coaching email] notification log created", {
      traceId,
      type,
      provider,
      logIds: getLogIds(logs),
      recipients: to
    });

    settings = await loadEmailSettings();
    provider = normalizeProvider(settings.provider);
    console.info("[Kim's Coaching email] email settings loaded", {
      traceId,
      provider,
      enabled: Boolean(settings.enabled),
      fromEmail: settings.from_email || "",
      replyToEmail: settings.reply_to_email || ""
    });
    const settingsRecipients = getRecipients(type, payload, settings);
    if (settingsRecipients.length && settingsRecipients.join(",") !== to.join(",")) {
      console.info("[Kim's Coaching email] recipients updated from Admin email settings", {
        traceId,
        type,
        previousRecipients: to,
        settingsRecipients
      });
      to.splice(0, to.length, ...settingsRecipients);
    }
    console.info("[Kim's Coaching email] email send stage ready", {
      traceId,
      type,
      provider,
      enabled: Boolean(settings.enabled),
      recipients: to,
      relatedType: payload.relatedType || null,
      relatedId: payload.relatedId || null,
      hasResendApiKey: Boolean(process.env.RESEND_API_KEY)
    });
    logs = attachLogContext(logs, type, payload, provider);

    if (!to.length) {
      await finalizeLogs(logs, "skipped", "No recipient configured");
      res.status(200).json({ sent: false, status: "skipped", reason: "No recipient configured", traceId, logIds: getLogIds(logs) });
      return;
    }

    if (!settings.enabled || provider === "disabled") {
      console.info("[Kim's Coaching email] email disabled/test mode", { traceId, type, to });
      await finalizeLogs(logs, "test_mode");
      res.status(200).json({ sent: false, status: "test_mode", provider, traceId, logIds: getLogIds(logs) });
      return;
    }

    const missingEnv = getMissingEnv(provider);
    if (missingEnv.length) {
      const message = `Missing Vercel email environment variables: ${missingEnv.join(", ")}`;
      console.error("[Kim's Coaching email] email environment validation failed", { traceId, type, provider, missingEnv });
      await finalizeLogs(logs, "failed", message);
      res.status(200).json({ sent: false, status: "failed", provider, error: message, traceId, logIds: getLogIds(logs) });
      return;
    }

    const message = {
      traceId,
      to,
      settings,
      subject: getSubject(type, payload),
      text: renderText(type, payload),
      html: renderHtml(type, payload),
      ics: payload.ics || ""
    };

    console.info("[Kim's Coaching email] sending email through Resend", { traceId, type, recipients: to });
    await sendWithResend(message, settings);

    await finalizeLogs(logs, "sent");
    console.info("[Kim's Coaching email] email send succeeded", { traceId, type, provider, recipients: to, logIds: getLogIds(logs) });
    res.status(200).json({ sent: true, status: "sent", provider, traceId, logIds: getLogIds(logs) });
  } catch (error) {
    const safeMessage = safeError(error) || "Email failed safely";
    console.error("[Kim's Coaching email] email failed safely", { traceId, type, provider, recipients: to, message: safeMessage });
    if (!logs.length) {
      logs = attachLogContext(await createPendingLogs(type, to, payload, provider), type, payload, provider);
      console.info("[Kim's Coaching email] notification log created in catch", {
        traceId,
        type,
        provider,
        logIds: getLogIds(logs),
        recipients: to
      });
    }
    await finalizeLogs(logs, "failed", safeMessage);
    res.status(200).json({ sent: false, status: "failed", provider, error: safeMessage, traceId, logIds: getLogIds(logs) });
  }
};
