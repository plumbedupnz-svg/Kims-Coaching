const h = require("./stripe/_helpers");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await h.verifyUser(req.headers.authorization || "");
    const [profile] = await h.restSelect("profiles", "role", {
      id: `eq.${user.id}`,
      limit: "1",
    });

    if (profile?.role === "admin") {
      return res.status(200).json({ allowed: true, admin: true, coach: false });
    }

    const activeCoaches = await h.restSelect(
      "coaches",
      "id,profile_id,email,is_active",
      { is_active: "eq.true", limit: "500" },
    );
    const loginEmail = String(user.email || "").trim().toLowerCase();
    const coach = activeCoaches.find((item) =>
      item.profile_id === user.id ||
      (loginEmail && String(item.email || "").trim().toLowerCase() === loginEmail)
    );

    if (!coach) {
      return res.status(403).json({
        allowed: false,
        admin: false,
        coach: false,
        error: "This resource area is available to active coaches and admins only.",
      });
    }

    return res.status(200).json({ allowed: true, admin: false, coach: true });
  } catch (error) {
    return res.status(401).json({ allowed: false, error: error.message || "Login required." });
  }
};
