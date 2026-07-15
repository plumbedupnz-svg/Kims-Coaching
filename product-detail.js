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

  function getImageMarkup(product) {
    if (product.image) {
      return `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" class="product-detail-image" decoding="async" fetchpriority="high" />`;
    }
    return '<div class="product-detail-image product-image-placeholder">No image</div>';
  }

  function renderProduct(product) {
    const shop = window.KimsShop;
    const discounted = shop.getDiscountedPrice(product);
    const hasDiscount = Number(product.discount || 0) > 0;
    const outOfStock = shop.isProductOutOfStock(product);
    const stockText = shop.getProductStockText(product);
    const availabilityNote = shop.getProductAvailabilityNote?.(product) || "";
    document.title = `${product.name} | Kim Jones Coaching`;
    detailEl.innerHTML = `
      <article class="product-detail">
        <div class="product-detail-media">${getImageMarkup(product)}</div>
        <div class="product-detail-summary">
          <p class="eyebrow">${escapeHtml(product.category || "Shop")}</p>
          <h1>${escapeHtml(product.name || "Shop product")}</h1>
          <p class="product-detail-status">${escapeHtml(stockText)}</p>
          ${availabilityNote ? `<p class="product-availability-note">${escapeHtml(availabilityNote)}</p>` : ""}
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
      const quantity = Math.max(1, Number(detailEl.querySelector("#product-detail-quantity")?.value || 1));
      const added = shop.addToCart(product, quantity);
      const message = detailEl.querySelector("[data-detail-message]");
      if (message && added) message.textContent = `${quantity} added to your cart.`;
    });
  }

  async function initProductDetail() {
    if (!requestedSlug) {
      renderNotFound();
      return;
    }
    try {
      const shop = window.KimsShop;
      if (!shop) throw new Error("Shop scripts are not loaded.");
      const requested = shop.getProductSlug({ slug: requestedSlug });
      const products = await shop.loadPublicProducts();
      const product = products.find((item) => shop.getProductSlug(item) === requested);
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
