(function () {
  const detailEl = document.querySelector("[data-product-detail]");
  if (!detailEl) return;

  const params = new URLSearchParams(window.location.search);
  const requestedSlug = params.get("slug") || "";

  function escapeHtml(value = "") {
    return window.KimsShop?.escapeHtml
      ? window.KimsShop.escapeHtml(value)
      : String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function normalizeProductSlug(value = "") {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90);
  }

  function isTruthy(value) {
    return value === true || String(value).trim().toLowerCase() === "true" || value === 1 || value === "1";
  }

  function isFalsy(value) {
    return value === false || String(value).trim().toLowerCase() === "false" || value === 0 || value === "0";
  }

  function getProductName(product = {}) {
    return product.name || product.product_name || "Shop product";
  }

  function getProductSlug(product = {}) {
    try {
      const helperSlug = window.KimsShop?.getProductSlug?.(product);
      if (helperSlug) return normalizeProductSlug(helperSlug);
    } catch (error) {
      console.warn("Could not build product slug with shop helper.", error);
    }

    const savedSlug = normalizeProductSlug(product.slug || "");
    if (savedSlug) return savedSlug;
    const base = normalizeProductSlug(getProductName(product)) || "product";
    const suffix = String(product.id || product.inventory_item_id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
    return suffix ? `${base}-${suffix.toLowerCase()}` : base;
  }

  function getProductSlugCandidates(product = {}) {
    const name = getProductName(product);
    const suffix = String(product.id || product.inventory_item_id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
    const candidates = [
      product.slug,
      getProductSlug(product),
      suffix ? `${name}-${suffix}` : "",
      product.inventory_item_id,
      product.id
    ];
    return [...new Set(candidates.map(normalizeProductSlug).filter(Boolean))];
  }

  function normalizeProductGalleryImages(product = {}) {
    const rawImages = [
      ...(Array.isArray(product.inventory_item_images) ? product.inventory_item_images : []),
      ...(Array.isArray(product.product_images) ? product.product_images : []),
      ...(Array.isArray(product.images) ? product.images.map((image, index) => ({ image_url: image, sort_order: index })) : []),
      product.image_url ? { image_url: product.image_url, is_main: true, sort_order: -1 } : null,
      product.image ? { image_url: product.image, is_main: true, sort_order: -1 } : null
    ].filter(Boolean);

    const seen = new Set();
    return rawImages
      .map((image, index) => ({
        image_url: String(image.image_url || image.url || image.image || "").trim(),
        is_main: isTruthy(image.is_main),
        sort_order: Number(image.sort_order ?? index)
      }))
      .filter((image) => {
        if (!image.image_url || seen.has(image.image_url)) return false;
        seen.add(image.image_url);
        return true;
      })
      .sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.sort_order - b.sort_order);
  }

  function normalizeProduct(product = {}) {
    const name = getProductName(product);
    const galleryImages = normalizeProductGalleryImages(product);
    const imageUrl = galleryImages.find((image) => image.is_main)?.image_url
      || galleryImages[0]?.image_url
      || "";
    const trackStock = product.track_stock !== false && !isTruthy(product.is_order_to_sale);
    const isOrderToSale = isTruthy(product.is_order_to_sale) || product.fulfilment_type === "order_to_sale" || !trackStock;

    return {
      ...product,
      id: product.id || product.inventory_item_id || "",
      inventory_item_id: product.inventory_item_id || product.id || "",
      name,
      product_name: product.product_name || name,
      category: product.product_categories?.name || product.category || "Uncategorized",
      price: Number(product.price ?? product.sell_price ?? 0),
      purchase_price: Number(product.purchase_price ?? product.cost_price ?? 0),
      cost_price: Number(product.cost_price ?? product.purchase_price ?? 0),
      discount: Number(product.discount || 0),
      description: product.full_description || product.description || product.short_description || "",
      short_description: product.short_description || "",
      image: imageUrl,
      image_url: imageUrl,
      images: galleryImages.map((image) => image.image_url),
      product_images: galleryImages,
      quantity_on_hand: Number(product.quantity_on_hand ?? 0),
      stock_status: product.stock_status || product.status || "out_of_stock",
      fulfilment_type: isOrderToSale ? "order_to_sale" : "stock",
      visible_in_shop: !isFalsy(product.visible_in_shop),
      is_active: !isFalsy(product.is_active),
      archived_at: product.archived_at || null
    };
  }

  function money(value) {
    if (window.KimsShop?.money) return window.KimsShop.money(Number(value || 0));
    return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(Number(value || 0));
  }

  function getDiscountedPrice(product = {}) {
    if (window.KimsShop?.getDiscountedPrice) return window.KimsShop.getDiscountedPrice(product);
    const base = Number(product.price || 0);
    const discount = Number(product.discount || 0);
    return discount > 0 ? Math.max(0, base * (1 - discount / 100)) : base;
  }

  function isProductOutOfStock(product = {}) {
    if (window.KimsShop?.isProductOutOfStock) return window.KimsShop.isProductOutOfStock(product);
    if (product.fulfilment_type === "order_to_sale") return false;
    return Number(product.quantity_on_hand || 0) <= 0 || product.stock_status === "out_of_stock";
  }

  function getProductStockText(product = {}) {
    if (window.KimsShop?.getProductStockText) return window.KimsShop.getProductStockText(product);
    if (product.fulfilment_type === "order_to_sale") return "Available to order";
    const quantity = Number(product.quantity_on_hand || 0);
    if (quantity <= 0 || product.stock_status === "out_of_stock") return "Out of stock";
    if (product.stock_status === "low_stock") return `Low stock - ${quantity} left`;
    if (product.stock_status === "need_order" || product.stock_status === "need_to_order") return `Need to order - ${quantity} left`;
    return `${quantity} in stock`;
  }

  function renderNotFound() {
    document.title = "Product not found | Kim Jones Coaching";
    detailEl.innerHTML = `
      <div class="product-not-found">
        <p class="eyebrow">Shop</p>
        <h1>Product not found</h1>
        <p class="helper-text">This product may have moved, sold out, or been removed from the shop.</p>
        <a class="btn btn-primary" href="shop.html">Back to Shop</a>
      </div>`;
  }

  function getProductImages(product) {
    const urls = [
      ...(Array.isArray(product.product_images) ? product.product_images.map((image) => image.image_url || image.url || image.image) : []),
      ...(Array.isArray(product.images) ? product.images : []),
      product.image
    ]
      .map((url) => String(url || "").trim())
      .filter(Boolean);
    return [...new Set(urls)];
  }

  function getImageMarkup(product) {
    const images = getProductImages(product);
    if (!images.length) return '<div class="product-detail-image product-image-placeholder">No image</div>';
    const thumbnails = images.length > 1
      ? `<div class="product-detail-thumbs" aria-label="Product photos">
          ${images.map((image, index) => `
            <button class="product-detail-thumb ${index === 0 ? "active" : ""}" type="button" data-product-detail-thumb="${escapeHtml(image)}" aria-label="Show photo ${index + 1}">
              <img src="${escapeHtml(image)}" alt="" />
            </button>
          `).join("")}
        </div>`
      : "";
    return `
      <div class="product-detail-gallery">
        <img src="${escapeHtml(images[0])}" alt="${escapeHtml(getProductName(product))}" class="product-detail-image" decoding="async" fetchpriority="high" data-product-detail-main-image />
        ${thumbnails}
      </div>`;
  }

  function renderProduct(product) {
    const name = getProductName(product);
    const discounted = getDiscountedPrice(product);
    const hasDiscount = Number(product.discount || 0) > 0;
    const outOfStock = isProductOutOfStock(product);
    const stockText = getProductStockText(product);
    document.title = `${name} | Kim Jones Coaching`;
    detailEl.innerHTML = `
      <article class="product-detail">
        <div class="product-detail-media">${getImageMarkup(product)}</div>
        <div class="product-detail-summary">
          <p class="eyebrow">${escapeHtml(product.category || "Shop")}</p>
          <h1>${escapeHtml(name)}</h1>
          <p class="product-detail-status">${escapeHtml(stockText)}</p>
          <div class="price-wrap product-detail-price">
            ${hasDiscount ? `<p class="old-price">${money(Number(product.price))}</p>` : ""}
            <p class="price">${money(discounted)} ${hasDiscount ? `<span class="discount-badge">-${Number(product.discount)}%</span>` : ""}</p>
          </div>
          <label class="product-quantity-label" for="product-detail-quantity">Quantity</label>
          <input id="product-detail-quantity" class="product-detail-quantity" type="number" min="1" step="1" value="1" ${outOfStock ? "disabled" : ""} />
          <div class="product-detail-actions">
            <button class="btn btn-primary" type="button" data-detail-add-to-cart ${outOfStock ? "disabled" : ""}>${outOfStock ? "Out of stock" : "Add to Cart"}</button>
            <a class="btn btn-secondary" href="shop.html">Continue Shopping</a>
            <a class="btn btn-secondary" href="#cart">Checkout / View Cart</a>
          </div>
          <p class="helper-text" data-detail-message></p>
        </div>
        <section class="product-detail-description">
          <h2>Product details</h2>
          <p>${escapeHtml(product.description || product.short_description || "No product description available.")}</p>
        </section>
      </article>`;

    detailEl.querySelector("[data-detail-add-to-cart]")?.addEventListener("click", () => {
      const quantity = Math.max(1, Number(detailEl.querySelector("#product-detail-quantity")?.value || 1));
      const message = detailEl.querySelector("[data-detail-message]");
      if (!window.KimsShop?.addToCart) {
        if (message) message.textContent = "Cart is still loading. Please refresh and try again.";
        return;
      }
      const added = window.KimsShop.addToCart(product, quantity);
      if (message && added) message.textContent = `${quantity} added to your cart.`;
    });

    detailEl.querySelectorAll("[data-product-detail-thumb]").forEach((button) => {
      button.addEventListener("click", () => {
        const image = button.dataset.productDetailThumb || "";
        const mainImage = detailEl.querySelector("[data-product-detail-main-image]");
        if (mainImage && image) mainImage.src = image;
        detailEl.querySelectorAll("[data-product-detail-thumb]").forEach((thumb) => thumb.classList.toggle("active", thumb === button));
      });
    });
  }

  async function loadProductCandidates() {
    try {
      const products = await window.KimsShop?.loadPublicProducts?.();
      if (Array.isArray(products) && products.length) return products.map(normalizeProduct);
    } catch (error) {
      console.warn("Could not load product detail through shop helper; trying API cache.", error);
    }

    const response = await fetch("/api/shop-products", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Product request failed with ${response.status}.`);
    const data = await response.json();
    return (Array.isArray(data?.products) ? data.products : []).map(normalizeProduct);
  }

  async function initProductDetail() {
    if (!requestedSlug) {
      renderNotFound();
      return;
    }
    try {
      const requested = normalizeProductSlug(requestedSlug);
      const products = await loadProductCandidates();
      const product = products.find((item) => getProductSlugCandidates(item).includes(requested));
      if (!product) {
        renderNotFound();
        return;
      }
      renderProduct(product);
    } catch (error) {
      console.error("Could not load product detail.", error);
      detailEl.innerHTML = `<p class="empty-cart">Could not load this product: ${escapeHtml(error.message)}</p>`;
    }
  }

  initProductDetail();
})();
