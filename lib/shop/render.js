const fs = require('node:fs');
const path = require('node:path');
const c = require('./catalogue');
const copy = require('./content');
const SITE = 'https://www.kimjonescoaching.co.nz';
const EMAIL = 'kimjonescoaching@outlook.com';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const money = amount => `$${Number(amount).toFixed(2)}`;
const safeImage = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
function images(product) {
  const gallery = [...(product.inventory_item_images || [])].sort((a, b) => Number(b.is_main) - Number(a.is_main) || Number(a.sort_order) - Number(b.sort_order));
  return [...new Set([gallery.find(image => image.is_main)?.image_url, product.image_url, ...gallery.map(image => image.image_url)].map(safeImage).filter(Boolean))];
}
function breadcrumbs(items) {
  return `<nav class="shop-breadcrumbs" aria-label="Breadcrumb">${items.map(([name, href], index) => `${index ? '<span aria-hidden="true">/</span>' : ''}<a href="${esc(href)}">${esc(name)}</a>`).join('')}</nav>`;
}
const breadcrumbSchema = items => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, href], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + href })) });
function shell({ title, description, canonical, body, schemas = [], image, noindex = false, seed }) {
  return `<!DOCTYPE html><html lang="en-NZ"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} | Kim Jones Coaching</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(SITE + canonical)}">${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(SITE + canonical)}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<link rel="stylesheet" href="/styles.css?v=20260922"><link rel="stylesheet" href="/layout-option-2.css?v=20260922"><link rel="stylesheet" href="/shop-seo.css?v=20260922"><link rel="stylesheet" href="/analytics.css?v=20260917"><link rel="stylesheet" href="/header-cart.css?v=20260920">
<script src="/analytics.js?v=20260922" defer></script><script src="/header-cart.js?v=20260922" defer></script>
${schemas.map(schema => `<script type="application/ld+json">${json(schema)}</script>`).join('\n')}</head><body>
<header class="site-header"><nav class="container nav" aria-label="Primary navigation"><a class="brand" href="/" aria-label="Kim Jones Coaching home"><span class="brand-main">KIM JONES</span><span class="brand-sub">COACHING</span></a><button class="menu-toggle" type="button" aria-label="Open menu" aria-controls="primary-nav" aria-expanded="false" data-menu-toggle><span></span><span></span><span></span></button><div class="nav-links" id="primary-nav" data-nav-links data-storefront-nav><a href="/shop">Shop</a><a href="/shop/junior-tennis-rackets">Junior rackets</a><a href="/shop/pickleball-paddles">Pickleball</a><a href="/booking">Book coaching</a><a href="/contact">Contact</a><a href="/account" data-store-account>Login</a></div></nav></header>
<main>${body}</main><footer class="site-footer"><div class="container shop-footer"><p>Kim Jones Coaching Limited</p><nav aria-label="Shop information"><a href="/delivery">NZ delivery & pickup</a><a href="/returns">Returns & order help</a><a href="/contact">Contact Kim</a><a href="/privacy">Privacy policy</a></nav><p><a href="mailto:${EMAIL}">${EMAIL}</a></p></div></footer>
${seed ? `<script type="application/json" id="shop-page-data">${json(seed)}</script><script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><script src="/supabase-config.js"></script><script src="/shop-pricing.js?v=20260922"></script>` : ''}
<script src="/storefront.js?v=20260922" defer></script>${seed ? '<script src="/shop-order-emails.js?v=20260922" defer></script>' : ''}</body></html>`;
}
function cartSection() {
  const template = fs.readFileSync(path.join(__dirname, 'templates/shop-legacy.html'), 'utf8');
  const cart = template.slice(template.indexOf('<section class="section alt" id="cart">'), template.lastIndexOf('</main>'));
  return cart.replace(/href="privacy.html"/g, 'href="/privacy"').replace(/\s*<label for="promo-code">[\s\S]*?<p class="helper-text" id="promo-message"><\/p>/, '')
    .replace('<div id="cart-items" class="cart-items"></div>', '<div id="cart-items" class="cart-items"><p>Your cart is empty.</p></div><p class="helper-text" data-cart-message role="status"></p>')
    .replace('<button class="btn btn-primary full" id="checkout-btn">', '<button class="btn btn-primary full" id="checkout-btn" disabled>');
}
function card(product, index = 5) {
  const name = copy.title(product), photo = images(product)[0], price = c.price(product);
  return `<article class="product-card product-card-compact" data-product-id="${esc(product.id)}"><a class="product-card-link" href="${esc(c.productPath(product))}">${photo ? `<img src="${esc(photo)}" alt="${esc(name)}" class="product-image" width="400" height="400" loading="${index < 2 ? 'eager' : 'lazy'}" decoding="async">` : '<div class="product-image product-image-placeholder">View product details</div>'}</a><p class="owner-meta">${esc(product.category)}</p><h3><a href="${esc(c.productPath(product))}">${esc(name)}</a></h3><p class="owner-meta">${esc(c.stockText(product))}</p><div class="price-wrap">${Number(product.discount) > 0 ? `<p class="old-price">${money(product.sell_price)}</p>` : ''}<p class="price">${money(price)} <span class="currency-label">NZD</span></p></div><div class="product-card-actions"><button class="btn btn-primary" type="button" data-add-product="${esc(product.id)}" ${c.purchasable(product) ? '' : 'disabled'}>${c.purchasable(product) ? 'Add to cart' : 'Out of stock'}</button><a class="btn btn-secondary" href="${esc(c.productPath(product))}">View details</a></div></article>`;
}
function deliverySummary(settings, product) {
  if (c.isService(product)) return '<p>Bring your racket to Kim. Confirm drop-off and collection arrangements before ordering this service.</p>';
  const free = Number(settings.free_shipping_threshold) > 0 && c.price(product) >= Number(settings.free_shipping_threshold);
  const shipping = settings.courier_delivery_enabled ? `<strong>NZ courier: ${free ? 'free for this item' : money(settings.courier_delivery_fee)}</strong>.` : 'Contact Kim to arrange delivery.';
  return `<div class="product-delivery"><p>${shipping} ${esc(settings.pickup_label || 'Pickup from coaching / club')} is also available.</p><p>${c.toOrder(product) ? 'This item is sourced to order. Contact Kim for availability and an estimated arrival date before ordering if you need it by a particular date.' : 'Need this for a match or a gift? Contact Kim to confirm dispatch timing before ordering.'}</p><p><a href="/delivery">Delivery details</a> · <a href="/returns">Returns & order help</a></p></div>`;
}
function productPage(product, catalogue) {
  const { products, settings } = catalogue;
  const name = copy.title(product), editorial = copy.productCopy[product.sku], category = copy.categoryFor(product);
  const crumbs = [['Home', '/'], ['Shop', '/shop'], ...(category ? [[category.title.replace(' NZ', ''), `/shop/${category.slug}`]] : []), [name, c.productPath(product)]];
  const gallery = images(product);
  const related = products.filter(p => p.id !== product.id && c.inStock(p)).sort((a, b) => Number(editorial?.related?.includes(b.sku)) - Number(editorial?.related?.includes(a.sku)) || Number(b.category === product.category) - Number(a.category === product.category)).slice(0, 3);
  const raw = String(product.full_description || product.description || product.short_description || '').replace(/&nbsp;/g, ' ');
  const detail = editorial
    ? `<p>${esc(editorial.intro)}</p>${editorial.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}<table class="product-specs"><caption>Product specifications</caption><tbody>${editorial.specs.map(([label, value]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="product-description-text">${esc(raw || 'Contact Kim for help with the specifications of this item.')}</div>`;
  const schemas = [breadcrumbSchema(crumbs)];
  if (!c.isService(product)) {
    const offer = { '@type': 'Offer', url: SITE + c.productPath(product), priceCurrency: 'NZD', price: c.price(product).toFixed(2), itemCondition: 'https://schema.org/NewCondition', seller: { '@type': 'Organization', name: 'Kim Jones Coaching Limited' } };
    if (!c.toOrder(product)) offer.availability = `https://schema.org/${c.inStock(product) ? 'InStock' : 'OutOfStock'}`;
    schemas.push({ '@context': 'https://schema.org', '@type': 'Product', name, description: copy.description(product), image: gallery, sku: product.sku || product.id, ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}), ...(editorial?.mpn ? { mpn: editorial.mpn } : {}), offers: offer });
  }
  const body = `<section class="section"><div class="container">${breadcrumbs(crumbs)}<article class="product-detail"><div class="product-detail-media"><div class="product-detail-gallery">${gallery[0] ? `<img class="product-detail-image" src="${esc(gallery[0])}" alt="${esc(name)}" width="700" height="700" fetchpriority="high" data-main-product-image>` : ''}${gallery.length > 1 ? `<div class="product-detail-thumbs" aria-label="Product photos">${gallery.map((url, index) => `<button type="button" class="product-detail-thumb ${index === 0 ? 'active' : ''}" data-product-photo="${esc(url)}" aria-label="Show photo ${index + 1}"><img src="${esc(url)}" alt="" width="80" height="80" loading="lazy"></button>`).join('')}</div>` : ''}</div></div><div class="product-detail-summary"><p class="eyebrow">${esc(product.brand || product.category)}</p><h1>${esc(name)}</h1><p class="product-detail-status">${esc(c.stockText(product))}</p><div class="price-wrap">${Number(product.discount) > 0 ? `<p class="old-price">${money(product.sell_price)}</p>` : ''}<p class="price">${money(c.price(product))} <span class="currency-label">NZD</span></p></div><p>${esc(copy.description(product).split('\n')[0])}</p><label for="product-detail-quantity">Quantity</label><input id="product-detail-quantity" type="number" min="1" max="${c.inStock(product) ? Math.min(99, Number(product.quantity_on_hand)) : 99}" value="1" step="1" ${c.purchasable(product) ? '' : 'disabled'}><div class="product-detail-actions"><button class="btn btn-primary" type="button" data-add-product="${esc(product.id)}" data-product-quantity ${c.purchasable(product) ? '' : 'disabled'}>${c.purchasable(product) ? 'Add to cart' : 'Out of stock'}</button><a class="btn btn-secondary" href="#cart">View cart</a></div><p class="helper-text" data-product-message role="status"></p>${deliverySummary(settings, product)}<p class="helper-text">Product code: ${esc(product.sku || product.id)}</p><noscript><p>Enable JavaScript to add items to your cart, or <a href="/contact">contact Kim to order</a>.</p></noscript></div><section class="product-detail-description"><h2>About this product</h2>${detail}<p><a href="mailto:${EMAIL}">Ask Kim about this product</a>. Please quote the product code.</p>${category?.slug === 'junior-tennis-rackets' ? '<p><a href="/guides/junior-racket-size">Read the junior racket buying guide</a></p>' : ''}</section></article>${related.length ? `<section class="shop-related"><h2>Also in stock</h2><p>Check sizes and compatibility before adding accessories.</p><div class="cards three-col">${related.map(card).join('')}</div></section>` : ''}</div></section>${cartSection()}`;
  return shell({ title: name, description: copy.description(product).replace(/\s+/g, ' ').slice(0, 170), canonical: c.productPath(product), image: gallery[0], body, schemas, seed: { products: [product, ...related].map(p => ({ ...p, product_name: copy.title(p) })), settings, productId: product.id } });
}
function listingPage(catalogue, category, query) {
  const { products, settings } = catalogue;
  const base = category ? `/shop/${category.slug}` : '/shop';
  const term = String(query.get('q') || '').trim().slice(0, 100);
  const requestedSize = query.get('size');
  const size = requestedSize === 'all' ? Math.max(1, products.length) : ['20', '40', '60'].includes(requestedSize) ? Number(requestedSize) : 20;
  let filtered = products.filter(p => !category || category.matches(p));
  if (query.get('stock') === 'ready') filtered = filtered.filter(c.inStock);
  if (term) {
    const words = term.toLowerCase().split(/\s+/);
    filtered = filtered.filter(p => words.every(word => `${copy.title(p)} ${p.brand} ${p.sku} ${p.category}`.toLowerCase().includes(word)));
  }
  const priority = p => c.inStock(p) ? (copy.heroSkus.includes(p.sku) ? 0 : 1) : c.purchasable(p) ? 2 : 3;
  filtered.sort((a, b) => priority(a) - priority(b) || copy.title(a).localeCompare(copy.title(b)));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const requestedPage = Number(query.get('page') || 1);
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > pages) return null;
  const page = requestedPage, start = (page - 1) * size, shown = filtered.slice(start, start + size);
  const title = category?.title || 'Tennis & Pickleball Shop NZ';
  const intro = category?.intro || 'Shop tennis and pickleball equipment from Kim Jones Coaching. Start with the products in stock, browse by category, or ask Kim for help choosing your gear.';
  const pageHref = number => { const params = new URLSearchParams(); if (number > 1) params.set('page', number); if (requestedSize && requestedSize !== '20') params.set('size', requestedSize); if (term) params.set('q', term); if (query.get('stock') === 'ready') params.set('stock', 'ready'); return base + (params.size ? '?' + params : ''); };
  const nav = pages > 1 ? `<nav class="shop-page-links" aria-label="Product pages">${Array.from({length: pages}, (_, i) => `<a class="btn btn-secondary" href="${esc(pageHref(i + 1))}" ${i + 1 === page ? 'aria-current="page"' : ''}>${i + 1}</a>`).join('')}</nav>` : '';
  const activeCategories = copy.categories.filter(cat => products.some(cat.matches));
  const crumbs = [['Home', '/'], ['Shop', '/shop'], ...(category ? [[title.replace(' NZ', ''), base]] : [])];
  const body = `<section class="section"><div class="container">${breadcrumbs(crumbs)}<div class="section-head"><p class="eyebrow">Kim Jones Coaching shop</p><h1>${esc(title)}</h1><p>${esc(intro)}</p><p><a href="/delivery">NZ delivery & pickup</a> · <a href="/contact">Help choosing your gear</a></p></div><nav class="shop-category-links" aria-label="Shop categories"><a href="/shop" ${!category ? 'aria-current="page"' : ''}>All products</a>${activeCategories.map(cat => `<a href="/shop/${cat.slug}" ${cat.slug === category?.slug ? 'aria-current="page"' : ''}>${esc(cat.title.replace(' NZ', ''))}</a>`).join('')}</nav><form class="shop-toolbar" method="get" action="${base}" role="search" aria-label="Find products"><div class="shop-search-field"><label for="shop-search">Search products</label><input id="shop-search" type="search" name="q" value="${esc(term)}" placeholder="Name, brand or product code"></div><div><label for="stock-filter">Availability</label><select id="stock-filter" name="stock"><option value="">All availability</option><option value="ready" ${query.get('stock') === 'ready' ? 'selected' : ''}>In stock now</option></select></div><div><label for="shop-page-size">Items per page</label><select id="shop-page-size" name="size">${['20','40','60','all'].map(value => `<option value="${value}" ${String(requestedSize || '20') === value ? 'selected' : ''}>${value === 'all' ? 'All' : value}</option>`).join('')}</select></div><button class="btn btn-primary" type="submit">Show products</button>${term || query.get('stock') ? `<a href="${base}">Clear filters</a>` : ''}</form><p class="shop-results-summary" role="status">${filtered.length ? `Showing ${start + 1}–${start + shown.length} of ${filtered.length} products` : 'No products match these filters.'}</p>${nav}<div id="product-list" class="cards three-col">${shown.map(card).join('')}</div>${nav}<noscript><p>Enable JavaScript to use the cart, or <a href="/contact">contact Kim to order</a>.</p></noscript></div></section>${cartSection()}`;
  return shell({ title: title + (page > 1 ? ` — Page ${page}` : ''), description: intro, canonical: pageHref(page), noindex: Boolean(term || query.get('stock') || (requestedSize && requestedSize !== '20')), body, schemas: [breadcrumbSchema(crumbs)], seed: { products: shown.map(p => ({...p, product_name: copy.title(p)})), settings } });
}
function sitemap(products) {
  const paths = ['/', '/booking', '/shop', '/delivery', '/returns', '/contact', '/privacy', '/guides/junior-racket-size', '/guides/tennis-grips', ...copy.categories.filter(cat => products.some(cat.matches)).map(cat => `/shop/${cat.slug}`), ...products.map(c.productPath)];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(paths)].map(url => `<url><loc>${esc(SITE + url)}</loc></url>`).join('')}</urlset>`;
}
function merchantFeed({products, settings}) {
  // Supplier availability is unconfirmed. Feed only stock we can substantiate;
  // services and ambiguous order-to-sale stock never become invented InStock offers.
  if (settings.tax_mode === 'gst_exclusive') throw new Error('Merchant feed requires tax-inclusive retail prices.');
  const eligible = products.filter(p => c.inStock(p) && images(p).length && c.price(p) > 0);
  const tag = (name, value) => `<g:${name}>${esc(value)}</g:${name}>`;
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Kim Jones Coaching NZ shop</title><link>${SITE}/shop</link><description>Currently stocked products, priced in NZD.</description>${eligible.map(product => `<item>${tag('id', product.id)}${tag('title', copy.title(product))}${tag('description', copy.description(product))}${tag('link', SITE + c.productPath(product))}${tag('image_link', images(product)[0])}${images(product).slice(1, 11).map(image => tag('additional_image_link', image)).join('')}${product.brand ? tag('brand', product.brand) : ''}${copy.productCopy[product.sku]?.mpn ? tag('mpn', copy.productCopy[product.sku].mpn) : ''}${tag('condition', 'new')}${tag('availability', 'in_stock')}${tag('price', Number(product.sell_price).toFixed(2) + ' NZD')}${Number(product.discount) > 0 ? tag('sale_price', c.price(product).toFixed(2) + ' NZD') : ''}${settings.courier_delivery_enabled ? `<g:shipping>${tag('country','NZ')}${tag('service','NZ courier')}${tag('price', (Number(settings.free_shipping_threshold) > 0 && c.price(product) >= Number(settings.free_shipping_threshold) ? '0.00' : Number(settings.courier_delivery_fee).toFixed(2)) + ' NZD')}</g:shipping>` : ''}</item>`).join('')}</channel></rss>`;
}
function errorPage(title, message) {
  return shell({ title, description: message, canonical: '/shop', noindex: true, body: `<section class="section"><div class="container"><h1>${esc(title)}</h1><p>${esc(message)}</p><a class="btn btn-primary" href="/shop">Browse the shop</a></div></section>` });
}
module.exports = { SITE, EMAIL, esc, json, money, shell, card, productPage, listingPage, sitemap, merchantFeed, errorPage, images };
