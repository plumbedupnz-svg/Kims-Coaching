(function () {
  const productsKey = "kims_products";
  const categoriesKey = "kims_categories";
  const defaultCategories = ["Recovery", "Strength", "Training"];
  const categorySelectEl = document.getElementById("owner-product-category");
  const newCategoryEl = document.getElementById("owner-new-category");
  const addCategoryBtnEl = document.getElementById("add-category-btn");
  const addProductFormEl = document.getElementById("owner-add-form");

  function normalizeCategory(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function getUniqueCategories(categories) {
    const categoriesByLowercase = new Map();

    categories
      .map(normalizeCategory)
      .filter(Boolean)
      .forEach((category) => {
        const key = category.toLowerCase();
        if (!categoriesByLowercase.has(key)) categoriesByLowercase.set(key, category);
      });

    return [...categoriesByLowercase.values()].sort((a, b) => a.localeCompare(b));
  }

  function loadJsonArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveCategories(categories) {
    localStorage.setItem(categoriesKey, JSON.stringify(getUniqueCategories(categories)));
  }

  function loadCategories() {
    const products = loadJsonArray(productsKey);
    const storedCategories = loadJsonArray(categoriesKey);
    const productCategories = products.map((product) => product.category);
    const categories = getUniqueCategories([...defaultCategories, ...storedCategories, ...productCategories]);

    saveCategories(categories);
    return categories;
  }

  function upsertCategoryOption(category) {
    if (!categorySelectEl) return;
    const normalized = normalizeCategory(category);
    if (!normalized) return;

    const exists = [...categorySelectEl.options].some(
      (option) => option.value.toLowerCase() === normalized.toLowerCase()
    );

    if (!exists) {
      const option = document.createElement("option");
      option.value = normalized;
      option.textContent = normalized;
      categorySelectEl.appendChild(option);
    }
  }

  function renderCategoryOptions() {
    if (!categorySelectEl) return;
    const current = categorySelectEl.value;
    categorySelectEl.innerHTML = '<option value="">Select category</option>';
    loadCategories().forEach(upsertCategoryOption);

    const matchingOption = [...categorySelectEl.options].find(
      (option) => option.value.toLowerCase() === current.toLowerCase()
    );
    if (matchingOption) categorySelectEl.value = matchingOption.value;
  }

  if (addCategoryBtnEl) addCategoryBtnEl.addEventListener("click", () => {
    const newCategory = normalizeCategory(newCategoryEl?.value);
    if (!newCategory) return;
    saveCategories([...loadCategories(), newCategory]);
    renderCategoryOptions();
    categorySelectEl.value = newCategory;
  }, true);

  if (addProductFormEl) addProductFormEl.addEventListener("submit", () => {
    const selectedCategory = normalizeCategory(categorySelectEl?.value);
    if (selectedCategory) saveCategories([...loadCategories(), selectedCategory]);
  }, true);

  renderCategoryOptions();
  categorySelectEl?.addEventListener("focus", renderCategoryOptions);
  setTimeout(renderCategoryOptions, 500);
})();
