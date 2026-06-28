const {
  callEmail,
  getRawBody,
  moneyText,
  restInsert,
  restSelect,
  restUpdate,
  verifyStripeSignature
} = require("./_helpers");

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

async function markEvent(event, status, errorMessage = "") {
  try {
    await restUpdate("stripe_webhook_events", { id: `eq.${event.id}` }, {
      processed_at: new Date().toISOString(),
      status,
      error_message: errorMessage || null
    }, "");
  } catch (error) {
    console.error("[Stripe webhook] could not update event log", { eventId: event.id, message: error.message });
  }
}

async function createEventLog(event) {
  try {
    await restInsert("stripe_webhook_events", {
      id: event.id,
      event_type: event.type,
      stripe_created_at: event.created ? new Date(event.created * 1000).toISOString() : null,
      payload: event,
      status: "processing"
    }, "id");
    return true;
  } catch (error) {
    if (/duplicate|23505|409/i.test(error.message || "")) {
      const rows = await restSelect("stripe_webhook_events", "id,status", { id: `eq.${event.id}`, limit: "1" });
      if (rows[0]?.status === "processed") return false;
      await restUpdate("stripe_webhook_events", { id: `eq.${event.id}` }, {
        status: "processing",
        error_message: null
      }, "");
      return true;
    }
    throw error;
  }
}

async function sendBookingEmails(booking) {
  const payload = {
    traceId: `stripe-booking-${booking.id}`,
    relatedType: "booking",
    relatedId: booking.id,
    customerName: booking.parent_name || booking.customer_name,
    playerName: booking.player_name,
    playerLevel: booking.player_level || "Not specified",
    email: booking.customer_email || booking.email,
    mobile: booking.mobile,
    dateTime: booking.start_time,
    startTime: booking.start_time,
    endTime: booking.end_time,
    durationMinutes: booking.duration_minutes,
    lessonTypeName: booking.lesson_type?.name || "Coaching",
    paymentOption: "pay_now",
    totalPrice: booking.total_price,
    clubName: booking.club?.name || "",
    coachName: booking.coach?.display_name || "Kim Jones",
    location: booking.club?.name || "Kim Jones Coaching",
    bookingStatus: "confirmed",
    notes: booking.notes || ""
  };
  await Promise.allSettled([
    callEmail("booking_admin_notification", payload),
    callEmail("booking_customer_confirmation", payload)
  ]);
}

async function handlePrivateLesson(session) {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) throw new Error("Stripe session is missing booking_id metadata.");
  const booking = await restUpdate("bookings", { id: `eq.${bookingId}` }, {
    booking_status: "confirmed",
    payment_status: "paid",
    stripe_session_id: session.id,
    payment_intent_id: session.payment_intent || null,
    paid_at: new Date().toISOString()
  }, "*,lesson_type:lesson_type_id(name,price,duration),club:club_id(name),coach:coach_id(display_name)");
  if (booking) await sendBookingEmails(booking);
}

async function sendJuniorEmails(member) {
  const payload = {
    traceId: `stripe-junior-${member.id}`,
    relatedType: "junior_group",
    relatedId: member.id,
    email: member.email,
    customerName: member.parent_name,
    playerName: member.player_name,
    playerAge: member.player_age,
    playerLevel: member.player_level,
    programmeName: member.group?.programme?.programme_name || member.group?.group_name,
    groupName: member.group?.group_name,
    coachName: member.group?.coach?.display_name || "Kim Jones",
    clubName: member.group?.club?.name || "",
    startDate: member.group?.start_date,
    sessionCount: member.group?.session_count,
    durationMinutes: member.group?.session_duration_minutes,
    amount: member.group?.price,
    notes: member.notes || ""
  };
  await Promise.allSettled([
    callEmail("junior_group_admin_notification", payload),
    callEmail("junior_group_customer_confirmation", payload)
  ]);
}

