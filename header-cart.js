(() => {
  const cartKey = "kims_cart";
  const navigation = document.querySelector(".site-header .nav");
  if (!navigation || navigation.querySelector("[data-header-cart]")) return;

  const link = document.createElement("a");
  link.className = "header-cart";
  link.dataset.headerCart = "";
  link.href = document.getElementById("cart") ? "#cart" : "/shop#cart";
  link.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3h2l2.4 12h11.2l2-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg><span class="header-cart-label">Cart</span><span class="header-cart-count" aria-hidden="true">0</span>`;
  const status = document.createElement("span");
  status.className = "header-cart-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  navigation.append(link, status);
  const badge = link.querySelector(".header-cart-count");

  function update() {
    let count = 0;
    try {
      const cart = JSON.parse(localStorage.getItem(cartKey) || "[]");
      if (Array.isArray(cart)) {
        count = cart.reduce((total, item) => {
          const quantity = Number(item?.quantity ?? 1);
          return item?.id && Number.isFinite(quantity) && quantity > 0
            ? total + Math.floor(quantity)
            : total;
        }, 0);
      }
    } catch {
      // Keep the shortcut usable if browser storage is unavailable.
    }
    const label = `${count} item${count === 1 ? "" : "s"}`;
    link.setAttribute("aria-label", `View cart, ${label}`);
    badge.textContent = String(count);
    const message = `Cart: ${label}`;
    if (status.textContent !== message) status.textContent = message;
  }

  link.addEventListener("click", () => {
    navigation.querySelector("[data-nav-links]")?.classList.remove("open");
    const toggle = navigation.querySelector("[data-menu-toggle]");
    toggle?.setAttribute("aria-expanded", "false");
    toggle?.setAttribute("aria-label", "Open menu");
  });
  window.addEventListener("kims:cart-updated", update);
  window.addEventListener("pageshow", update);
  window.addEventListener("storage", (event) => {
    if (event.key === cartKey || event.key === null) update();
  });
  update();
})();
