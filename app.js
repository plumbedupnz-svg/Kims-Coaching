const CART_KEY = "kims_cart";
const STRIPE_KEY = "kims_stripe_link";
const PRODUCTS_KEY = "kims_products";
const PROMO_SETTINGS_KEY = "kims_promo_settings";
const APPLIED_PROMO_CODE_KEY = "kims_applied_promo_code";

const defaultProducts = [
  { id: "agility-kit", name: "Speed Agility Kit", price: 59.99, discount: 0, category: "Training", description: "Cones, ladder, and bands for movement sessions.", image: "" },
  { id: "power-bands", name: "Resistance Power Bands", price: 29.99, discount: 0, category: "Strength", description: "Warmup and strength band set.", image: "" },
  { id: "recovery-roller", name: "Recovery Roller", price: 34.99, discount: 0, category: "Recovery", description: "Compact roller for post-session recovery.", image: "" }
];

const productListEl = document.getElementById("product-list");
const cartItemsEl = document.getElementById("cart-items");
const subtotalEl = document.getElementById("subtotal");
const taxEl = document.getElementById("tax");
const totalEl = document.getElementById("total");
const stripeInputEl = document.getElementById("stripe-link");
const checkoutBtnEl = document.getElementById("checkout-btn");
const clearCartBtnEl = document.getElementById("clear-cart-btn");
const promoDiscountEl = document.getElementById("promo-discount");
const promoCodeEl = document.getElementById("promo-code");
const applyPromoBtnEl = document.getElementById("apply-promo-btn");
const promoMessageEl = document.getElementById("promo-message");
const checkoutAccountMessageEl = document.getElementById("checkout-account-message");

const ownerStatusEl = document.getElementById("owner-status");
const ownerPanelEl = document.getElementById("owner-panel");
const ownerAddFormEl = document.getElementById("owner-add-form");
const ownerProductNameEl = document.getElementById("owner-product-name");
const ownerProductPriceEl = document.getElementById("owner-product-price");
const ownerProductDiscountEl = document.getElementById("owner-product-discount");
const ownerProductCategoryEl = document.getElementById("owner-product-category");
const ownerProductDescEl = document.getElementById("owner-product-desc");
const ownerProductImageEl = document.getElementById("owner-product-image");
const ownerProductsListEl = document.getElementById("owner-products-list");
const categoryFilterEl = document.getElementById("category-filter");
const ownerProductCategorySelectEl = document.getElementById("owner-product-category");
const ownerNewCategoryEl = document.getElementById("owner-new-category");
const addCategoryBtnEl = document.getElementById("add-category-btn");
const ownerPromoFormEl = document.getElementById("owner-promo-form");
const ownerPromoCodeEl = document.getElementById("owner-promo-code");
const ownerPromoPercentEl = document.getElementById("owner-promo-percent");
const ownerPromoStatusEl = document.getElementById("owner-promo-status");
const authFormEl = document.querySelector("[data-auth-form]");
const authMessageEl = document.querySelector("[data-auth-message]");
const authTitleEl = document.querySelector("[data-auth-title]");
const authCopyEl = document.querySelector("[data-auth-copy]");
const authSubmitEl = document.querySelector("[data-submit-auth]");
const modeSwitchEl = document.querySelector(".mode-switch");
const emailFieldEl = document.querySelector("[data-email-field]");
const nameFieldEl = document.querySelector("[data-name-field]");
const lastNameFieldEl = document.querySelector("[data-last-name-field]");
const phoneFieldEl = document.querySelector("[data-phone-field]");
const loginActionsEl = document.querySelector("[data-login-actions]");
const forgotPasswordEl = document.querySelector("[data-forgot-password]");
const authSectionEl = document.querySelector("[data-auth-section]");
const customerAreaEl = document.querySelector("[data-customer-area]");
const customerGreetingEl = document.querySelector("[data-customer-greeting]");
const customerDetailsEl = document.querySelector("[data-customer-details]");
const customerCartEl = document.querySelector("[data-customer-cart]");
const profileFormEl = document.querySelector("[data-profile-form]");
const profileMessageEl = document.querySelector("[data-profile-message]");
const playerCountEl = document.querySelector("[data-player-count]");
const playersListEl = document.querySelector("[data-players-list]");
const publicAuthEls = document.querySelectorAll("[data-auth-public]");
const privateAuthEls = document.querySelectorAll("[data-auth-private]");
const signOutEls = document.querySelectorAll("[data-sign-out]");
const menuToggleEl = document.querySelector("[data-menu-toggle]");
const navLinksEl = document.querySelector("[data-nav-links]");

const money = (v) => `$${v.toFixed(2)}`;
const slugify = (v) => v.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
const isAdminPage = Boolean(document.body?.classList.contains("admin-page") || document.getElementById("owner-panel"));
const isShopPage = Boolean(productListEl);
let selectedCategory = "all";
const urlParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const isPasswordRecovery = urlParams.get("type") === "recovery" || hashParams.get("type") === "recovery" || urlParams.get("mode") === "reset";
let authMode = isPasswordRecovery ? "reset" : urlParams.get("mode") === "signup" ? "signup" : "login";
let currentUser = null;
let currentProfile = null;
let shopInventorySettings = { hide_out_of_stock: false };
let shopLoadDebug = {
  source: "not_loaded",
  rowsReturned: 0,
  rowsAfterFilters: 0,
  rowsSentToRenderer: 0,
  rowsAfterVisibilityFilter: 0,
  rowsAfterCategoryFilter: 0,
  filters: "",
  error: ""
};
let publicShopProducts = null;
let initialShopRenderComplete = false;

const tennisLevelOptions = ["Beginner", "Developing", "Interclub", "Tournament"];

