const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tbvfpaikyxqhncjvnusr.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_34HW1F0Asg7kEk8vEYCiLQ_9jO1jl4m";
const INVENTORY_SELECT = "id,product_name,brand,sku,slug,short_description,category,category_id,description,full_description,sell_price,cost_price,purchase_price,image_url,quantity_on_hand,status,visible_in_shop,is_active,track_stock,is_order_to_sale,archived_at";
const INVENTORY_GALLERY_SELECT = `${INVENTORY_SELECT},inventory_item_images(id,image_url,sort_order,is_main)`;

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
    const shopParams = {
      visible_in_shop: "eq.true",
      is_active: "eq.true",
      archived_at: "is.null",
      order: "product_name.asc"
    };
    let inventoryRows;
    try {
      inventoryRows = await fetchRows("inventory_items", INVENTORY_GALLERY_SELECT, shopParams);
    } catch (error) {
      if (!/inventory_item_images|relationship|schema cache|does not exist|PGRST|42P01/i.test(error.message || "")) throw error;
      inventoryRows = await fetchRows("inventory_items", INVENTORY_SELECT, shopParams);
    }
    const products = inventoryRows.map((row) => ({ ...row, source_row: "inventory_items" }));
    response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    response.status(200).json({ products });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(500).json({ error: error.message || "Could not load shop products." });
  }
};