async function handleJuniorGroup(session) {
  const memberId = session.metadata?.member_id || session.metadata?.booking_id;
  const paymentId = session.metadata?.payment_id;
  if (!memberId) throw new Error("Stripe session is missing junior member metadata.");
  const member = await restUpdate("junior_group_members", { id: `eq.${memberId}` }, {
    booking_status: "confirmed",
    payment_status: "paid",
    confirmed_at: new Date().toISOString(),
    expires_at: null
  }, "*,group:group_id(id,group_name,price,start_date,session_count,session_duration_minutes,programme:programme_id(programme_name),club:club_id(name),coach:coach_id(display_name))");

  const paymentPatch = {
    payment_status: "paid",
    provider: "stripe",
    provider_reference: session.id,
    stripe_session_id: session.id,
    payment_intent_id: session.payment_intent || null,
    paid_at: new Date().toISOString()
  };
  if (paymentId) await restUpdate("payments", { id: `eq.${paymentId}` }, paymentPatch, "");
  else await restUpdate("payments", { junior_group_member_id: `eq.${memberId}` }, paymentPatch, "");

  if (member) await sendJuniorEmails(member);
}

async function deductInventoryForOrder(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    if (item.fulfilment_type !== "stock" || !item.inventory_item_id) continue;
    const inventoryRows = await restSelect("inventory_items", "id,quantity_on_hand,status,low_stock_threshold,need_order_threshold", {
      id: `eq.${item.inventory_item_id}`,
      limit: "1"
    });
    const inventory = inventoryRows[0];
    if (!inventory) throw new Error(`Inventory item ${item.inventory_item_id} was not found.`);
    const before = Number(inventory.quantity_on_hand || 0);
    const quantity = Math.max(1, Number(item.quantity || 1));
    if (before < quantity) throw new Error(`Not enough stock available for ${item.name}.`);
    const after = before - quantity;
    const nextStatus = after <= Number(inventory.need_order_threshold || 0)
      ? "need_to_order"
      : after <= Number(inventory.low_stock_threshold || 0)
        ? "low_stock"
        : "in_stock";
    await restUpdate("inventory_items", { id: `eq.${inventory.id}` }, { quantity_on_hand: after, status: nextStatus }, "");
    await restInsert("stock_movements", {
      inventory_item_id: inventory.id,
      movement_type: "stock_out",
      quantity_delta: -quantity,
      quantity_before: before,
      quantity_after: after,
      reason: `Stripe paid shop order ${order.id}`,
      related_type: "shop_order",
      related_id: order.id
    }, "id");
  }
}