const supabaseSettings = window.KIMS_SUPABASE || {};
const hasSupabaseConfig = Boolean(supabaseSettings.url && supabaseSettings.anonKey && window.supabase);
const supabaseClient = hasSupabaseConfig
  ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
  : null;

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeShopProduct(row) {
  const inventory = row.inventory_items || {};
  const category = row.product_categories?.name || inventory.product_categories?.name || row.category || inventory.category || "Uncategorized";
  const hasInventoryRow = Boolean(inventory.id);
  return {
    id: row.id,
    inventory_item_id: row.inventory_item_id || inventory.id || "",
    name: row.name || inventory.product_name,
    price: Number(row.price || 0),
    discount: Number(row.discount || 0),
    category,
    category_id: row.category_id || inventory.category_id || row.product_categories?.id || inventory.product_categories?.id || "",
    description: row.description || inventory.description || "",
    image: row.image || inventory.image || "",
    is_active: row.is_active !== false && inventory.is_active !== false,
    quantity_on_hand: Number(inventory.quantity_on_hand ?? row.quantity_on_hand ?? 0),
    stock_status: inventory.status || row.stock_status || row.status || "out_of_stock",
    visible_in_shop: hasInventoryRow ? inventory.visible_in_shop !== false : row.visible_in_shop !== false,
    archived_at: inventory.archived_at || row.archived_at || null
  };
}

function isTruthy(value) {
  return value === true || String(value).trim().toLowerCase() === "true" || value === 1 || value === "1";
}

function isFalsy(value) {
  return value === false || String(value).trim().toLowerCase() === "false" || value === 0 || value === "0";
}

function normalizeInventoryShopProduct(row) {
  const category = row.product_categories?.name || row.category || "Uncategorized";
  const inventoryId = row.inventory_item_id || row.id || "";
  return {
    id: row.shop_product_id || row.id || (inventoryId ? `inv-${inventoryId}` : `shop-${Date.now()}`),
    inventory_item_id: inventoryId,
    name: row.product_name || row.name || "Unnamed product",
    price: Number(row.sell_price ?? row.price ?? 0),
    discount: Number(row.discount || 0),
    category,
    category_id: row.category_id || row.product_categories?.id || "",
    description: row.description || "",
    image: row.image || "",
    is_active: !isFalsy(row.is_active),
    quantity_on_hand: Number(row.quantity_on_hand ?? 0),
    stock_status: row.status || row.stock_status || "out_of_stock",
    visible_in_shop: isTruthy(row.visible_in_shop),
    archived_at: row.archived_at || null,
    source_row: "inventory_items"
  };
}

async function loadPublicInventoryProducts() {
  const filters = "visible_in_shop=true,is_active=true,archived_at=null";
  const result = await supabaseClient
    .from("inventory_items")
    .select("id, shop_product_id, product_name, category, category_id, description, image, sell_price, quantity_on_hand, status, visible_in_shop, is_active, archived_at, product_categories:category_id(id,name)")
    .eq("visible_in_shop", true)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("product_name", { ascending: true });

  shopLoadDebug = {
    source: "inventory_items",
    rowsReturned: Array.isArray(result.data) ? result.data.length : 0,
    rowsAfterFilters: Array.isArray(result.data) ? result.data.length : 0,
    rowsSentToRenderer: 0,
    rowsAfterVisibilityFilter: 0,
    rowsAfterCategoryFilter: 0,
    filters,
    error: result.error?.message || ""
  };

  if (result.error) return result;

  const products = (result.data || [])
    .map(normalizeInventoryShopProduct)
    .filter((product) => {
      if (shopInventorySettings.hide_out_of_stock) return !isProductOutOfStock(product);
      return true;
    });

  shopLoadDebug.rowsAfterFilters = products.length;
  console.log("RAW ROWS", result.data || []);
  console.log("FIRST SHOP ROW", result.data?.[0] || null);
  console.log("AFTER PUBLIC FILTER", products);
  console.info("[Kim Shop] inventory rows loaded", {
    rowsLoaded: result.data.length,
    rowsAfterHideOutOfStockFilter: products.length,
    hideOutOfStock: shopInventorySettings.hide_out_of_stock,
    sample: result.data.slice(0, 3)
  });
  return { data: products, error: null };
}

function setPublicShopProducts(products) {
  publicShopProducts = Array.isArray(products) ? products.map(normalizeInventoryShopProduct) : [];
  shopLoadDebug.rowsSentToRenderer = publicShopProducts.length;
  console.info("[Kim Shop] rows sent to renderer", {
    rowsSentToRenderer: publicShopProducts.length,
    sample: publicShopProducts.slice(0, 3).map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      category_id: product.category_id,
      visible_in_shop: product.visible_in_shop,
      is_active: product.is_active,
      archived_at: product.archived_at,
      quantity_on_hand: product.quantity_on_hand
    }))
  });
  saveProducts(publicShopProducts);
  return publicShopProducts;
}

function getCurrentShopProducts() {
  if (isShopPage && Array.isArray(publicShopProducts)) return publicShopProducts;
  return loadProducts();
}

async function syncShopProductsFromSupabase() {
  if (!supabaseClient) return loadProducts();
  if (!isShopPage) return loadProducts();

  const settingsResult = await supabaseClient
    .from("shop_inventory_settings")
    .select("hide_out_of_stock")
    .eq("id", true)
    .maybeSingle();

  if (!settingsResult.error && settingsResult.data) {
    shopInventorySettings = settingsResult.data;
  }

  const inventoryProductResult = await loadPublicInventoryProducts();
  if (inventoryProductResult.error) {
    shopLoadDebug = {
      source: "inventory_items",
      rowsReturned: 0,
      rowsAfterFilters: 0,
      rowsSentToRenderer: 0,
      rowsAfterVisibilityFilter: 0,
      rowsAfterCategoryFilter: 0,
      filters: "visible_in_shop=true,is_active=true,archived_at=null",
      error: inventoryProductResult.error.message || "Could not load inventory_items"
    };
    console.warn("Could not load public inventory shop products from Supabase.", inventoryProductResult.error.message);
    return setPublicShopProducts([]);
  }

  return setPublicShopProducts(inventoryProductResult.data || []);
}

