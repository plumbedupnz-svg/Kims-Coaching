(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem("kims_cart") || "[]");
    } catch (error) {
      return [];
    }
  }

  function getStripeLink() {
    return (localStorage.getItem("kims_stripe_link") || "").trim();
  }

  async function getCurrentUser() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session?.user || null;
  }

  async function getCurrentProfile(user) {
    if (!client || !user) return null;
    const { data } = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
    return data || null;
  }

  function getCartTotals(cart) {
    const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
    const tax = subtotal * 0.1;
    return { subtotal, total: subtotal + tax };
  }

  async function saveShopOrder({ user, profile, cart, totals }) {
    if (!client) return null;
    const payload = {
      p_user_id: user?.id || null,
      p_customer_name: `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || user?.email || "Shop customer",
      p_customer_email: user?.email || profile?.email || "",
      p_mobile: profile?.mobile || profile?.phone || "",
      p_items: cart,
      p_subtotal: totals.subtotal,
      p_total: totals.total
    };

    const { data, error } = await client.rpc("create_shop_order_with_stock", payload);
    if (error) {
      console.warn("Could not save stock-aware shop order", { message: error.message });
      throw error;
    }
    return data;
  }

  async function notifyProductOrder({ order, user, profile, cart, totals }) {
    if (!cart.length || !window.KimsEmailService) return { admin: null, customer: null };

    const payload = {
      relatedType: "shop_order",
      relatedId: order?.id,
      customerName: order?.customer_name || `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || user?.email || "Shop customer",
      email: order?.customer_email || user?.email || profile?.email || "",
      mobile: order?.mobile || profile?.mobile || profile?.phone || "",
      items: cart,
      subtotal: document.getElementById("subtotal")?.textContent || `$${totals.subtotal.toFixed(2)}`,
      total: document.getElementById("total")?.textContent || `$${totals.total.toFixed(2)}`,
      orderStatus: order?.order_status || "pending_payment"
    };

    const [admin, customer] = await Promise.allSettled([
      window.KimsEmailService.sendShopOrderAdminNotification(payload),
      payload.email ? window.KimsEmailService.sendShopOrderCustomerConfirmation(payload) : Promise.resolve({ status: "skipped" })
    ]);

    return {
      admin: admin.status === "fulfilled" ? admin.value : { status: "failed", error: admin.reason?.message || "Email failed" },
      customer: customer.status === "fulfilled" ? customer.value : { status: "failed", error: customer.reason?.message || "Email failed" }
    };
  }

  async function handleCheckout(event) {
    if (event.currentTarget?.dataset.emailCheckoutHandled === "true") return;
    const cart = loadCart();
    const link = getStripeLink();
    if (!cart.length || !link) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    event.currentTarget.dataset.emailCheckoutHandled = "true";

    const user = await getCurrentUser();
    if (!user) {
      window.location.href = "account.html?mode=signup";
      return;
    }

    const profile = await getCurrentProfile(user);
    const totals = getCartTotals(cart);
    try {
      const order = await saveShopOrder({ user, profile, cart, totals });
      await notifyProductOrder({ order, user, profile, cart, totals });
      window.location.href = link;
    } catch (error) {
      event.currentTarget.dataset.emailCheckoutHandled = "false";
      alert(error.message || "Could not create the shop order. Please try again.");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("checkout-btn")?.addEventListener("click", handleCheckout, true);
  });
})();
