(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const inventoryListEl = document.querySelector("[data-inventory-list]");
  const reviewListEl = document.querySelector("[data-inventory-review-list]");
  const searchEl = document.querySelector("[data-inventory-search]");
  const categoryFilterEl = document.querySelector("[data-inventory-category-filter]");
  const showArchivedEl = document.querySelector("[data-inventory-show-archived]");
  const addProductBtnEl = document.querySelector("[data-inventory-add-product]");
  const productFormEl = document.querySelector("[data-inventory-product-form]");
  const productFormTitleEl = document.querySelector("[data-inventory-form-title]");
  const productCategoryEl = document.querySelector("[data-inventory-form-category]");
  const productMessageEl = document.querySelector("[data-inventory-product-message]");
  const cancelEditBtnEl = document.querySelector("[data-inventory-cancel-edit]");
  const invoiceFormEl = document.querySelector("[data-invoice-upload-form]");
  const invoiceFileEl = document.querySelector("[data-invoice-file]");
  const invoiceMessageEl = document.querySelector("[data-invoice-message]");
  const invoiceReviewPanelEl = document.querySelector("[data-invoice-review-panel]");
  const invoiceReviewTableEl = document.querySelector("[data-invoice-review-table]");
  const invoiceReviewMessageEl = document.querySelector("[data-invoice-review-message]");
  const invoiceReviewClearEl = document.querySelector("[data-invoice-review-clear]");
  const invoiceImportConfirmEl = document.querySelector("[data-invoice-import-confirm]");
  const adjustFormEl = document.querySelector("[data-stock-adjust-form]");
  const adjustItemEl = document.querySelector("[data-stock-adjust-item]");
  const adjustMessageEl = document.querySelector("[data-stock-adjust-message]");
  const settingsFormEl = document.querySelector("[data-inventory-settings-form]");
  const hideOutOfStockEl = document.querySelector("[data-hide-out-of-stock]");
  const settingsMessageEl = document.querySelector("[data-inventory-settings-message]");

  let inventoryItems = [];
  let productCategories = [];
  let pendingInvoice = null;
  let invoiceReviewItems = [];
  let lastInventoryDebug = {
    source: "not_loaded",
    returnedRows: 0,
    activeRows: 0,
    filters: {},
    supabaseUrl: settings.url || "not configured",
    projectRef: "",
    userId: "",
    profileRole: "",
    isAdmin: "unknown",
    rpcError: "",
    error: ""
  };

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

  function formatDate(value) {
    if (!value) return "Not updated";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not updated";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function normalizeCategory(value) {
    return String(value || "Other").trim().replace(/\s+/g, " ") || "Other";
  }

  function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function getItemCategory(item) {
    return item.product_categories?.name || normalizeCategory(item.category);
  }

  function getCategoryForItem(item) {
    return productCategories.find((category) => category.id === item.category_id) || null;
  }

  function isArchivedOrInactive(item = {}) {
    return Boolean(item.archived_at) || item.is_active === false;
  }

  function itemMatchesCategory(item = {}, categoryId = "all") {
    if (categoryId === "all") return true;
    const selectedCategory = productCategories.find((category) => category.id === categoryId);
    if (item.category_id && item.category_id === categoryId) return true;
    if (!selectedCategory) return false;

    const selectedName = normalizeText(selectedCategory.name);
    return normalizeText(item.category) === selectedName
      || normalizeText(item.product_categories?.name) === selectedName;
  }

  function getActiveInventoryItems() {
    return inventoryItems.filter((item) => !isArchivedOrInactive(item));
  }

  function normalizeInventoryItem(item = {}) {
    const category = item.product_categories || getCategoryForItem(item);
    return {
      ...item,
      product_name: item.product_name || item.name || "Unnamed inventory item",
      sku: item.sku || "",
      supplier: item.supplier || "Sportco",
      category: category?.name || item.category || "Other",
      product_categories: category || item.product_categories || null,
      quantity_on_hand: Number(item.quantity_on_hand || 0),
      cost_price: Number(item.cost_price || 0),
      sell_price: Number(item.sell_price || item.price || 0),
      low_stock_threshold: Number(item.low_stock_threshold ?? 2),
      need_order_threshold: Number(item.need_order_threshold ?? item.reorder_threshold ?? 0),
      status: item.status || "out_of_stock",
      visible_in_shop: Boolean(item.visible_in_shop),
      is_active: item.is_active !== false
    };
  }

  function normaliseStatus(status = "") {
    return String(status).replace(/_/g, " ");
  }

  function getStatusClass(status = "") {
    if (status === "out_of_stock" || status === "new_supplier_item") return "blocked";
    if (status === "low_stock" || status === "need_to_order") return "warning";
    return "available";
  }

  function getMargin(item) {
    const cost = Number(item.cost_price || 0);
    const sell = Number(item.sell_price || 0);
    const profit = sell - cost;
    const margin = sell > 0 ? (profit / sell) * 100 : 0;
    return `${money(profit)} / ${margin.toFixed(1)}%`;
  }

  function renderEmpty(target, message) {
    if (!target) return;
    target.innerHTML = `<p class="helper-text">${escapeHtml(message)}</p>`;
  }

  function getCurrentFilters() {
    return {
      search: String(searchEl?.value || "").trim(),
      category: categoryFilterEl?.value || "all",
      showArchived: Boolean(showArchivedEl?.checked)
    };
  }

  function updateInventoryDebug(details = {}) {
    let projectRef = "";
    try {
      projectRef = settings.url ? new URL(settings.url).hostname.split(".")[0] : "";
    } catch (error) {
      projectRef = "unknown";
    }

    lastInventoryDebug = {
      ...lastInventoryDebug,
      ...details,
      supabaseUrl: settings.url || "not configured",
      projectRef,
      filters: getCurrentFilters()
    };
    console.info("[Kim's Coaching inventory]", lastInventoryDebug);
  }

  function getInventoryDebugText() {
    const filters = lastInventoryDebug.filters || getCurrentFilters();
    return [
      `Inventory debug: ${lastInventoryDebug.returnedRows || 0} row(s) returned`,
      `${lastInventoryDebug.activeRows || 0} active`,
      `source: ${lastInventoryDebug.source || "unknown"}`,
      `project: ${lastInventoryDebug.projectRef || "unknown"}`,
      `admin: ${lastInventoryDebug.isAdmin}`,
      lastInventoryDebug.profileRole ? `profile role: ${lastInventoryDebug.profileRole}` : "",
      `category: ${filters.category || "all"}`,
      `search: ${filters.search || "none"}`,
      `show archived: ${filters.showArchived ? "yes" : "no"}`,
      lastInventoryDebug.rpcError ? `rpc error: ${lastInventoryDebug.rpcError}` : "",
      lastInventoryDebug.error ? `error: ${lastInventoryDebug.error}` : ""
    ].filter(Boolean).join(" | ");
  }

  async function getSessionUser() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session?.user || null;
  }

  function renderCategoryControls() {
    const currentFilter = categoryFilterEl?.value || "all";
    const currentFormCategory = productCategoryEl?.value || "";

    if (categoryFilterEl) {
      categoryFilterEl.innerHTML = '<option value="all">All categories</option>' + productCategories
        .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
        .join("");
      categoryFilterEl.value = productCategories.some((category) => category.id === currentFilter) ? currentFilter : "all";
    }

    if (productCategoryEl) {
      productCategoryEl.innerHTML = '<option value="">Select category</option>' + productCategories
        .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
        .join("");
      productCategoryEl.value = productCategories.some((category) => category.id === currentFormCategory) ? currentFormCategory : "";
    }
  }

  async function loadProductCategories() {
    if (!client) return;
    const { data, error } = await client
      .from("product_categories")
      .select("id,name")
      .order("name", { ascending: true });

    if (error) {
      console.warn("Could not load product categories.", error.message);
      productCategories = [];
      renderCategoryControls();
      return;
    }

    productCategories = data || [];
    renderCategoryControls();
  }

  async function loadInventory() {
    if (!client) {
      renderEmpty(inventoryListEl, "Supabase is not configured yet.");
      renderEmpty(reviewListEl, "Supabase is not configured yet.");
      updateInventoryDebug({ source: "not_configured", returnedRows: 0, activeRows: 0, error: "Supabase client is not configured." });
      return;
    }

    renderEmpty(inventoryListEl, "Loading inventory...");
    renderEmpty(reviewListEl, "Loading new items...");

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const user = sessionData?.session?.user || null;
    if (sessionError || !user) {
      const message = sessionError?.message || "No logged-in user session was found.";
      updateInventoryDebug({ source: "auth_session", returnedRows: 0, activeRows: 0, userId: "", profileRole: "", isAdmin: "no session", error: message });
      renderEmpty(inventoryListEl, `Could not load inventory: ${message}`);
      renderEmpty(reviewListEl, `Could not load inventory: ${message}`);
      renderAdjustmentSelect();
      return;
    }

    const profileResult = await client
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const adminResult = await client.rpc("current_user_is_admin");
    const profileRole = profileResult.data?.role || "";
    updateInventoryDebug({
      userId: user.id,
      profileRole,
      isAdmin: adminResult.error ? "rpc error" : String(adminResult.data === true),
      rpcError: adminResult.error?.message || "",
      error: profileResult.error?.message || ""
    });

    if (adminResult.error) {
      console.warn("Inventory admin check failed; continuing to inventory read for diagnostics.", adminResult.error.message);
    } else if (adminResult.data !== true) {
      const message = "The current account is not recognised as an admin by Supabase RLS.";
      updateInventoryDebug({ source: "admin_check", returnedRows: 0, activeRows: 0, error: message });
      renderEmpty(inventoryListEl, `Could not load inventory: ${message}`);
      renderEmpty(reviewListEl, `Could not load inventory: ${message}`);
      renderAdjustmentSelect();
      return;
    }

    let result = await client.rpc("admin_list_inventory_items");
    let source = "admin_list_inventory_items RPC";

    if (result.error) {
      console.warn("Inventory RPC query failed, retrying direct inventory_items select.", result.error.message);
      source = "inventory_items direct select";
      updateInventoryDebug({ source, rpcError: result.error.message });
      result = await client
        .from("inventory_items")
        .select("*")
        .order("product_name", { ascending: true });
    }

    if (result.error) {
      const message = `Could not load inventory: ${result.error.message}. If rows exist in Supabase, check the inventory_items RLS select policy and run notify pgrst, 'reload schema'.`;
      updateInventoryDebug({ source, returnedRows: 0, activeRows: 0, error: result.error.message });
      renderEmpty(inventoryListEl, message);
      renderEmpty(reviewListEl, message);
      renderAdjustmentSelect();
      return;
    }

    const byId = new Map();
    (result.data || []).forEach((item) => {
      if (item?.id) byId.set(item.id, normalizeInventoryItem(item));
    });
    inventoryItems = Array.from(byId.values());
    updateInventoryDebug({
      source,
      returnedRows: inventoryItems.length,
      activeRows: getActiveInventoryItems().length,
      rpcError: "",
      error: ""
    });
    renderCategoryControls();
    resetInventoryCategoryFilterIfEmpty();
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

  function getFilteredInventoryItems() {
    const search = String(searchEl?.value || "").trim().toLowerCase();
    const categoryId = categoryFilterEl?.value || "all";
    const showArchived = Boolean(showArchivedEl?.checked);

    return inventoryItems.filter((item) => {
      if (!showArchived && isArchivedOrInactive(item)) return false;
      if (!itemMatchesCategory(item, categoryId)) return false;
      if (!search) return true;
      return `${item.product_name || ""} ${item.sku || ""}`.toLowerCase().includes(search);
    });
  }

  function resetInventoryCategoryFilterIfEmpty() {
    if (!categoryFilterEl || categoryFilterEl.value === "all") return;
    const activeItems = getActiveInventoryItems();
    if (!activeItems.length) return;
    const selectedCategoryId = categoryFilterEl.value;
    const hasMatch = activeItems.some((item) => itemMatchesCategory(item, selectedCategoryId));
    if (!hasMatch) categoryFilterEl.value = "all";
  }

  function renderInventoryList() {
    if (!inventoryListEl) return;
    updateInventoryDebug({
      returnedRows: inventoryItems.length,
      activeRows: getActiveInventoryItems().length
    });
    const items = getFilteredInventoryItems();
    if (!items.length) {
      const hasInventory = inventoryItems.length > 0;
      renderEmpty(inventoryListEl, hasInventory
        ? `No stock items match the current filters. Choose All categories or adjust the archived filter. ${getInventoryDebugText()}`
        : `No inventory items found. Add a product or check that your admin account can select inventory_items. ${getInventoryDebugText()}`);
      return;
    }

    inventoryListEl.innerHTML = `
      <div class="inventory-table" role="table" aria-label="Inventory items">
        <div class="inventory-table-row inventory-table-head" role="row">
          <span>Product</span>
          <span>SKU</span>
          <span>Category</span>
          <span>Supplier</span>
          <span>Qty</span>
          <span>Status</span>
          <span>Cost</span>
          <span>Sell</span>
          <span>Profit / margin</span>
          <span>Shop</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        ${items.map((item) => `
          <div class="inventory-table-row ${item.archived_at ? "archived" : ""}" role="row" data-inventory-item="${item.id}">
            <span><strong>${escapeHtml(item.product_name)}</strong></span>
            <span>${escapeHtml(item.sku || "Not set")}</span>
            <span>${escapeHtml(getItemCategory(item))}</span>
            <span>${escapeHtml(item.supplier || "Sportco")}</span>
            <span>${Number(item.quantity_on_hand || 0)}</span>
            <span><span class="status-pill ${getStatusClass(item.status)}">${escapeHtml(normaliseStatus(item.status))}</span></span>
            <span>${money(item.cost_price)}</span>
            <span>${money(item.sell_price)}</span>
            <span>${getMargin(item)}</span>
            <span>${item.visible_in_shop && item.is_active !== false && !item.archived_at ? "Yes" : "No"}</span>
            <span>${formatDate(item.updated_at || item.created_at)}</span>
            <span class="inventory-actions">
              <button class="btn btn-secondary" type="button" data-inventory-action="edit">Edit</button>
              <button class="btn btn-secondary" type="button" data-inventory-action="adjust">Adjust</button>
              <button class="btn btn-secondary" type="button" data-inventory-action="archive">${item.archived_at ? "Archived" : "Archive"}</button>
              <button class="btn btn-secondary" type="button" data-inventory-action="delete">Delete</button>
            </span>
          </div>
        `).join("")}
      </div>
      <p class="helper-text">${escapeHtml(getInventoryDebugText())}</p>
    `;
  }

  function renderReviewList() {
    if (!reviewListEl) return;
    const newItems = inventoryItems.filter((item) => item.review_status === "new_supplier_item" && !item.archived_at);
    if (!newItems.length) {
      renderEmpty(reviewListEl, "No new supplier items need review.");
      return;
    }

    const mergeOptions = inventoryItems
      .filter((item) => item.review_status !== "new_supplier_item" && !item.archived_at)
      .map((item) => `<option value="${item.id}">${escapeHtml(item.product_name)} (${escapeHtml(item.sku || "no SKU")})</option>`)
      .join("");

    reviewListEl.innerHTML = newItems.map((item) => `
      <article class="admin-data-row inventory-review-row" data-review-item="${item.id}">
        <div class="inventory-row-main">
          <strong>${escapeHtml(item.product_name)}</strong>
          <p>SKU: ${escapeHtml(item.sku || "Not found")} - Qty: ${Number(item.quantity_on_hand || 0)} - Cost: ${money(item.cost_price)}</p>
          <div class="inventory-review-controls">
            <select data-review-category-id>
              ${productCategories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === item.category_id ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}
            </select>
            <input data-review-sell-price type="number" step="0.01" min="0" value="${Number(item.sell_price || item.cost_price || 0).toFixed(2)}" placeholder="Sell price" />
            <input data-review-description type="text" value="${escapeHtml(item.description || "")}" placeholder="Shop description" />
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
    const activeItems = getActiveInventoryItems();
    adjustItemEl.innerHTML = '<option value="">Select item</option>' + activeItems
      .map((item) => `<option value="${item.id}">${escapeHtml(item.product_name)} (${Number(item.quantity_on_hand || 0)} on hand)</option>`)
      .join("");
    if (activeItems.some((item) => item.id === current)) adjustItemEl.value = current;
  }

  function getCategoryById(categoryId) {
    return productCategories.find((category) => category.id === categoryId) || null;
  }

  function getCategoryByName(categoryName) {
    const normalized = normalizeText(categoryName);
    return productCategories.find((category) => normalizeText(category.name) === normalized) || null;
  }

  function getFallbackCategory() {
    return getCategoryByName("Other") || productCategories[0] || null;
  }

  function suggestCategory(productName) {
    const name = normalizeText(productName);
    const rules = [
      { category: "Recovery", keywords: ["recovery", "massage", "roller", "trigger", "band", "support", "brace", "ice", "heat"] },
      { category: "Strength", keywords: ["weight", "dumbbell", "kettle", "strength", "resistance", "medicine ball", "core"] },
      { category: "Training", keywords: ["cone", "agility", "ladder", "marker", "training", "coach", "speed"] },
      { category: "Tennis Gear", keywords: ["tennis", "racquet", "racket", "ball", "grip", "string", "vibration", "dampener"] },
      { category: "Accessories", keywords: ["bag", "bottle", "cap", "hat", "towel", "socks", "accessory"] }
    ];
    const match = rules.find((rule) => rule.keywords.some((keyword) => name.includes(keyword)));
    return getCategoryByName(match?.category || "Other") || getFallbackCategory();
  }

  function findInventoryMatch(invoiceItem) {
    const sku = normalizeText(invoiceItem.sku);
    if (sku) {
      const skuMatch = inventoryItems.find((item) => normalizeText(item.sku) === sku);
      if (skuMatch) return skuMatch;
    }

    const productName = normalizeText(invoiceItem.productName);
    return inventoryItems.find((item) => normalizeText(item.product_name) === productName || normalizeText(item.normalized_name) === productName) || null;
  }

  function getInventoryOptions(selectedId = "") {
    return '<option value="">No match - create new item</option>' + inventoryItems
      .filter((item) => !item.archived_at)
      .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.product_name)} (${escapeHtml(item.sku || "no SKU")})</option>`)
      .join("");
  }

  function getCategoryOptions(selectedId = "") {
    return '<option value="">Select category</option>' + productCategories
      .map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === selectedId ? "selected" : ""}>${escapeHtml(category.name)}</option>`)
      .join("");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
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

  function showProductForm(item = null) {
    if (!productFormEl) return;
    const fields = productFormEl.elements;
    productFormEl.hidden = false;
    productFormEl.reset();
    renderCategoryControls();
    productFormTitleEl.textContent = item ? "Edit inventory product" : "Add inventory product";
    fields.inventory_item_id.value = item?.id || "";
    fields.product_name.value = item?.product_name || "";
    fields.sku.value = item?.sku || "";
    fields.supplier.value = item?.supplier || "Sportco";
    fields.category.value = item?.category_id || "";
    fields.description.value = item?.description || "";
    fields.cost_price.value = Number(item?.cost_price || 0).toFixed(2);
    fields.sell_price.value = Number(item?.sell_price || 0).toFixed(2);
    fields.quantity_on_hand.value = Number(item?.quantity_on_hand || 0);
    fields.low_stock_threshold.value = Number(item?.low_stock_threshold ?? 2);
    fields.need_order_threshold.value = Number(item?.need_order_threshold ?? 0);
    fields.visible_in_shop.checked = Boolean(item?.visible_in_shop);
    fields.is_active.checked = item?.is_active !== false;
    setMessage(productMessageEl, "");
  }

  function hideProductForm() {
    if (!productFormEl) return;
    productFormEl.hidden = true;
    productFormEl.reset();
    setMessage(productMessageEl, "");
  }

  function buildInvoiceReviewItems(parsedItems) {
    return parsedItems.map((item, index) => {
      const matchedItem = findInventoryMatch(item);
      const suggestedCategory = matchedItem?.category_id
        ? getCategoryById(matchedItem.category_id)
        : suggestCategory(item.productName);
      const sellPrice = Number(matchedItem?.sell_price || item.unitCost || 0);

      return {
        rowId: `invoice-line-${Date.now()}-${index}`,
        productName: item.productName,
        sku: item.sku || "",
        quantity: Number(item.quantity || 0),
        unitCost: Number(item.unitCost || 0),
        totalCost: Number(item.totalCost || (Number(item.quantity || 0) * Number(item.unitCost || 0))),
        matchedInventoryItemId: matchedItem?.id || "",
        matchedInventoryItemName: matchedItem?.product_name || "",
        suggestedCategoryId: suggestedCategory?.id || "",
        finalCategoryId: suggestedCategory?.id || "",
        sellPrice,
        visibleInShop: Boolean(matchedItem?.visible_in_shop),
        reviewStatus: matchedItem ? "matched" : "new_supplier_item"
      };
    });
  }

  function renderInvoiceReviewTable() {
    if (!invoiceReviewPanelEl || !invoiceReviewTableEl) return;

    if (!invoiceReviewItems.length) {
      invoiceReviewPanelEl.hidden = true;
      invoiceReviewTableEl.innerHTML = "";
      return;
    }

    invoiceReviewPanelEl.hidden = false;
    invoiceReviewTableEl.innerHTML = `
      <div class="inventory-table invoice-review-table" role="table" aria-label="Supplier invoice review">
        <div class="inventory-table-row invoice-review-table-row inventory-table-head" role="row">
          <span>Product name</span>
          <span>SKU</span>
          <span>Qty</span>
          <span>Unit cost</span>
          <span>Total cost</span>
          <span>Matched inventory item</span>
          <span>Suggested category</span>
          <span>Final category</span>
          <span>Sell price</span>
          <span>Visible in shop</span>
          <span>Review status</span>
        </div>
        ${invoiceReviewItems.map((item, index) => {
          const suggestedCategory = getCategoryById(item.suggestedCategoryId);
          return `
            <div class="inventory-table-row invoice-review-table-row" role="row" data-invoice-review-index="${index}">
              <span><input data-invoice-field="productName" type="text" value="${escapeHtml(item.productName)}" required /></span>
              <span><input data-invoice-field="sku" type="text" value="${escapeHtml(item.sku)}" /></span>
              <span><input data-invoice-field="quantity" type="number" min="1" step="1" value="${Number(item.quantity || 0)}" required /></span>
              <span><input data-invoice-field="unitCost" type="number" min="0" step="0.01" value="${Number(item.unitCost || 0).toFixed(2)}" required /></span>
              <span><input data-invoice-field="totalCost" type="number" min="0" step="0.01" value="${Number(item.totalCost || 0).toFixed(2)}" required /></span>
              <span><select data-invoice-field="matchedInventoryItemId">${getInventoryOptions(item.matchedInventoryItemId)}</select></span>
              <span>${escapeHtml(suggestedCategory?.name || "Other")}</span>
              <span><select data-invoice-field="finalCategoryId" required>${getCategoryOptions(item.finalCategoryId)}</select></span>
              <span><input data-invoice-field="sellPrice" type="number" min="0" step="0.01" value="${Number(item.sellPrice || 0).toFixed(2)}" /></span>
              <span><input data-invoice-field="visibleInShop" type="checkbox" ${item.visibleInShop ? "checked" : ""} /></span>
              <span>
                <select data-invoice-field="reviewStatus" required>
                  <option value="matched" ${item.reviewStatus === "matched" ? "selected" : ""}>Matched</option>
                  <option value="new_supplier_item" ${item.reviewStatus === "new_supplier_item" ? "selected" : ""}>New supplier item</option>
                  <option value="needs_review" ${item.reviewStatus === "needs_review" ? "selected" : ""}>Needs review</option>
                </select>
              </span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function syncInvoiceReviewFromDom() {
    if (!invoiceReviewTableEl) return;
    invoiceReviewTableEl.querySelectorAll("[data-invoice-review-index]").forEach((row) => {
      const index = Number(row.dataset.invoiceReviewIndex);
      const item = invoiceReviewItems[index];
      if (!item) return;

      row.querySelectorAll("[data-invoice-field]").forEach((field) => {
        const key = field.dataset.invoiceField;
        if (field.type === "checkbox") {
          item[key] = field.checked;
          return;
        }
        if (["quantity", "unitCost", "totalCost", "sellPrice"].includes(key)) {
          item[key] = Number(field.value || 0);
          return;
        }
        item[key] = field.value;
      });

      const matchedItem = inventoryItems.find((entry) => entry.id === item.matchedInventoryItemId);
      item.matchedInventoryItemName = matchedItem?.product_name || "";
    });
  }

  function clearInvoiceReview() {
    pendingInvoice = null;
    invoiceReviewItems = [];
    renderInvoiceReviewTable();
    setMessage(invoiceReviewMessageEl, "");
  }

  function validateInvoiceReview() {
    syncInvoiceReviewFromDom();
    if (!pendingInvoice?.id) return "Upload and save an invoice before importing.";
    if (!invoiceReviewItems.length) return "There are no invoice items to import.";

    const needsReview = invoiceReviewItems.find((item) => item.reviewStatus === "needs_review");
    if (needsReview) return "Resolve every item marked needs review before importing.";

    const invalid = invoiceReviewItems.find((item) => !item.productName || item.quantity <= 0 || item.unitCost < 0 || item.totalCost < 0 || !item.finalCategoryId);
    if (invalid) return "Each row needs a product name, positive quantity, costs, and a final category.";

    return "";
  }

  async function saveProduct(event) {
    event.preventDefault();
    if (!client) {
      setMessage(productMessageEl, "Supabase is not configured yet.", "error");
      return;
    }

    const formData = new FormData(productFormEl);
    const imageFile = productFormEl.elements.image.files[0];
    let image = null;
    if (imageFile) {
      if (!imageFile.type.startsWith("image/")) {
        setMessage(productMessageEl, "Choose a valid product image.", "error");
        return;
      }
      if (imageFile.size > 2 * 1024 * 1024) {
        setMessage(productMessageEl, "Image is too large. Please use a file under 2MB.", "error");
        return;
      }
      image = await fileToDataUrl(imageFile);
    }

    const category = getCategoryById(formData.get("category"));

    const payload = {
      p_inventory_item_id: formData.get("inventory_item_id") || null,
      p_product_name: formData.get("product_name"),
      p_sku: formData.get("sku"),
      p_supplier: formData.get("supplier") || "Sportco",
      p_category_id: category?.id || null,
      p_category: category?.name || "Other",
      p_description: formData.get("description"),
      p_cost_price: Number(formData.get("cost_price") || 0),
      p_sell_price: Number(formData.get("sell_price") || 0),
      p_quantity_on_hand: Number(formData.get("quantity_on_hand") || 0),
      p_low_stock_threshold: Number(formData.get("low_stock_threshold") || 0),
      p_need_order_threshold: Number(formData.get("need_order_threshold") || 0),
      p_image: image,
      p_visible_in_shop: Boolean(formData.get("visible_in_shop")),
      p_is_active: Boolean(formData.get("is_active"))
    };

    const { error } = await client.rpc("admin_save_inventory_item", payload);
    if (error) {
      setMessage(productMessageEl, error.message, "error");
      return;
    }

    setMessage(productMessageEl, "Product saved.", "success");
    hideProductForm();
    await loadInventory();
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
    setMessage(invoiceMessageEl, "Uploading invoice and preparing review...");
    clearInvoiceReview();

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

    pendingInvoice = {
      id: invoice.id,
      invoiceNumber: parsed.invoiceNumber || "",
      invoiceDate: parsed.invoiceDate,
      fileName: file.name
    };
    invoiceReviewItems = buildInvoiceReviewItems(parsed.items);
    renderInvoiceReviewTable();
    invoiceFormEl.reset();
    setMessage(invoiceMessageEl, `Found ${parsed.items.length} item${parsed.items.length === 1 ? "" : "s"}. Review and confirm before stock is updated.`, "success");
    setMessage(invoiceReviewMessageEl, "");
  }

  async function confirmInvoiceImport() {
    if (!client) {
      setMessage(invoiceReviewMessageEl, "Supabase is not configured yet.", "error");
      return;
    }

    const validationError = validateInvoiceReview();
    if (validationError) {
      setMessage(invoiceReviewMessageEl, validationError, "error");
      return;
    }

    invoiceImportConfirmEl.disabled = true;
    setMessage(invoiceReviewMessageEl, "Importing reviewed invoice items...");

    for (const item of invoiceReviewItems) {
      const category = getCategoryById(item.finalCategoryId);
      const { error } = await client.rpc("import_reviewed_supplier_invoice_item", {
        p_invoice_id: pendingInvoice.id,
        p_inventory_item_id: item.matchedInventoryItemId || null,
        p_product_name: item.productName,
        p_sku: item.sku || null,
        p_quantity: item.quantity,
        p_unit_cost: item.unitCost,
        p_total_cost: item.totalCost,
        p_category_id: category?.id || null,
        p_category: category?.name || "Other",
        p_sell_price: item.sellPrice,
        p_visible_in_shop: Boolean(item.visibleInShop),
        p_review_status: item.reviewStatus,
        p_invoice_number: pendingInvoice.invoiceNumber || null,
        p_invoice_date: pendingInvoice.invoiceDate || null
      });

      if (error) {
        setMessage(invoiceReviewMessageEl, `Import stopped on ${item.productName}: ${error.message}`, "error");
        invoiceImportConfirmEl.disabled = false;
        await loadInventory();
        return;
      }
    }

    const importedCount = invoiceReviewItems.length;
    clearInvoiceReview();
    setMessage(invoiceMessageEl, `Imported ${importedCount} reviewed Sportco invoice item${importedCount === 1 ? "" : "s"}.`, "success");
    await loadInventory();
    if (invoiceImportConfirmEl) invoiceImportConfirmEl.disabled = false;
  }

  function handleInvoiceReviewChange(event) {
    const field = event.target.closest("[data-invoice-field]");
    if (!field) return;

    syncInvoiceReviewFromDom();
    if (field.dataset.invoiceField === "matchedInventoryItemId") {
      const row = field.closest("[data-invoice-review-index]");
      const index = Number(row?.dataset.invoiceReviewIndex);
      const item = invoiceReviewItems[index];
      const matchedItem = inventoryItems.find((entry) => entry.id === item?.matchedInventoryItemId);
      if (item && matchedItem) {
        item.finalCategoryId = matchedItem.category_id || item.finalCategoryId || getFallbackCategory()?.id || "";
        item.suggestedCategoryId = item.finalCategoryId;
        item.sellPrice = Number(matchedItem.sell_price || item.sellPrice || 0);
        item.visibleInShop = Boolean(matchedItem.visible_in_shop);
        item.reviewStatus = "matched";
        renderInvoiceReviewTable();
      }
    }
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
      const category = getCategoryById(row.querySelector("[data-review-category-id]")?.value);
      result = await client.rpc("publish_inventory_item_to_shop", {
        p_inventory_item_id: itemId,
        p_category_id: category?.id || null,
        p_category: category?.name || "Other",
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

  async function handleInventoryAction(event) {
    const button = event.target.closest("[data-inventory-action]");
    if (!button || !client) return;

    const row = button.closest("[data-inventory-item]");
    const item = inventoryItems.find((entry) => entry.id === row?.dataset.inventoryItem);
    if (!item) return;

    const action = button.dataset.inventoryAction;
    if (action === "edit") {
      showProductForm(item);
      return;
    }

    if (action === "adjust") {
      if (adjustItemEl) adjustItemEl.value = item.id;
      adjustFormEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    button.disabled = true;
    if (action === "archive") {
      if (item.archived_at) {
        alert("This product is already archived.");
      } else if (confirm(`Archive ${item.product_name}? It will be hidden from the public shop.`)) {
        const { error } = await client.rpc("archive_inventory_item", { p_inventory_item_id: item.id });
        if (error) alert(error.message);
        await loadInventory();
      }
    }

    if (action === "delete") {
      if (confirm(`Permanently delete ${item.product_name}? This is only allowed when there are no stock movements or orders.`)) {
        const { error } = await client.rpc("delete_inventory_item_if_safe", { p_inventory_item_id: item.id });
        if (error) alert(error.message);
        await loadInventory();
      }
    }
    button.disabled = false;
  }

  searchEl?.addEventListener("input", () => {
    renderInventoryList();
  });
  categoryFilterEl?.addEventListener("change", () => {
    renderInventoryList();
  });
  showArchivedEl?.addEventListener("change", () => {
    renderInventoryList();
    renderAdjustmentSelect();
  });
  addProductBtnEl?.addEventListener("click", () => showProductForm());
  cancelEditBtnEl?.addEventListener("click", hideProductForm);
  productFormEl?.addEventListener("submit", saveProduct);
  inventoryListEl?.addEventListener("click", handleInventoryAction);
  invoiceFormEl?.addEventListener("submit", uploadInvoice);
  invoiceReviewTableEl?.addEventListener("change", handleInvoiceReviewChange);
  invoiceReviewTableEl?.addEventListener("input", syncInvoiceReviewFromDom);
  invoiceReviewClearEl?.addEventListener("click", clearInvoiceReview);
  invoiceImportConfirmEl?.addEventListener("click", confirmInvoiceImport);
  reviewListEl?.addEventListener("click", handleReviewAction);
  adjustFormEl?.addEventListener("submit", saveStockAdjustment);
  settingsFormEl?.addEventListener("submit", saveInventorySettings);

  document.addEventListener("DOMContentLoaded", () => {
    loadProductCategories().then(loadInventory);
    loadInventorySettings();
  });
})();
