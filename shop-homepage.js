(function () {
  const productsKey = "kims_products";
  const defaultCategories = {
    "agility-kit": "Training",
    "power-bands": "Strength",
    "recovery-roller": "Recovery"
  };

  function normalizeCategory(value) {
    return String(value || "Uncategorized").trim().replace(/\s+/g, " ") || "Uncategorized";
  }

  function normalizeStoredProductCategories() {
    const raw = localStorage.getItem(productsKey);
    if (!raw) return;

    try {
      const products = JSON.parse(raw);
      if (!Array.isArray(products)) return;

      const normalizedProducts = products.map((product) => ({
        ...product,
        category: normalizeCategory(product.category || defaultCategories[product.id])
      }));

      localStorage.setItem(productsKey, JSON.stringify(normalizedProducts));
    } catch (error) {
      console.error("Could not normalize product categories", error);
    }
  }

  normalizeStoredProductCategories();
  if (typeof window.renderProducts === "function") window.renderProducts();
})();
