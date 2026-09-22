// Local-only UI preview. Synthetic data; no payments, emails or production writes.
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  port = 4175;
const service = {
  id: "12345678-1234-4234-8234-123456789012",
  product_name: "Racket stringing – labour",
  sku: "KJC-STRING-LABOUR",
  category: "Services",
  sell_price: 50,
  description: "Labour per racket. Strings charged separately.",
  item_kind: "service",
  track_stock: false,
  is_order_to_sale: false,
  quantity_on_hand: 0,
  visible_in_shop: true,
  is_active: true,
  inventory_item_images: [],
};
const strings = {
  ...service,
  id: "12345678-1234-4234-8234-123456789013",
  product_name: "Demo string set",
  sku: "DEMO-STRINGS",
  category: "Strings",
  sell_price: 20,
  item_kind: "product",
  track_stock: true,
  status: "in_stock",
  quantity_on_hand: 3,
  description: "Sample string set for checkout testing.",
};
const settings = {
  tax_mode: "none",
  pickup_label: "Pick up from coaching / club",
  pickup_instructions: "Bring your racket to Kim.",
  courier_delivery_enabled: true,
  courier_delivery_fee: 8,
  local_delivery_enabled: false,
};
const invoiceSettings = {
  enabled: true,
  stripe_ready: true,
  bank_name: "KIM JONES COACHING LTD",
  bank_number: "01-0286-0978708-00",
  due_days: 0,
  sales_account_code: "200",
  branding_theme_id: service.id,
};
let order = null,
  status = "pending";
const bootstrap = `window.KIMS_SUPABASE={url:location.origin,anonKey:'preview'};
class Query {constructor(t){this.t=t;} select(){return this;} order(){return this;} limit(){return this;} eq(){return this;} in(){return this;} is(){return this;} maybeSingle(){return Promise.resolve({data:this.t==='shop_inventory_settings'?${JSON.stringify(settings)}:{role:'admin'}});} single(){return this.maybeSingle();} then(a,b){return fetch('/rest/v1/'+this.t).then(r=>r.json()).then(data=>({data,count:data.length})).then(a,b);}}
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:location.pathname.includes('admin')?{user:{id:'preview-admin',email:'preview@example.com'},access_token:'preview'}:null}}),onAuthStateChange:()=>{}},from:t=>new Query(t),rpc:async()=>({data:[]})})};`;
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1"),
      send = (v) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(v));
      };
    try {
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.split("/").pop();
        return send(
          table === "inventory_items"
            ? [service, strings]
            : table === "product_categories"
              ? [
                  { id: service.id, name: "Services" },
                  { id: strings.id, name: "Strings" },
                ]
              : table === "shop_orders"
                ? order
                  ? [order]
                  : []
                : table === "profiles"
                  ? [{ role: "admin" }]
                  : [],
        );
      }
      if (url.pathname === "/api/shop-checkout") {
        if (req.method === "GET")
          return send({
            provider: "xero",
            card: true,
            bank_transfer: true,
            ...invoiceSettings,
          });
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        if (body.action === "status")
          return send({
            reference: "DEMO-000001",
            total: order?.total_amount || 50,
            status,
            due: status === "paid" ? 0 : order?.total_amount || 50,
            due_date: "2026-09-17",
            invoice_url: "https://in.xero.com/preview-only",
            email_status: "sent",
            bank_name: invoiceSettings.bank_name,
            bank_number: invoiceSettings.bank_number,
          });
        order = {
          id: service.id,
          order_reference: "DEMO-000001",
          created_at: new Date().toISOString(),
          customer_name: body.checkout.customer.full_name,
          customer_email: body.checkout.customer.email,
          customer_phone: body.checkout.customer.phone,
          items: body.cart.map((i) => ({
            ...i,
            unitAmount: i.id === service.id ? 50 : 20,
          })),
          total_amount: body.cart.reduce(
            (a, i) => a + (i.id === service.id ? 50 : 20) * i.quantity,
            0,
          ),
          payment_provider: "xero",
          payment_method: body.checkout.payment_method,
          payment_status: "pending",
          order_status: "pending_payment",
          fulfilment_status: "unfulfilled",
          service_details: body.checkout.service_details,
          xero_invoice_id: service.id,
          invoice_email_status: "sent",
          xero_amount_due: 50,
        };
        return send({
          provider: "xero",
          url: "/order-payment.html#" + body.checkout_key,
        });
      }
      if (url.pathname === "/api/xero") {
        if (req.method === "POST") {
          let raw = "";
          for await (const c of req) raw += c;
          const b = JSON.parse(raw);
          if (b.action === "save_settings")
            Object.assign(invoiceSettings, b.settings);
          if (b.action === "fulfilment" && order)
            order.fulfilment_status = b.status;
          return send({ saved: true });
        }
        return send({
          configured: true,
          connected: true,
          webhook_configured: true,
          tenant_id: service.id,
          tenant_name: "Kim Jones Coaching — PREVIEW",
          settings: invoiceSettings,
          organisations: [
            { id: service.id, name: "Kim Jones Coaching — PREVIEW" },
          ],
          accounts: [{ code: "200", name: "Sales" }],
          themes: [{ id: service.id, name: "Shop invoices" }],
        });
      }
      if (url.pathname === "/fixture/status") {
        status = url.searchParams.get("value") || "pending";
        return send({ status });
      }
      let relative = ["/", "/shop.html", "/shop"].includes(url.pathname) ? "lib/shop/templates/shop-legacy.html" : url.pathname.slice(1);
      if (!path.extname(relative)) relative += ".html";
      const file = path.resolve(root, relative);
      if (
        !file.startsWith(root + path.sep) ||
        !fs.existsSync(file) ||
        ![".html", ".js", ".css", ".svg", ".png", ".jpg", ".webp"].includes(
          path.extname(file),
        )
      ) {
        res.statusCode = 404;
        return res.end("Not found");
      }
      let content = fs.readFileSync(file);
      if (relative.endsWith(".html")) {
        let html = content.toString();
        html = html
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
          .replace('<div id="owner-panel" hidden>', '<div id="owner-panel">');
        const scripts =
          relative === "admin.html"
            ? [
                "admin-settings-tabs.js",
                "admin-xero.js",
                "admin-dashboard.js",
                "admin-shop-orders.js",
              ]
            : relative === "order-payment.html"
              ? ["order-payment.js"]
              : ["product-categories.js", "app.js", "shop-order-emails.js"];
        html = html
          .replace("<body", "<body")
          .replace(
            "</body>",
            `<script>${bootstrap}</script>${scripts.map((s) => '<script src="' + s + '"></script>').join("")}</body>`,
          )
          .replace(
            "<main",
            '<p style="padding:12px;background:#fff3cd;color:#18233b;text-align:center">LOCAL PREVIEW · Sample data only. No payments or emails.</p><main',
          );
        content = html;
      }
      res.setHeader(
        "Content-Type",
        relative.endsWith(".html")
          ? "text/html"
          : relative.endsWith(".js")
            ? "application/javascript"
            : relative.endsWith(".css")
              ? "text/css"
              : "image/" + path.extname(file).slice(1),
      );
      res.end(content);
    } catch (e) {
      res.statusCode = 500;
      res.end(e.message);
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log("Invoice preview: http://127.0.0.1:" + port + "/shop.html"),
  );