async function saveAdminProductToSupabase(product) {
  if (!supabaseClient || !isAdminProfile()) return null;
  const category = await window.KimsProductCategories?.save(product.category);
  const { data: inventoryItem, error } = await supabaseClient.rpc("admin_save_inventory_item", {
    p_inventory_item_id: null,
    p_product_name: product.name,
    p_sku: null,
    p_supplier: "Manual",
    p_category_id: category?.id || null,
    p_category: category?.name || product.category,
    p_description: product.description,
    p_cost_price: 0,
    p_sell_price: product.price,
    p_quantity_on_hand: 0,
    p_low_stock_threshold: 2,
    p_need_order_threshold: 0,
    p_image: product.image,
    p_visible_in_shop: true,
    p_is_active: true
  });

  if (error) throw error;
  return normalizeShopProduct({
    id: inventoryItem.shop_product_id,
    inventory_item_id: inventoryItem.id,
    name: inventoryItem.product_name,
    price: inventoryItem.sell_price,
    discount: product.discount,
    category_id: inventoryItem.category_id,
    product_categories: category || { id: inventoryItem.category_id, name: product.category },
    description: inventoryItem.description,
    image: inventoryItem.image,
    is_active: inventoryItem.is_active,
    inventory_items: inventoryItem
  });
}

function getDiscountedPrice(product) {
  const base = Number(product.price);
  const discount = Number(product.discount || 0);
  if (Number.isNaN(base)) return 0;
  if (Number.isNaN(discount) || discount <= 0) return base;
  return Math.max(0, base * (1 - discount / 100));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function loadProducts() {
  const raw = localStorage.getItem(PRODUCTS_KEY);
  if (!raw) {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(defaultProducts));
    return [...defaultProducts];
  }
  return JSON.parse(raw);
}

const saveProducts = (products) => localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
const loadCart = () => JSON.parse(localStorage.getItem(CART_KEY) || "[]");
const saveCart = (cart) => localStorage.setItem(CART_KEY, JSON.stringify(cart));

function isAdminProfile(profile = currentProfile) {
  return profile?.role === "admin";
}

function activeAccount() {
  if (!currentUser) return null;
  return {
    id: currentUser.id,
    email: currentUser.email,
    role: currentProfile?.role || "customer",
    ...currentProfile
  };
}

function getAccountDestination(profile = currentProfile) {
  return isAdminProfile(profile) ? "/admin" : "/account#customer-account";
}

function getRouteName() {
  const path = window.location.pathname;
  const file = path.split("/").pop() || "index.html";
  if (file === "account" || file === "account.html") return "account";
  if (file === "admin" || file === "admin.html" || file === "owner.html") return "admin";
  return file.replace(".html", "") || "index";
}

async function loadProfile(user) {
  if (!supabaseClient || !user) return null;
  let data = null;
  let error = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    data = result.data;
    error = result.error;
    if (data || error?.code !== "PGRST116") break;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  if (error) {
    console.error("Could not load profile", error);
    return null;
  }

  return data;
}

async function refreshSessionProfile() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) console.error("Could not load auth session", error);
  currentUser = data?.session?.user || null;
  currentProfile = currentUser ? await loadProfile(currentUser) : null;
}

function redirectAfterAuth(profile = currentProfile) {
  const destination = getAccountDestination(profile);
  const route = getRouteName();

  if (!isAdminProfile(profile) && route === "account") {
    history.replaceState(null, "", destination);
    renderAccountNavigation();
    renderCustomerAccount();
    return;
  }

  window.location.href = destination;
}

function setAuthMode(mode) {
  authMode = mode === "signup" || mode === "reset" ? mode : "login";
  const isSignup = authMode === "signup";
  const isReset = authMode === "reset";

  document.querySelectorAll("[data-mode-button]").forEach((button) => {
    const isActive = button.dataset.modeButton === authMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  if (modeSwitchEl) modeSwitchEl.hidden = isReset;
  if (emailFieldEl) emailFieldEl.hidden = isReset;
  if (authFormEl?.email) authFormEl.email.required = !isReset;
  if (nameFieldEl) nameFieldEl.hidden = !isSignup;
  if (lastNameFieldEl) lastNameFieldEl.hidden = !isSignup;
  if (phoneFieldEl) phoneFieldEl.hidden = !isSignup;
  if (loginActionsEl) loginActionsEl.hidden = isSignup || isReset;
  if (authTitleEl) authTitleEl.textContent = isReset ? "Set a new password" : isSignup ? "Create your account" : "Welcome back";
  if (authCopyEl) {
    authCopyEl.textContent = isReset
      ? "Enter a new password for your Kim Jones Coaching account."
      : isSignup
      ? "Set up your customer profile before booking or buying SportsCo gear."
      : "Access your coaching account and continue where you left off.";
  }
  if (authSubmitEl) authSubmitEl.textContent = isReset ? "Update Password" : isSignup ? "Create Account" : "Login";
  if (authFormEl?.password) {
    authFormEl.password.autocomplete = isSignup || isReset ? "new-password" : "current-password";
    authFormEl.password.placeholder = isReset ? "Enter a new password" : "Enter your password";
  }
  if (authMessageEl) {
    authMessageEl.textContent = "";
    authMessageEl.removeAttribute("data-tone");
  }
}

function showAuthMessage(message, tone = "neutral") {
  if (!authMessageEl) return;
  authMessageEl.textContent = message;
  authMessageEl.dataset.tone = tone;
}

async function createAccount(formData) {
  if (!supabaseClient) {
    showAuthMessage("Supabase is not configured yet. Add supabase-config.js with your project URL and anon key.", "error");
    return;
  }

  const email = formData.get("email").trim();
  const password = formData.get("password");
  const firstName = formData.get("first_name").trim();
  const lastName = formData.get("last_name").trim();
  const phone = formData.get("phone").trim();

  if (!firstName || !lastName) {
    showAuthMessage("Please add your first and last name to create an account.", "error");
    return;
  }

  authSubmitEl.disabled = true;
  showAuthMessage("Creating your account...", "neutral");

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        phone
      }
    }
  });

  authSubmitEl.disabled = false;

  if (error) {
    showAuthMessage(error.message, "error");
    return;
  }

  currentUser = data.user;
  currentProfile = currentUser ? await loadProfile(currentUser) : null;

  if (!data.session) {
    showAuthMessage("Check your email to confirm your account, then log in.", "success");
    setAuthMode("login");
    return;
  }

  redirectAfterAuth(currentProfile);
}

async function login(formData) {
  if (!supabaseClient) {
    showAuthMessage("Supabase is not configured yet. Add supabase-config.js with your project URL and anon key.", "error");
    return;
  }

  const email = formData.get("email").trim();
  const password = formData.get("password");

  authSubmitEl.disabled = true;
  showAuthMessage("Signing you in...", "neutral");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  authSubmitEl.disabled = false;

  if (error) {
    showAuthMessage(error.message, "error");
    return;
  }

  currentUser = data.user;
  currentProfile = currentUser ? await loadProfile(currentUser) : null;
  redirectAfterAuth(currentProfile);
}

