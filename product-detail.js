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
        <img src="${escapeHtml(images[0])}" alt="${escapeHtml(product.name)}" class="product-detail-image" decoding="async" fetchpriority="high" data-product-detail-main-image />
        ${thumbnails}
      </div>`;
  }

  function renderProduct(product) {
    const shop = window.KimsShop;
    const discounted = shop.getDiscountedPrice(product);
    const hasDiscount = Number(product.discount || 0) > 0;
    const outOfStock = shop.isProductOutOfStock(product);
    const stockText = shop.getProductStockText(product);
    document.title = `${product.name} | Kim Jones Coaching`;
    detailEl.innerHTML = `
      <article class="product-detail">
        <div class="product-detail-media">${getImageMarkup(product)}</div>
        <div class="product-detail-summary">
          <p class="eyebrow">${escapeHtml(product.category || "Shop")}</p>
          <h1>${escapeHtml(product.name || "Shop product")}</h1>
          <p class="product-detail-status">${escapeHtml(stockText)}</p>
          <div class="price-wrap product-detail-price">
            ${hasDiscount ? `<p class="old-price">${shop.money(Number(product.price))}</p>` : ""}
            <p class="price">${shop.money(discounted)} ${hasDiscount ? `<span class="discount-badge">-${Number(product.discount)}%</span>` : ""}</p>
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
      const quantity = Math.max(1, Number(detailEl.querySelector("#product-detail-quantity")?.value