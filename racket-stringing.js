(function (root) {
  function today(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }

  function dueDate(date, count, unit) {
    if (!date || !Number.isInteger(Number(count)) || count < 1 || !["weeks", "months"].includes(unit)) return null;
    const result = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(result.getTime())) return null;
    if (unit === "weeks") result.setUTCDate(result.getUTCDate() + Number(count) * 7);
    else {
      const day = result.getUTCDate();
      result.setUTCDate(1);
      result.setUTCMonth(result.getUTCMonth() + Number(count));
      const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
      result.setUTCDate(Math.min(day, lastDay));
    }
    return result.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return "Not recorded";
    const isTimestamp = value.length > 10;
    return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: isTimestamp ? "Pacific/Auckland" : "UTC" })
      .format(new Date(isTimestamp ? value : `${value}T12:00:00Z`));
  }

  function tension(record) {
    return `${Number(record.tension_main)}${record.tension_cross == null ? "" : ` / ${Number(record.tension_cross)}`} ${record.tension_unit}`;
  }

  const api = { today, dueDate, formatDate, tension };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KimsStringing = api;
})(typeof window === "undefined" ? this : window);
