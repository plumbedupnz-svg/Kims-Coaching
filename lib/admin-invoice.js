// Shared invoice arithmetic. Public checkout never opts into these admin controls.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KimsAdminInvoice = api;
})(typeof window === 'object' ? window : this, function () {
  function quantity(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error('Quantity must be a whole number from 1 to 99.');
    return n;
  }
  function money(value, label = 'Price') {
    if (value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000000)
      throw new Error(`${label} must be between $0 and $1,000,000.`);
    const cents = Math.round((Number(value) + Number.EPSILON) * 100);
    if (Math.abs(Number(value) * 100 - cents) > 0.000001) throw new Error(`${label} must have at most two decimal places.`);
    return cents;
  }
  function normalizeCart(cart = []) {
    if (!Array.isArray(cart) || cart.length > 50) throw new Error('Use up to 50 invoice lines.');
    const merged = new Map();
    for (const row of cart) {
      if (!row || !row.id) throw new Error('Choose an item for every invoice line.');
      const id = String(row.id), inventory = String(row.inventory_item_id || '');
      const key = `${id}:${inventory}`;
      const existing = merged.get(key);
      const count = quantity(row.quantity);
      if (existing) existing.quantity = quantity(existing.quantity + count);
      else merged.set(key, { id, ...(inventory ? { inventory_item_id: inventory } : {}), quantity: count });
    }
    return [...merged.values()];
  }
  function customLines(rows = []) {
    if (!Array.isArray(rows) || rows.length > 50) throw new Error('Use up to 50 invoice lines.');
    return rows.map((row, index) => {
      const name = String(row?.name || '').trim();
      if (!name || name.length > 200) throw new Error('Give each custom line a description of up to 200 characters.');
      const count = quantity(row.quantity), unit = money(row.unit_amount);
      return { id: `custom-${index + 1}`, inventory_item_id: '', name, quantity: count, unitAmount: unit / 100,
        lineTotal: unit * count / 100, sale_price_at_sale: unit / 100,
        price: `$${(unit / 100).toFixed(2)}`, category: 'Custom invoice line', fulfilment_type: 'service', custom_line: true };
    });
  }
  function discountCents(subtotalCents, discount = { type: 'none', value: 0 }) {
    const type = discount?.type || 'none';
    if (type === 'none') return 0;
    if (!['amount', 'percent'].includes(type)) throw new Error('Choose a dollar or percentage discount.');
    const value = money(discount.value, 'Discount');
    if (type === 'percent' && value > 10000) throw new Error('Percentage discount cannot exceed 100%.');
    const cents = type === 'percent' ? Math.round(subtotalCents * value / 10000) : value;
    if (cents > subtotalCents) throw new Error('Discount cannot exceed the invoice subtotal.');
    return cents;
  }
  function matches(item, query) {
    const text = `${item.name || item.product_name || ''} ${item.sku || ''} ${item.category || ''}`.toLowerCase();
    return String(query).trim().toLowerCase().split(/\s+/).every(term => text.includes(term));
  }
  return { quantity, money, normalizeCart, customLines, discountCents, matches };
});
