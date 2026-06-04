(function () {
  const productsKey = "kims_products";
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const ownerStatusEl = document.getElementById("owner-status");
  const ownerAddFormEl = document.getElementById("owner-add-form");
  const ownerProductNameEl = document.getElementById("owner-product-name");
  const ownerProductPriceEl = document.getElementById("owner-product-price");
  const ownerProductDiscountEl = document.getElementById("owner-product-discount");
  const ownerProductCategoryEl = document.getElementById("owner-product-category");
  const ownerProductDescEl = document.getElementById("owner-product-desc");
  const ownerProductImageEl = document.getElementById("owner-product-image");
  const ownerProductsListEl = document.getElementById("owner-products-list");

  function setMessage(message) {
    if (ownerStatusEl) ownerStatusEl.textContent = message;
  }

  function normalizeCategory(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.readAsDataURL(file);
    });
  }

  function mapProduct(row) {
    return {
      id: row.id,
      name: row.name || "",
      price: Number(row.price || 0),
      discount: Number(row.discount || 0),
      category: row.product_categories?.name || "Uncategorized",
      category_id: row.category_id || null,
      description: row.description || "",
      image: row.image_url || "",
      image_url: row.image_url || "",
      is_active: row.is_active !== false
    };
  }

  function saveProducts(products) {
    localStorage.setItem(productsKey, JSON.stringify(products));
  }

  function loadProducts() {
    try {
      const products = JSON.parse(localStorage.getItem(productsKey) || "[]");
      return Array.isArray(products) ? products : [];
    } catch {
      return [];
    }
  }

  function rerenderProducts() {
    window.renderProducts?.();
    window.renderOwnerProducts?.();
    window.renderCart?.();
  }

  async function loadProductsFromSupabase() {
    if (!client) return loadProducts();

    const { data, error } = await client
      .from("products")
      .select("id,name,description,price,discount,image_url,is_active,category_id,product_categories(name)")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(`Products could not load from Supabase: ${error.message}`);
      console.error("Could not load products from Supabase", error);
      return loadProducts();
    }

    const products = Array.isArray(data) ? data.map(mapProduct) : [];
    saveProducts(products);
    rerenderProducts();
    return products;
  }

  async function getOrCreateCategoryId(categoryName) {
    const name = normalizeCategory(categoryName);
    if (!name) throw new Error("Select a product category.");

    const { data: existingCategory, error: selectError } = await client
      .from("product_categories")
      .select("id,name")
      .eq("normalized_name", name.toLowerCase())
      .maybeSingle();

    if (existingCategory?.id) return existingCategory.id;
    if (selectError) console.warn("Could not check product category in Supabase.", selectError.message);

    const { data: createdCategory, error: insertError } = await client
      .from("product_categories")
      .insert({ name })
      .select("id")
      .single();

    if (insertError) throw new Error(`Category could not be saved: ${insertError.message}`);
    return createdCategory.id;
  }

  async function createProduct(event) {
    if (!client || !ownerAddFormEl) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const selectedFile = ownerProductImageEl?.files?.[0];
    let imageUrl = "";

    if (selectedFile) {
      if (!selectedFile.type.startsWith("image/")) {
        setMessage("Please select a valid image file.");
        return;
      }
      if (selectedFile.size > 2 * 1024 * 1024) {
        setMessage("Image is too large. Please use a file under 2MB.");
        return;
      }
      imageUrl = await fileToDataUrl(selectedFile);
    }

    const product = {
      name: ownerProductNameEl?.value.trim() || "",
      price: Number(ownerProductPriceEl?.value),
      discount: Number(ownerProductDiscountEl?.value || 0),
      category: normalizeCategory(ownerProductCategoryEl?.value || ""),
      description: ownerProductDescEl?.value.trim() || "",
      image_url: imageUrl
    };

    if (
      !product.name ||
      !product.category ||
      Number.isNaN(product.price) ||
      product.price < 0 ||
      Number.isNaN(product.discount) ||
      product.discount < 0 ||
      product.discount > 100
    ) {
      setMessage("Please enter valid name, category, price, and discount (0-100).");
      return;
    }

    const submitButton = ownerAddFormEl.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    setMessage("Saving product to Supabase...");

    try {
      const categoryId = await getOrCreateCategoryId(product.category);
      const { error } = await client.from("products").insert({
        category_id: categoryId,
        name: product.name,
        description: product.description,
        price: product.price,
        discount: product.discount,
        image_url: product.image_url,
        is_active: true
      });

      if (error) throw new Error(`Product could not be saved: ${error.message}`);

      ownerAddFormEl.reset();
      await loadProductsFromSupabase();
      setMessage("Product saved to Supabase.");
    } catch (error) {
      setMessage(error.message || "Product could not be saved.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function updateProduct(productId, patch) {
    const { error } = await client
      .from("products")
      .update(patch)
      .eq("id", productId);

    if (error) throw new Error(`Product update failed: ${error.message}`);
  }

  async function handleProductChange(event) {
    if (!client) return;
    const priceInput = event.target.closest(".owner-price-input");
    const discountInput = event.target.closest(".owner-discount-input");
    if (!priceInput && !discountInput) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const input = priceInput || discountInput;
    const value = Number(input.value);
    const patch = {};

    if (priceInput) {
      if (Number.isNaN(value) || value < 0) {
        setMessage("Enter a valid product price.");
        return;
      }
      patch.price = value;
    }

    if (discountInput) {
      if (Number.isNaN(value) || value < 0 || value > 100) {
        setMessage("Enter a valid discount between 0 and 100.");
        return;
      }
      patch.discount = value;
    }

    try {
      await updateProduct(input.dataset.id, patch);
      await loadProductsFromSupabase();
      setMessage("Product updated in Supabase.");
    } catch (error) {
      setMessage(error.message || "Product could not be updated.");
    }
  }

  async function handleProductDelete(event) {
    if (!client) return;
    const button = event.target.closest(".owner-remove-btn");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;

    try {
      const { error } = await client
        .from("products")
        .delete()
        .eq("id", button.dataset.id);

      if (error) throw new Error(`Product delete failed: ${error.message}`);

      saveProducts(loadProducts().filter((product) => product.id !== button.dataset.id));
      await loadProductsFromSupabase();
      setMessage("Product deleted from Supabase.");
    } catch (error) {
      setMessage(error.message || "Product could not be deleted.");
      button.disabled = false;
    }
  }

  ownerAddFormEl?.addEventListener("submit", createProduct, true);
  ownerProductsListEl?.addEventListener("change", handleProductChange, true);
  ownerProductsListEl?.addEventListener("click", handleProductDelete, true);

  loadProductsFromSupabase();
  window.KimsProductPersistence = { loadProductsFromSupabase };
})();
