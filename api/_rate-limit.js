const crypto = require("crypto");

const buckets = globalThis.__kimsCoachingRateLimitBuckets || new Map();
globalThis.__kimsCoachingRateLimitBuckets = buckets;

function getClientAddress(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || "").split(",")[0];
  return String(firstForwarded || req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "unknown").trim();
}

function getBucketKey(req, scope) {
  const addressHash = crypto.createHash("sha256").update(getClientAddress(req)).digest("hex").slice(0, 24);
  return `${scope}:${addressHash}`;
}

function pruneExpired(now) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function enforceRateLimit(req, res, { scope, limit, windowMs }) {
  const now = Date.now();
  pruneExpired(now);
  const key = getBucketKey(req, scope);
  const previous = buckets.get(key);
  const bucket = !previous || previous.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : previous;
  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, limit - bucket.count);
  res.setHeader?.("RateLimit-Limit", String(limit));
  res.setHeader?.("RateLimit-Remaining", String(remaining));
  res.setHeader?.("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count <= limit) return true;
  res.setHeader?.("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
  res.status(429).json({ error: "Too many requests. Please wait and try again." });
  return false;
}

module.exports = { enforceRateLimit, _test: { buckets, getBucketKey } };
