const { database } = require('../lib/email-campaigns');
const { escape } = require('../email-campaign-content');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const page = (title, body) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Kim Jones Coaching</title><body style="margin:0;background:#f3f7fc;color:#13213d;font:17px/1.7 Arial,sans-serif"><main style="max-width:520px;margin:12vh auto;padding:32px;background:white;border-radius:12px"><p>KIM JONES COACHING</p><h1>${title}</h1>${body}</main></body></html>`;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).send(page('Method not allowed', ''));
  const token = req.query?.token || new URL(req.url, 'https://example.invalid').searchParams.get('token');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).send(page('Link unavailable', '<p>Please use the unsubscribe link in your email.</p>'));
  // GET only confirms intent: email security scanners must not unsubscribe people.
  if (req.method === 'GET') return res.status(200).send(page('Unsubscribe from newsletters', `<p>You can stop news and promotional emails. Messages about your bookings will still reach you.</p><form method="post" action="/api/email-unsubscribe?token=${escape(token)}"><button style="padding:12px 20px;font:inherit;background:#183454;color:white;border:0;border-radius:6px">Unsubscribe</button></form>`));
  try {
    const saved = await database('rpc/unsubscribe_email_recipient', 'POST', { p_token: token });
    if (!saved) return res.status(400).send(page('Link unavailable', '<p>Please use the unsubscribe link in your email.</p>'));
    return res.status(200).send(page('You’re unsubscribed', '<p>You will no longer receive newsletters from Kim Jones Coaching. Your coaching and booking emails are unchanged.</p>'));
  } catch {
    return res.status(503).send(page('Please try again', '<p>We could not save your preference just now. Please try this link again shortly.</p>'));
  }
};
