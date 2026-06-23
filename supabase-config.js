window.KIMS_SUPABASE = window.KIMS_SUPABASE || {
  url: "https://tbvfpaikyxqhncjvnusr.supabase.co",
  anonKey: "sb_publishable_34HW1F0Asg7kEk8vEYCiLQ_9jO1jl4m"
};

(function () {
  const nav = document.querySelector("[data-nav-links]");
  if (!nav) return;

  const currentFile = (window.location.pathname.split("/").pop() || "index.html").replace(/^$/, "index.html");
  const isCurrent = (file) => currentFile === file || (file === "index.html" && currentFile === "");
  const currentAttr = (file) => (isCurrent(file) ? ' aria-current="page"' : "");

  nav.innerHTML = `
    <a href="index.html"${currentAttr("index.html")}>Home</a>
    <a href="booking.html"${currentAttr("booking.html")}>Book Private Lesson</a>
    <a href="shop.html"${currentAttr("shop.html")}>Shop</a>
    <a href="index.html#about">About</a>
    <a href="index.html#programmes">Programmes</a>
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

    const client = window.supabase.createClient(settings.url, settings.anonKey);
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
