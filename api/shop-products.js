const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tbvfpaikyxqhncjvnusr.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_34HW1F0Asg7kEk8vEYCiLQ_9jO1jl4m";

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fetchRows = async (table, select, params) => {
    const url = new URL(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const supabaseResponse = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!supabaseResponse.ok) {
      const message = await supabaseResponse.text();
      throw new Error(message || `Could not load ${table}.`);
    }

    const rows = await supabaseResponse.json();
    return Array.isArray(rows) ? rows : [];
  };

  try {
    const [inventoryResult, productResult] = await Promise.allSettled([
      fetchRows(
        "inventory_items",
        "id,product_name,category,category_id,description,sell_price,quantity_on_hand,status,visible_in_shop,is_active,archived_at",
        {
          visible_in_shop: "eq.true",
          is_active: "eq.true",
          archived_at: "is.null",
          order: "product_name.asc"
        }
      ),
      fetchRows(
        "products",
        "id,inventory_item_id,category,category_id,name,description,price,discount,image,image_url,is_active,visible_in_shop,quantity_on_hand,stock_status,archived_at,fulfilment_type",
        {
          visible_in_shop: "eq.true",
          is_active: "eq.true",
          archived_at: "is.null",
          order: "name.asc"
        }
      )
    ]);
    if (inventoryResult.status === "rejected") throw inventoryResult.reason;
    const productRows = productResult.status === "fulfilled"
      ? productResult.value
      : [];
    if (productResult.status === "rejected" && !/inventory_item_id|fulfilment_type|image_url|does not exist|PGRST|42703/i.test(productResult.reason?.message || "")) {
      throw productResult.reason;
    }
    const productInventoryIds = new Set(productRows.map((row) => String(row.inventory_item_id || "")).filter(Boolean));
    const products = [
      ...productRows.map((row) => ({ ...row, source_row: "products" })),
      ...inventoryResult.value
        .filter((row) => !productInventoryIds.has(String(row.id)))
        .map((row) => ({ ...row, source_row: "inventory_items" }))
    ];
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    response.status(200).json({ products });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(500).json({ error: error.message || "Could not load shop products." });
  }
};
