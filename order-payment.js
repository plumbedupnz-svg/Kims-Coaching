(function () {
  const key = decodeURIComponent(location.hash.slice(1)),
    message = document.querySelector("[data-order-message]");
  let checks = 0,
    timer;
  const text = (selector, value) => {
    document.querySelector(selector).textContent = value;
  };
  const money = (value) =>
    new Intl.NumberFormat("en-NZ", {
      style: "currency",
      currency: "NZD",
    }).format(value);
  async function refresh() {
    clearTimeout(timer);
    try {
      if (!/^[0-9a-f-]{36}$/i.test(key))
        throw new Error(
          "This order link is incomplete. Please use the link shown after checkout.",
        );
      const r = await fetch("/api/shop-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", key }),
      });
      const o = await r.json();
      if (!r.ok) throw new Error(o.error || "Could not load the order.");
      document.querySelector("[data-order-summary]").hidden = false;
      text("[data-order-reference]", o.reference);
      text(
        "[data-order-status]",
        {
          pending: "Awaiting payment",
          part_paid: "Part payment received",
          paid: "Paid",
          cancelled: "Invoice cancelled",
        }[o.status] || o.status,
      );
      text("[data-order-total]", money(o.total));
      text("[data-order-due]", money(o.due));
      text(
        "[data-order-due-date]",
        o.due_date ? `Payment due: ${o.due_date}` : "",
      );
      text(
        "[data-invoice-email]",
        o.email_status === "sent"
          ? "Your invoice has been emailed."
          : o.email_status === "needs_review"
            ? "Please use the invoice link here. Contact Kim if you need an email copy."
            : "Your invoice email is being prepared.",
      );
      const ready =
        Boolean(o.invoice_url) &&
        !o.needs_review &&
        !["cancelled", "failed"].includes(o.status);
      const link = document.querySelector("[data-invoice-link]");
      link.hidden = !ready;
      if (ready) {
        const url = new URL(o.invoice_url);
        if (
          url.protocol !== "https:" ||
          !(
            url.hostname === "in.xero.com" || url.hostname.endsWith(".xero.com")
          )
        )
          throw new Error("The invoice link needs review. Please contact Kim.");
        link.href = url.href;
        link.textContent =
          o.status === "paid"
            ? "View paid invoice"
            : "View invoice and pay by card";
      }
      document.querySelector("[data-bank-details]").hidden =
        !ready || o.status === "paid";
      text("[data-bank-name]", o.bank_name || "");
      text("[data-bank-number]", o.bank_number || "");
      text("[data-bank-reference]", o.reference);
      message.textContent = o.needs_review
        ? "Your order is recorded. Kim needs to check the invoice before you pay."
        : ready
          ? "Your order is recorded. Choose card payment on the invoice, or use the bank details below."
          : o.status === "cancelled"
            ? "This invoice has been cancelled."
            : "Your order is recorded. We are preparing your invoice; this page will update shortly.";
      if (o.status === "paid")
        message.textContent = "Payment received. Thank you.";
      if (ready) {
        try {
          const pending = JSON.parse(
            sessionStorage.getItem("kims_invoice_checkout") || "null",
          );
          const current = JSON.parse(localStorage.getItem("kims_cart") || "[]");
          if (
            pending?.key === key &&
            JSON.stringify(pending.cart) === JSON.stringify(current)
          ) {
            localStorage.removeItem("kims_cart");
            window.dispatchEvent(new CustomEvent("kims:cart-updated"));
          }
          if (pending?.key === key)
            sessionStorage.removeItem("kims_invoice_checkout");
        } catch {}
      }
      if (!["paid", "cancelled"].includes(o.status) && ++checks < 12)
        timer = setTimeout(refresh, 10000);
    } catch (e) {
      message.textContent = e.message;
    }
  }
  document
    .querySelector("[data-refresh-order]")
    .addEventListener("click", () => {
      checks = 0;
      refresh();
    });
  refresh();
})();
