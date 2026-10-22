window.KIMS_SUPABASE = window.KIMS_SUPABASE || {
  url: "https://tbvfpaikyxqhncjvnusr.supabase.co",
  anonKey: "sb_publishable_34HW1F0Asg7kEk8vEYCiLQ_9jO1jl4m"
};

// One browser client owns this page's auth session. All feature modules reuse it.
(function () {
  const clients = new Map();
  window.KimsGetSupabaseClient = function (url, key) {
    const identity = JSON.stringify([url, key]);
    if (!clients.has(identity)) clients.set(identity, window.supabase.createClient(url, key));
    return clients.get(identity);
  };
  // Image-heavy admin rows must not be JSON-encoded in one unbounded RPC response.
  window.KimsReadAdminRows = async function (client, name, columns) {
    const rows = [], size = 20;
    for (let start = 0; ; start += size) {
      let query = client.rpc(name);
      if (columns) query = query.select(columns);
      const result = await query.order('id').range(start, start + size - 1);
      if (result.error) return { data: null, error: result.error };
      rows.push(...(result.data || []));
      if ((result.data || []).length < size) return { data: rows, error: null };
    }
  };
})();

(function () {
  const nav = document.querySelector("[data-nav-links]");
  if (!nav || nav.hasAttribute("data-storefront-nav")) return;

  const currentFile = (window.location.pathname.split("/").pop() || "index.html").replace(/^$/, "index.html");
  const isCurrent = (file) => currentFile === file || (file === "index.html" && currentFile === "");
  const currentAttr = (file) => (isCurrent(file) ? ' aria-current="page"' : "");

  nav.innerHTML = `
    <a href="index.html"${currentAttr("index.html")}>Home</a>
    <a href="booking.html"${currentAttr("booking.html")}>Book Coaching</a>
    <a href="shop.html"${currentAttr("shop.html")}>Shop</a>
    <a href="/#about">About</a>
    <a href="/booking">Programmes</a>
    <a href="account.html" data-auth-public${currentAttr("account.html")}>Login</a>
    <a href="account.html" data-auth-private hidden${currentAttr("account.html")}>My Account</a>
    <a href="admin.html" data-admin-link hidden${currentAttr("admin.html")}>Admin</a>
    <button class="nav-button" type="button" data-sign-out hidden>Sign Out</button>
  `;

  async function updateAdminLink() {
    const adminLink = nav.querySelector("[data-admin-link]");
    const accountLink = nav.querySelector("[data-auth-private]");
    if (!adminLink || !window.supabase) return;
    const settings = window.KIMS_SUPABASE || {};
    if (!settings.url || !settings.anonKey) return;

    const client = window.KimsGetSupabaseClient(settings.url, settings.anonKey);
    const { data } = await client.auth.getSession();
    const user = data?.session?.user;
    if (!user) {
      adminLink.hidden = true;
      if (accountLink) accountLink.hidden = true;
      return;
    }

    const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
    const isAdmin = profile?.role === "admin";
    adminLink.hidden = !isAdmin;
    if (accountLink) accountLink.hidden = isAdmin;
  }

  updateAdminLink();
})();
