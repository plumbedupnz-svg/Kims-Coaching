const CART_KEY = "kims_cart";
const STRIPE_KEY = "kims_stripe_link";
const PRODUCTS_KEY = "kims_products";
const OWNER_AUTH_KEY = "kims_owner_authenticated";
const OWNER_PASSCODE = "coach-admin-2026";

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

const ownerLoginFormEl = document.getElementById("owner-login-form");
const ownerPasscodeEl = document.getElementById("owner-passcode");
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
const ownerLogoutBtnEl = document.getElementById("owner-logout-btn");
const categoryFilterEl = document.getElementById("category-filter");

const money = (v) => `$${v.toFixed(2)}`;
const slugify = (v) => v.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
let selectedCategory = "all";

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

function getCategoryList(products) {
  return [...new Set(products.map((p) => (p.category?.trim() || "Uncategorized")))].sort((a,b)=>a.localeCompare(b));
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
  subtotalEl.textContent = money(subtotal);
  taxEl.textContent = money(tax);
  totalEl.textContent = money(subtotal + tax);
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
const isOwnerAuthed = () => localStorage.getItem(OWNER_AUTH_KEY) === "true";
const setOwnerAuthed = (value) => localStorage.setItem(OWNER_AUTH_KEY, value ? "true" : "false");

function renderOwnerProducts() {
  const products = loadProducts();
  ownerProductsListEl.innerHTML = products
    .map(
      (p) => `<div class="owner-product-row"><div><strong>${p.name}</strong><p>${p.description || "No description"}</p><p class="owner-meta">Category: ${p.category || "Uncategorized"}</p>${p.image ? `<img src="${p.image}" alt="${p.name}" class="owner-thumb" />` : ""}</div><div class="owner-row-actions"><label>Price</label><input type="number" step="0.01" min="0" data-id="${p.id}" class="owner-price-input" value="${Number(p.price).toFixed(2)}" /><label>Discount %</label><input type="number" step="0.01" min="0" max="100" data-id="${p.id}" class="owner-discount-input" value="${Number(p.discount || 0).toFixed(2)}" /><button class="btn btn-secondary owner-remove-btn" data-id="${p.id}">Remove</button></div></div>`
    )
    .join("");
}

function setOwnerUI() {
  const authed = isOwnerAuthed();
  ownerPanelEl.hidden = !authed;
  ownerLoginFormEl.hidden = authed;
  ownerStatusEl.textContent = authed ? "Owner mode active. You can add products, categories, upload images, and manage discounts." : "Use owner passcode to manage products.";
  if (authed) renderOwnerProducts();
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
if (checkoutBtnEl) checkoutBtnEl.addEventListener("click", () => {
  const cart = loadCart();
  const link = (localStorage.getItem(STRIPE_KEY) || "").trim();
  if (!cart.length) return alert("Your cart is empty. Add items before checkout.");
  if (!link) {
    alert("Please add your Stripe checkout link first.");
    stripeInputEl.focus();
    return;
  }
  window.location.href = link;
});

if (ownerLoginFormEl) ownerLoginFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  if (ownerPasscodeEl.value === OWNER_PASSCODE) {
    setOwnerAuthed(true);
    ownerPasscodeEl.value = "";
    setOwnerUI();
  } else alert("Incorrect passcode.");
});

if (ownerLogoutBtnEl) ownerLogoutBtnEl.addEventListener("click", () => {
  setOwnerAuthed(false);
  setOwnerUI();
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
    category: ownerProductCategoryEl.value.trim(),
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

if (stripeInputEl) loadStripeLink();
if (productListEl) renderProducts();
if (cartItemsEl) renderCart();
if (ownerStatusEl) setOwnerUI();
