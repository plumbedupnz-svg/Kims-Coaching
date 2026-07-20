try {
  const isShopOrder = sessionStorage.getItem("kims_pending_checkout_type") === "shop_order";
  if (isShopOrder) {
    document.querySelector("[data-shop-stock-success-note]")?.removeAttribute("hidden");
    localStorage.removeItem("kims_cart");
  }
  sessionStorage.removeItem("kims_pending_checkout_type");
} catch (error) {
  console.warn("Could not update checkout state after payment.", error);
}