async function sendPasswordReset() {
  if (!supabaseClient) {
    showAuthMessage("Supabase is not configured yet. Add supabase-config.js with your project URL and anon key.", "error");
    return;
  }

  const email = authFormEl?.email?.value.trim();
  if (!email) {
    showAuthMessage("Enter your email address first, then use Forgot password.", "error");
    authFormEl?.email?.focus();
    return;
  }

  forgotPasswordEl.disabled = true;
  showAuthMessage("Sending password reset email...", "neutral");

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/account`
  });

  forgotPasswordEl.disabled = false;

  if (error) {
    showAuthMessage(error.message, "error");
    return;
  }

  showAuthMessage("Check your email for the password reset link.", "success");
}

async function updatePassword(formData) {
  if (!supabaseClient) {
    showAuthMessage("Supabase is not configured yet. Add supabase-config.js with your project URL and anon key.", "error");
    return;
  }

  const password = formData.get("password");
  authSubmitEl.disabled = true;
  showAuthMessage("Updating password...", "neutral");

  const { error } = await supabaseClient.auth.updateUser({ password });

  authSubmitEl.disabled = false;

  if (error) {
    showAuthMessage(error.message, "error");
    return;
  }

  showAuthMessage("Password updated. You can now log in.", "success");
  setAuthMode("login");
  if (authFormEl?.password) authFormEl.password.value = "";
}

function renderAccountNavigation() {
  const account = activeAccount();
  publicAuthEls.forEach((item) => {
    item.hidden = Boolean(account);
  });
  privateAuthEls.forEach((item) => {
    item.hidden = !account;
    if (account) item.href = getAccountDestination(currentProfile);
  });
  signOutEls.forEach((button) => {
    button.hidden = !account;
  });
}

function renderCustomerAccount() {
  if (!customerAreaEl) return;
  const account = activeAccount();
  const showCustomerArea = Boolean(account) && !isAdminProfile(currentProfile);
  customerAreaEl.hidden = !showCustomerArea;
  if (authSectionEl) authSectionEl.hidden = Boolean(account);

  if (!account) return;
  if (isAdminProfile(currentProfile)) {
    window.location.replace("admin.html");
    return;
  }

  const firstName = currentProfile?.first_name || "there";
  const cart = loadCart();
  const itemCount = cart.reduce((total, item) => total + Number(item.quantity || 0), 0);
  const cartTotal = cart.reduce((total, item) => total + Number(item.price) * Number(item.quantity || 0), 0);

  if (customerGreetingEl) customerGreetingEl.textContent = `Welcome back, ${firstName}`;
  if (customerDetailsEl) {
    customerDetailsEl.textContent = `${account.email}${currentProfile?.phone ? ` · ${currentProfile.phone}` : ""}`;
  }
  if (customerCartEl) {
    customerCartEl.textContent = itemCount
      ? `${itemCount} item${itemCount === 1 ? "" : "s"} saved, currently ${money(cartTotal)} before tax.`
      : "Your cart is empty.";
  }

  populateProfileForm();
}

function setProfileMessage(message, tone = "neutral") {
  if (!profileMessageEl) return;
  profileMessageEl.textContent = message;
  profileMessageEl.dataset.tone = tone;
}

function populateProfileForm() {
  if (!profileFormEl || !currentProfile) return;
  const fields = ["first_name", "last_name", "phone", "parent_name", "notes"];
  fields.forEach((field) => {
    if (!profileFormEl.elements[field]) return;
    profileFormEl.elements[field].value = currentProfile[field] ?? "";
  });

  const players = getProfilePlayers(currentProfile);
  if (playerCountEl) playerCountEl.value = String(players.length || 1);
  renderPlayerFields(players);
}

function getProfilePlayers(profile) {
  if (Array.isArray(profile?.players) && profile.players.length) {
    return profile.players.map(normalizePlayer);
  }

  if (profile?.player_name || profile?.player_age || profile?.tennis_level) {
    return [
      normalizePlayer({
        name: profile.player_name || "",
        age: profile.player_age || "",
        level: profile.tennis_level || ""
      })
    ];
  }

  return [normalizePlayer({})];
}

function normalizePlayer(player) {
  return {
    name: player?.name || "",
    dob: player?.dob || "",
    age: player?.age ?? "",
    level: player?.level || player?.tennis_level || "",
    notes: player?.notes || ""
  };
}

function getSelectedPlayerCount() {
  const count = Number(playerCountEl?.value || 1);
  if (Number.isNaN(count)) return 1;
  return Math.min(6, Math.max(1, count));
}

function renderPlayerFields(players = []) {
  if (!playersListEl) return;
  const count = getSelectedPlayerCount();
  const nextPlayers = [...players];
  while (nextPlayers.length < count) nextPlayers.push(normalizePlayer({}));

  playersListEl.innerHTML = nextPlayers
    .slice(0, count)
    .map((player, index) => {
      const levelOptions = [
        '<option value="">Select skill level</option>',
        ...tennisLevelOptions.map((level) => `<option value="${level}" ${player.level === level ? "selected" : ""}>${level}</option>`)
      ].join("");

      return `
        <article class="player-card">
          <h4>Player ${index + 1}</h4>
          <div class="player-grid">
            <label>
              Player name
              <input type="text" name="player_name_${index}" value="${escapeAttribute(player.name)}" />
            </label>
            <label>
              Date of birth
              <input type="date" name="player_dob_${index}" value="${escapeAttribute(player.dob)}" />
            </label>
            <label>
              Age
              <input type="number" name="player_age_${index}" min="0" max="120" inputmode="numeric" value="${escapeAttribute(String(player.age ?? ""))}" />
            </label>
            <label>
              Skill level
              <select name="player_level_${index}">${levelOptions}</select>
            </label>
          </div>
        </article>`;
    })
    .join("");
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getPlayersFromForm(formData) {
  return Array.from({ length: getSelectedPlayerCount() }, (_item, index) =>
    normalizePlayer({
      name: formData.get(`player_name_${index}`)?.trim() || "",
      dob: formData.get(`player_dob_${index}`) || "",
      age: formData.get(`player_age_${index}`) ? Number(formData.get(`player_age_${index}`)) : null,
      level: formData.get(`player_level_${index}`) || ""
    })
  );
}

async function saveProfile(formData) {
  if (!supabaseClient || !currentUser) return;
  const players = getPlayersFromForm(formData);
  const primaryPlayer = players[0] || normalizePlayer({});

  const payload = {
    first_name: formData.get("first_name").trim(),
    last_name: formData.get("last_name").trim(),
    phone: formData.get("phone").trim(),
    parent_name: formData.get("parent_name").trim(),
    player_name: primaryPlayer.name,
    player_age: primaryPlayer.age === "" ? null : primaryPlayer.age,
    tennis_level: primaryPlayer.level,
    players,
    notes: formData.get("notes").trim()
  };

  setProfileMessage("Saving profile...", "neutral");
  const submitButton = profileFormEl.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;

  const { data, error } = await supabaseClient
    .from("profiles")
    .update(payload)
    .eq("id", currentUser.id)
    .select()
    .single();

  if (submitButton) submitButton.disabled = false;

  if (error) {
    setProfileMessage(error.message, "error");
    return;
  }

  currentProfile = data;
  renderCustomerAccount();
  setProfileMessage("Profile saved.", "success");
}

function loadPromoSettings() {
  const raw = localStorage.getItem(PROMO_SETTINGS_KEY);
  return raw ? JSON.parse(raw) : { code: "", percent: 0 };
}

function savePromoSettings(code, percent) {
  localStorage.setItem(PROMO_SETTINGS_KEY, JSON.stringify({ code, percent }));
}

function getAppliedPromoPercent() {
  const appliedCode = (localStorage.getItem(APPLIED_PROMO_CODE_KEY) || "").trim().toLowerCase();
  const promo = loadPromoSettings();
  if (!appliedCode || !promo.code) return 0;
  return appliedCode === promo.code.toLowerCase() ? Number(promo.percent || 0) : 0;
}
function getCategoryList(products) {
  const sourceCategories = window.KimsProductCategories?.getAll?.().map((category) => category.name) || [];
  if (sourceCategories.length) return [...new Set(sourceCategories)].sort((a,b)=>a.localeCompare(b));
  const productCategories = products.map((p) => (p.category?.trim() || "Uncategorized"));
  return [...new Set(productCategories)].sort((a,b)=>a.localeCompare(b));
}


function getNormalizedCategoryName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function upsertCategoryOption(categoryName) {
  if (!ownerProductCategorySelectEl) return;
  const normalized = getNormalizedCategoryName(categoryName);
  if (!normalized) return;

  const exists = [...ownerProductCategorySelectEl.options].some(
    (opt) => opt.value.toLowerCase() === normalized.toLowerCase()
  );

  if (!exists) {
    const opt = document.createElement("option");
    opt.value = normalized;
    opt.textContent = normalized;
    ownerProductCategorySelectEl.appendChild(opt);
  }
}

function renderOwnerCategorySelect(products) {
  if (!ownerProductCategorySelectEl) return;
  const categories = getCategoryList(products);
  const current = ownerProductCategorySelectEl.value;

  ownerProductCategorySelectEl.innerHTML = '<option value="">Select category</option>';
  categories.forEach((cat) => upsertCategoryOption(cat));

  const canKeepCurrent = categories.some((cat) => cat.toLowerCase() === current.toLowerCase());
  ownerProductCategorySelectEl.value = canKeepCurrent ? current : "";
}
function renderCategoryFilter(products) {
  if (!categoryFilterEl) return;
  const categories = getCategoryList(products);
  const options = ["<option value=\"all\">All categories</option>", ...categories.map((cat)=>`<option value=\"${cat}\">${cat}</option>`)].join("");
  categoryFilterEl.innerHTML = options;
  categoryFilterEl.value = categories.includes(selectedCategory) || selectedCategory === "all" ? selectedCategory : "all";
  selectedCategory = categoryFilterEl.value || "all";
}

