(function () {
  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem("kims_cart") || "[]");
    } catch (error) {
      return [];
    }
  }

  function getCurrentUserEmail() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const session = JSON.parse(localStorage.getItem(key) || "{}");
        const user = session?.user || session?.currentSession?.user || session?.session?.user;
        if (user?.email) return user.email;
      }
    } catch (error) {
      return "";
    }
    return "";
  }

  function notifyProductOrder() {
    const cart = loadCart();
    if (!cart.length || !window.KimsEmailService) return;

    const email = getCurrentUserEmail();
    const payload = {
      customerName: email || "Shop customer",
      email,
      mobile: "",
      items: cart,
      subtotal: document.getElementById("subtotal")?.textContent || "",
      total: document.getElementById("total")?.textContent || ""
    };

    window.KimsEmailService.sendProductAdminNotification(payload);
    if (email) {
      window.KimsEmailService.sendProductCustomerConfirmation(payload);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("checkout-btn")?.addEventListener("click", notifyProductOrder, true);
  });
})();
