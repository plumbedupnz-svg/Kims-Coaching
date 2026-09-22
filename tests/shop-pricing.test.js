const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const pricing = require("../shop-pricing");
const { calculateDiscountedPrice } = require("../api/stripe/_helpers");

test("display and payment calculations round discounted units to cents and reject invalid prices", () => {
  assert.equal(pricing.unitPrice(449.98, 20), 359.98);
  assert.equal(calculateDiscountedPrice(449.98, 20), 359.98);
  assert.equal(pricing.unitPrice(19.99, 0), 19.99);
  assert.equal(pricing.unitPrice(39.99, 15) * 3, 101.97);
  for (const [price, discount] of [[-1, 0], [NaN, 0], [20, -5], [20, 101], [20, Infinity]]) {
    assert.throws(() => pricing.unitPrice(price, discount), /price is unavailable/);
  }
});

test("sale cart survives persistence and reprices old carts from the catalogue without double discounting", () => {
  const source = fs.readFileSync(require.resolve("../app.js"), "utf8");
  let stored = "[]";
  const product = { id: "racket", price: 449.98, discount: 20, name: "Racket", fulfilment_type: "stock" };
  const context = {
    window: { KimsPricing: pricing, dispatchEvent() {} },
    CustomEvent: class {},
    CART_KEY: "test-cart",
    getCurrentShopProducts: () => [product],
    getProductAvailabilityNote: () => "",
    getStorableImage: () => "",
    safeJsonParse: JSON.parse,
    safeStorageGet: () => stored,
    safeStorageSet: (_, value) => { stored = value; }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function getMinimalCartItem("), source.indexOf("function isAdminProfile(")), context);
  context.saveCart([{ ...product, quantity: 2 }]);
  for (let n = 0; n < 3; n++) {
    const cart = context.loadCart();
    assert.equal(cart[0].price, 359.98);
    assert.equal(cart[0].price * cart[0].quantity, 719.96);
    context.saveCart(cart);
  }
  // The old format omitted discounts and held full price.
  stored = JSON.stringify([{ id: "racket", price: 449.98, quantity: 1 }]);
  assert.equal(context.loadCart()[0].price, 359.98);
  // An ended sale must also refresh the cart to today's price.
  product.discount = 0;
  assert.equal(context.loadCart()[0].price, 449.98);
});