async function refreshShopCategoriesBeforeRender() {
  if (!isShopPage) return;
  if (!window.KimsProductCategories?.refresh) {
    await new Promise((resolve) => {
      window.addEventListener("kims:categories-ready", resolve, { once: true });
    });
    return;
  }
  selectedCategory = "all";
  await window.KimsProductCategories.refresh("all");
  if (categoryFilterEl) categoryFilterEl.value = "all";
}

function renderProducts() {
  if (isShopPage && supabaseClient && publicShopProducts === null) {
    if (productListEl) {
      productListEl.innerHTML = `<p class="empty-cart">Loading shop products...</p>`;
    }
    return;
  }

  const products = getCurrentShopProducts().map(normalizeInventoryShopProduct);
  renderOwnerCategorySelect(products);
  const publicProducts = products.filter((product) => {
    const outOfStock = isProductOutOfStock(product);
    if (shopInventorySettings.hide_out_of_stock && outOfStock) return false;
    return product.visible_in_shop === true && product.is_active !== false && !product.archived_at;
  });
  shopLoadDebug.rowsSentToRenderer = products.length;
  shopLoadDebug.rowsAfterVisibilityFilter = publicProducts.length;
  renderCategoryFilter(publicProducts);
  if (!productListEl) return;

  const filteredProducts = selectedCategory === "all"
    ? publicProducts
    : publicProducts.filter((p) => productMatchesSelectedCategory(p, selectedCategory));
  shopLoadDebug.rowsAfterCategoryFilter = filteredProducts.length;
  console.log("AFTER CATEGORY FILTER", filteredProducts);
  if (isShopPage && !initialShopRenderComplete) {
    console.log("[Kim Shop] first render", {
      categoriesLoaded: window.KimsProductCategories?.getAll?.().length || 0,
      publicProductsCount: publicProducts.length,
      selectedCategory,
      renderedProductsCount: filteredProducts.length
    });
    initialShopRenderComplete = true;
  }
  console.info("[Kim Shop] render counts", {
    rowsSentToRenderer: products.length,
    rowsAfterVisibilityFilter: publicProducts.length,
    rowsAfterCategoryFilter: filteredProducts.length,
    selectedCategory,
    filters: shopLoadDebug.filters,
    source: shopLoadDebug.source
  });

  const cards = filteredProducts
    .sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name))
    .map((p) => {
      const discounted = getDiscountedPrice(p);
      const hasDiscount = Number(p.discount || 0) > 0;
      const outOfStock = isProductOutOfStock(p);
      const stockText = getProductStockText(p);
      return `
        <article class="product-card" data-id="${p.id}" data-name="${p.name}" data-price="${discounted}">
          <div class="product-image-wrap">
            ${p.image ? `<img src="${p.image}" alt="${p.name}" class="product-image" />` : `<div class="product-image product-image-placeholder">No image</div>`}
          </div>
          <p class="owner-meta">${p.category || "Uncategorized"}</p>
          <h3>${p.name}</h3>
          <p>${p.description || "Product description"}</p>
          <p class="owner-meta">${stockText}</p>
          <div class="price-wrap">
            ${hasDiscount ? `<p class="old-price">${money(Number(p.price))}</p>` : ""}
            <p class="price">${money(discounted)} ${hasDiscount ? `<span class="discount-badge">-${Number(p.discount)}%</span>` : ""}</p>
          </div>
          <button class="btn btn-primary add-to-cart" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Out of stock" : "Add to Cart"}</button>
        </article>`;
    })
    .join("");

  const emptyMessage = publicProducts.length
    ? "No products found in this category."
    : "No public shop products found.";
  productListEl.innerHTML = cards
    ? `<div class="cards three-col">${cards}</div>`
    : `<p class="empty-cart">${emptyMessage}</p>${getShopDebugMarkup(publicProducts.length, filteredProducts.length)}`;
}

