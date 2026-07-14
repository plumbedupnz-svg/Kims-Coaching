(function () {
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

  const sectionEl = document.querySelector('[data-admin-section="reports"]');
  const selectorEl = document.querySelector("[data-report-selector]");
  const startEl = document.querySelector("[data-report-start]");
  const endEl = document.querySelector("[data-report-end]");
  const filterEl = document.querySelector("[data-report-filter]");
  const filterWrapEl = document.querySelector("[data-report-filter-wrap]");
  const emailEl = document.querySelector("[data-report-email]");
  const previewEl = document.querySelector("[data-report-preview]");
  const messageEl = document.querySelector("[data-report-message]");
  const runEl = document.querySelector("[data-report-run]");
  const printEl = document.querySelector("[data-report-print]");
  const emailButtonEl = document.querySelector("[data-report-email-button]");
  const csvEl = document.querySelector("[data-report-csv]");

  if (!sectionEl || !selectorEl || !previewEl) return;

  const paidStatuses = new Set(["paid", "confirmed", "complete", "completed", "active", "active_in_group"]);
  const reportState = { current: null, filtersLoadedFor: "" };

  const money = (value) => `$${Number(value || 0).toFixed(2)}`;
  const percent = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "Missing costs" : `${Number(value).toFixed(1)}%`;
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const monthStartIso = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  };

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setMessage(message = "", tone = "") {
    if (!messageEl) return;
    messageEl.textContent = message;
    if (tone) messageEl.dataset.tone = tone;
    else messageEl.removeAttribute("data-tone");
  }

  function parseDateValue(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function inDateRange(value, start, end) {
    if (!value) return true;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return true;
    if (start && date < start) return false;
    if (end) {
      const endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 999);
      if (date > endOfDay) return false;
    }
    return true;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
  }

  function getDayName(day) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(day || 0)] || "";
  }

  function formatTime(value) {
    if (!value) return "";
    const [hour, minute] = String(value).slice(0, 5).split(":");
    const date = new Date();
    date.setHours(Number(hour || 0), Number(minute || 0), 0, 0);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  async function fetchRows(table, select = "*", order = "created_at") {
    const query = client.from(table).select(select);
    if (order) query.order(order, { ascending: false });
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    return Array.isArray(data) ? data : [];
  }

  function getFilters() {
    return {
      reportId: selectorEl.value,
      startIso: startEl.value || "",
      endIso: endEl.value || "",
      start: parseDateValue(startEl.value),
      end: parseDateValue(endEl.value),
      filter: filterEl.value || ""
    };
  }

  function isPaidJuniorMember(member) {
    const payment = String(member.payment_status || "").toLowerCase();
    const booking = String(member.booking_status || "").toLowerCase();
    const placement = String(member.placement_status || "").toLowerCase();
    return paidStatuses.has(payment) && (paidStatuses.has(booking) || paidStatuses.has(placement) || booking === "confirmed");
  }

  async function loadJuniorContext() {
    const [members, programmes, groups, coaches, payments] = await Promise.all([
      fetchRows("junior_group_members"),
      fetchRows("junior_programmes"),
      fetchRows("junior_groups", "*", "start_date"),
      fetchRows("coaches", "*", "display_name").catch(() => []),
      fetchRows("payments").catch(() => [])
    ]);
    return {
      members,
      programmesById: new Map(programmes.map((item) => [item.id, item])),
      groupsById: new Map(groups.map((item) => [item.id, item])),
      coachesById: new Map(coaches.map((item) => [item.id, item])),
      payments
    };
  }

  function getMemberDate(member) {
    return member.paid_at || member.confirmed_at || member.updated_at || member.created_at;
  }

  function getProgrammeName(member, group, programme) {
    return programme?.programme_name || group?.programme_name || member.programme_name || "Unassigned programme";
  }

  function getGroupName(member, group) {
    return group?.group_name || member.group_name || "Unassigned group";
  }

  function getGroupAmount(member, group, programme) {
    return Number(member.amount ?? member.price ?? group?.price ?? programme?.price ?? 0);
  }

  function getGroupCosts(group = {}, programme = {}) {
    const coach = Number(group.coach_cost_per_session ?? programme.coach_cost_per_session ?? 0);
    const court = Number(group.court_cost_per_session ?? programme.court_cost_per_session ?? 0);
    const fixed = Number(group.fixed_programme_cost ?? programme.fixed_programme_cost ?? 0);
    const hasMissing = !Number.isFinite(coach) || !Number.isFinite(court) || !Number.isFinite(fixed)
      || group.coach_cost_per_session == null && programme.coach_cost_per_session == null
      || group.court_cost_per_session == null && programme.court_cost_per_session == null;
    return { coach: Number.isFinite(coach) ? coach : 0, court: Number.isFinite(court) ? court : 0, fixed: Number.isFinite(fixed) ? fixed : 0, hasMissing };
  }

  function getStripeFee(member, payments = []) {
    const matches = payments.filter((payment) => {
      const related = payment.related_id || payment.relatedId || payment.junior_group_member_id;
      const metadata = payment.metadata || {};
      return related === member.id || metadata.member_id === member.id || metadata.completed_member_id === member.id;
    });
    const fee = matches.reduce((sum, payment) => sum + Number(payment.stripe_fee ?? payment.provider_fee ?? payment.fee_amount ?? 0), 0);
    return fee > 0 ? fee : null;
  }

  async function buildJuniorProgrammeReport(filters) {
    const context = await loadJuniorContext();
    const rows = context.members
      .filter((member) => !member.archived_at)
      .filter(isPaidJuniorMember)
      .filter((member) => inDateRange(getMemberDate(member), filters.start, filters.end))
      .filter((member) => !filters.filter || member.programme_id === filters.filter)
      .map((member) => {
        const group = context.groupsById.get(member.group_id);
        const programme = context.programmesById.get(member.programme_id || group?.programme_id);
        const coach = context.coachesById.get(member.coach_id || group?.coach_id || programme?.coach_id);
        return {
          programme: getProgrammeName(member, group, programme),
          group: getGroupName(member, group),
          player: member.player_name || member.name || "",
          age: member.player_age ?? member.age ?? "",
          level: member.admin_level || member.player_level || member.suggested_level || "",
          parent: member.parent_name || member.customer_name || "",
          email: member.email || member.customer_email || "",
          phone: member.mobile || member.phone || "",
          payment: member.payment_status || "",
          placement: member.placement_status || member.booking_status || "",
          coach: coach?.display_name || coach?.name || "",
          session: [getDayName(group?.recurring_day), formatTime(group?.start_time)].filter(Boolean).join(" "),
          notes: member.notes || member.admin_notes || ""
        };
      });
    return {
      id: "junior-programme",
      title: "Junior Programme Report",
      columns: ["Programme name", "Group name", "Player name", "Player age", "Player level", "Parent/customer name", "Email", "Phone", "Payment status", "Placement status", "Coach", "Session day/time", "Notes"],
      rows: rows.map((row) => [row.programme, row.group, row.player, row.age, row.level, row.parent, row.email, row.phone, row.payment, row.placement, row.coach, row.session, row.notes]),
      totals: [`Paid/confirmed players: ${rows.length}`],
      filters
    };
  }

  async function buildJuniorProfitReport(filters) {
    const context = await loadJuniorContext();
    const grouped = new Map();
    context.members
      .filter((member) => !member.archived_at)
      .filter(isPaidJuniorMember)
      .filter((member) => inDateRange(getMemberDate(member), filters.start, filters.end))
      .filter((member) => !filters.filter || member.programme_id === filters.filter)
      .forEach((member) => {
        const group = context.groupsById.get(member.group_id);
        const programme = context.programmesById.get(member.programme_id || group?.programme_id);
        const key = `${programme?.id || member.programme_id || "none"}:${group?.id || member.group_id || "none"}`;
        const current = grouped.get(key) || { programme, group, count: 0, revenue: 0, fees: 0, feesAvailable: false };
        current.count += 1;
        current.revenue += getGroupAmount(member, group, programme);
        const fee = getStripeFee(member, context.payments);
        if (fee != null) {
          current.feesAvailable = true;
          current.fees += fee;
        }
        grouped.set(key, current);
      });
    const rows = [...grouped.values()].map((item) => {
      const sessionCount = Number(item.group?.session_count || 1);
      const costs = getGroupCosts(item.group, item.programme);
      const coachCost = costs.coach * sessionCount;
      const courtCost = costs.court * sessionCount;
      const fixedCost = costs.fixed;
      const totalCosts = coachCost + courtCost + fixedCost + (item.feesAvailable ? item.fees : 0);
      const profit = item.revenue - totalCosts;
      const margin = item.revenue > 0 && !costs.hasMissing ? profit / item.revenue * 100 : null;
      return [
        getProgrammeName({}, item.group, item.programme),
        getGroupName({}, item.group),
        item.count,
        money(item.revenue),
        costs.hasMissing ? "Missing costs" : money(coachCost),
        costs.hasMissing ? "Missing costs" : money(courtCost),
        costs.fixed ? money(fixedCost) : "None",
        item.feesAvailable ? money(item.fees) : "Not tracked",
        costs.hasMissing ? "Missing costs" : money(profit),
        percent(margin)
      ];
    });
    const revenue = [...grouped.values()].reduce((sum, row) => sum + row.revenue, 0);
    return {
      id: "junior-profit",
      title: "Junior Coaching Profit Report",
      columns: ["Programme", "Group", "Paid players", "Revenue", "Estimated coach cost", "Estimated court/session cost", "Fixed programme cost", "Stripe/payment fees", "Estimated gross profit", "Profit margin"],
      rows,
      totals: [`Revenue: ${money(revenue)}`, `Groups: ${grouped.size}`],
      filters
    };
  }

  function parseItems(order) {
    if (Array.isArray(order.items)) return order.items;
    try {
      return JSON.parse(order.items || "[]");
    } catch {
      return [];
    }
  }

  function itemUnitSale(item) {
    const quantity = Math.max(1, Number(item.quantity || 1));
    return Number(item.sale_price_at_sale ?? item.unitAmount ?? item.price_at_sale ?? item.price?.replace?.(/[^0-9.-]/g, "") ?? Number(item.lineTotal || 0) / quantity ?? 0);
  }

  function itemUnitCost(item) {
    return Number(item.purchase_price_at_sale ?? item.cost_price_at_sale ?? item.purchase_price ?? item.cost_price ?? 0);
  }

  async function buildShopSalesReport(filters) {
    const orders = await fetchRows("shop_orders");
    const grouped = new Map();
    orders
      .filter((order) => paidStatuses.has(String(order.payment_status || order.order_status || "").toLowerCase()) || order.paid_at)
      .filter((order) => inDateRange(order.paid_at || order.created_at, filters.start, filters.end))
      .forEach((order) => {
        parseItems(order).forEach((item) => {
          const category = item.category || "Uncategorized";
          if (filters.filter && category !== filters.filter) return;
          const name = item.name || item.product_name || "Product";
          const key = `${name}:${category}`;
          const quantity = Math.max(1, Number(item.quantity || 1));
          const sale = itemUnitSale(item);
          const cost = itemUnitCost(item);
          const current = grouped.get(key) || { name, category, quantity: 0, revenue: 0, cost: 0, orders: new Set() };
          current.quantity += quantity;
          current.revenue += sale * quantity;
          current.cost += cost * quantity;
          current.orders.add(order.id);
          grouped.set(key, current);
        });
      });
    const rows = [...grouped.values()].map((item) => {
      const profit = item.revenue - item.cost;
      const margin = item.revenue > 0 ? profit / item.revenue * 100 : 0;
      return [item.name, item.category, item.quantity, money(item.revenue), money(item.cost), money(profit), percent(margin), item.orders.size];
    });
    const revenue = [...grouped.values()].reduce((sum, item) => sum + item.revenue, 0);
    const profit = [...grouped.values()].reduce((sum, item) => sum + item.revenue - item.cost, 0);
    return {
      id: "shop-sales",
      title: "Shop Sales / Gross Profit Report",
      columns: ["Product name", "Category", "Quantity sold", "Sales revenue", "Purchase cost", "Gross profit", "Gross margin %", "Order count"],
      rows,
      totals: [`Sales revenue: ${money(revenue)}`, `Gross profit: ${money(profit)}`],
      filters
    };
  }

  const reportBuilders = {
    "junior-programme": buildJuniorProgrammeReport,
    "junior-profit": buildJuniorProfitReport,
    "shop-sales": buildShopSalesReport
  };

  function renderReport(report) {
    const range = [report.filters.startIso || "Any start", report.filters.endIso || "Any end"].join(" to ");
    const filterLabel = filterEl.selectedOptions?.[0]?.textContent || "All";
    const tableRows = report.rows.length
      ? report.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "")}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${report.columns.length}">No matching report rows.</td></tr>`;
    previewEl.innerHTML = `
      <div class="report-print-head">
        <h3>${escapeHtml(report.title)}</h3>
        <p>Generated ${escapeHtml(formatDate(new Date()))}</p>
        <p>Date range: ${escapeHtml(range)} · Filter: ${escapeHtml(filterLabel)}</p>
      </div>
      <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr>${report.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="report-totals">${report.totals.map((item) => `<strong>${escapeHtml(item)}</strong>`).join("")}</div>`;
  }

  function toCsv(report) {
    const rows = [report.columns, ...report.rows];
    return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  function downloadCsv(report) {
    const blob = new Blob([toCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.id}-${todayIso()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function reportText(report) {
    const header = [
      report.title,
      `Date range: ${report.filters.startIso || "Any start"} to ${report.filters.endIso || "Any end"}`,
      report.totals.join(" | "),
      ""
    ];
    const rows = [report.columns, ...report.rows].map((row) => row.join(" | "));
    return [...header, ...rows].join("\n");
  }

  async function sendReportEmail() {
    if (!reportState.current) return setMessage("Run a report before emailing it.", "error");
    if (!window.KimsEmailService?.sendReportEmail) {
      return setMessage("Email service is not loaded. The report can still be printed or exported.", "error");
    }
    setMessage("Sending report email...");
    const report = reportState.current;
    const result = await window.KimsEmailService.sendReportEmail({
      email: emailEl?.value || "",
      reportName: report.title,
      dateRange: `${report.filters.startIso || "Any start"} to ${report.filters.endIso || "Any end"}`,
      totals: report.totals,
      reportText: reportText(report),
      relatedType: "admin_report",
      traceId: `report-${Date.now()}`
    });
    if (result.sent) return setMessage("Report email sent.", "success");
    if (result.status === "test_mode") return setMessage("Email is in test mode. Report was generated but not sent.", "warning");
    return setMessage(`Email could not be sent: ${result.error || result.status || "unknown error"}`, "error");
  }

  async function runReport() {
    if (!client) return setMessage("Supabase is not configured for reports.", "error");
    const builder = reportBuilders[selectorEl.value];
    if (!builder) return setMessage("Choose a valid report.", "error");
    setMessage("Loading report...");
    try {
      const report = await builder(getFilters());
      reportState.current = report;
      renderReport(report);
      setMessage(`Report ready: ${report.rows.length} rows.`, "success");
    } catch (error) {
      console.error("Could not build report.", error);
      previewEl.innerHTML = `<p class="helper-text">Could not load report: ${escapeHtml(error.message)}</p>`;
      setMessage(`Could not load report: ${error.message}`, "error");
    }
  }

  async function loadFilterOptions() {
    if (!client || reportState.filtersLoadedFor === selectorEl.value) return;
    reportState.filtersLoadedFor = selectorEl.value;
    const reportId = selectorEl.value;
    filterWrapEl.hidden = false;
    filterEl.innerHTML = '<option value="">All</option>';
    try {
      if (reportId === "shop-sales") {
        const orders = await fetchRows("shop_orders").catch(() => []);
        const categories = new Set();
        orders.forEach((order) => parseItems(order).forEach((item) => categories.add(item.category || "Uncategorized")));
        filterEl.innerHTML += [...categories].sort().map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
      } else {
        const programmes = await fetchRows("junior_programmes");
        filterEl.innerHTML += programmes
          .sort((a, b) => String(a.programme_name || "").localeCompare(String(b.programme_name || "")))
          .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.programme_name || "Programme")}</option>`)
          .join("");
      }
    } catch (error) {
      console.warn("Could not load report filter options.", error);
    }
  }

  function setDefaultDates() {
    if (startEl && !startEl.value) startEl.value = monthStartIso();
    if (endEl && !endEl.value) endEl.value = todayIso();
  }

  selectorEl.addEventListener("change", () => {
    reportState.current = null;
    reportState.filtersLoadedFor = "";
    loadFilterOptions();
  });
  runEl?.addEventListener("click", runReport);
  printEl?.addEventListener("click", () => window.print());
  emailButtonEl?.addEventListener("click", sendReportEmail);
  csvEl?.addEventListener("click", () => {
    if (!reportState.current) return setMessage("Run a report before exporting CSV.", "error");
    downloadCsv(reportState.current);
  });

  window.addEventListener("hashchange", () => {
    if (location.hash === "#reports") {
      setDefaultDates();
      loadFilterOptions();
    }
  });

  setDefaultDates();
  loadFilterOptions();
})();
