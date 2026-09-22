const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const pricing=require('../shop-pricing');
const product={id:'a1b2c3d4-1111-2222-3333-444444444444',product_name:'Sale racket',sell_price:449.98,discount:20,quantity_on_hand:4,track_stock:true};
function app({saved=[],products=[product],fresh=[product],fail=false}={}) {
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',addEventListener(){}});return elements.get(id);};
  element('shop-page-data').textContent=JSON.stringify({products,settings:{}});
  let stored=JSON.stringify(saved);
  const events=[];
  const document={getElementById:element,querySelector:selector=>selector==='[data-cart-message]'?element('message'):null,querySelectorAll:()=>[]};
  const window={KimsPricing:pricing,dispatchEvent:event=>events.push(event),addEventListener(){}};
  const localStorage={getItem:()=>stored,setItem:(_,value)=>{stored=value;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../storefront.js'),'utf8'),{window,document,localStorage,CustomEvent:class{constructor(type,data){this.type=type;this.detail=data?.detail;}},fetch:async()=>({ok:!fail,json:async()=>({products:fresh})}),setTimeout});
  return {shop:window.KimsShop,stored:()=>JSON.parse(stored),element,events};
}
test('new cart saves cents-rounded sale price, updates quantity and enforces stock',async()=>{
  const a=app();
  a.shop.addToCart(product,2);
  assert.equal(a.stored()[0].price,359.98);
  assert.equal(a.element('subtotal').textContent,'$719.96');
  await a.shop.ensureCartCurrent();
  assert.throws(()=>a.shop.addToCart(product,3),/Not enough stock/);
  assert.throws(()=>a.shop.addToCart(product,0.5),/whole quantity/);
});
test('legacy carts reprice without double discounting and refresh missing page products',async()=>{
  const a=app({saved:[{id:product.id,name:'Old name',price:449.98,quantity:2}],products:[]});
  await a.shop.ensureCartCurrent().catch(error=>assert.match(error.message,/price has changed/));
  assert.equal(a.shop.loadCart()[0].price,359.98);
  assert.equal(a.element('subtotal').textContent,'$719.96');
});
test('checkout requires review after a fresh price change and blocks removed or oversold stock',async()=>{
  const changed=app({fresh:[{...product,discount:0}]});
  changed.shop.addToCart(product);
  await assert.rejects(()=>changed.shop.ensureCartCurrent(),/price has changed/);
  assert.equal(changed.element('subtotal').textContent,'$449.98');
  assert.equal((await changed.shop.ensureCartCurrent())[0].price,449.98);
  const gone=app({fresh:[]});gone.shop.addToCart(product);
  await assert.rejects(()=>gone.shop.ensureCartCurrent(),/no longer available/);
  const fewer=app({fresh:[{...product,quantity_on_hand:1}]});fewer.shop.addToCart(product,2);
  await assert.rejects(()=>fewer.shop.ensureCartCurrent(),/only 1/);
  const offline=app({fail:true});offline.shop.addToCart(product);
  await assert.rejects(()=>offline.shop.ensureCartCurrent(),/Could not verify current prices/);
});