window.KimsRenderShopProducts = () => {
  if (!isShopPage) return;
  selectedCategory = categoryFilterEl?.value || "all";
  renderProducts();
};

function productMatchesSelectedCategory(product, selectedValue) {
  if (!selectedValue || selectedValue === "all") return true;
  const selected = String(selectedValue).trim().toLowerCase();
  const categoryName = String(product.category || "Uncategorized").trim().toLowerCase();
  const categoryId = String(product.category_id || "").trim().toLowerCase();
  return selected === categoryName || (categoryId && selected === categoryId);
}

function getShopDebugMarkup(publicCount, filteredCount) {
  if (!supabaseClient) return "";
  const parts = [
    `table/query used: ${shopLoadDebug.source}`,
    `rows returned: ${shopLoadDebug.rowsReturned}`,
    `public rows after filters: ${shopLoadDebug.rowsAfterFilters}`,
    `rows sent to renderer: ${shopLoadDebug.rowsSentToRenderer}`,
    `visible rows before category filter: ${publicCount}`,
    `visible rows after category filter: ${filteredCount}`,
    `filters applied: ${shopLoadDebug.filters || "none"}`,
    `Supabase error: ${shopLoadDebug.error || "none"}`
  ];
  return `<p class="helper-text shop-debug-output">${parts.map(escapeHtml).join(" | ")}</p>`;
}

function isProductOutOfStock(product) {
  if (product.inventory_item_id || product.stock_status) {
    return Number(product.quantity_on_hand || 0) <= 0 || product.stock_status === "out_of_stock";
  }
  return false;
}

function getProductStockText(product) {
  if (!(product.inventory_item_id || product.stock_status)) return "Available";
  const quantity = Number(product.quantity_on_hand || 0);
  if (quantity <= 0 || product.stock_status === "out_of_stock") return "Out of stock";
  if (product.stock_status === "low_stock") return `Low stock - ${quantity} left`;
  if (product.stock_status === "need_to_order") return `Need to order - ${quantity} left`;
  return `${quantity} in stock`;
}

function renderCart() {
  if (!cartItemsEl) return;
  const cart = loadCart();
  cartItemsEl.innerHTML = !cart.length
    ? `<p class="empty-cart">Your cart is empty. Add a SportsCo product above.</p>`
    : cart
        .map(
          (item) => `<div class="cart-item"><div><h4>${item.name}</h4><p>${money(Number(item.price))} each</p></div><div class="qty-controls"><button class="qty-btn" data-action="decrease" data-id="${item.id}">−</button><span>${item.quantity}</span><button class="qty-btn" data-action="increase" data-id="${item.id}">+</button></div></div>`
        )
        .join("");

  const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  const tax = subtotal * 0.1;
  const prePromoTotal = subtotal + tax;
  const promoPercent = getAppliedPromoPercent();
  const promoDiscount = prePromoTotal * (promoPercent / 100);
  const finalTotal = Math.max(0, prePromoTotal - promoDiscount);

  subtotalEl.textContent = money(subtotal);
  taxEl.textContent = money(tax);
  if (promoDiscountEl) promoDiscountEl.textContent = `-${money(promoDiscount)}`;
  totalEl.textContent = money(finalTotal);
}

function addToCart(product) {
  const cart = loadCart();
  const existing = cart.find((item) => item.id === product.id);
  const availableQuantity = Number(product.quantity_on_hand ?? Infinity);
  const nextQuantity = existing ? existing.quantity + 1 : 1;
  if (Number.isFinite(availableQuantity) && nextQuantity > availableQuantity) {
    alert("Not enough stock is available for that product.");
    return;
  }
  if (existing) existing.quantity += 1;
  else cart.push({ ...product, quantity: 1 });
  saveCart(cart);
  renderCart();
}

function updateQuantity(productId, action) {
  const cart = loadCart();
  const item = cart.find((entry) => entry.id === productId);
  if (!item) return;
  const products = getCurrentShopProducts();
  const product = products.find((entry) => entry.id === productId);
  const availableQuantity = Number(product?.quantity_on_hand ?? item.quantity_on_hand ?? Infinity);
  if (action === "increase" && Number.isFinite(availableQuantity) && item.quantity + 1 > availableQuantity) {
    alert("Not enough stock is available for that product.");
    return;
  }
  item.quantity += action === "increase" ? 1 : -1;
  saveCart(cart.filter((entry) => entry.quantity > 0));
  renderCart();
}

const loadStripeLink = () => (stripeInputEl.value = localStorage.getItem(STRIPE_KEY) || "");
const saveStripeLink = () => localStorage.setItem(STRIPE_KEY, stripeInputEl.value.trim());

