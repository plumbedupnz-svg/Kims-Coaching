(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const inventoryListEl = document.querySelector("[data-inventory-list]");
  const reviewListEl = document.querySelector("[data-inventory-review-list]");
  const invoiceFormEl = document.querySelector("[data-invoice-upload-form]");
  const invoiceFileEl = document.querySelector("[data-invoice-file]");
  const invoiceMessageEl = document.querySelector("[data-invoice-message]");
  const adjustFormEl = document.querySelector("[data-stock-adjust-form]");
  const adjustItemEl = document.querySelector("[data-stock-adjust-item]");
  const adjustMessageEl = document.querySelector("[data-stock-adjust-message]");
  const settingsFormEl = document.querySelector("[data-inventory-settings-form]");
  const hideOutOfStockEl = document.querySelector("[data-hide-out-of-stock]");
  const settingsMessageEl = document.querySelector("[data-inventory-settings-message]");

  let inventoryItems = [];

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setMessage(target, message, tone = "neutral") {
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
  }

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function normaliseStatus(status = "") {
    return String(status).replace(/_/g, " ");
  }

  function getStatusClass(status = "") {
    if (status === "out_of_stock" || status === "new_supplier_item") return "blocked";
    if (status === "low_stock" || status === "need_to_order") return "warning";
    return "available";
  }

  function renderEmpty(target, message) {
    if (!target) return;
    target.innerHTML = `<p class="helper-text">${escapeHtml(message)}</p>`;
  }

  async function getSessionUser() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session?.user || null;
  }

  async function loadInventory() {
    if (!client) {
      renderEmpty(inventoryListEl, "Supabase is not configured yet.");
      renderEmpty(reviewListEl, "Supabase is not configured yet.");
      return;
    }

    const { data, error } = await client
      .from("inventory_items")
      .select("*")
      .order("product_name", { ascending: true });

    if (error) {
      renderEmpty(inventoryListEl, `Could not load inventory: ${error.message}`);
      renderEmpty(reviewListEl, `Could not load new items: ${error.message}`);
      return;
    }

    inventoryItems = data || [];
    renderInventoryList();
    renderReviewList();
    renderAdjustmentSelect();
  }

  async function loadInventorySettings() {
    if (!client || !hideOutOfStockEl) return;
    const { data, error } = await client
      .from("shop_inventory_settings")
      .select("hide_out_of_stock")
      .eq("id", true)
      .maybeSingle();

    if (!error && data) hideOutOfStockEl.checked = Boolean(data.hide_out_of_stock);
  }

  function renderInventoryList() {
    if (!inventoryListEl) return;
    if (!inventoryItems.length) {
      renderEmpty(inventoryListEl, "No stock items yet. Upload a Sportco invoice to begin.");
      return;
    }

    inventoryListEl.innerHTML = inventoryItems.map((item) => `
      <article class="admin-data-row inventory-row">
        <div class="inventory-row-main">
          <strong>${escapeHtml(item.product_name)}</strong>
          <p>SKU: ${escapeHtml(item.sku || "Not set")} - Supplier: ${escapeHtml(item.supplier || "Sportco")}</p>
          <p>Cost: ${money(item.cost_price)} - Sell: ${money(item.sell_price)} - Qty: ${Number(item.quantity_on_hand || 0)}</p>
          <p>${item.visible_in_shop ? "Visible in public shop" : "Internal inventory only"}</p>
        </div>
        <span class="status-pill ${getStatusClass(item.status)}">${escapeHtml(normaliseStatus(item.status))}</span>
      </article>
    `).join("");
  }

  function renderReviewList() {
    if (!reviewListEl) return;
    const newItems = inventoryItems.filter((item) => item.review_status === "new_supplier_item");
    if (!newItems.length) {
      renderEmpty(reviewListEl, "No new supplier items need review.");
      return;
    }

    const mergeOptions = inventoryItems
      .filter((item) => item.review_status !== "new_supplier_item")
      .map((item) => `<option value="${item.id}">${escapeHtml(item.product_name)} (${escapeHtml(item.sku || "no SKU")})</option>`)
      .join("");

    reviewListEl.innerHTML = newItems.map((item) => `
      <article class="admin-data-row inventory-review-row" data-review-item="${item.id}">
        <div class="inventory-row-main">
          <strong>${escapeHtml(item.product_name)}</strong>
          <p>SKU: ${escapeHtml(item.sku || "Not found")} - Qty: ${Number(item.quantity_on_hand || 0)} - Cost: ${money(item.cost_price)}</p>
          <div class="inventory-review-controls">
            <input data-review-category type="text" value="Training" placeholder="Shop category" />
            <input data-review-sell-price type="number" step="0.01" min="0" value="${Number(item.sell_price || item.cost_price || 0).toFixed(2)}" placeholder="Sell price" />
            <input data-review-description type="text" placeholder="Shop description" />
          </div>
          <div class="inventory-review-controls">
            <select data-merge-target>
              <option value="">Merge with existing item</option>
              ${mergeOptions}
            </select>
          </div>
        </div>
        <div class="availability-actions">
          <button class="btn btn-primary" type="button" data-review-action="add">Add to shop</button>
          <button class="btn btn-secondary" type="button" data-review-action="internal">Do not add</button>
          <button class="btn btn-secondary" type="button" data-review-action="merge">Merge</button>
        </div>
      </article>
    `).join("");
  }

  function renderAdjustmentSelect() {
    if (!adjustItemEl) return;
    const current = adjustItemEl.value;
    adjustItemEl.innerHTML = '<option value="">Select item</option>' + inventoryItems.map((item) => (
      `<option value="${item.id}">${escapeHtml(item.product_name)} (${Number(item.quantity_on_hand || 0)} on hand)</option>`
    )).join("");
    if (inventoryItems.some((item) => item.id === current)) adjustItemEl.value = current;
  }

  async function ensureCategory(category) {
    const name = String(category || "").trim().replace(/\s+/g, " ");
    if (!client || !name) return;
    const defaultCategories = ["Recovery", "Strength", "Training"];
    await client
      .from("product_categories")
      .upsert(
        { name, is_default: defaultCategories.some((defaultCategory) => defaultCategory.toLowerCase() === name.toLowerCase()) },
        { onConflict: "normalized_name" }
      );
  }

  async function extractPdfText(file) {
    if (!window.pdfjsLib) throw new Error("PDF reader is not available.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }

    return pages.join("\n");
  }

  function parseMoney(value) {
    return Number(String(value || "0").replace(/[$,]/g, ""));
  }

  function parseSportcoInvoice(text) {
    const invoiceNumber = text.match(/invoice\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Z0-9-]+)/i)?.[1] || "";
    const dateMatch = text.match(/invoice\s*date\s*[:#]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)
      || text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
    const invoiceDate = dateMatch ? normaliseInvoiceDate(dateMatch[1]) : null;
    const lines = text.split(/\n| {3,}/).map((line) => line.trim()).filter(Boolean);
    const items = [];

    lines.forEach((line) => {
      const compact = line.replace(/\s+/g, " ").trim();
      const match = compact.match(/^(.+?)\s+(?:SKU[:\s#-]*([A-Z0-9][A-Z0-9-]{2,})\s+)?(\d+)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})$/i);
      if (!match) return;

      const [, rawName, rawSku, rawQuantity, rawUnitCost, rawTotalCost] = match;
      const name = rawName.replace(/\b(code|sku)\b[:\s#-]*[A-Z0-9-]+$/i, "").trim();
      const embeddedSku = rawSku || rawName.match(/\b(?:SKU|Code)[:\s#-]*([A-Z0-9-]{3,})/i)?.[1] || "";

      items.push({
        productName: name,
        sku: embeddedSku,
        quantity: Number(rawQuantity),
        unitCost: parseMoney(rawUnitCost),
        totalCost: parseMoney(rawTotalCost)
      });
    });

    return { invoiceNumber, invoiceDate, items };
  }

  function normaliseInvoiceDate(value) {
    const parts = String(value).split(/[/-]/).map((part) => Number(part));
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [day, month, year] = parts;
    const fullYear = year < 100 ? 2000 + year : year;
    return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  async function uploadInvoice(event) {
    event.preventDefault();
    if (!client) {
      setMessage(invoiceMessageEl, "Supabase is not configured yet.", "error");
      return;
    }

    const file = invoiceFileEl?.files?.[0];
    if (!file) {
      setMessage(invoiceMessageEl, "Choose a Sportco PDF invoice first.", "error");
      return;
    }

    if (file.type !== "application/pdf") {
      setMessage(invoiceMessageEl, "Please upload a PDF invoice.", "error");
      return;
    }

    const user = await getSessionUser();
    const storagePath = `sportco/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, "-")}`;
    setMessage(invoiceMessageEl, "Uploading invoice and reading line items...");

    const { error: uploadError } = await client.storage
      .from("supplier-invoices")
      .upload(storagePath, file, { upsert: false });

    if (uploadError) {
      setMessage(invoiceMessageEl, `Could not upload invoice: ${uploadError.message}`, "error");
      return;
    }

    let parsed;
    try {
      parsed = parseSportcoInvoice(await extractPdfText(file));
    } catch (error) {
      setMessage(invoiceMessageEl, `Invoice uploaded, but PDF extraction failed: ${error.message}`, "error");
      return;
    }

    if (!parsed.items.length) {
      setMessage(invoiceMessageEl, "Invoice uploaded, but no line items could be detected. Check the PDF format and enter stock manually for now.", "error");
      return;
    }

    const { data: invoice, error: invoiceError } = await client
      .from("supplier_invoices")
      .insert({
        supplier: "Sportco",
        invoice_number: parsed.invoiceNumber || null,
        invoice_date: parsed.invoiceDate,
        storage_path: storagePath,
        file_name: file.name,
        uploaded_by: user?.id || null
      })
      .select()
      .single();

    if (invoiceError) {
      setMessage(invoiceMessageEl, `Could not save invoice record: ${invoiceError.message}`, "error");
      return;
    }

    for (const item of parsed.items) {
      const { error } = await client.rpc("process_supplier_invoice_item", {
        p_invoice_id: invoice.id,
        p_product_name: item.productName,
        p_sku: item.sku || null,
        p_quantity: item.quantity,
        p_unit_cost: item.unitCost,
        p_total_cost: item.totalCost,
        p_invoice_number: parsed.invoiceNumber || null,
        p_invoice_date: parsed.invoiceDate
      });

      if (error) {
        setMessage(invoiceMessageEl, `Invoice saved, but stock update failed: ${error.message}`, "error");
        await loadInventory();
        return;
      }
    }

    invoiceFormEl.reset();
    setMessage(invoiceMessageEl, `Updated inventory from ${parsed.items.length} Sportco invoice item${parsed.items.length === 1 ? "" : "s"}.`, "success");
    await loadInventory();
  }

  async function handleReviewAction(event) {
    const button = event.target.closest("[data-review-action]");
    if (!button || !client) return;

    const row = button.closest("[data-review-item]");
    const itemId = row?.dataset.reviewItem;
    if (!itemId) return;

    button.disabled = true;
    const action = button.dataset.reviewAction;
    let result;

    if (action === "add") {
      const category = row.querySelector("[data-review-category]")?.value || "Training";
      await ensureCategory(category);
      result = await client.rpc("publish_inventory_item_to_shop", {
        p_inventory_item_id: itemId,
        p_category: category,
        p_description: row.querySelector("[data-review-description]")?.value || null,
        p_sell_price: Number(row.querySelector("[data-review-sell-price]")?.value || 0),
        p_discount: 0,
        p_image: null
      });
    }

    if (action === "internal") {
      result = await client.rpc("mark_inventory_item_internal", { p_inventory_item_id: itemId });
    }

    if (action === "merge") {
      const targetId = row.querySelector("[data-merge-target]")?.value;
      if (!targetId) {
        alert("Choose an existing item to merge into.");
        button.disabled = false;
        return;
      }
      result = await client.rpc("merge_inventory_item", {
        p_source_item_id: itemId,
        p_target_item_id: targetId,
        p_reason: "Merged from Sportco invoice review"
      });
    }

    if (result?.error) alert(result.error.message);
    await loadInventory();
    button.disabled = false;
  }

  async function saveStockAdjustment(event) {
    event.preventDefault();
    if (!client) {
      setMessage(adjustMessageEl, "Supabase is not configured yet.", "error");
      return;
    }

    const formData = new FormData(adjustFormEl);
    const quantityDelta = Number(formData.get("quantity_delta"));
    if (!formData.get("inventory_item_id") || Number.isNaN(quantityDelta) || quantityDelta === 0) {
      setMessage(adjustMessageEl, "Choose an item and enter a non-zero quantity change.", "error");
      return;
    }

    const { error } = await client.rpc("admin_adjust_inventory", {
      p_inventory_item_id: formData.get("inventory_item_id"),
      p_quantity_delta: quantityDelta,
      p_reason: formData.get("reason")
    });

    if (error) {
      setMessage(adjustMessageEl, error.message, "error");
      return;
    }

    adjustFormEl.reset();
    setMessage(adjustMessageEl, "Stock adjustment saved.", "success");
    await loadInventory();
  }

  async function saveInventorySettings(event) {
    event.preventDefault();
    if (!client) {
      setMessage(settingsMessageEl, "Supabase is not configured yet.", "error");
      return;
    }

    const { error } = await client
      .from("shop_inventory_settings")
      .upsert({ id: true, hide_out_of_stock: Boolean(hideOutOfStockEl?.checked) }, { onConflict: "id" });

    if (error) {
      setMessage(settingsMessageEl, error.message, "error");
      return;
    }

    setMessage(settingsMessageEl, "Shop stock settings saved.", "success");
  }

  invoiceFormEl?.addEventListener("submit", uploadInvoice);
  reviewListEl?.addEventListener("click", handleReviewAction);
  adjustFormEl?.addEventListener("submit", saveStockAdjustment);
  settingsFormEl?.addEventListener("submit", saveInventorySettings);

  document.addEventListener("DOMContentLoaded", () => {
    loadInventory();
    loadInventorySettings();
  });
})();
