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
            <small>${escapeHtml(order.order_reference || formatOrderId(order.id))}</small>
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
            ${(order.service_details || order.notes) ? `<small>${escapeHtml(order.service_details || order.notes)}</small>` : ""}
          </span>
          <span>
            <strong>${money(total)}</strong>
            <small>Shipping ${money(order.shipping_amount)}</small>
          </span>
          <span>
            <span class="status-pill ${statusClass(paymentStatus)}">${escapeHtml(formatStatus(paymentStatus))}</span>
            <small>${escapeHtml(order.payment_method === "bank_transfer" ? "Online banking" : "Card")}</small>
            ${order.payment_provider === "xero" ? `<small>Balance ${money(order.xero_amount_due ?? total)}</small><small>Invoice email: ${escapeHtml(formatStatus(order.invoice_email_status))}</small><small>${order.xero_synced_at ? "Synced " + escapeHtml(formatDate(order.xero_synced_at)) : "Awaiting invoice"}</small>${order.xero_error ? `<small class="form-message" data-tone="error">${escapeHtml(order.xero_error)}</small>` : ""}<button class="btn btn-secondary" type="button" data-sync-xero="${escapeHtml(order.id)}">Refresh from Xero</button>${order.xero_invoice_id ? `<a href="https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(order.xero_invoice_id)}" target="_blank" rel="noopener">Open invoice in Xero</a>` : ""}` : ""}
          </span>
          <span>
            <span class="status-pill ${statusClass(orderStatus)}">${escapeHtml(formatStatus(orderStatus))}</span>
            <label>Fulfilment<select data-order-fulfilment="${escapeHtml(order.id)}">${["unfulfilled","in_progress","ready","completed","cancelled"].map(status => `<option value="${status}"${(order.fulfilment_status || "unfulfilled") === status ? " selected" : ""}>${escapeHtml(formatStatus(status))}</option>`).join("")}</select></label>
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
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      listEl.innerHTML = `<p class="form-message" data-tone="error">Could not load shop orders: ${escapeHtml(error.message)}</p>`;
      return;
    }
    renderOrders(data || []);
  }

  async function changeOrder(body, element) {
    element.disabled = true;
    try {
      const { data } = await client.auth.getSession();
      const response = await fetch("/api/xero", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update order.");
      if (body.action === "sync_order") { element.textContent = "Refresh queued"; setTimeout(loadOrders, 5000); }
      else await loadOrders();
    } catch (error) { alert(error.message); element.disabled = false; }
  }
  listEl.addEventListener("click", event => { const button = event.target.closest("[data-sync-xero]"); if (button) changeOrder({ action: "sync_order", order_id: button.dataset.syncXero }, button); });
  listEl.addEventListener("change", event => { if (event.target.matches("[data-order-fulfilment]")) changeOrder({ action: "fulfilment", order_id: event.target.dataset.orderFulfilment, status: event.target.value }, event.target); });
  document.querySelector('[data-products-tab="orders"]')?.addEventListener("click", loadOrders);
  loadOrders();
})();