function renderOwnerProducts() {
  if (!ownerProductsListEl) return;
  const products = loadProducts();
  ownerProductsListEl.innerHTML = products
    .map(
      (p) => `<div class="owner-product-row"><div><strong>${p.name}</strong><p>${p.description || "No description"}</p><p class="owner-meta">Category: ${p.category || "Uncategorized"}</p>${p.image ? `<img src="${p.image}" alt="${p.name}" class="owner-thumb" />` : ""}</div><div class="owner-row-actions"><label>Price</label><input type="number" step="0.01" min="0" data-id="${p.id}" class="owner-price-input" value="${Number(p.price).toFixed(2)}" /><label>Discount %</label><input type="number" step="0.01" min="0" max="100" data-id="${p.id}" class="owner-discount-input" value="${Number(p.discount || 0).toFixed(2)}" /><button class="btn btn-secondary owner-remove-btn" data-id="${p.id}">Remove</button></div></div>`
    )
    .join("");
}

function setOwnerUI() {
  if (!ownerPanelEl || !ownerStatusEl) return;
  const account = activeAccount();
  const authed = isAdminProfile(currentProfile);
  ownerPanelEl.hidden = !authed;

  if (!supabaseClient) {
    ownerStatusEl.textContent = "Supabase is not configured yet. Add supabase-config.js with your project URL and anon key.";
    return;
  }

  if (!account) {
    ownerStatusEl.innerHTML = 'Please <a href="account.html">log in</a> to continue.';
    window.location.replace("account.html");
    return;
  }

  if (!authed) {
    ownerStatusEl.textContent = "This area is available to admin accounts only.";
    window.location.replace("account.html#customer-account");
    return;
  }

  ownerStatusEl.textContent = `Signed in as ${account.email}. You can add products, categories, upload images, and manage discounts.`;
  renderOwnerProducts();
}

if (productListEl) productListEl.addEventListener("click", (event) => {
  const button = event.target.closest(".add-to-cart");
  if (!button) return;
  const card = button.closest(".product-card");
  const product = getCurrentShopProducts().find((item) => item.id === card.dataset.id);
  addToCart(product || { id: card.dataset.id, name: card.dataset.name, price: Number(card.dataset.price) });
});

if (cartItemsEl) cartItemsEl.addEventListener("click", (event) => {
  const button = event.target.closest(".qty-btn");
  if (!button) return;
  updateQuantity(button.dataset.id, button.dataset.action);
});

if (clearCartBtnEl) clearCartBtnEl.addEventListener("click", () => {
  saveCart([]);
  renderCart();
});

if (stripeInputEl) stripeInputEl.addEventListener("change", saveStripeLink);
if (categoryFilterEl) categoryFilterEl.addEventListener("change", () => {
  selectedCategory = categoryFilterEl.value || "all";
  renderProducts();
});
window.addEventListener("kims:categories-ready", () => {
  if (!isShopPage) return;
  selectedCategory = categoryFilterEl?.value || "all";
  renderProducts();
});
if (applyPromoBtnEl) applyPromoBtnEl.addEventListener("click", () => {
  const entered = (promoCodeEl?.value || "").trim();
  const promo = loadPromoSettings();

  if (!entered) {
    localStorage.removeItem(APPLIED_PROMO_CODE_KEY);
    if (promoMessageEl) promoMessageEl.textContent = "Promo removed.";
    renderCart();
    return;
  }

  if (promo.code && entered.toLowerCase() === promo.code.toLowerCase()) {
    localStorage.setItem(APPLIED_PROMO_CODE_KEY, entered);
    if (promoMessageEl) promoMessageEl.textContent = `Promo applied: ${promo.percent}% off.`;
  } else {
    localStorage.removeItem(APPLIED_PROMO_CODE_KEY);
    if (promoMessageEl) promoMessageEl.textContent = "Invalid promo code.";
  }

  renderCart();
});

if (checkoutBtnEl) checkoutBtnEl.addEventListener("click", () => {
  const cart = loadCart();
  const account = activeAccount();
  const link = (localStorage.getItem(STRIPE_KEY) || "").trim();
  if (!cart.length) return alert("Your cart is empty. Add items before checkout.");
  if (!account) {
    if (checkoutAccountMessageEl) checkoutAccountMessageEl.textContent = "Please log in or create an account before checkout.";
    window.location.href = "account.html?mode=signup";
    return;
  }
  if (!link) {
    alert("Please add your Stripe checkout link first.");
    stripeInputEl.focus();
    return;
  }
  window.location.href = link;
});

if (ownerPromoFormEl) ownerPromoFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = (ownerPromoCodeEl?.value || "").trim();
  const percent = Number(ownerPromoPercentEl?.value || 0);

  if (!code || Number.isNaN(percent) || percent < 0 || percent > 100) {
    if (ownerPromoStatusEl) ownerPromoStatusEl.textContent = "Enter valid promo code and discount (0-100).";
    return;
  }

  savePromoSettings(code, percent);
  if (ownerPromoStatusEl) ownerPromoStatusEl.textContent = `Saved promo ${code} (${percent}% off).`;
});

if (ownerAddFormEl) ownerAddFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const products = loadProducts();
  const selectedFile = ownerProductImageEl.files[0];
  let imageData = "";

  if (selectedFile) {
    if (!selectedFile.type.startsWith("image/")) return alert("Please select a valid image file.");
    if (selectedFile.size > 2 * 1024 * 1024) return alert("Image is too large. Please use a file under 2MB.");
    try {
      imageData = await fileToDataUrl(selectedFile);
    } catch {
      return alert("Could not read image file.");
    }
  }

  const newProduct = {
    id: `prod-${Date.now()}`,
    name: ownerProductNameEl.value.trim(),
    price: Number(ownerProductPriceEl.value),
    discount: Number(ownerProductDiscountEl.value || 0),
    category: getNormalizedCategoryName(ownerProductCategorySelectEl?.value || ""),
    description: ownerProductDescEl.value.trim(),
    image: imageData
  };

  if (
    !newProduct.name ||
    !newProduct.category ||
    Number.isNaN(newProduct.price) ||
    newProduct.price < 0 ||
    Number.isNaN(newProduct.discount) ||
    newProduct.discount < 0 ||
    newProduct.discount > 100
  ) {
    return alert("Please enter valid name, category, price, and discount (0-100).");
  }

  products.push(newProduct);
  saveProducts(products);
  try {
    const savedProduct = await saveAdminProductToSupabase(newProduct);
    if (savedProduct) {
      const nextProducts = loadProducts().filter((product) => product.id !== newProduct.id);
      saveProducts([...nextProducts, savedProduct]);
    }
  } catch (error) {
    alert(`Product saved locally, but Supabase save failed: ${error.message}`);
  }
  ownerAddFormEl.reset();
  renderProducts();
  renderOwnerProducts();
});

