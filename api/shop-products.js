const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tbvfpaikyxqhncjvnusr.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_34HW1F0Asg7kEk8vEYCiLQ_9jO1jl4m";

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const url = new URL(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/inventory_items`);
  url.searchParams.set("select", "id,product_name,category,category_id,description,sell_price,quantity_on_hand,status,visible_in_shop,is_active,archived_at");
  url.searchParams.set("visible_in_shop", "eq.true");
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("archived_at", "is.null");
  url.searchParams.set("order", "product_name.asc");

  try {
    const supabaseResponse = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!supabaseResponse.ok) {
      const message = await supabaseResponse.text();
      response.setHeader("Cache-Control", "no-store");
      response.status(supabaseResponse.status).json({ error: message || "Could not load shop products." });
      return;
    }

    const products = await supabaseResponse.json();
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    response.status(200).json({ products: Array.isArray(products) ? products : [] });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(500).json({ error: error.message || "Could not load shop products." });
  }
};
