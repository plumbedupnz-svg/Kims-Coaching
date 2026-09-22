// Read-only local storefront preview. POSTs never reach a live service.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const storefront = require('../api/storefront');
const products = require('../api/shop-products');
const root = path.resolve(__dirname,'..');
const csp = require('../vercel.json').headers[0].headers[0].value.replace('; upgrade-insecure-requests','');
http.createServer(async(req,res)=>{
  res.status = code => {res.statusCode=code;return res;};
  res.json = value => {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  res.setHeader('Content-Security-Policy',csp);
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);return res.end('Read-only preview');}
  const url = new URL(req.url,'http://localhost:4173');
  if(url.pathname==='/api/shop-products')return products(req,res);
  if(url.pathname==='/api/shop-checkout'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({provider:'stripe'}));}
  if (/^\/(shop(?:\/.*)?|product|delivery|returns|contact|guides\/.*|sitemap.xml|merchant-products.xml)$/.test(url.pathname)) return storefront(req,res);
  let file = path.resolve(root,'.'+decodeURIComponent(url.pathname === '/'?'/index.html':url.pathname));
  if(!path.extname(file))file+='.html';
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}
  res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.xml':'application/xml','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(4173,'127.0.0.1',()=>console.log('Read-only preview http://127.0.0.1:4173'));
