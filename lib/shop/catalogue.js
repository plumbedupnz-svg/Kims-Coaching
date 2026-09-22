const { getSupabaseConfig } = require('../../api/stripe/_helpers');
const { unitPrice } = require('../../shop-pricing');
const PUBLIC_FIELDS = 'id,product_name,brand,sku,slug,short_description,category,category_id,description,full_description,sell_price,discount,image_url,quantity_on_hand,status,visible_in_shop,is_active,track_stock,is_order_to_sale,item_kind,archived_at'.split(',');
const SETTINGS_FIELDS = 'pickup_label,pickup_instructions,local_delivery_enabled,local_delivery_fee,courier_delivery_enabled,courier_delivery_fee,free_shipping_threshold,tax_mode,tax_label,tax_rate_percent,prices_include_tax,stripe_automatic_tax';
let cached, pending;
async function publicRows(table, select, params = {}) {
  const { restUrl, anonKey } = getSupabaseConfig();
  const url = new URL(`${restUrl}/${table}`);
  url.searchParams.set('select', select);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Public catalogue request failed (${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Invalid public catalogue response.');
  return rows;
}
function publicProduct(row) {
  const safe = Object.fromEntries(PUBLIC_FIELDS.filter(key => key in row).map(key => [key, row[key]]));
  safe.inventory_item_images = (row.inventory_item_images || []).map(image => ({ id: image.id, image_url: image.image_url, sort_order: image.sort_order, is_main: image.is_main }));
  safe.source_row = 'inventory_items';
  return safe;
}
async function loadCatalogue({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < 30000) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await publicRows('inventory_items', `${PUBLIC_FIELDS.join(',')},inventory_item_images(id,image_url,sort_order,is_main)`, {
        visible_in_shop: 'eq.true', is_active: 'eq.true', archived_at: 'is.null', order: 'id.asc', limit: '500', offset: String(offset)
      });
      rows.push(...batch);
      if (batch.length < 500) break;
    }
    const settings = (await publicRows('shop_inventory_settings', SETTINGS_FIELDS, { id: 'eq.true', limit: '1' }))[0];
    if (!settings) throw new Error('Shop delivery settings are unavailable.');
    const value = { products: rows.filter(row => row.visible_in_shop === true && row.is_active !== false && !row.archived_at).map(publicProduct), settings };
    cached = { at: Date.now(), value };
    return value;
  })();
  try { return await pending; } finally { pending = null; }
}
const slug = product => String(product.slug || `${product.product_name}-${String(product.id).slice(0, 8)}`).toLowerCase().trim().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
const productPath = product => `/product?slug=${encodeURIComponent(slug(product))}`;
const price = product => unitPrice(product.sell_price, product.discount);
const isService = product => product.item_kind === 'service';
const toOrder = product => !isService(product) && (product.track_stock === false || product.is_order_to_sale === true);
const inStock = product => !isService(product) && !toOrder(product) && Number(product.quantity_on_hand) > 0 && product.status !== 'out_of_stock';
const purchasable = product => isService(product) || toOrder(product) || inStock(product);
const stockText = product => isService(product) ? 'Racket service · labour only' : toOrder(product) ? 'Available to order · contact us for timing' : inStock(product) ? `${Number(product.quantity_on_hand)} in stock` : 'Out of stock';
module.exports = { loadCatalogue, publicRows, publicProduct, PUBLIC_FIELDS, slug, productPath, price, isService, toOrder, inStock, purchasable, stockText };
