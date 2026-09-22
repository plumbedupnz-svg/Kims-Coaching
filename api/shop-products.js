const { loadCatalogue } = require('../lib/shop/catalogue');
module.exports = async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  const url = new URL(request.url, 'https://www.kimjonescoaching.co.nz');
  const ids = url.searchParams.get('ids');
  const selected = ids ? ids.split(',') : null;
  if (selected && (selected.length > 50 || selected.some(id => !/^[a-f0-9-]{36}$/i.test(id)))) return response.status(400).json({ error: 'Invalid product selection.' });
  try {
    const { products } = await loadCatalogue({ fresh: Boolean(selected) });
    response.setHeader('Cache-Control', selected ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=60');
    if (request.method === 'HEAD') return response.status(200).end();
    return response.status(200).json({ products: selected ? products.filter(product => selected.includes(product.id)) : products });
  } catch (error) {
    console.error('[Shop products]', error.message);
    response.setHeader('Cache-Control', 'no-store');
    return response.status(503).json({ error: 'Products are temporarily unavailable. Please try again.' });
  }
};
