(function () {
  const productsKey = "kims_products";
  const categoriesKey = "kims_categories";
  const defaultCategories = ["Recovery", "Strength", "Training"];
  const categorySelectEl = document.getElementById("owner-product-category");
  const categoryFilterEl = document.getElementById("category-filter");
  const newCategoryEl = document.getElementById("owner-new-category");
  const addCategoryBtnEl = document.getElementById("add-category-btn");
  const addProductFormEl = document.getElementById("owner-add-form");
  const supabaseSettings = window.KIMS_SUPABASE || {};
  const supabaseClient = supabaseSettings.url && supabaseSettings.anonKey && window.supabase
    ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
    : null;
  let lastSelectedFilterCategory = categoryFilterEl?.value || "all";

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

  function escapeAttribute(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function loadSupabaseCategories() {
    if (!supabaseClient) return [];

    const { data, error } = await supabaseClient
      .from("product_categories")
      .select("name")
      .order("name", { ascending: true });

    if (error) {
      console.warn("Could not load product categories from Supabase.", error.message);
      return [];
    }

    if (Array.isArray(data) && data.length) return data.map((category) => category.name);

    const { data: seededCategories, error: seedError } = await supabaseClient
      .from("product_categories")
      .upsert(
        defaultCategories.map((name) => ({ name, is_default: true })),
        { onConflict: "normalized_name" }
      )
      .select("name");

    if (seedError) return [];
    return Array.isArray(seededCategories) ? seededCategories.map((category) => category.name) : [];
  }

  async function saveCategoryToSupabase(category) {
    if (!supabaseClient) return "";
    const normalized = normalizeCategory(category);
    if (!normalized) return "";

    const { data: existingCategory, error: selectError } = await supabaseClient
      .from("product_categories")
      .select("name")
      .eq("normalized_name", normalized.toLowerCase())
      .maybeSingle();

    if (existingCategory?.name) return existingCategory.name;
    if (selectError) console.warn("Could not check product category in Supabase.", selectError.message);

    const isDefault = defaultCategories.some((defaultCategory) => defaultCategory.toLowerCase() === normalized.toLowerCase());
    const { data: createdCategory, error: insertError } = await supabaseClient
      .from("product_categories")
      .insert({ name: normalized, is_default: isDefault })
      .select("name")
      .single();

    if (insertError) {
      console.warn("Could not save product category in Supabase.", insertError.message);
      return "";
    }

    return createdCategory?.name || normalized;
  }

  async function syncCategoriesFromSupabase() {
    const supabaseCategories = await loadSupabaseCategories();
    if (!supabaseCategories.length) return loadCategories();
    const categories = getUniqueCategories([...loadCategories(), ...supabaseCategories]);
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

  function renderPublicCategoryFilter(preferredValue = lastSelectedFilterCategory) {
    if (!categoryFilterEl) return;
    const categories = loadCategories();
    const current = preferredValue || categoryFilterEl.value || "all";
    const options = [
      '<option value="all">All categories</option>',
      ...categories.map((category) => `<option value="${escapeAttribute(category)}">${escapeAttribute(category)}</option>`)
    ].join("");

    categoryFilterEl.innerHTML = options;
    categoryFilterEl.value = current === "all" || categories.some((category) => category.toLowerCase() === current.toLowerCase())
      ? current
      : "all";
  }

  function renderAllCategoryControls(preferredFilterValue) {
    renderCategoryOptions();
    renderPublicCategoryFilter(preferredFilterValue);
  }

  async function refreshCategoryControls(preferredFilterValue) {
    await syncCategoriesFromSupabase();
    renderAllCategoryControls(preferredFilterValue);
  }

  if (addCategoryBtnEl) addCategoryBtnEl.addEventListener("click", () => {
    const newCategory = normalizeCategory(newCategoryEl?.value);
    if (!newCategory) return;
    saveCategories([...loadCategories(), newCategory]);
    saveCategoryToSupabase(newCategory).then((savedCategory) => {
      if (savedCategory) saveCategories([...loadCategories(), savedCategory]);
      renderAllCategoryControls();
    });
    renderAllCategoryControls();
    categorySelectEl.value = newCategory;
  }, true);

  if (addProductFormEl) addProductFormEl.addEventListener("submit", () => {
    const selectedCategory = normalizeCategory(categorySelectEl?.value);
    if (selectedCategory) {
      saveCategories([...loadCategories(), selectedCategory]);
      saveCategoryToSupabase(selectedCategory).then((savedCategory) => {
        if (savedCategory) saveCategories([...loadCategories(), savedCategory]);
        renderAllCategoryControls();
      });
    }
  }, true);

  if (categoryFilterEl) categoryFilterEl.addEventListener("change", (event) => {
    lastSelectedFilterCategory = event.target.value;
    setTimeout(() => renderPublicCategoryFilter(lastSelectedFilterCategory), 0);
  }, true);

  renderAllCategoryControls();
  refreshCategoryControls();
  categorySelectEl?.addEventListener("focus", renderCategoryOptions);
  categoryFilterEl?.addEventListener("focus", () => renderPublicCategoryFilter());
  setTimeout(() => refreshCategoryControls(lastSelectedFilterCategory), 500);
})();
