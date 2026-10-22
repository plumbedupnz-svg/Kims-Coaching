const test = require('node:test');
const assert = require('node:assert/strict');
const math = require('../lib/admin-invoice');
test('catalogue search matches all query terms across name, SKU and category', () => {
  const item = { name: 'Wilson Pro Overgrip', sku: 'WIL-004', category: 'Grips' };
  assert.equal(math.matches(item, 'wil-004 grips'), true);
  assert.equal(math.matches(item, ' pro  WILSON '), true);
  assert.equal(math.matches(item, 'strings'), false);
});
test('multiple catalogue rows combine quantities without trusting client prices', () => {
  const cart = math.normalizeCart([{ id: 'a', inventory_item_id: 'a', quantity: 2, price: 0 }, { id: 'b', quantity: 1 }, { id: 'a', inventory_item_id: 'a', quantity: 3 }]);
  assert.deepEqual(cart, [{ id: 'a', inventory_item_id: 'a', quantity: 5 }, { id: 'b', quantity: 1 }]);
  assert.throws(() => math.normalizeCart([{ id: 'a', quantity: 99 }, { id: 'a', quantity: 1 }]), /Quantity/);
  assert.throws(() => math.normalizeCart([{ id: 'a', quantity: 1.5 }]), /Quantity/);
});
test('custom invoice lines round in cents and cannot consume inventory', () => {
  const [line] = math.customLines([{ name: ' Grip fitting ', quantity: 3, unit_amount: '12.35', inventory_item_id: 'forged', fulfilment_type: 'stock' }]);
  assert.equal(line.name, 'Grip fitting'); assert.equal(line.lineTotal, 37.05);
  assert.equal(line.fulfilment_type, 'service'); assert.equal(line.inventory_item_id, '');
  for (const value of [-1, Infinity, 'bad', 1.234, '', 1000001]) assert.throws(() => math.customLines([{ name: 'Custom', quantity: 1, unit_amount: value }]));
  assert.throws(() => math.customLines([{ name: '', quantity: 1, unit_amount: 5 }]), /description/);
});
test('invoice discounts support dollars and percentages with cent rounding and bounds', () => {
  assert.equal(math.discountCents(7000, { type: 'percent', value: 10 }), 700);
  assert.equal(math.discountCents(3333, { type: 'percent', value: 12.5 }), 417);
  assert.equal(math.discountCents(7000, { type: 'amount', value: 5.25 }), 525);
  assert.equal(math.discountCents(7000), 0);
  assert.throws(() => math.discountCents(1000, { type: 'amount', value: 11 }), /subtotal/);
  assert.throws(() => math.discountCents(1000, { type: 'percent', value: 101 }), /100%/);
  assert.throws(() => math.discountCents(1000, { type: 'amount', value: -1 }));
});

test('line cost, sell price and discount produce exact snapshots without modifying the source', () => {
  const original = { id: 'stock', quantity: 3, unitAmount: 20, purchase_price_at_sale: 8, fulfilment_type: 'stock' };
  const priced = math.linePricing(original, { unit_amount: 25, cost_price: 9.25, discount_percent: 10 });
  assert.equal(priced.unitAmount,22.5); assert.equal(priced.lineTotal,67.5);
  assert.equal(priced.purchase_price_at_sale,9.25); assert.equal(priced.line_discount_amount,7.5);
  assert.equal(priced.gross_profit_at_sale,39.75); assert.equal(priced.fulfilment_type,'stock');
  assert.equal(original.unitAmount,20); assert.equal(original.purchase_price_at_sale,8);
  assert.throws(() => math.linePricing(original, {discount_percent: 101}), /100%/);
  assert.throws(() => math.linePricing(original, {cost_price: -1}), /Cost price/);
  assert.throws(() => math.linePricing(original, {unit_amount: 1.001}), /decimal/);
  assert.throws(() => math.normalizeCart([{id:'stock',quantity:1,unit_amount:20},{id:'stock',quantity:1,unit_amount:25}]), /same prices/);
});
test('manual lines save internal costs and apply per-line discounts once', () => {
  const [row] = math.customLines([{name:'Grip fitting',quantity:2,unit_amount:25,cost_price:8,discount_percent:20}]);
  assert.equal(row.unitAmount,20); assert.equal(row.lineTotal,40); assert.equal(row.purchase_price_at_sale,8);
  assert.equal(row.gross_profit_at_sale,24); assert.equal(row.line_discount_percent,20);
});
