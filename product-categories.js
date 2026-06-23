(function () {
  const defaultCategories = ["Recovery", "Strength", "Training", "Tennis Gear", "Accessories", "Other"];
  const categorySelectEl = document.getElementById("owner-product-category");
  const categoryFilterEl = document.getElementById("category-filter");
  const newCategoryEl = document.getElementById("owner-new-category");
  const addCategoryBtnEl = document.getElementById("add-category-btn");
  const supabaseSettings = window.KIMS_SUPABASE || {};
  const supabaseClient = supabaseSettings.url && supabaseSettings.anonKey && window.supabase
    ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
    : null;

  let categories = [];
  let lastSelectedFilterCategory = categoryFilterEl?.value || "all";
  let categoriesReady = false;
  let categoriesLoading = false;
  let categoriesError = "";
  let categoryLoadPromise = null;

  function normalizeCategory(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function escapeAttribute(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function getUniqueCategories(rows) {
    const byName = new Map();
    rows
      .filter((row) => row?.name)
      .forEach((row) => {
        const key = normalizeCategory(row.name).toLowerCase();
        if (!byName.has(key)) byName.set(key, { id: row.id || "", name: normalizeCategory(row.name) });
      });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async function saveCategory(categoryName) {
    const name = normalizeCategory(categoryName);
    if (!name || !supabaseClient) return null;

    const isDefault = defaultCategories.some((defaultCategory) => defaultCategory.toLowerCase() === name.toLowerCase());
    const { data, error } = await supabaseClient
      .from("product_categories")
      .upsert({ name, is_default: isDefault }, { onConflict: "normalized_name" })
      .select("id,name")
      .single();

    if (error) {
      console.warn("Could not save product category in Supabase.", error.message);
      return null;
    }

    return data;
  }

  async function loadCategories({ force = false } = {}) {
    if (!force && categoriesReady) return categories;
    if (categoryLoadPromise) return categoryLoadPromise;

    categoriesLoading = true;
    categoriesError = "";

    categoryLoadPromise = (async () => {
    if (!supabaseClient) {
      categories = defaultCategories.map((name) => ({ id: "", name }));
      return categories;
    }

    const { data, error } = await supabaseClient
      .from("product_categories")
      .select("id,name")
      .order("name", { ascending: true });

    if (error) {
      console.warn("Could not load product categories from Supabase.", error.message);
      categoriesError = "Could not load categories";
      if (!categoriesReady) categories = [];
      return categories;
    }

    if (!Array.isArray(data) || !data.length) {
      const seeded = await Promise.all(defaultCategories.map(saveCategory));
      categories = getUniqueCategories(seeded.filter(Boolean));
      return categories;
    }

    categories = getUniqueCategories(data);
    return categories;
    })();

    try {
      return await categoryLoadPromise;
    } finally {
      categoryLoadPromise = null;
      categoriesLoading = false;
    }
  }

  function getCategoryName(value) {
    const normalized = normalizeCategory(value);
    const byId = categories.find((category) => category.id === value);
    if (byId) return byId.name;
    const byName = categories.find((category) => category.name.toLowerCase() === normalized.toLowerCase());
    return byName?.name || normalized;
  }

  function getCategoryIdByName(value) {
    const normalized = normalizeCategory(value).toLowerCase();
    return categories.find((category) => category.name.toLowerCase() === normalized)?.id || "";
  }

  function renderCategoryOptions() {
    if (!categorySelectEl) return;
    const currentName = getCategoryName(categorySelectEl.value);
    if (categoriesError && !categories.length) {
      categorySelectEl.innerHTML = '<option value="">Could not load categories</option>';
      categorySelectEl.disabled = false;
      return;
    }

    categorySelectEl.innerHTML = '<option value="">Select category</option>' + categories
      .map((category) => `<option value="${escapeAttribute(category.name)}" data-category-id="${escapeAttribute(category.id)}">${escapeAttribute(category.name)}</option>`)
      .join("");
    if (categories.some((category) => category.name.toLowerCase() === currentName.toLowerCase())) {
      categorySelectEl.value = currentName;
    }
  }

  function renderPublicCategoryFilter(preferredValue = lastSelectedFilterCategory) {
    if (!categoryFilterEl) return;
    const currentName = preferredValue === "all" ? "all" : getCategoryName(preferredValue);
    if (categoriesError && !categories.length) {
      categoryFilterEl.innerHTML = '<option value="all">Could not load categories</option>';
      categoryFilterEl.value = "all";
      return;
    }

    categoryFilterEl.innerHTML = [
      '<option value="all">All categories</option>',
      ...categories.map((category) => `<option value="${escapeAttribute(category.name)}">${escapeAttribute(category.name)}</option>`)
    ].join("");
    categoryFilterEl.value = currentName === "all" || categories.some((category) => category.name.toLowerCase() === currentName.toLowerCase())
      ? currentName
      : "all";
  }

  function renderAllCategoryControls(preferredFilterValue) {
    renderCategoryOptions();
    renderPublicCategoryFilter(preferredFilterValue);
  }

  function renderCategoryLoadingState() {
    if (categoriesReady || categories.length) {
      renderAllCategoryControls(lastSelectedFilterCategory);
      return;
    }

    if (categorySelectEl) {
      categorySelectEl.innerHTML = '<option value="">Loading categories...</option>';
      categorySelectEl.disabled = true;
    }
    if (categoryFilterEl) {
      categoryFilterEl.innerHTML = '<option value="all">All categories</option>';
      categoryFilterEl.value = "all";
    }
  }

  async function refreshCategoryControls(preferredFilterValue, options = {}) {
    try {
      if (!categoriesReady && !categories.length) renderCategoryLoadingState();
      await loadCategories(options);
      categoriesReady = true;
      renderAllCategoryControls(preferredFilterValue);
      if (categorySelectEl) categorySelectEl.disabled = false;
    } catch (error) {
      console.warn("Could not refresh product categories.", error);
      categoriesReady = true;
    } finally {
      window.dispatchEvent(new CustomEvent("kims:categories-ready", {
        detail: {
          categories: [...categories],
          preferredFilterValue: preferredFilterValue || lastSelectedFilterCategory || "all"
        }
      }));
      window.KimsRenderShopProducts?.();
    }
  }

  window.KimsProductCategories = {
    refresh: refreshCategoryControls,
    getAll: () => [...categories],
    isReady: () => categoriesReady,
    getError: () => categoriesError,
    getName: getCategoryName,
    getIdByName: getCategoryIdByName,
    save: async (categoryName) => {
      const saved = await saveCategory(categoryName);
      await refreshCategoryControls(lastSelectedFilterCategory, { force: true });
      return saved;
    }
  };

  if (addCategoryBtnEl) addCategoryBtnEl.addEventListener("click", async () => {
    const newCategory = normalizeCategory(newCategoryEl?.value);
    if (!newCategory) return;
    const saved = await window.KimsProductCategories.save(newCategory);
    if (newCategoryEl) newCategoryEl.value = "";
    if (categorySelectEl) categorySelectEl.value = saved?.name || newCategory;
  }, true);

  if (categoryFilterEl) categoryFilterEl.addEventListener("change", (event) => {
    lastSelectedFilterCategory = event.target.value;
  }, true);

  renderCategoryLoadingState();
  refreshCategoryControls();
})();
