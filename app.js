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
let selectedCategory = "all";
const urlParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const isPasswordRecovery = urlParams.get("type") === "recovery" || hashParams.get("type") === "recovery" || urlParams.get("mode") === "reset";
let authMode = isPasswordRecovery ? "reset" : urlParams.get("mode") === "signup" ? "signup" : "login";
let currentUser = null;
let currentProfile = null;

const tennisLevelOptions = ["Beginner", "Developing", "Interclub", "Tournament"];

const supabaseSettings = window.KIMS_SUPABASE || {};
const hasSupabaseConfig = Boolean(supabaseSettings.url && supabaseSettings.anonKey && window.supabase);
const supabaseClient = hasSupabaseConfig
  ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
  : null;

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
  return [...new Set(products.map((p) => (p.category?.trim() || "Uncategorized")))].sort((a,b)=>a.localeCompare(b));
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
}

function renderProducts() {
  const products = loadProducts();
  renderCategoryFilter(products);
  renderOwnerCategorySelect(products);
  if (!productListEl) return;

  const filteredProducts = selectedCategory === "all"
    ? products
    : products.filter((p) => (p.category?.trim() || "Uncategorized") === selectedCategory);

  const cards = filteredProducts
    .sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name))
    .map((p) => {
      const discounted = getDiscountedPrice(p);
      const hasDiscount = Number(p.discount || 0) > 0;
      return `
        <article class="product-card" data-id="${p.id}" data-name="${p.name}" data-price="${discounted}">
          <div class="product-image-wrap">
            ${p.image ? `<img src="${p.image}" alt="${p.name}" class="product-image" />` : `<div class="product-image product-image-placeholder">No image</div>`}
          </div>
          <p class="owner-meta">${p.category || "Uncategorized"}</p>
          <h3>${p.name}</h3>
          <p>${p.description || "Product description"}</p>
          <div class="price-wrap">
            ${hasDiscount ? `<p class="old-price">${money(Number(p.price))}</p>` : ""}
            <p class="price">${money(discounted)} ${hasDiscount ? `<span class="discount-badge">-${Number(p.discount)}%</span>` : ""}</p>
          </div>
          <button class="btn btn-primary add-to-cart">Add to Cart</button>
        </article>`;
    })
    .join("");

  productListEl.innerHTML = cards ? `<div class="cards three-col">${cards}</div>` : `<p class="empty-cart">No products found in this category.</p>`;
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
  if (existing) existing.quantity += 1;
  else cart.push({ ...product, quantity: 1 });
  saveCart(cart);
  renderCart();
}

function updateQuantity(productId, action) {
  const cart = loadCart();
  const item = cart.find((entry) => entry.id === productId);
  if (!item) return;
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
  addToCart({ id: card.dataset.id, name: card.dataset.name, price: Number(card.dataset.price) });
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
  selectedCategory = categoryFilterEl.value;
  renderProducts();
});
if (addCategoryBtnEl) addCategoryBtnEl.addEventListener("click", () => {
  const raw = ownerNewCategoryEl?.value || "";
  const newCategory = getNormalizedCategoryName(raw);
  if (!newCategory) return;

  const products = loadProducts();
  const existsInProducts = products.some((p) => (p.category || "").trim().toLowerCase() === newCategory.toLowerCase());
  if (!existsInProducts) {
    // Persist category by adding/removing a placeholder product category source is avoided; category list is derived from products,
    // so we just keep it in dropdown until it is used in a product.
  }

  upsertCategoryOption(newCategory);
  ownerProductCategorySelectEl.value = newCategory;
  if (ownerNewCategoryEl) ownerNewCategoryEl.value = "";
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
  ownerAddFormEl.reset();
  renderProducts();
  renderOwnerProducts();
});

if (ownerProductsListEl) ownerProductsListEl.addEventListener("change", (event) => {
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
  renderProducts();
  renderCart();
});

if (ownerProductsListEl) ownerProductsListEl.addEventListener("click", (event) => {
  const button = event.target.closest(".owner-remove-btn");
  if (!button) return;
  const id = button.dataset.id;
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
  if (stripeInputEl) loadStripeLink();
  if (authFormEl) setAuthMode(authMode);
  if (productListEl) renderProducts();
  if (cartItemsEl) renderCart();

  if (!supabaseClient && authMessageEl) {
    showAuthMessage("Supabase is not configured yet. Add supabase-config.js with your project URL and anon key.", "error");
  }

  await refreshSessionProfile();
  renderAccountNavigation();
  renderCustomerAccount();
  if (ownerStatusEl) setOwnerUI();

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
      currentUser = session?.user || null;
      currentProfile = currentUser ? await loadProfile(currentUser) : null;
      if (event === "PASSWORD_RECOVERY") setAuthMode("reset");
      renderAccountNavigation();
      renderCustomerAccount();
      if (ownerStatusEl) setOwnerUI();
    });
  }
}

init();
