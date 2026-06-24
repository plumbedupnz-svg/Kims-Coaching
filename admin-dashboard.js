(function () {
  const tabLinks = document.querySelectorAll("[data-admin-tab]");
  const tabLinkButtons = document.querySelectorAll("[data-admin-tab-link]");
  const sections = document.querySelectorAll("[data-admin-section]");
  const statsEl = document.querySelector("[data-admin-stats]");
  const bookingsPreviewEl = document.querySelector("[data-admin-bookings-preview]");
  const bookingsListEl = document.querySelector("[data-admin-bookings-list]");
  const customersListEl = document.querySelector("[data-admin-customers-list]");
  const waitlistListEl = document.querySelector("[data-admin-waitlist-list]");
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    if (!value) return "No date";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function setActiveTab(tabName) {
    const activeTab = tabName || "dashboard";
    sections.forEach((section) => {
      section.hidden = section.dataset.adminSection !== activeTab;
    });
    tabLinks.forEach((link) => {
      const isActive = link.dataset.adminTab === activeTab;
      link.classList.toggle("active", isActive);
      link.setAttribute("aria-current", isActive ? "page" : "false");
    });
    if (window.location.hash.replace("#", "") !== activeTab) {
      history.replaceState(null, "", `#${activeTab}`);
    }
  }

  function renderEmpty(target, message) {
    if (!target) return;
    target.innerHTML = `<p class="helper-text">${message}</p>`;
  }

  function renderStats({ availability = 0, bookings = 0, customers = 0, waitlist = 0 }) {
    if (!statsEl) return;
    const items = [
      [availability, "Available slots"],
      [bookings, "Active bookings"],
      [customers, "Customers"],
      [waitlist, "Waitlist entries"]
    ];
    statsEl.innerHTML = items.map(([value, label]) => `
      <article>
        <strong>${value}</strong>
        <span>${label}</span>
      </article>
    `).join("");
  }

  function renderBookings(target, bookings = [], compact = false) {
    if (!target) return;
    if (!bookings.length) {
      renderEmpty(target, "No coaching bookings yet.");
      return;
    }

    target.innerHTML = bookings.map((booking) => {
      const slot = booking.availability || {};
      const playerName = booking.player_name || "Player";
      const status = booking.booking_status || "pending";
      return `
        <article class="admin-data-row">
          <div>
            <strong>${escapeHtml(playerName)}</strong>
            <p>${formatDate(slot.start_time)}${slot.end_time && !compact ? ` - ${formatDate(slot.end_time)}` : ""}</p>
            ${booking.club?.name ? `<p>${escapeHtml(booking.club.name)}</p>` : ""}
            ${booking.coach?.display_name ? `<p>Coach ${escapeHtml(booking.coach.display_name)}</p>` : ""}
            ${booking.customer_email && !compact ? `<p>${escapeHtml(booking.customer_email)}</p>` : ""}
          </div>
          <span class="status-pill available">${escapeHtml(status)}</span>
        </article>
      `;
    }).join("");
  }

  function renderCustomers(customers = []) {
    if (!customersListEl) return;
    if (!customers.length) {
      renderEmpty(customersListEl, "No customer profiles yet.");
      return;
    }

    customersListEl.innerHTML = customers.map((profile) => {
      const name = `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || profile.email || "Customer";
      const players = Array.isArray(profile.players) && profile.players.length
        ? profile.players.map((player) => player.name).filter(Boolean).join(", ")
        : profile.player_name || "No player saved";
      return `
        <article class="admin-data-row">
          <div>
            <strong>${escapeHtml(name)}</strong>
            <p>${escapeHtml(profile.email || "No email")} ${profile.mobile || profile.phone ? `- ${escapeHtml(profile.mobile || profile.phone)}` : ""}</p>
            <p>${escapeHtml(players)}</p>
          </div>
          <span class="status-pill ${profile.role === "admin" ? "blocked" : "available"}">${escapeHtml(profile.role || "customer")}</span>
        </article>
      `;
    }).join("");
  }

  function renderWaitlist(entries = []) {
    if (!waitlistListEl) return;
    if (!entries.length) {
      renderEmpty(waitlistListEl, "No waitlist requests yet.");
      return;
    }

    waitlistListEl.innerHTML = entries.map((entry) => `
      <article class="admin-data-row">
        <div>
          <strong>${escapeHtml(entry.skill_level || "Waitlist request")}</strong>
          <p>Days: ${escapeHtml(Array.isArray(entry.preferred_days) ? entry.preferred_days.join(", ") : entry.preferred_days || "Any")}</p>
          <p>Times: ${escapeHtml(Array.isArray(entry.preferred_times) ? entry.preferred_times.join(", ") : entry.preferred_times || "Any")}</p>
          ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : ""}
        </div>
      </article>
    `).join("");
  }

  async function loadAdminData() {
    if (!client) {
      renderEmpty(bookingsPreviewEl, "Supabase is not configured yet.");
      renderEmpty(bookingsListEl, "Supabase is not configured yet.");
      renderEmpty(customersListEl, "Supabase is not configured yet.");
      renderEmpty(waitlistListEl, "Supabase is not configured yet.");
      renderStats({});
      return;
    }

    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;

    const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return;

    const [
      availabilityResult,
      bookingsResult,
      customersResult,
      waitlistResult
    ] = await Promise.all([
      client.from("availability").select("id", { count: "exact", head: true }).eq("is_available", true),
      client.from("bookings").select("*, availability:availability_id(start_time,end_time), club:club_id(name), coach:coach_id(display_name)").in("booking_status", ["pending", "confirmed"]).order("created_at", { ascending: false }).limit(50),
      client.from("profiles").select("*").order("created_at", { ascending: false }).limit(100),
      client.from("waitlist").select("*").limit(100)
    ]);

    const bookings = bookingsResult.data || [];
    const customers = customersResult.data || [];
    const waitlist = waitlistResult.data || [];
    renderStats({
      availability: availabilityResult.count || 0,
      bookings: bookings.length,
      customers: customers.filter((customer) => customer.role !== "admin").length,
      waitlist: waitlist.length
    });
    renderBookings(bookingsPreviewEl, bookings.slice(0, 5), true);
    renderBookings(bookingsListEl, bookings);
    renderCustomers(customers);
    renderWaitlist(waitlist);
  }

  tabLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setActiveTab(link.dataset.adminTab);
    });
  });

  tabLinkButtons.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setActiveTab(link.dataset.adminTabLink);
    });
  });

  window.addEventListener("hashchange", () => setActiveTab(window.location.hash.replace("#", "")));
  setActiveTab(window.location.hash.replace("#", "") || "dashboard");
  loadAdminData();
})();
