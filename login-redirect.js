const loginTarget = `/account${window.location.search || ""}${window.location.hash || ""}`;
window.location.replace(loginTarget);
