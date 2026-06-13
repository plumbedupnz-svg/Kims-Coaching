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

  async function loadCategories() {
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
      categories = defaultCategories.map((name) => ({ id: "", name }));
      return categories;
    }

    if (!Array.isArray(data) || !data.length) {
      const seeded = await Promise.all(defaultCategories.map(saveCategory));
      categories = getUniqueCategories(seeded.filter(Boolean));
      return categories;
    }

    categories = getUniqueCategories(data);
    return categories;
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

  async function refreshCategoryControls(preferredFilterValue) {
    await loadCategories();
    renderAllCategoryControls(preferredFilterValue);
    window.dispatchEvent(new CustomEvent("kims:categories-ready", {
      detail: {
        categories: [...categories],
        preferredFilterValue: preferredFilterValue || lastSelectedFilterCategory || "all"
      }
    }));
    window.KimsRenderShopProducts?.();
  }

  window.KimsProductCategories = {
    refresh: refreshCategoryControls,
    getAll: () => [...categories],
    getName: getCategoryName,
    getIdByName: getCategoryIdByName,
    save: async (categoryName) => {
      const saved = await saveCategory(categoryName);
      await refreshCategoryControls(lastSelectedFilterCategory);
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

  renderAllCategoryControls();
  refreshCategoryControls();
  categorySelectEl?.addEventListener("focus", () => refreshCategoryControls());
  categoryFilterEl?.addEventListener("focus", () => refreshCategoryControls(lastSelectedFilterCategory));
})();
