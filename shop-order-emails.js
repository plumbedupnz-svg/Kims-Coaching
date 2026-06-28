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

  async function getSession() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session || null;
  }

  async function startShopCheckout(cart, token) {
    const response = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        booking_type: "shop_order",
        cart
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

    const messageEl = document.getElementById("checkout-account-message");
    const session = await getSession();
    if (!session?.user) {
      if (messageEl) messageEl.textContent = "Please log in or create an account before checkout.";
      window.location.href = "account.html?mode=signup";
      return;
    }

    try {
      if (messageEl) messageEl.textContent = "Redirecting to secure Stripe Checkout...";
      await startShopCheckout(cart, session.access_token);
    } catch (error) {
      event.currentTarget.dataset.stripeCheckoutHandled = "false";
      if (messageEl) messageEl.textContent = error.message || "Could not start Stripe Checkout.";
      alert(error.message || "Could not start Stripe Checkout. Please try again.");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("checkout-btn")?.addEventListener("click", handleCheckout, true);
  });
})();
