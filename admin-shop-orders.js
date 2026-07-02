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
    if (typeof address === "string") return address;
    return [
      address.address_line1,
      address.address_line2,
      address.suburb,
      address.city,
      address.postcode,
      address.country
    ].filter(Boolean).join(", ");
  }

  function statusClass(value = "") {
    const normalized = String(value || "").toLowerCase();
    if (["paid", "complete", "completed", "fulfilled"].includes(normalized)) return "available";
    if (["pending", "pending_payment", "processing"].includes(normalized)) return "warning";
    if (["cancelled", "canceled", "failed", "refunded"].includes(normalized)) return "blocked";
    return "";
  }

  function formatStatus(value = "") {
    return String(value || "pending")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatOrderId(id = "") {
    return id ? `#${String(id).slice(0, 8)}` : "";
  }

  function formatItems(items = []) {
    if (!Array.isArray(items) || !items.length) return "No items";
    return items.map((item) => {
      const name = item.name || item.product_name || item.title || "Product";
      const quantity = Number(item.quantity || item.qty || 1);
      return `${name} x ${quantity}`;
    }).join(", ");
  }

  function renderOrders(orders = []) {
    if (!orders.length) {
      listEl.innerHTML = '<p class="empty-state">No shop orders yet.</p>';
      return;
    }
    const rows = orders.map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const customerName = order.customer_name || "Shop customer";
      const customerPhone = order.customer_phone || order.mobile || "";
      const address = formatAddress(order.delivery_address || {});
      const paymentStatus = order.payment_status || "pending_payment";
      const orderStatus = order.order_status || "pending";
      const total = order.total_amount ?? order.total;
      return `
        <div class="shop-orders-table-row" role="row">
          <span>
            <strong>${escapeHtml(formatDate(order.created_at) || "No date")}</strong>
            <small>${escapeHtml(formatOrderId(order.id))}</small>
          </span>
          <span>
            <strong>${escapeHtml(customerName)}</strong>
            <small>${escapeHtml([order.customer_email, customerPhone].filter(Boolean).join(" · ") || "No contact details")}</small>
          </span>
          <span>
            <strong>${escapeHtml(fulfilmentLabel(order.fulfilment_method))}</strong>
            <small>${escapeHtml(address || "No address")}</small>
          </span>
          <span>
            <strong>${escapeHtml(formatItems(items))}</strong>
          </span>
          <span>
            <strong>${money(total)}</strong>
            <small>Shipping ${money(order.shipping_amount)}</small>
          </span>
          <span>
            <span class="status-pill ${statusClass(paymentStatus)}">${escapeHtml(formatStatus(paymentStatus))}</span>
          </span>
          <span>
            <span class="status-pill ${statusClass(orderStatus)}">${escapeHtml(formatStatus(orderStatus))}</span>
          </span>
        </div>
      `;
    }).join("");

    listEl.innerHTML = `
      <div class="shop-orders-table-row shop-orders-table-head" role="row">
        <span>Date</span>
        <span>Customer</span>
        <span>Fulfilment</span>
        <span>Items</span>
        <span>Total</span>
        <span>Payment</span>
        <span>Status</span>
      </div>
      ${rows}
    `;
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
