const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const read = (f) => fs.readFileSync(f, "utf8");
test("invoice permissions, duplicate checkout, reservations and Xero payment updates", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(read("tests/fixtures/racket-base.sql"));
  await db.exec(read("tests/fixtures/shop-invoices-base.sql"));
  for (const name of [
    "20260629000000_create_shop_orders_for_stripe_checkout.sql",
    "20260629030000_shop_checkout_delivery.sql",
    "20260716020000_shop_tax_settings.sql",
    "20260917000000_shop_services_xero.sql",
  ])
    await db.exec(read("supabase/migrations/" + name));
  await db.exec(
    read("supabase/migrations/20260917000000_shop_services_xero.sql"),
  );
  const service = (
    await db.query(
      "select * from inventory_items where sku='KJC-STRING-LABOUR'",
    )
  ).rows;
  assert.equal(service.length, 1);
  assert.equal(Number(service[0].sell_price), 50);
  assert.equal(service[0].track_stock, false);
  const stock = randomUUID(),
    tenant = randomUUID(),
    invoice = randomUUID();
  await db.query(
    "insert into inventory_items(id,product_name,quantity_on_hand) values($1,'String set',3)",
    [stock],
  );
  const payload = {
    checkout_key_hash: "a".repeat(64),
    checkout_digest: "b".repeat(64),
    user_id: null,
    customer_name: "Demo Customer",
    customer_email: "demo@example.com",
    items: [
      {
        name: "Labour",
        inventory_item_id: service[0].id,
        quantity: 1,
        unitAmount: 50,
        fulfilment_type: "service",
      },
      {
        name: "String set",
        inventory_item_id: stock,
        quantity: 2,
        unitAmount: 10,
        fulfilment_type: "stock",
      },
    ],
    subtotal: 70,
    total: 70,
    subtotal_amount: 70,
    total_amount: 70,
    shipping_amount: 0,
    tax_amount: 0,
    tax_included_amount: 0,
    tax_mode: "none",
    tax_label: "GST",
    tax_rate_percent: 0,
    prices_include_tax: false,
    discount_amount: 0,
    delivery_address: {},
    fulfilment_method: "pickup",
    payment_method: "bank_transfer",
    xero_tenant_id: tenant,
    xero_due_date: "2026-09-17",
  };
  const create = async (p = payload) =>
    (
      await db.query(
        "select * from public.create_invoiced_shop_order($1::jsonb)",
        [JSON.stringify(p)],
      )
    ).rows[0];
  const quantity = async () =>
    Number(
      (
        await db.query(
          "select quantity_on_hand from inventory_items where id=$1",
          [stock],
        )
      ).rows[0].quantity_on_hand,
    );
  await t.test(
    "customers cannot create invoices, forge payments, read tokens or queue work",
    async () => {
      await db.exec(
        "set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)",
      );
      await assert.rejects(create(), /permission denied/);
      await assert.rejects(
        db.query("select * from xero_connection"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from shop_invoice_settings"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from claim_xero_jobs()"),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          "insert into shop_orders(user_id,total_amount) values('00000000-0000-0000-0000-000000000002',0)",
        ),
        /row-level security/,
      );
      await db.exec("reset role;set role service_role");
    },
  );
  let order;
  await t.test(
    "a retried checkout reserves only once and rejects changed details",
    async () => {
      order = await create();
      assert.match(order.order_reference, /^KJC-\d+$/);
      assert.equal(await quantity(), 1);
      assert.equal((await create()).id, order.id);
      assert.equal(await quantity(), 1);
      await assert.rejects(
        create({ ...payload, checkout_digest: "c".repeat(64) }),
        /details changed/,
      );
      await assert.rejects(
        create({ ...payload, checkout_key_hash: "d".repeat(64) }),
        /Stock is no longer available/,
      );
      assert.equal(
        Number(
          (await db.query("select count(*) as count from shop_orders")).rows[0]
            .count,
        ),
        1,
      );
      assert.equal(
        Number(
          (await db.query("select count(*) as count from stock_movements"))
            .rows[0].count,
        ),
        1,
      );
    },
  );
  const apply = async (status, due, paid, overrides = {}) => {
    const a = { tenant, invoice, total: 70, currency: "NZD", ...overrides };
    return (
      await db.query(
        "select * from apply_xero_invoice_state($1,$2,$3,$4,$5,$6,$7,$8)",
        [order.id, a.tenant, a.invoice, status, a.total, due, paid, a.currency],
      )
    ).rows[0];
  };
  await t.test(
    "only matching invoices can change payment; partial payment stays unpaid",
    async () => {
      await db.query("update shop_orders set xero_invoice_id=$1 where id=$2", [
        invoice,
        order.id,
      ]);
      await assert.rejects(
        apply("PAID", 0, 70, { tenant: randomUUID() }),
        /does not belong/,
      );
      await assert.rejects(
        apply("PAID", 0, 70, { total: 71 }),
        /amount or currency/,
      );
      await assert.rejects(
        apply("PAID", 0, 70, { currency: "USD" }),
        /amount or currency/,
      );
      assert.equal(
        (await apply("AUTHORISED", 20, 50)).payment_status,
        "part_paid",
      );
      assert.equal((await apply("PAID", 20, 50)).payment_status, "part_paid");
      assert.equal((await apply("PAID", 0, 70)).payment_status, "paid");
      const repeated = await apply("PAID", 0, 70);
      assert.equal(repeated.fulfilment_status, "unfulfilled");
      assert.equal(await quantity(), 1);
      await db.query(
        "update shop_orders set fulfilment_status='completed' where id=$1",
        [order.id],
      );
      const reversed = await apply("AUTHORISED", 70, 0);
      assert.equal(reversed.payment_status, "pending");
      assert.equal(reversed.fulfilment_status, "completed");
      assert.equal(await quantity(), 1);
    },
  );
  await t.test(
    "voiding an unpaid invoice releases reservations exactly once",
    async () => {
      const next = await create({
        ...payload,
        checkout_key_hash: "e".repeat(64),
        items: [
          {
            inventory_item_id: stock,
            name: "Strings",
            quantity: 1,
            unitAmount: 10,
            fulfilment_type: "stock",
          },
        ],
        subtotal: 10,
        total: 10,
        subtotal_amount: 10,
        total_amount: 10,
      });
      const inv = randomUUID();
      await db.query("update shop_orders set xero_invoice_id=$1 where id=$2", [
        inv,
        next.id,
      ]);
      assert.equal(await quantity(), 0);
      for (let i = 0; i < 2; i++)
        await db.query(
          "select apply_xero_invoice_state($1,$2,$3,'VOIDED',10,0,0,'NZD')",
          [next.id, tenant, inv],
        );
      assert.equal(await quantity(), 1);
    },
  );
  await t.test(
    "a webhook arriving during work survives completion and wrong tenants are ignored",
    async () => {
      await db.exec("delete from xero_sync_jobs");
      await db.query("select enqueue_xero_order($1)", [order.id]);
      const job = (await db.query("select * from claim_xero_jobs(1)")).rows[0];
      assert.ok(job.lease_token);
      assert.equal(
        (await db.query("select * from claim_xero_jobs(1)")).rows.length,
        0,
      );
      await db.query("select enqueue_xero_events($1)", [
        JSON.stringify([{ invoice_id: invoice, tenant_id: randomUUID() }]),
      ]);
      assert.equal(
        Number(
          (await db.query("select revision from xero_sync_jobs")).rows[0]
            .revision,
        ),
        Number(job.revision),
      );
      await db.query("select enqueue_xero_events($1)", [
        JSON.stringify([{ invoice_id: invoice, tenant_id: tenant }]),
      ]);
      await db.query("select finish_xero_job($1,$2,$3,null)", [
        order.id,
        job.lease_token,
        job.revision,
      ]);
      assert.equal(
        (await db.query("select * from claim_xero_jobs(1)")).rows.length,
        1,
      );
    },
  );
});
