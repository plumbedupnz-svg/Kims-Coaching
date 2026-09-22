const { loadCatalogue, slug, productPath } = require('../lib/shop/catalogue');
const { categories } = require('../lib/shop/content');
const render = require('../lib/shop/render');
const { paths, informationPage } = require('../lib/shop/pages');
function createHandler(load = loadCatalogue) {
  return async function storefront(request, response) {
    const send = (status, body, type = 'text/html; charset=utf-8') => {
      response.statusCode = status;
      response.setHeader('Content-Type', type);
      response.setHeader('Cache-Control', status === 200 ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=30' : 'no-store');
      if (status !== 200) response.setHeader('X-Robots-Tag', 'noindex');
      response.end(request.method === 'HEAD' ? '' : body);
    };
    if (!['GET','HEAD'].includes(request.method)) { response.setHeader('Allow','GET, HEAD'); return send(405, render.errorPage('Method not allowed', 'Open the shop to continue.')); }
    const url = new URL(request.url, render.SITE);
    const page = request.query?.view || url.searchParams.get('view') || url.pathname;
    const categorySlug = request.query?.category || url.searchParams.get('category');
    const query = url.searchParams;
    try {
      const catalogue = await load();
      if (page === 'sitemap' || page === '/sitemap.xml') return send(200, render.sitemap(catalogue.products), 'application/xml; charset=utf-8');
      if (page === 'merchant' || page === '/merchant-products.xml') return send(200, render.merchantFeed(catalogue), 'application/xml; charset=utf-8');
      if (page === 'product' || page === '/product') {
        const requested = String(request.query?.slug || query.get('slug') || '').toLowerCase();
        const product = catalogue.products.find(p => slug(p) === requested);
        if (!product) return send(404, render.errorPage('Product not found', 'This product is no longer available at this address. Browse the current range or contact Kim for help.'));
        return send(200, render.productPage(product, catalogue));
      }
      if (page === 'shop' || page === '/shop' || String(page).startsWith('/shop/')) {
        const name = categorySlug || (String(page).startsWith('/shop/') ? String(page).slice(6) : '');
        const category = name ? categories.find(c => c.slug === name && catalogue.products.some(c.matches)) : null;
        if (name && !category) return send(404, render.errorPage('Category not found', 'Browse the current shop categories.'));
        const html = render.listingPage(catalogue, category, query);
        return html ? send(200, html) : send(404, render.errorPage('Page not found', 'Choose a page from the current shop.'));
      }
      const infoPath = String(page).startsWith('/') ? page : '/' + page;
      if (paths.includes(infoPath)) return send(200, informationPage(infoPath, catalogue));
      return send(404, render.errorPage('Page not found', 'Browse the current shop.'));
    } catch (error) {
      console.error('Storefront unavailable:', error.message);
      response.setHeader('Retry-After', '60');
      return send(503, render.errorPage('The shop is temporarily unavailable', 'Please try again shortly, or email kimjonescoaching@outlook.com for help with an order.'));
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
