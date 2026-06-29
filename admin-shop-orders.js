(function () {
  const listEl = document.querySelector("[data-shop-orders-list]");
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  if (!listEl) return;

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function fulfilmentLabel(value = "") {
    if (value === "local_delivery") return "Local delivery";
    if (value === "courier") return "NZ courier";
    return "Pickup";
  }

  function formatAddress(address = {}) {
    return [
      address.address_line1,
      address.address_line2,
      address.suburb,
      address.city,
      address.postcode,
      address.country
    ].filter(Boolean).join(", ");
  }

  function renderOrders(orders = []) {
    if (!orders.length) {
      listEl.innerHTML = '<p class="helper-text">No shop orders yet.</p>';
      return;
    }
    listEl.innerHTML = orders.map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      return `
        <article class="admin-data-row">
          <div>
            <strong>${escapeHtml(order.customer_name || "Shop customer")}</strong>
            <p>${escapeHtml(order.customer_email || "")}${order.customer_phone || order.mobile ? ` · ${escapeHtml(order.customer_phone || order.mobile)}` : ""}</p>
            <p>${escapeHtml(fulfilmentLabel(order.fulfilment_method))} · Shipping ${money(order.shipping_amount)} · Total ${money(order.total_amount ?? order.total)}</p>
            ${formatAddress(order.delivery_address || {}) ? `<p>${escapeHtml(formatAddress(order.delivery_address || {}))}</p>` : ""}
            ${items.length ? `<p>${escapeHtml(items.map((item) => `${item.name || "Product"} x ${item.quantity || 1}`).join(", "))}</p>` : ""}
            <p class="owner-meta">${escapeHtml(formatDate(order.created_at))}</p>
          </div>
          <div class="availability-actions">
            <span class="status-pill ${order.payment_status === "paid" || order.order_status === "paid" ? "available" : "blocked"}">${escapeHtml(order.payment_status || "pending")}</span>
            <span class="status-pill">${escapeHtml(order.order_status || "pending_payment")}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  async function loadOrders() {
    if (!client) {
      listEl.innerHTML = '<p class="helper-text">Supabase is not configured.</p>';
      return;
    }
    const { data, error } = await client
      .from("shop_orders")
      .select("id,customer_name,customer_email,customer_phone,mobile,delivery_address,fulfilment_method,shipping_amount,total_amount,total,payment_status,order_status,items,created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      listEl.innerHTML = `<p class="form-message" data-tone="error">Could not load shop orders: ${escapeHtml(error.message)}</p>`;
      return;
    }
    renderOrders(data || []);
  }

  loadOrders();
})();