async function sendShopEmails(order) {
  const payload = {
    traceId: `stripe-shop-${order.id}`,
    relatedType: "shop_order",
    relatedId: order.id,
    customerName: order.customer_name,
    email: order.customer_email,
    mobile: order.mobile,
    items: order.items || [],
    subtotal: moneyText(order.subtotal),
    total: moneyText(order.total),
    orderStatus: "paid"
  };
  const updates = {};

  if (!order.admin_notification_email_sent_at) {
    console.info("Sending shop notification email to admin", {
      orderId: order.id,
      customerEmail: order.customer_email || ""
    });
    const adminResult = await callEmail("shop_order_admin_notification", payload);
    if (adminResult?.sent === true || adminResult?.status === "sent") {
      console.info("Email sent successfully", {
        orderId: order.id,
        emailType: "shop_order_admin_notification",
        traceId: adminResult.traceId || payload.traceId
      });
      updates.admin_notification_email_sent_at = new Date().toISOString();
    } else {
      const message = adminResult?.error || adminResult?.reason || adminResult?.status || "Unknown admin email failure";
      console.error(`Email send failed: ${message}`, {
        orderId: order.id,
        emailType: "shop_order_admin_notification",
        traceId: adminResult?.traceId || payload.traceId
      });
    }
  } else {
    console.info("[Stripe webhook] shop admin email already sent, skipping duplicate", {
      orderId: order.id,
      sentAt: order.admin_notification_email_sent_at
    });
  }

  if (!order.customer_confirmation_email_sent_at) {
    console.info("Sending shop confirmation email to customer", {
      orderId: order.id,
      customerEmail: order.customer_email || ""
    });
    const customerResult = await callEmail("shop_order_customer_confirmation", payload);
    if (customerResult?.sent === true || customerResult?.status === "sent") {
      console.info("Email sent successfully", {
        orderId: order.id,
        emailType: "shop_order_customer_confirmation",
        traceId: customerResult.traceId || payload.traceId
      });
      updates.customer_confirmation_email_sent_at = new Date().toISOString();
    } else {
      const message = customerResult?.error || customerResult?.reason || customerResult?.status || "Unknown customer email failure";
      console.error(`Email send failed: ${message}`, {
        orderId: order.id,
        emailType: "shop_order_customer_confirmation",
        traceId: customerResult?.traceId || payload.traceId
      });
    }
  } else {
    console.info("[Stripe webhook] shop customer email already sent, skipping duplicate", {
      orderId: order.id,
      sentAt: order.customer_confirmation_email_sent_at
    });
  }

  if (Object.keys(updates).length) {
    try {
      await restUpdate("shop_orders", { id: `eq.${order.id}` }, updates, "");
    } catch (error) {
      console.error("[Stripe webhook] could not update shop email sent markers", {
        orderId: order.id,
        message: error.message
      });
    }
  }
}

async function handleShopOrder(session) {
  const orderId = session.metadata?.order_id || session.metadata?.booking_id;
  if (!orderId) throw new Error("Stripe session is missing order_id metadata.");
  const rows = await restSelect("shop_orders", "*", { id: `eq.${orderId}`, limit: "1" });
  const existingOrder = rows[0];
  if (!existingOrder) throw new Error("Shop order was not found.");
  console.info("[Stripe webhook] processing paid shop order", {
    orderId,
    currentStatus: existingOrder.order_status,
    customerEmail: existingOrder.customer_email || "",
    adminEmailSent: Boolean(existingOrder.admin_notification_email_sent_at),
    customerEmailSent: Boolean(existingOrder.customer_confirmation_email_sent_at)
  });
  if (existingOrder.order_status !== "paid") await deductInventoryForOrder(existingOrder);
  const order = await restUpdate("shop_orders", { id: `eq.${orderId}` }, {
    order_status: "paid",
    stripe_session_id: session.id,
    payment_intent_id: session.payment_intent || null,
    paid_at: new Date().toISOString()
  });
  console.info("[Stripe webhook] shop order marked paid", {
    orderId,
    stripeSessionId: session.id,
    paymentIntentId: session.payment_intent || ""
  });
  await sendShopEmails(order || existingOrder);
}

async function handleCheckoutCompleted(session) {
  const type = session.metadata?.booking_type;
  if (type === "private_lesson") return handlePrivateLesson(session);
  if (type === "junior_group") return handleJuniorGroup(session);
  if (type === "shop_order") return handleShopOrder(session);
  console.info("[Stripe webhook] ignored checkout session without supported booking_type", { sessionId: session.id, type });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let event;
  try {
    const rawBody = await getRawBody(req);
    verifyStripeSignature(rawBody, req.headers["stripe-signature"]);
    event = JSON.parse(rawBody.toString("utf8"));
    const shouldProcess = await createEventLog(event);
    if (!shouldProcess) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object);
    }

    await markEvent(event, "processed");
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[Stripe webhook] failed", {
      eventId: event?.id || "",
      eventType: event?.type || "",
      message: error.message,
      time: formatDateTime(new Date().toISOString())
    });
    if (event?.id) await markEvent(event, "failed", error.message || "Webhook failed.");
    res.status(400).json({ error: error.message || "Webhook failed." });
  }
};
