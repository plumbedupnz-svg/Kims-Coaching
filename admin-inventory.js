(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const inventoryListEl = document.querySelector("[data-inventory-list]");
  const reviewListEl = document.querySelector("[data-inventory-review-list]");
  const searchEl = document.querySelector("[data-inventory-search]");
  const categoryFilterEl = document.querySelector("[data-inventory-category-filter]");
  const statusFilterEl = document.querySelector("[data-inventory-status-filter]");
  const supplierFilterEl = document.querySelector("[data-inventory-supplier-filter]");
  const showArchivedEl = document.querySelector("[data-inventory-show-archived]");
  const inventoryTabEls = document.querySelectorAll("[data-inventory-tab]");
  const inventoryPanelEls = document.querySelectorAll("[data-inventory-panel]");
  const inventoryDashboardEl = document.querySelector("[data-inventory-dashboard]");
  const addProductBtnEls = document.querySelectorAll("[data-inventory-add-product]");
  const productFormEl = document.querySelector("[data-inventory-product-form]");
  const productFormTitleEl = document.querySelector("[data-inventory-form-title]");
  const productCategoryEl = document.querySelector("[data-inventory-form-category]");
  const productMessageEl = document.querySelector("[data-inventory-product-message]");
  const productGstMessageEl = document.querySelector("[data-inventory-gst-message]");
  const inventoryListMessageEl = document.querySelector("[data-inventory-list-message]");
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
  const categoryFormEl = document.querySelector("[data-inventory-category-form]");
  const categoryNameEl = document.querySelector("[data-inventory-category-name]");
  const categoryListEl = document.querySelector("[data-inventory-category-list]");
  const categoryMessageEl = document.querySelector("[data-inventory-category-message]");
  const productImageInputEl = document.querySelector("[data-inventory-image-input]");
  const productImageListEl = document.querySelector("[data-inventory-image-list]");
  const PRODUCT_IMAGE_BUCKET = "product-images";
  const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
  const PRODUCT_IMAGE_MAX_DIMENSION = 1000;
  const PRODUCT_IMAGE_TARGET_QUALITY = 0.82;
  const PRODUCT_IMAGE_TARGET_BYTES = 300 * 1024;
  const DELETE_BLOCKED_MESSAGE = "This item has stock history and cannot be permanently deleted. Use Archive instead.";
  const showInventoryDebug = new URLSearchParams(window.location.search).get("debug") === "inventory";

  let inventoryItems = [];
  let productCategories = [];
  let productCategoriesLoaded = false;
  let productCategoriesLoading = false;
  let productCategoriesError = "";
  let productCategoriesPromise = null;
  let inventoryImageGalleryReady = null;
  let currentProductImages = [];
  let pendingProductImageFiles = [];
  let removedProductImages = [];
  let productImagePreviewUrls = [];
  let selectedMainImageKey = "";
  let pendingInvoice = null;
  let invoiceReviewItems = [];
  let lastInventoryDebug = {
    source: "not_loaded",
    returnedRows: 0,
    activeRows: 0,
    categoryRows: 0,
    statusRows: 0,
    supplierRows: 0,
    searchRows: 0,
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

  function getInventoryGstRate() {
    const globalRate = Number(window.KimsShopTaxSettings?.tax_rate_percent);
    if (Number.isFinite(globalRate) && globalRate >= 0) return globalRate;
    const settingsRate = Number(document.querySelector('[data-shop-checkout-settings-form] [name="tax_rate_percent"]')?.value);
    if (Number.isFinite(settingsRate) && settingsRate >= 0) return settingsRate;
    return 15;
  }

  function handleInventoryGstAction(action) {
    const sellPriceEl = productFormEl?.elements?.sell_price;
    if (!sellPriceEl) return;
    const sellPrice = Number(sellPriceEl.value);
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
      setMessage(productGstMessageEl, "Enter a sell price first.", "error");
      return;
    }

    const gstRate = getInventoryGstRate();
    const gstMultiplier = 1 + (gstRate / 100);
    if (action === "add") {
      const updatedPrice = sellPrice * gstMultiplier;
      sellPriceEl.value = updatedPrice.toFixed(2);
      setMessage(productGstMessageEl, `${money(sellPrice)} plus ${gstRate}% GST = ${money(updatedPrice)}.`, "success");
      return;
    }

    if (action === "inclusive") {
      const exGst = gstMultiplier ? sellPrice / gstMultiplier : sellPrice;
      const gstPortion = sellPrice - exGst;
      setMessage(productGstMessageEl, `${money(sellPrice)} GST inclusive: ${money(exGst)} ex GST + ${money(gstPortion)} GST.`, "success");
    }
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

  function getStorableImageUrl(value = "") {
    const imageUrl = String(value || "").trim();
    if (!imageUrl || imageUrl.startsWith("data:")) return "";
    return /^https?:\/\//i.test(imageUrl) && imageUrl.length <= 2000 ? imageUrl : "";
  }

  function normalizeInventoryItemImage(image = {}, index = 0) {
    const imageUrl = getStorableImageUrl(image.image_url || image.image || image.url);
    if (!imageUrl) return null;
    return {
      id: image.id || "",
      inventory_item_id: image.inventory_item_id || "",
      image_url: imageUrl,
      storage_path: image.storage_path || "",
      alt_text: image.alt_text || "",
      sort_order: Number(image.sort_order ?? index),
      is_main: Boolean(image.is_main)
    };
  }

  function getExistingImageKey(image = {}, index = 0) {
    return `existing:${image.id || image.image_url || index}`;
  }

  function getNewImageKey(index = 0) {
    return `new:${index}`;
  }

  function getProductImageFiles() {
    return pendingProductImageFiles;
  }

  function clearProductImagePreviews() {
    productImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    productImagePreviewUrls = [];
  }

  function syncProductImageInputFiles(files = pendingProductImageFiles) {
    pendingProductImageFiles = Array.from(files || []);
    if (!productImageInputEl) return;
    if (!pendingProductImageFiles.length) {
      productImageInputEl.value = "";
      return;
    }

    try {
      const transfer = new DataTransfer();
      pendingProductImageFiles.forEach((file) => transfer.items.add(file));
      productImageInputEl.files = transfer.files;
    } catch (error) {
      console.warn("Could not sync product image input after photo removal.", error);
    }
  }

  function getItemImageRecords(item = {}) {
    const galleryImages = Array.isArray(item.product_images)
      ? item.product_images
      : Array.isArray(item.inventory_item_images)
        ? item.inventory_item_images
        : [];
    const records = galleryImages
      .map(normalizeInventoryItemImage)
      .filter(Boolean)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const mainImageUrl = getStorableImageUrl(item.image_url || item.image);
    if (mainImageUrl && !records.some((image) => image.image_url === mainImageUrl)) {
      records.unshift({
        id: "",
        inventory_item_id: item.id || "",
        image_url: mainImageUrl,
        storage_path: "",
        alt_text: "",
        sort_order: -1,
        is_main: true
      });
    }
    if (!records.some((image) => image.is_main) && records[0]) records[0].is_main = true;
    return records;
  }

  function getAvailableMainImageKeys(files = getProductImageFiles()) {
    return [
      ...currentProductImages.map(getExistingImageKey),
      ...files.map((_, index) => getNewImageKey(index))
    ];
  }

  function syncMainImageCheckboxes() {
    productImageListEl?.querySelectorAll("[data-product-main-image]").forEach((checkbox) => {
      checkbox.checked = checkbox.value === selectedMainImageKey;
    });
  }

  function rememberRemovedProductImage(image = {}) {
    if (!image?.id && !image?.image_url && !image?.storage_path) return;
    const alreadyRemoved = removedProductImages.some((removed) => (
      (image.id && removed.id === image.id)
      || (image.image_url && removed.image_url === image.image_url)
      || (image.storage_path && removed.storage_path === image.storage_path)
    ));
    if (!alreadyRemoved) removedProductImages.push(image);
  }

  function chooseAvailableMainImage() {
    const availableKeys = getAvailableMainImageKeys();
    if (!availableKeys.includes(selectedMainImageKey)) selectedMainImageKey = availableKeys[0] || "";
  }

  function removeExistingProductImage(key = "") {
    const imageIndex = currentProductImages.findIndex((image, index) => getExistingImageKey(image, index) === key);
    if (imageIndex < 0) return;
    const [removedImage] = currentProductImages.splice(imageIndex, 1);
    rememberRemovedProductImage(removedImage);
    chooseAvailableMainImage();
    renderProductImagePicker();
  }

  function removeNewProductImage(index = -1) {
    if (index < 0 || index >= pendingProductImageFiles.length) return;
    const nextFiles = pendingProductImageFiles.filter((_, fileIndex) => fileIndex !== index);
    syncProductImageInputFiles(nextFiles);
    chooseAvailableMainImage();
    renderProductImagePicker();
  }

  function renderProductImagePicker() {
    if (!productImageListEl) return;
    clearProductImagePreviews();
    const files = getProductImageFiles();
    const availableKeys = getAvailableMainImageKeys(files);
    if (!availableKeys.includes(selectedMainImageKey)) {
      selectedMainImageKey = currentProductImages.find((image) => image.is_main)
        ? getExistingImageKey(currentProductImages.find((image) => image.is_main), currentProductImages.findIndex((image) => image.is_main))
        : availableKeys[0] || "";
    }

    const existingCards = currentProductImages.map((image, index) => {
      const key = getExistingImageKey(image, index);
      return `
        <div class="inventory-image-card">
          <img src="${escapeHtml(image.image_url)}" alt="${escapeHtml(image.alt_text || "Saved product photo")}" />
          <button class="inventory-image-remove" type="button" data-product-remove-existing-image="${escapeHtml(key)}">Remove photo</button>
          <label class="inventory-image-main">
            <input type="checkbox" value="${escapeHtml(key)}" data-product-main-image ${selectedMainImageKey === key ? "checked" : ""} />
            <span>Main photo</span>
          </label>
          <small>Saved photo</small>
        </div>`;
    });

    const newCards = files.map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      productImagePreviewUrls.push(previewUrl);
      const key = getNewImageKey(index);
      return `
        <div class="inventory-image-card">
          <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(file.name || "New product photo")}" />
          <button class="inventory-image-remove" type="button" data-product-remove-new-image="${index}">Remove photo</button>
          <label class="inventory-image-main">
            <input type="checkbox" value="${escapeHtml(key)}" data-product-main-image ${selectedMainImageKey === key ? "checked" : ""} />
            <span>Main photo</span>
          </label>
          <small>${escapeHtml(file.name || "New photo")}</small>
        </div>`;
    });

    const cards = [...existingCards, ...newCards].join("");
    productImageListEl.innerHTML = cards || '<p class="helper-text">No product photos selected.</p>';
  }

  function getSortedProductCategories(rows = productCategories) {
    const byName = new Map();
    rows
      .filter((category) => category?.name)
      .forEach((category) => {
        const name = String(category.name || "").trim().replace(/\s+/g, " ");
        const key = name.toLowerCase();
        if (!byName.has(key)) byName.set(key, { ...category, id: category.id || "", name });
      });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  function setProductCategories(rows = []) {
    productCategories = getSortedProductCategories(rows);
    return productCategories;
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

  function itemIsActive(item = {}) {
    return item.is_active !== false && !item.archived_at;
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
    return inventoryItems.filter(itemIsActive);
  }

  function normalizeInventoryItem(item = {}) {
    const imageUrl = item.image_url || item.image || "";
    const category = item.product_categories || getCategoryForItem(item);
    return {
      ...item,
      product_name: item.product_name || item.name || "Unnamed inventory item",
      brand: item.brand || "",
      sku: item.sku || "",
      supplier: item.supplier || "Sportco",
      category: category?.name || item.category || "Other",
      product_categories: category || item.product_categories || null,
      quantity_on_hand: Number(item.quantity_on_hand || 0),
      cost_price: Number(item.cost_price || 0),
      purchase_price: Number(item.purchase_price ?? item.cost_price ?? 0),
      sell_price: Number(item.sell_price || item.price || 0),
      low_stock_threshold: Number(item.low_stock_threshold ?? 2),
      need_order_threshold: Number(item.need_order_threshold ?? item.reorder_threshold ?? 0),
      status: item.status || "out_of_stock",
      visible_in_shop: Boolean(item.visible_in_shop),
      track_stock: item.track_stock !== false && item.is_order_to_sale !== true,
      is_order_to_sale: Boolean(item.is_order_to_sale) || item.track_stock === false,
      short_description: item.short_description || "",
      is_active: item.is_active !== false,
      image_url: imageUrl,
      image: imageUrl,
      product_images: getItemImageRecords(item)
    };
  }

  function normaliseStatus(status = "") {
    return String(status).replace(/_/g, " ");
  }

  function normalizeStatusFilter(status = "") {
    const value = String(status || "").trim().toLowerCase();
    return value === "need_to_order" ? "need_order" : value;
  }

  function getStatusClass(status = "") {
    if (status === "out_of_stock" || status === "new_supplier_item") return "blocked";
    if (status === "low_stock" || status === "need_order" || status === "need_to_order" || status === "order_to_sale") return "warning";
    return "available";
  }

  function getItemTypeLabel(item = {}) {
    if (item.is_order_to_sale || item.track_stock === false) return "Order-to-sale";
    return "Stock tracked";
  }

  function getShopVisibilityLabel(item = {}) {
    if (!item.visible_in_shop) return "Hidden";
    return item.is_order_to_sale || item.track_stock === false ? "Shop - order" : "Shop - stock";
  }

  function matchesInventoryViewFilter(item = {}, status = "all") {
    const normalized = normalizeStatusFilter(status);
    if (normalized === "all") return true;
    if (normalized === "stock_on_hand") return item.track_stock !== false && Number(item.quantity_on_hand || 0) > 0;
    if (normalized === "online_shop") return item.visible_in_shop === true;
    if (normalized === "order_to_sale") return item.is_order_to_sale === true || item.track_stock === false;
    if (normalized === "hidden") return item.visible_in_shop !== true;
    return normalizeStatusFilter(item.status) === normalized;
  }

  function getMargin(item) {
    const cost = Number(item.cost_price || 0);
    const sell = Number(item.sell_price || 0);
    const profit = sell - cost;
    const margin = sell > 0 ? (profit / sell) * 100 : 0;
    return `${money(profit)} / ${margin.toFixed(1)}%`;
  }

  function getInventoryProductForShop(item = {}) {
    const inventoryId = item.id || item.inventory_item_id || "";
    const isOrderToSale = item.is_order_to_sale || item.track_stock === false;
    return {
      id: item.shop_product_id || item.id || inventoryId,
      inventory_item_id: inventoryId,
      name: item.product_name || item.name || "Inventory item",
      slug: item.slug || "",
      price: Number(item.sell_price || 0),
      discount: 0,
      category: getItemCategory(item),
      category_id: item.category_id || "",
      description: item.description || item.full_description || item.short_description || "",
      short_description: item.short_description || "",
      image: item.image_url || item.image || "",
      image_url: item.image_url || item.image || "",
      fulfilment_type: isOrderToSale ? "order_to_sale" : "stock",
      stock_status: item.status || "",
      quantity_on_hand: Number(item.quantity_on_hand || 0),
      visible_in_shop: item.visible_in_shop !== false,
      is_active: item.is_active !== false
    };
  }

  function findInventoryRow(itemId) {
    return Array.from(inventoryListEl?.querySelectorAll("[data-inventory-item]") || [])
      .find((row) => row.dataset.inventoryItem === itemId);
  }

  function closeInventoryQrPanels(exceptItemId = "") {
    inventoryListEl?.querySelectorAll("[data-inventory-qr-panel]").forEach((panel) => {
      const row = panel.closest("[data-inventory-item]");
      if (exceptItemId && row?.dataset.inventoryItem === exceptItemId) return;
      panel.hidden = true;
    });
  }

  function closeInventoryActionMenus() {
    document.querySelectorAll("[data-inventory-action-list]").forEach((list) => {
      list.hidden = true;
      list.classList.remove("is-fixed-popover");
      list.removeAttribute("style");
    });
    document.querySelectorAll("[data-inventory-menu-toggle]").forEach((toggle) => {
      toggle.setAttribute("aria-expanded", "false");
    });
  }

  function positionInventoryActionMenu(menu, toggle) {
    if (!menu || !toggle) return;
    menu.hidden = false;
    menu.classList.add("is-fixed-popover");
    menu.style.position = "fixed";
    menu.style.right = "auto";
    menu.style.zIndex = "1000";

    const toggleRect = toggle.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const top = Math.min(toggleRect.bottom + 6, window.innerHeight - menuRect.height - margin);
    const left = Math.min(toggleRect.right - menuRect.width, window.innerWidth - menuRect.width - margin);

    menu.style.top = `${Math.max(margin, top)}px`;
    menu.style.left = `${Math.max(margin, left)}px`;
  }

  function hideInventoryQr(itemId) {
    const row = findInventoryRow(itemId);
    const panel = row?.querySelector("[data-inventory-qr-panel]");
    if (panel) panel.hidden = true;
  }

  async function toggleInventoryQr(itemId) {
    const row = findInventoryRow(itemId);
    const panel = row?.querySelector("[data-inventory-qr-panel]");
    if (!panel) return;
    if (!panel.hidden) {
      panel.hidden = true;
      return;
    }
    closeInventoryQrPanels(itemId);
    await generateInventoryQr(itemId);
  }

  async function generateInventoryQr(itemId) {
    const item = inventoryItems.find((entry) => entry.id === itemId);
    const row = findInventoryRow(itemId);
    const panel = row?.querySelector("[data-inventory-qr-panel]");
    const canvas = row?.querySelector("[data-inventory-qr-canvas]");
    const message = row?.querySelector("[data-inventory-qr-message]");
    if (!item || !panel || !canvas) return;
    panel.hidden = false;
    if (message) message.textContent = "Generating QR code...";
    try {
      if (!window.KimsShop?.drawProductQrLabel) throw new Error("QR code tools are not ready. Please refresh and try again.");
      await window.KimsShop.drawProductQrLabel(canvas, getInventoryProductForShop(item));
      if (message) message.textContent = "QR code links to the public product detail page.";
    } catch (error) {
      if (message) message.textContent = error.message || "Could not generate QR code.";
    }
  }

  async function downloadInventoryQr(itemId) {
    await generateInventoryQr(itemId);
    const item = inventoryItems.find((entry) => entry.id === itemId);
    const row = findInventoryRow(itemId);
    const canvas = row?.querySelector("[data-inventory-qr-canvas]");
    if (!item || !canvas) return;
    const product = getInventoryProductForShop(item);
    const slug = window.KimsShop?.getProductSlug?.(product) || String(product.name || "inventory-item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${slug || "inventory-item"}-qr.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function printInventoryQr(itemId) {
    await generateInventoryQr(itemId);
    const item = inventoryItems.find((entry) => entry.id === itemId);
    const row = findInventoryRow(itemId);
    const canvas = row?.querySelector("[data-inventory-qr-canvas]");
    if (!item || !canvas) return;
    const product = getInventoryProductForShop(item);
    const printWindow = window.open("", "_blank", "width=720,height=900");
    if (!printWindow) {
      alert("Allow pop-ups to print the QR code.");
      return;
    }
    printWindow.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(product.name)} QR Code</title><style>body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:Arial,sans-serif;background:#fff}img{width:min(92vw,520px);height:auto}</style></head><body><img src="${canvas.toDataURL("image/png")}" alt="${escapeHtml(product.name)} QR code" /></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  function sumItems(items, field) {
    return items.reduce((total, item) => total + Number(item[field] || 0), 0);
  }

  function renderEmpty(target, message) {
    if (!target) return;
    target.innerHTML = `<p class="helper-text">${escapeHtml(message)}</p>`;
  }

  function getCurrentFilters() {
    return {
      search: String(searchEl?.value || "").trim(),
      category: categoryFilterEl?.value || "all",
      status: statusFilterEl?.value || "all",
      supplier: supplierFilterEl?.value || "all",
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
    if (showInventoryDebug) console.info("[Kim's Coaching inventory]", lastInventoryDebug);
  }

  function getInventoryDebugText() {
    const filters = lastInventoryDebug.filters || getCurrentFilters();
    return [
      `Inventory debug: ${lastInventoryDebug.returnedRows || 0} row(s) returned`,
      `${lastInventoryDebug.activeRows || 0} after active/archive filter`,
      `${lastInventoryDebug.categoryRows || 0} after category filter`,
      `${lastInventoryDebug.statusRows || 0} after status filter`,
      `${lastInventoryDebug.supplierRows || 0} after supplier filter`,
      `${lastInventoryDebug.searchRows || 0} after search filter`,
      `source: ${lastInventoryDebug.source || "unknown"}`,
      `project: ${lastInventoryDebug.projectRef || "unknown"}`,
      `admin: ${lastInventoryDebug.isAdmin}`,
      lastInventoryDebug.profileRole ? `profile role: ${lastInventoryDebug.profileRole}` : "",
      `category: ${filters.category || "all"}`,
      `status: ${filters.status || "all"}`,
      `supplier: ${filters.supplier || "all"}`,
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
    const sortedCategories = getSortedProductCategories();
    const categoryOptions = sortedCategories
      .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
      .join("");

    if (categoryFilterEl) {
      if (productCategoriesLoading && !productCategoriesLoaded && !productCategories.length) {
        categoryFilterEl.innerHTML = '<option value="all">Loading categories...</option>';
        categoryFilterEl.value = "all";
      } else if (productCategoriesError && !productCategories.length) {
        categoryFilterEl.innerHTML = '<option value="all">Could not load categories</option>';
        categoryFilterEl.value = "all";
      } else {
        const fallback = currentFilter !== "all" && !sortedCategories.some((category) => category.id === currentFilter)
          ? `<option value="${escapeHtml(currentFilter)}">Selected category</option>`
          : "";
        categoryFilterEl.innerHTML = '<option value="all">All categories</option>' + fallback + categoryOptions;
        categoryFilterEl.value = currentFilter === "all" || fallback || sortedCategories.some((category) => category.id === currentFilter)
          ? currentFilter
          : "all";
      }
    }

    if (productCategoryEl) {
      if (productCategoriesLoading && !productCategoriesLoaded && !productCategories.length) {
        productCategoryEl.innerHTML = '<option value="">Loading categories...</option>';
        productCategoryEl.disabled = true;
      } else if (productCategoriesError && !productCategories.length) {
        productCategoryEl.innerHTML = '<option value="">Could not load categories</option>';
        productCategoryEl.disabled = false;
      } else {
        const fallback = currentFormCategory && !sortedCategories.some((category) => category.id === currentFormCategory)
          ? `<option value="${escapeHtml(currentFormCategory)}">Selected category</option>`
          : "";
        productCategoryEl.innerHTML = '<option value="">Select category</option>' + fallback + categoryOptions;
        productCategoryEl.value = currentFormCategory && (fallback || sortedCategories.some((category) => category.id === currentFormCategory))
          ? currentFormCategory
          : "";
        productCategoryEl.disabled = false;
      }
    }

    renderInventoryCategoryList();
  }

  function renderInventoryCategoryList() {
    if (!categoryListEl) return;

    if (productCategoriesLoading && !productCategoriesLoaded && !productCategories.length) {
      categoryListEl.innerHTML = '<p class="helper-text">Loading categories...</p>';
      return;
    }

    if (productCategoriesError && !productCategories.length) {
      categoryListEl.innerHTML = '<p class="helper-text">Could not load categories.</p>';
      return;
    }

    const sortedCategories = getSortedProductCategories();
    categoryListEl.innerHTML = sortedCategories.length
      ? sortedCategories.map((category) => `<span class="inventory-category-pill">${escapeHtml(category.name)}</span>`).join("")
      : '<p class="helper-text">No categories yet.</p>';
  }

  function renderSupplierControls() {
    if (!supplierFilterEl) return;
    const currentSupplier = supplierFilterEl.value || "all";
    const suppliers = Array.from(new Set(
      inventoryItems
        .map((item) => String(item.supplier || "").trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    supplierFilterEl.innerHTML = '<option value="all">All suppliers</option>' + suppliers
      .map((supplier) => `<option value="${escapeHtml(normalizeText(supplier))}">${escapeHtml(supplier)}</option>`)
      .join("");
    supplierFilterEl.value = suppliers.some((supplier) => normalizeText(supplier) === currentSupplier) ? currentSupplier : "all";
  }

  function setInventoryTab(tabName = "dashboard") {
    inventoryTabEls.forEach((button) => {
      const isActive = button.dataset.inventoryTab === tabName;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("aria-expanded", String(isActive));
    });

    inventoryPanelEls.forEach((panel) => {
      panel.hidden = panel.dataset.inventoryPanel !== tabName;
    });
  }

  async function loadProductCategories({ force = false } = {}) {
    if (!client) return productCategories;
    if (productCategoriesLoaded && !force) return productCategories;
    if (productCategoriesPromise) return productCategoriesPromise;

    productCategoriesLoading = true;
    productCategoriesError = "";
    renderCategoryControls();

    productCategoriesPromise = (async () => {
      const { data, error } = await client
        .from("product_categories")
        .select("id,name")
        .order("name", { ascending: true });

      if (error) {
        console.warn("Could not load product categories.", error.message);
        productCategoriesError = "Could not load categories";
        return productCategories;
      }

      setProductCategories(data || []);
      productCategoriesLoaded = true;
      return productCategories;
    })();

    try {
      return await productCategoriesPromise;
    } finally {
      productCategoriesLoading = false;
      productCategoriesPromise = null;
      renderCategoryControls();
    }
  }

  function galleryTableMissing(error = {}) {
    return /inventory_item_images|schema cache|relationship|does not exist|42P01|PGRST/i.test(error.message || "");
  }

  async function inventoryImageGalleryIsReady() {
    if (!client) return false;
    if (inventoryImageGalleryReady !== null) return inventoryImageGalleryReady;
    const { error } = await client
      .from("inventory_item_images")
      .select("id")
      .limit(1);
    inventoryImageGalleryReady = !error;
    if (error && !galleryTableMissing(error)) console.warn("Could not check inventory image gallery table.", error.message);
    return inventoryImageGalleryReady;
  }

  async function loadInventoryImages() {
    if (!client || !inventoryItems.length) return;
    const itemIds = inventoryItems.map((item) => item.id).filter(Boolean);
    if (!itemIds.length) return;

    const { data, error } = await client
      .from("inventory_item_images")
      .select("id,inventory_item_id,image_url,storage_path,alt_text,sort_order,is_main")
      .in("inventory_item_id", itemIds)
      .order("sort_order", { ascending: true });

    if (error) {
      inventoryImageGalleryReady = false;
      if (!galleryTableMissing(error)) console.warn("Could not load inventory item images.", error.message);
      return;
    }

    inventoryImageGalleryReady = true;
    const imagesByItem = new Map();
    (data || []).forEach((row, index) => {
      const image = normalizeInventoryItemImage(row, index);
      if (!image) return;
      const images = imagesByItem.get(row.inventory_item_id) || [];
      images.push(image);
      imagesByItem.set(row.inventory_item_id, images);
    });

    inventoryItems = inventoryItems.map((item) => ({
      ...item,
      product_images: getItemImageRecords({
        ...item,
        product_images: imagesByItem.get(item.id) || []
      })
    }));
  }

  async function saveInventoryCategory(event) {
    event.preventDefault();
    if (!client) {
      setMessage(categoryMessageEl, "Supabase is not configured yet.", "error");
      return;
    }

    const categoryName = String(categoryNameEl?.value || "").trim().replace(/\s+/g, " ");
    if (!categoryName) {
      setMessage(categoryMessageEl, "Enter a category name.", "error");
      return;
    }

    const submitButton = categoryFormEl?.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    setMessage(categoryMessageEl, "Saving category...");

    const { data, error } = await client
      .from("product_categories")
      .upsert({ name: categoryName, is_default: false }, { onConflict: "normalized_name" })
      .select("id,name")
      .single();

    if (submitButton) submitButton.disabled = false;

    if (error) {
      setMessage(categoryMessageEl, error.message, "error");
      return;
    }

    if (categoryNameEl) categoryNameEl.value = "";
    productCategoriesLoaded = false;
    await loadProductCategories({ force: true });
    await window.KimsProductCategories?.refresh?.(categoryFilterEl?.value || "all", { force: true });
    if (productCategoryEl && data?.id) productCategoryEl.value = data.id;
    renderInventoryList();
    setMessage(categoryMessageEl, `Category saved: ${data?.name || categoryName}.`, "success");
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

    let result = await client
      .from("inventory_items")
      .select("*")
      .order("product_name", { ascending: true });
    let source = "inventory_items direct select";

    if (result.error) {
      console.warn("Inventory direct select failed, retrying admin inventory RPC.", result.error.message);
      source = "admin_list_inventory_items RPC";
      updateInventoryDebug({ source, rpcError: result.error.message });
      result = await client.rpc("admin_list_inventory_items");
    } else if (!result.data?.length) {
      const directResult = result;
      const rpcResult = await client.rpc("admin_list_inventory_items");
      if (!rpcResult.error && rpcResult.data?.length) {
        source = "admin_list_inventory_items RPC after empty direct select";
        result = rpcResult;
      } else if (rpcResult.error) {
        updateInventoryDebug({
          source,
          returnedRows: directResult.data?.length || 0,
          activeRows: 0,
          categoryRows: 0,
          searchRows: 0,
          rpcError: rpcResult.error.message
        });
      }
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
    await loadInventoryImages();
    updateInventoryDebug({
      source,
      returnedRows: inventoryItems.length,
      ...getInventoryFilterCounts(),
      rpcError: "",
      error: ""
    });
    renderCategoryControls();
    renderSupplierControls();
    resetInventoryCategoryFilterIfEmpty();
    renderInventoryDashboard();
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
    const status = normalizeStatusFilter(statusFilterEl?.value || "all");
    const supplier = supplierFilterEl?.value || "all";
    const showArchived = Boolean(showArchivedEl?.checked);

    const archiveFiltered = showArchived ? inventoryItems : inventoryItems.filter(itemIsActive);
    const categoryFiltered = categoryId === "all"
      ? archiveFiltered
      : archiveFiltered.filter((item) => itemMatchesCategory(item, categoryId));
    const statusFiltered = categoryFiltered.filter((item) => matchesInventoryViewFilter(item, status));
    const supplierFiltered = supplier === "all"
      ? statusFiltered
      : statusFiltered.filter((item) => normalizeText(item.supplier) === supplier);
    const searchFiltered = search
      ? supplierFiltered.filter((item) => `${item.product_name || ""} ${item.sku || ""}`.toLowerCase().includes(search))
      : supplierFiltered;

    return searchFiltered;
  }

  function getInventoryFilterCounts() {
    const search = String(searchEl?.value || "").trim().toLowerCase();
    const categoryId = categoryFilterEl?.value || "all";
    const status = normalizeStatusFilter(statusFilterEl?.value || "all");
    const supplier = supplierFilterEl?.value || "all";
    const showArchived = Boolean(showArchivedEl?.checked);
    const archiveFiltered = showArchived ? inventoryItems : inventoryItems.filter(itemIsActive);
    const categoryFiltered = categoryId === "all"
      ? archiveFiltered
      : archiveFiltered.filter((item) => itemMatchesCategory(item, categoryId));
    const statusFiltered = categoryFiltered.filter((item) => matchesInventoryViewFilter(item, status));
    const supplierFiltered = supplier === "all"
      ? statusFiltered
      : statusFiltered.filter((item) => normalizeText(item.supplier) === supplier);
    const searchFiltered = search
      ? supplierFiltered.filter((item) => `${item.product_name || ""} ${item.sku || ""}`.toLowerCase().includes(search))
      : supplierFiltered;

    return {
      activeRows: archiveFiltered.length,
      categoryRows: categoryFiltered.length,
      statusRows: statusFiltered.length,
      supplierRows: supplierFiltered.length,
      searchRows: searchFiltered.length
    };
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
    if (inventoryListMessageEl?.textContent === DELETE_BLOCKED_MESSAGE) setMessage(inventoryListMessageEl, "");
    updateInventoryDebug({
      returnedRows: inventoryItems.length,
      ...getInventoryFilterCounts()
    });
    const items = getFilteredInventoryItems();
    if (!items.length) {
      const hasInventory = inventoryItems.length > 0;
      renderEmpty(inventoryListEl, hasInventory
        ? "No stock items match the current filters. Choose All categories or adjust the archived filter."
        : "No inventory items found. Add a product or check that your admin account can select inventory_items.");
      return;
    }

    inventoryListEl.innerHTML = `
      <div class="inventory-table" role="table" aria-label="Inventory items">
        <div class="inventory-table-row inventory-table-head" role="row">
          <span>Product</span>
          <span>SKU</span>
          <span>Category</span>
          <span>Supplier</span>
          <span>Quantity</span>
          <span>Type</span>
          <span>Shop</span>
          <span>Cost Price</span>
          <span>Sell Price</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        ${items.map((item) => `
          <div class="inventory-table-row ${item.archived_at ? "archived" : ""}" role="row" data-inventory-item="${item.id}">
            <span><strong>${escapeHtml(item.product_name)}</strong></span>
            <span>${escapeHtml(item.sku || "Not set")}</span>
            <span>${escapeHtml(getItemCategory(item))}</span>
            <span>${escapeHtml(item.supplier || "Sportco")}</span>
            <span>${Number(item.quantity_on_hand || 0)}</span>
            <span>${escapeHtml(getItemTypeLabel(item))}</span>
            <span>${escapeHtml(getShopVisibilityLabel(item))}</span>
            <span>${money(item.cost_price)}</span>
            <span>${money(item.sell_price)}</span>
            <span><span class="status-pill ${getStatusClass(item.status)}">${escapeHtml(normaliseStatus(item.status))}</span></span>
            <span class="inventory-actions">
              <button class="inventory-action-toggle" type="button" aria-label="Open actions menu" aria-expanded="false" data-inventory-menu-toggle>⋮</button>
              <div class="inventory-action-list" data-inventory-action-list hidden>
                <button type="button" data-inventory-action="edit">Edit</button>
                <button type="button" data-inventory-action="qr">QR Code</button>
                <button type="button" data-inventory-action="adjust">Adjust Stock</button>
                <button type="button" data-inventory-action="archive">${item.archived_at ? "Archived" : "Archive"}</button>
                <button type="button" data-inventory-action="delete">Delete</button>
              </div>
              <div class="product-qr-panel inventory-qr-panel" data-inventory-qr-panel hidden>
                <div class="qr-panel-head">
                  <strong>QR Code</strong>
                  <button class="qr-panel-close" type="button" data-inventory-qr-close="${escapeHtml(item.id)}" aria-label="Hide QR code">Close</button>
                </div>
                <canvas width="520" height="680" data-inventory-qr-canvas></canvas>
                <p class="helper-text" data-inventory-qr-message></p>
                <div class="admin-action-row">
                  <button class="btn btn-secondary" type="button" data-inventory-qr-download="${escapeHtml(item.id)}">Download QR</button>
                  <button class="btn btn-secondary" type="button" data-inventory-qr-print="${escapeHtml(item.id)}">Print QR</button>
                  <button class="btn btn-secondary" type="button" data-inventory-qr-close="${escapeHtml(item.id)}">Hide QR</button>
                </div>
              </div>
            </span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderInventoryDashboard() {
    if (!inventoryDashboardEl) return;
    const activeItems = getActiveInventoryItems();
    const lowItems = activeItems.filter((item) => ["low_stock", "need_order", "need_to_order"].includes(item.status));
    const outItems = activeItems.filter((item) => item.status === "out_of_stock" || Number(item.quantity_on_hand || 0) <= 0);
    const visibleItems = activeItems.filter((item) => item.visible_in_shop);
    const orderToSaleItems = activeItems.filter((item) => item.is_order_to_sale || item.track_stock === false);
    const hiddenItems = activeItems.filter((item) => !item.visible_in_shop);
    const totalQuantity = sumItems(activeItems, "quantity_on_hand");
    const costValue = activeItems.reduce((total, item) => total + (Number(item.quantity_on_hand || 0) * Number(item.cost_price || 0)), 0);
    const sellValue = activeItems.reduce((total, item) => total + (Number(item.quantity_on_hand || 0) * Number(item.sell_price || 0)), 0);

    const cards = [
      ["Active items", activeItems.length],
      ["Units on hand", totalQuantity],
      ["Low / need order", lowItems.length],
      ["Out of stock", outItems.length],
      ["Visible in shop", visibleItems.length],
      ["Order-to-sale", orderToSaleItems.length],
      ["Hidden", hiddenItems.length],
      ["Cost value", money(costValue)],
      ["Retail value", money(sellValue)],
      ["Archived items", inventoryItems.filter(isArchivedOrInactive).length]
    ];

    inventoryDashboardEl.innerHTML = cards.map(([label, value]) => `
      <article class="inventory-summary-card">
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(label)}</span>
      </article>
    `).join("");
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

  function getSafeImageFileName(fileName = "product-image") {
    const baseName = String(fileName)
      .replace(/\.[^.]+$/, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "product-image";
    return `${baseName}.webp`;
  }

  function validateProductImage(file) {
    if (!file) return "";
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) return "Choose a JPG, PNG, or WebP product image.";
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) return "Image is too large. Please use a file under 2MB.";
    return "";
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not compress product image."));
      }, type, quality);
    });
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read product image."));
      };
      image.src = url;
    });
  }

  async function compressProductImage(file) {
    const source = window.createImageBitmap
      ? await createImageBitmap(file)
      : await loadImageElement(file);
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    const scale = Math.min(1, PRODUCT_IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare product image.");
    context.drawImage(source, 0, 0, width, height);

    const supportsWebp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    const outputType = supportsWebp ? "image/webp" : "image/jpeg";
    const extension = supportsWebp ? "webp" : "jpg";
    let quality = PRODUCT_IMAGE_TARGET_QUALITY;
    let blob = await canvasToBlob(canvas, outputType, quality);
    while (blob.size > PRODUCT_IMAGE_TARGET_BYTES && quality > 0.58) {
      quality = Math.max(0.58, quality - 0.08);
      blob = await canvasToBlob(canvas, outputType, quality);
    }
    source.close?.();
    return { blob, contentType: outputType, extension };
  }

  async function uploadProductImage(file, inventoryItemId = "") {
    const validationError = validateProductImage(file);
    if (validationError) throw new Error(validationError);

    setMessage(productMessageEl, "Optimising and uploading product image...", "neutral");
    const { blob, contentType, extension } = await compressProductImage(file);
    if (blob.size > PRODUCT_IMAGE_MAX_BYTES) {
      throw new Error("Compressed image is still too large. Please choose a smaller product image.");
    }
    const folderId = inventoryItemId || `temp-${Date.now()}`;
    const safeName = getSafeImageFileName(file.name).replace(/\.webp$/, `.${extension}`);
    const storagePath = `inventory/${folderId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await client.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(storagePath, blob, {
        cacheControl: "31536000",
        contentType,
        upsert: true
      });

    if (uploadError) throw new Error(`Product image upload failed: ${uploadError.message}`);

    const { data } = client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath);
    if (!data?.publicUrl) throw new Error("Product image uploaded, but no public URL was returned.");
    return { imageUrl: data.publicUrl, storagePath };
  }

  async function updateInventoryImageUrl(inventoryItemId, imageUrl, { allowEmpty = false } = {}) {
    if (!inventoryItemId || (!imageUrl && !allowEmpty)) return;
    const storedImageUrl = imageUrl || null;
    let result = await client
      .from("inventory_items")
      .update({ image_url: storedImageUrl, image: storedImageUrl })
      .eq("id", inventoryItemId);

    if (result.error && /image_url/i.test(result.error.message || "")) {
      result = await client
        .from("inventory_items")
        .update({ image: storedImageUrl })
        .eq("id", inventoryItemId);
    }

    if (result.error) throw new Error(`Product image URL could not be saved: ${result.error.message}`);
  }

  async function deleteRemovedProductImages() {
    if (!removedProductImages.length) return;
    const removedIds = [...new Set(removedProductImages.map((image) => image.id).filter(Boolean))];
    const storagePaths = [...new Set(removedProductImages.map((image) => image.storage_path).filter(Boolean))];

    if (removedIds.length) {
      const { error } = await client
        .from("inventory_item_images")
        .delete()
        .in("id", removedIds);
      if (error) throw new Error(`Could not delete product photo: ${error.message}`);
    }

    if (storagePaths.length) {
      const { error } = await client.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .remove(storagePaths);
      if (error) console.warn("Product photo was removed from the gallery, but storage cleanup failed.", error.message);
    }
  }

  async function saveProductImageSelection(inventoryItemId, imageFiles = []) {
    if (!inventoryItemId) return "";
    const hasExistingImages = currentProductImages.length > 0;
    const hasRemovedImages = removedProductImages.length > 0;
    if (!hasExistingImages && !imageFiles.length && !hasRemovedImages) return "";

    const galleryReady = await inventoryImageGalleryIsReady();
    if (!galleryReady) {
      if (imageFiles.length > 1) {
        throw new Error("Run the product gallery SQL migration before saving multiple photos.");
      }
      if (!imageFiles.length) {
        if (hasRemovedImages) {
          await updateInventoryImageUrl(inventoryItemId, "", { allowEmpty: true });
          removedProductImages = [];
        }
        return "";
      }
      setMessage(productMessageEl, "Optimising and uploading product photo...", "neutral");
      const uploaded = await uploadProductImage(imageFiles[0], inventoryItemId);
      await updateInventoryImageUrl(inventoryItemId, uploaded.imageUrl);
      removedProductImages = [];
      return uploaded.imageUrl;
    }

    const uploadedImages = [];
    for (const [index, file] of imageFiles.entries()) {
      setMessage(productMessageEl, `Optimising and uploading product photo ${index + 1} of ${imageFiles.length}...`, "neutral");
      const uploaded = await uploadProductImage(file, inventoryItemId);
      uploadedImages.push({
        key: getNewImageKey(index),
        inventory_item_id: inventoryItemId,
        image_url: uploaded.imageUrl,
        storage_path: uploaded.storagePath,
        alt_text: file.name || "",
        sort_order: currentProductImages.length + index,
        is_main: false
      });
    }

    let insertedImages = [];
    if (uploadedImages.length) {
      const { data, error } = await client
        .from("inventory_item_images")
        .insert(uploadedImages.map(({ key, ...image }) => image))
        .select("id,inventory_item_id,image_url,storage_path,alt_text,sort_order,is_main");

      if (error) throw new Error(`Product gallery could not be saved: ${error.message}`);
      insertedImages = (data || []).map((image, index) => {
        const normalizedImage = normalizeInventoryItemImage(image, currentProductImages.length + index);
        return normalizedImage
          ? { ...normalizedImage, key: uploadedImages[index]?.key || getNewImageKey(index) }
          : null;
      }).filter(Boolean);
    }

    await deleteRemovedProductImages();

    const selectedExisting = currentProductImages.find((image, index) => getExistingImageKey(image, index) === selectedMainImageKey);
    const selectedInserted = insertedImages.find((image) => image.key === selectedMainImageKey);
    const fallbackImage = selectedExisting
      || selectedInserted
      || currentProductImages.find((image) => image.is_main)
      || insertedImages.find((image) => image.is_main)
      || currentProductImages[0]
      || insertedImages[0]
      || null;
    const mainImageUrl = fallbackImage?.image_url || "";

    if (mainImageUrl) {
      const resetResult = await client
        .from("inventory_item_images")
        .update({ is_main: false })
        .eq("inventory_item_id", inventoryItemId);
      if (resetResult.error) throw new Error(`Could not update product gallery main photo: ${resetResult.error.message}`);

      if (fallbackImage.id) {
        const mainResult = await client
          .from("inventory_item_images")
          .update({ is_main: true })
          .eq("id", fallbackImage.id);
        if (mainResult.error) throw new Error(`Could not set main product photo: ${mainResult.error.message}`);
      } else {
        const upsertResult = await client
          .from("inventory_item_images")
          .upsert({
            inventory_item_id: inventoryItemId,
            image_url: mainImageUrl,
            storage_path: fallbackImage.storage_path || null,
            alt_text: fallbackImage.alt_text || null,
            sort_order: fallbackImage.sort_order ?? 0,
            is_main: true
          }, { onConflict: "inventory_item_id,image_url" });
        if (upsertResult.error) throw new Error(`Could not save main product photo: ${upsertResult.error.message}`);
      }

      await updateInventoryImageUrl(inventoryItemId, mainImageUrl);
    } else if (hasRemovedImages) {
      const resetResult = await client
        .from("inventory_item_images")
        .update({ is_main: false })
        .eq("inventory_item_id", inventoryItemId);
      if (resetResult.error) throw new Error(`Could not clear product gallery main photo: ${resetResult.error.message}`);
      await updateInventoryImageUrl(inventoryItemId, "", { allowEmpty: true });
    }

    removedProductImages = [];
    return mainImageUrl;
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
    setInventoryTab("add-product");
    productFormEl.reset();
    renderCategoryControls();
    productFormTitleEl.textContent = item ? "Edit inventory product" : "Add inventory product";
    fields.inventory_item_id.value = item?.id || "";
    fields.product_name.value = item?.product_name || "";
    fields.sku.value = item?.sku || "";
    if (fields.brand) fields.brand.value = item?.brand || "";
    fields.supplier.value = item?.supplier || "Sportco";
    fields.category.value = item?.category_id || "";
    if (fields.short_description) fields.short_description.value = item?.short_description || "";
    fields.description.value = item?.description || "";
    fields.cost_price.value = Number(item?.cost_price || 0).toFixed(2);
    fields.sell_price.value = Number(item?.sell_price || 0).toFixed(2);
    fields.quantity_on_hand.value = Number(item?.quantity_on_hand || 0);
    fields.low_stock_threshold.value = Number(item?.low_stock_threshold ?? 2);
    fields.need_order_threshold.value = Number(item?.need_order_threshold ?? 0);
    if (fields.track_stock) fields.track_stock.checked = item ? item.track_stock !== false && !item.is_order_to_sale : true;
    fields.visible_in_shop.checked = Boolean(item?.visible_in_shop);
    if (fields.is_order_to_sale) fields.is_order_to_sale.checked = Boolean(item?.is_order_to_sale) || item?.track_stock === false;
    if (fields.hidden_admin_only) fields.hidden_admin_only.checked = item ? !item.visible_in_shop : false;
    fields.is_active.checked = item?.is_active !== false;
    const existingImage = item?.image_url || item?.image || "";
    const imageWarning = existingImage.startsWith("data:")
      ? "Replace this image to optimise loading."
      : "";
    syncProductImageInputFiles([]);
    removedProductImages = [];
    currentProductImages = getItemImageRecords(item || {});
    selectedMainImageKey = currentProductImages.find((image) => image.is_main)
      ? getExistingImageKey(currentProductImages.find((image) => image.is_main), currentProductImages.findIndex((image) => image.is_main))
      : "";
    renderProductImagePicker();
    setMessage(productMessageEl, imageWarning, imageWarning ? "warning" : "");
    setMessage(productGstMessageEl, "");
    syncInventoryOptionControls();
  }

  function hideProductForm() {
    if (!productFormEl) return;
    productFormEl.reset();
    currentProductImages = [];
    syncProductImageInputFiles([]);
    removedProductImages = [];
    selectedMainImageKey = "";
    renderProductImagePicker();
    setMessage(productMessageEl, "");
    setMessage(productGstMessageEl, "");
    setInventoryTab("stock-list");
  }

  function syncInventoryOptionControls() {
    if (!productFormEl) return;
    const fields = productFormEl.elements;
    const isOrderToSale = Boolean(fields.is_order_to_sale?.checked);
    const hiddenAdminOnly = Boolean(fields.hidden_admin_only?.checked);

    if (fields.track_stock) {
      if (isOrderToSale) fields.track_stock.checked = false;
      else if (fields.track_stock.disabled && !fields.track_stock.checked) fields.track_stock.checked = true;
      fields.track_stock.disabled = isOrderToSale;
    }

    if (fields.visible_in_shop) {
      if (hiddenAdminOnly) fields.visible_in_shop.checked = false;
      fields.visible_in_shop.disabled = hiddenAdminOnly;
    }
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
    const fields = productFormEl.elements;
    const isOrderToSale = Boolean(fields.is_order_to_sale?.checked);
    const hiddenAdminOnly = Boolean(fields.hidden_admin_only?.checked);
    const trackStock = !isOrderToSale && Boolean(fields.track_stock?.checked);
    const visibleInShop = !hiddenAdminOnly && Boolean(fields.visible_in_shop?.checked);
    const imageFiles = getProductImageFiles();
    for (const imageFile of imageFiles) {
      const validationError = validateProductImage(imageFile);
      if (validationError) {
        setMessage(productMessageEl, validationError, "error");
        return;
      }
    }

    if (imageFiles.length > 1 && !(await inventoryImageGalleryIsReady())) {
      setMessage(productMessageEl, "Run the product gallery SQL migration before saving multiple photos.", "error");
      return;
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
      p_image: null,
      p_visible_in_shop: visibleInShop,
      p_is_active: Boolean(fields.is_active?.checked),
      p_brand: formData.get("brand"),
      p_short_description: formData.get("short_description"),
      p_track_stock: trackStock,
      p_is_order_to_sale: isOrderToSale,
      p_slug: null
    };

    const { data: savedItem, error } = await client.rpc("admin_save_inventory_item", payload);
    if (error) {
      setMessage(productMessageEl, error.message, "error");
      return;
    }

    try {
      await saveProductImageSelection(savedItem?.id, imageFiles);
    } catch (imageError) {
      setMessage(productMessageEl, imageError.message, "error");
      return;
    }

    const publicProductId = savedItem?.shop_product_id || "";
    const publishMessage = payload.p_visible_in_shop
      ? `Inventory saved. Public product created/updated${publicProductId ? `: ${publicProductId}` : "."}`
      : `Inventory saved. Public product${publicProductId ? ` ${publicProductId}` : ""} hidden.`;
    hideProductForm();
    await loadInventory();
    setMessage(productMessageEl, publishMessage, "success");
    setMessage(inventoryListMessageEl, publishMessage, "success");
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
    const qrCloseButton = event.target.closest("[data-inventory-qr-close]");
    if (qrCloseButton) {
      hideInventoryQr(qrCloseButton.dataset.inventoryQrClose);
      return;
    }

    const qrDownloadButton = event.target.closest("[data-inventory-qr-download]");
    if (qrDownloadButton) {
      await downloadInventoryQr(qrDownloadButton.dataset.inventoryQrDownload);
      return;
    }

    const qrPrintButton = event.target.closest("[data-inventory-qr-print]");
    if (qrPrintButton) {
      await printInventoryQr(qrPrintButton.dataset.inventoryQrPrint);
      return;
    }

    const menuToggle = event.target.closest("[data-inventory-menu-toggle]");
    if (menuToggle) {
      const menu = menuToggle.parentElement?.querySelector("[data-inventory-action-list]");
      const shouldOpen = Boolean(menu?.hidden);
      closeInventoryActionMenus();
      closeInventoryQrPanels();
      if (menu) {
        if (shouldOpen) positionInventoryActionMenu(menu, menuToggle);
        else menu.hidden = true;
        menuToggle.setAttribute("aria-expanded", String(shouldOpen));
      }
      return;
    }

    const button = event.target.closest("[data-inventory-action]");
    if (!button || !client) return;

    const row = button.closest("[data-inventory-item]");
    const item = inventoryItems.find((entry) => entry.id === row?.dataset.inventoryItem);
    if (!item) return;

    const action = button.dataset.inventoryAction;
    closeInventoryActionMenus();

    if (action === "edit") {
      showProductForm(item);
      return;
    }

    if (action === "adjust") {
      if (adjustItemEl) adjustItemEl.value = item.id;
      setInventoryTab("stock-adjustments");
      adjustFormEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (action === "qr") {
      await toggleInventoryQr(item.id);
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
        const { data, error } = await client.rpc("delete_inventory_item_if_safe", { p_inventory_item_id: item.id });
        if (error) {
          const message = /stock history|stock movements|orders|cannot be permanently deleted/i.test(error.message || "")
            ? DELETE_BLOCKED_MESSAGE
            : error.message;
          alert(message);
          if (message === DELETE_BLOCKED_MESSAGE) setMessage(inventoryListMessageEl, "");
          else setMessage(inventoryListMessageEl, message, "error");
          await loadInventory();
          button.disabled = false;
          return;
        }
        if (data === false) {
          alert(DELETE_BLOCKED_MESSAGE);
          setMessage(inventoryListMessageEl, "");
          await loadInventory();
          button.disabled = false;
          return;
        }
        setMessage(inventoryListMessageEl, `${item.product_name} was permanently deleted.`, "success");
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
  statusFilterEl?.addEventListener("change", () => {
    renderInventoryList();
  });
  supplierFilterEl?.addEventListener("change", () => {
    renderInventoryList();
  });
  showArchivedEl?.addEventListener("change", () => {
    renderInventoryList();
    renderAdjustmentSelect();
  });
  addProductBtnEls.forEach((button) => {
    button.addEventListener("click", () => showProductForm());
  });
  inventoryTabEls.forEach((button) => {
    button.addEventListener("click", () => {
      setInventoryTab(button.dataset.inventoryTab);
    });
  });
  cancelEditBtnEl?.addEventListener("click", hideProductForm);
  productFormEl?.addEventListener("submit", saveProduct);
  productFormEl?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-inventory-gst-action]");
    if (!button) return;
    handleInventoryGstAction(button.dataset.inventoryGstAction);
  });
  productFormEl?.addEventListener("change", (event) => {
    if (event.target.matches('[name="track_stock"], [name="visible_in_shop"], [name="is_order_to_sale"], [name="hidden_admin_only"]')) {
      syncInventoryOptionControls();
    }
  });
  productImageInputEl?.addEventListener("change", () => {
    syncProductImageInputFiles(Array.from(productImageInputEl.files || []));
    chooseAvailableMainImage();
    renderProductImagePicker();
  });
  productImageListEl?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const existingRemoveButton = target.closest("[data-product-remove-existing-image]");
    if (existingRemoveButton) {
      removeExistingProductImage(existingRemoveButton.dataset.productRemoveExistingImage || "");
      return;
    }

    const newRemoveButton = target.closest("[data-product-remove-new-image]");
    if (newRemoveButton) removeNewProductImage(Number(newRemoveButton.dataset.productRemoveNewImage));
  });
  productImageListEl?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-product-main-image]");
    if (!checkbox) return;
    selectedMainImageKey = checkbox.value;
    syncMainImageCheckboxes();
  });
  inventoryListEl?.addEventListener("click", handleInventoryAction);
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest("[data-inventory-qr-panel], [data-inventory-action-list], [data-inventory-menu-toggle], [data-inventory-action]")) {
      closeInventoryQrPanels();
      closeInventoryActionMenus();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeInventoryQrPanels();
    closeInventoryActionMenus();
  });
  window.addEventListener("resize", closeInventoryActionMenus);
  window.addEventListener("scroll", closeInventoryActionMenus, true);
  invoiceFormEl?.addEventListener("submit", uploadInvoice);
  invoiceReviewTableEl?.addEventListener("change", handleInvoiceReviewChange);
  invoiceReviewTableEl?.addEventListener("input", syncInvoiceReviewFromDom);
  invoiceReviewClearEl?.addEventListener("click", clearInvoiceReview);
  invoiceImportConfirmEl?.addEventListener("click", confirmInvoiceImport);
  reviewListEl?.addEventListener("click", handleReviewAction);
  adjustFormEl?.addEventListener("submit", saveStockAdjustment);
  settingsFormEl?.addEventListener("submit", saveInventorySettings);
  categoryFormEl?.addEventListener("submit", saveInventoryCategory);

  document.addEventListener("DOMContentLoaded", () => {
    loadProductCategories().then(loadInventory);
    loadInventorySettings();
  });
})();
