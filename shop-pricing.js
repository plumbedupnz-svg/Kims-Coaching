(function (root, factory) {
  const pricing = factory();
  if (typeof module === "object" && module.exports) module.exports = pricing;
  else root.KimsPricing = pricing;
})(typeof window === "object" ? window : this, function () {
  function unitPrice(price, discount = 0) {
    const base = Number(price);
    const percentage = Number(discount || 0);
    if (!Number.isFinite(base) || base < 0 || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error("This product's price is unavailable. Please contact Kim.");
    }
    return Math.round((base * (1 - percentage / 100) + Number.EPSILON) * 100) / 100;
  }
  return { unitPrice };
});