if (ownerProductsListEl) ownerProductsListEl.addEventListener("change", async (event) => {
  const priceInput = event.target.closest(".owner-price-input");
  const discountInput = event.target.closest(".owner-discount-input");
  if (!priceInput && !discountInput) return;

  const source = priceInput || discountInput;
  const products = loadProducts();
  const target = products.find((p) => p.id === source.dataset.id);
  if (!target) return;

  if (priceInput) {
    const nextPrice = Number(priceInput.value);
    if (Number.isNaN(nextPrice) || nextPrice < 0) return;
    target.price = nextPrice;
  }

  if (discountInput) {
    const nextDiscount = Number(discountInput.value);
    if (Number.isNaN(nextDiscount) || nextDiscount < 0 || nextDiscount > 100) return;
    target.discount = nextDiscount;
  }

  saveProducts(products);
  if (supabaseClient && isAdminProfile()) {
    const updates = {};
    if (priceInput) updates.price = target.price;
    if (discountInput) updates.discount = target.discount;
    const { error } = await supabaseClient
      .from("shop_products")
      .update(updates)
      .eq("id", target.id);
    if (error) alert(`Could not update Supabase product: ${error.message}`);
  }
  renderProducts();
  renderCart();
});

if (ownerProductsListEl) ownerProductsListEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".owner-remove-btn");
  if (!button) return;
  const id = button.dataset.id;
  if (supabaseClient && isAdminProfile()) {
    const { error } = await supabaseClient
      .from("shop_products")
      .update({ is_active: false })
      .eq("id", id);
    if (error) {
      alert(`Could not remove Supabase product: ${error.message}`);
      return;
    }
  }
  saveProducts(loadProducts().filter((p) => p.id !== id));
  saveCart(loadCart().filter((item) => item.id !== id));
  renderProducts();
  renderOwnerProducts();
  renderCart();
});

document.querySelectorAll("[data-mode-button]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.modeButton));
});

if (forgotPasswordEl) forgotPasswordEl.addEventListener("click", sendPasswordReset);

if (playerCountEl) playerCountEl.addEventListener("change", () => {
  const formData = profileFormEl ? new FormData(profileFormEl) : null;
  renderPlayerFields(formData ? getPlayersFromForm(formData) : getProfilePlayers(currentProfile));
});

if (authFormEl) authFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!authFormEl.checkValidity()) {
    showAuthMessage("Please complete the required fields.", "error");
    authFormEl.reportValidity();
    return;
  }

  const formData = new FormData(authFormEl);
  if (authMode === "reset") await updatePassword(formData);
  else if (authMode === "signup") await createAccount(formData);
  else await login(formData);
});

signOutEls.forEach((button) => {
  button.addEventListener("click", async () => {
    if (supabaseClient) await supabaseClient.auth.signOut();
    currentUser = null;
    currentProfile = null;
    renderAccountNavigation();
    window.location.href = "account.html";
  });
});

if (profileFormEl) profileFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profileFormEl.checkValidity()) {
    setProfileMessage("Please check the profile fields.", "error");
    profileFormEl.reportValidity();
    return;
  }

  await saveProfile(new FormData(profileFormEl));
});

if (menuToggleEl && navLinksEl) {
  menuToggleEl.addEventListener("click", () => {
    const isOpen = navLinksEl.classList.toggle("open");
    menuToggleEl.setAttribute("aria-expanded", String(isOpen));
    menuToggleEl.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  });

  navLinksEl.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    navLinksEl.classList.remove("open");
    menuToggleEl.setAttribute("aria-expanded", "false");
    menuToggleEl.setAttribute("aria-label", "Open menu");
  });
}

async function init() {
  try {
    if (stripeInputEl) loadStripeLink();
    if (authFormEl) setAuthMode(authMode);

    if (!supabaseClient && authMessageEl) {
      showAuthMessage("Supabase is not configured yet. Add supabase-config.js with your project URL and anon key.", "error");
    }

    await refreshSessionProfile();
    renderAccountNavigation();
    renderCustomerAccount();
    if (ownerStatusEl) setOwnerUI();

    if (isShopPage) {
      await refreshShopCategoriesBeforeRender();
      await syncShopProductsFromSupabase();
      selectedCategory = "all";
      if (categoryFilterEl) categoryFilterEl.value = "all";
    }
    if (productListEl) renderProducts();
    if (cartItemsEl) renderCart();

    if (ownerProductsListEl && !isShopPage) renderOwnerProducts();

    if (promoCodeEl) {
      const applied = localStorage.getItem(APPLIED_PROMO_CODE_KEY) || "";
      promoCodeEl.value = applied;
    }
    if (ownerPromoCodeEl || ownerPromoPercentEl) {
      const promo = loadPromoSettings();
      if (ownerPromoCodeEl) ownerPromoCodeEl.value = promo.code || "";
      if (ownerPromoPercentEl) ownerPromoPercentEl.value = promo.percent || 0;
    }

    if (supabaseClient) {
      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        try {
          currentUser = session?.user || null;
          currentProfile = currentUser ? await loadProfile(currentUser) : null;
          if (event === "PASSWORD_RECOVERY") setAuthMode("reset");
          renderAccountNavigation();
          renderCustomerAccount();
          if (ownerStatusEl) setOwnerUI();
        } catch (error) {
          handleAdminStartupError(error);
        }
      });
    }
  } catch (error) {
    handleAdminStartupError(error);
  }
}

function handleAdminStartupError(error) {
  console.error("Kim's Coaching startup failed.", error);
  if (isAdminPage && window.KimsShowAdminRuntimeError) {
    window.KimsShowAdminRuntimeError(error);
    return;
  }
  throw error;
}

init().catch(handleAdminStartupError);
