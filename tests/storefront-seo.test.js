const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/storefront');
const { publicProduct, productPath, slug } = require('../lib/shop/catalogue');
const render = require('../lib/shop/render');
const copy = require('../lib/shop/content');
const item = (extra = {}) => ({id:'a1b2c3d4-1111-2222-3333-444444444444',product_name:'24-HEAD Example Racket',brand:'HEAD',sku:'EX',category:'Tennis Rackets',sell_price:449.98,discount:20,quantity_on_hand:2,track_stock:true,status:'active',visible_in_shop:true,is_active:true,image_url:'https://example.com/racket.jpg',...extra});
const settings = {pickup_label:'Club pickup',local_delivery_enabled:true,local_delivery_fee:10,courier_delivery_enabled:true,courier_delivery_fee:12,tax_mode:'none'};
const catalogue = {products:[item()],settings};
const schemas = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m=>JSON.parse(m[1]));
async function request(url, data=catalogue, method='GET') {
  const response={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}};
  await createHandler(async()=>{if(data instanceof Error)throw data; return data;})({url,method},response);
  return response;
}
test('initial HTML exposes the real sale offer, canonical, identity, stock and breadcrumbs without JS', async()=>{
  const response=await request(productPath(item()));
  assert.equal(response.statusCode,200);
  assert.match(response.body,/<h1>HEAD Example Racket \(2024\)<\/h1>/);
  assert.match(response.body,/>\$359.98 /);
  assert.match(response.body,/2 in stock/);
  assert.match(response.body,/rel="canonical" href="https:\/\/www.kimjonescoaching.co.nz\/product\?slug=/);
  const product=schemas(response.body).find(s=>s['@type']==='Product');
  assert.equal(product.offers.price,'359.98');
  assert.equal(product.offers.priceCurrency,'NZD');
  assert.equal(product.offers.availability,'https://schema.org/InStock');
  assert.ok(schemas(response.body).some(s=>s['@type']==='BreadcrumbList'));
  assert.equal(copy.title(item()),'HEAD Example Racket (2024)');
});
test('missing products and categories are 404; outages are 503 rather than false product removals',async()=>{
  for (const url of ['/product?slug=missing','/shop/missing','/shop?page=2']) assert.equal((await request(url)).statusCode,404,url);
  const unavailable=await request('/shop',new Error('database offline'));
  assert.equal(unavailable.statusCode,503);
  assert.equal(unavailable.headers['Retry-After'],'60');
  assert.match(unavailable.body,/noindex/);
  assert.equal((await request('/shop',catalogue,'HEAD')).body,'');
  assert.equal((await request('/shop',catalogue,'POST')).statusCode,405);
});
test('pagination has crawlable URLs, distinct canonicals and only seeds the products on the page', async()=>{
  const products=Array.from({length:43},(_,i)=>item({id:`a1b2c3d4-1111-2222-3333-${String(i).padStart(12,'0')}`,slug:'racket-'+i,product_name:'Racket '+String(i).padStart(2,'0')}));
  const response=await request('/shop?page=2',{products,settings});
  assert.match(response.body,/canonical" href="https:\/\/www.kimjonescoaching.co.nz\/shop\?page=2/);
  assert.match(response.body,/href="\/shop\?page=3"/);
  assert.match(response.body,/Showing 21–40 of 43/);
  const data=JSON.parse(response.body.match(/id="shop-page-data">(.*?)<\/script>/s)[1]);
  assert.equal(data.products.length,20);
  assert.doesNotMatch(response.body,/noindex/);
  assert.match((await request('/shop?q=racket',{products,settings})).body,/noindex,follow/);
  assert.match((await request('/shop?size=all',{products,settings})).body,/Showing 1–43 of 43/);
});
test('public allowlist drops financial data including nested image values; user content cannot break out',async()=>{
  const safe=publicProduct(item({cost_price:99,purchase_price:100,inventory_item_images:[{image_url:'https://example.com/p.jpg',cost_price:77}],product_name:'</script><script>alert(1)</script>'}));
  assert.doesNotMatch(JSON.stringify(safe),/cost_price|purchase_price/);
  const response=await request(productPath(safe),{products:[safe],settings});
  assert.doesNotMatch(response.body,/<script>alert\(1\)<\/script>/);
  assert.match(response.body,/&lt;\/script&gt;/);
  assert.ok(schemas(response.body).length);
});
test('sitemap reflects the current products; feed excludes services and unconfirmed supplier stock',()=>{
  const products=[item(),item({id:'order',slug:'to-order',track_stock:false}),item({id:'service',slug:'labour',item_kind:'service'}),item({id:'sold',slug:'sold',quantity_on_hand:0})];
  const sitemap=render.sitemap(products);
  assert.match(sitemap,/\/shop\/tennis-rackets/);
  products.forEach(p=>assert.ok(sitemap.includes(slug(p))));
  const feed=render.merchantFeed({products,settings});
  assert.equal((feed.match(/<item>/g)||[]).length,1);
  assert.match(feed,/<g:price>449.98 NZD/);
  assert.match(feed,/<g:sale_price>359.98 NZD/);
  assert.match(feed,/<g:price>12.00 NZD/);
  assert.doesNotMatch(feed,/<g:id>(order|service|sold)<\/g:id>/);
  const sold=render.merchantFeed({products:[item({quantity_on_hand:0})],settings});
  assert.doesNotMatch(sold,/<item>/);
  const p=schemas(render.productPage(products[1],{products,settings})).find(s=>s['@type']==='Product');
  assert.equal(p.offers.availability,undefined);
  assert.ok(!schemas(render.productPage(products[2],{products,settings})).some(s=>s['@type']==='Product'));
});
test('category pages and every information/guide route have useful initial HTML',async()=>{
  for (const path of ['/shop/tennis-rackets','/delivery','/returns','/contact','/guides/junior-racket-size','/guides/tennis-grips']) {
    const response=await request(path);
    assert.equal(response.statusCode,200,path);
    assert.match(response.body,/<h1>/);
    assert.match(response.body,/rel="canonical"/);
  }
});

test('owner hide-out-of-stock preference removes sold-out cards but preserves services and sourced items', async()=>{
  const products=[item({slug:'stocked',product_name:'Stocked racket'}),item({id:'sold',slug:'sold',product_name:'Sold racket',quantity_on_hand:0}),item({id:'sourced',slug:'sourced',product_name:'Sourced racket',track_stock:false,quantity_on_hand:0}),item({id:'labour',slug:'labour',product_name:'Stringing labour',item_kind:'service',quantity_on_hand:0})];
  const data={products,settings:{...settings,hide_out_of_stock:true}};
  const response=await request('/shop',data);
  assert.match(response.body,/Showing 1–3 of 3/);
  const seed=JSON.parse(response.body.match(/id="shop-page-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(seed.products.map(p=>p.slug).sort(),['labour','sourced','stocked']);
  assert.equal((await request('/product?slug=sold',data)).statusCode,200);
  assert.match((await request('/shop',{products,settings})).body,/Showing 1–4 of 4/);
});
