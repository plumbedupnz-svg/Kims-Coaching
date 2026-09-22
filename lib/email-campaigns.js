const { createHash } = require('node:crypto');
const { loadEmailSettings } = require('../api/send-email');
const { content, email, parseAddresses } = require('../email-campaign-content');
const fail = (status, message) => Object.assign(new Error(message), { status });
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function config() {
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw fail(503, 'Email workspace database is not configured.');
  return { base, key };
}
async function database(path, method = 'GET', body) {
  const { base, key } = config();
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    if (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(detail.code)) throw fail(503, 'The Emails section needs its database setup. Please complete the email workspace migrations.');
    if (detail.code === 'P0001') throw fail(409, detail.message);
    if (detail.code === '23505') throw fail(409, 'That email address already exists. Edit the existing contact.');
    throw fail(503, 'Could not save or load the email workspace. Please try again.');
  }
  return response.status === 204 ? null : response.json();
}
async function rows(path) {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const page = await database(`${path}${path.includes('?') ? '&' : '?'}limit=500&offset=${offset}`);
    all.push(...page);
    if (page.length < 500) return all;
  }
}
async function requireAdmin(req) {
  const token = String(req.headers?.authorization || '');
  if (!/^Bearer\s+\S+$/i.test(token)) throw fail(401, 'Please sign in to your admin account.');
  const { base, key } = config();
  const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: token }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw fail(401, 'Your session has expired. Please sign in again.');
  const user = await response.json();
  if (!uuid(user.id)) throw fail(401, 'Please sign in again.');
  const [profile] = await database(`profiles?id=eq.${user.id}&select=role&limit=1`);
  if (profile?.role !== 'admin') throw fail(403, 'Only administrators can use the email workspace.');
  return user;
}
function parseBody(req) {
  if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) > 256000) throw fail(413, 'This request is too large.');
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { throw fail(400, 'Invalid request.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Invalid request.');
  return body;
}
function draft(input) {
  if (!input || typeof input !== 'object') throw fail(400, 'Missing email draft.');
  const result = {};
  for (const [key, max] of Object.entries({ subject: 200, preview_text: 180, body: 20000, button_label: 80, button_url: 2000 })) {
    if (input[key] != null && typeof input[key] !== 'string') throw fail(400, 'Invalid email content.');
    const value = String(input[key] || '').trim();
    if (value.length > max) throw fail(400, `${key.replaceAll('_', ' ')} is too long.`);
    result[key] = key === 'subject' ? value.replace(/[\r\n]/g, ' ') : value;
  }
  if (!['service', 'marketing'].includes(input.purpose)) throw fail(400, 'Choose an email type.');
  result.purpose = input.purpose;
  if (result.button_url) {
    let url;
    try { url = new URL(result.button_url); } catch { throw fail(400, 'Use a full https:// link for the button.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw fail(400, 'Use a full https:// link for the button.');
  }
  if (Boolean(result.button_url) !== Boolean(result.button_label)) throw fail(400, 'Add both button text and a link, or leave both blank.');
  for (const field of ['contact_ids', 'group_ids']) {
    if (!Array.isArray(input[field]) || input[field].length > 5000 || input[field].some((id) => !uuid(id))) throw fail(400, 'Invalid recipient selection.');
    result[field] = [...new Set(input[field])];
  }
  result.all_contacts = input.all_contacts === true;
  const pasted = input.extra_emails ?? '';
  if (typeof pasted !== 'string' && (!Array.isArray(pasted) || pasted.some((value) => typeof value !== 'string'))) throw fail(400, 'Paste a list of email addresses.');
  const extra = parseAddresses(Array.isArray(pasted) ? pasted.join('\n') : pasted);
  if (extra.tooMany) throw fail(400, 'Paste up to 1,000 email addresses at a time (100,000 characters maximum).');
  if (extra.invalid.length) throw fail(400, `Fix these email addresses before saving: ${extra.invalid.slice(0, 5).join(', ')}${extra.invalid.length > 5 ? '…' : ''}`);
  result.extra_emails = extra.addresses;
  if (input.extra_consent_note != null && typeof input.extra_consent_note !== 'string') throw fail(400, 'Enter a newsletter consent note.');
  result.extra_consent_note = String(input.extra_consent_note || '').trim();
  if (result.extra_consent_note.length > 1000) throw fail(400, 'Keep the newsletter consent note under 1,000 characters.');
  return result;
}
async function getCampaign(id) {
  if (!uuid(id)) throw fail(400, 'Invalid email ID.');
  const [campaign] = await database(`email_campaigns?id=eq.${id}&limit=1`);
  if (!campaign) throw fail(404, 'Email not found.');
  return campaign;
}
async function audience(id) {
  return rows(`rpc/email_campaign_audience?p_id=${id}&order=email`);
}
function reviewHash(campaign, recipients) {
  return createHash('sha256').update(JSON.stringify({ id: campaign.id, version: campaign.version, recipients })).digest('hex');
}
async function sender() {
  const settings = await loadEmailSettings();
  if (!settings.enabled || ['disabled', 'test'].includes(settings.provider || 'disabled') || !process.env.RESEND_API_KEY) throw fail(503, 'Email sending is disabled. Complete Resend setup in Settings → Email.');
  if (!email(settings.from_email) || !email(settings.reply_to_email || settings.from_email)) throw fail(503, 'Check the sender and reply-to addresses in Settings → Email.');
  return settings;
}
function siteUrl() {
  const raw = process.env.EMAIL_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw fail(503, 'Set EMAIL_SITE_URL to the website’s public https:// address before sending newsletters.'); }
}
function message(campaign, contact, settings, unsubscribeUrl = '') {
  return { from: `${String(settings.from_name || 'Kim Jones Coaching').replace(/[\r\n<>]/g, '')} <${settings.from_email}>`, to: [contact.email], reply_to: settings.reply_to_email || settings.from_email,
    ...content(campaign, contact, unsubscribeUrl), ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}) };
}
async function deliver(payload, key) {
  // jsonb can reorder object keys; canonical serialization keeps retries byte-identical.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(canonical(payload)), signal: AbortSignal.timeout(10000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw fail(503, `Email delivery could not be confirmed (${response.status}). Check Resend, then resume this email.`);
  return result.id;
}
async function progress(id) {
  const recipients = await rows(`email_campaign_recipients?campaign_id=eq.${id}&select=status&order=id`);
  const counts = { total: recipients.length, sent: 0, pending: 0, skipped: 0, needs_review: 0 };
  recipients.forEach((r) => counts[r.status === 'sending' ? 'pending' : r.status]++);
  return counts;
}
async function processCampaign(id) {
  const settings = await sender();
  const [campaign] = await database('rpc/claim_email_campaign', 'POST', { p_id: id });
  if (!campaign) return { ...(await progress(id)), busy: (await getCampaign(id)).status === 'sending' };
  const lease = `email_campaigns?id=eq.${id}&lease_token=eq.${campaign.lease_token}`;
  const started = Date.now();
  let error = '', lastSend = 0;
  try {
    const pending = await database(`email_campaign_recipients?campaign_id=eq.${id}&status=in.(pending,sending)&order=id&limit=10`);
    for (const recipient of pending) {
      if (Date.now() - started > 35000) break;
      const path = `email_campaign_recipients?id=eq.${recipient.id}`;
      try {
        const [contact] = await database(`email_contacts?${recipient.contact_id ? `id=eq.${recipient.contact_id}` : `email=eq.${encodeURIComponent(recipient.email)}`}&limit=1`);
        const [external] = !contact && !recipient.contact_id && campaign.purpose === 'marketing'
          ? await database(`email_external_preferences?email=eq.${encodeURIComponent(recipient.email)}&limit=1`) : [];
        // Recheck consent immediately before each attempt, including retried deliveries.
        const eligible = contact
          ? contact.email === recipient.email && (campaign.purpose !== 'marketing' || contact.marketing_status === 'subscribed')
          : !recipient.contact_id && (campaign.purpose !== 'marketing' || (campaign.extra_consent_note?.trim() && external && !external.unsubscribed_at));
        if (!eligible) {
          await database(path, 'PATCH', { status: recipient.first_attempt_at ? 'needs_review' : 'skipped', error_message: recipient.first_attempt_at ? 'Preferences changed after a delivery attempt. Check Resend for its outcome.' : 'Address or newsletter preference changed before sending.' });
          continue;
        }
        // Resend retains idempotency keys for 24h. Never retry an uncertain delivery past that window.
        if (recipient.first_attempt_at && Date.now() - Date.parse(recipient.first_attempt_at) >= 23 * 3600000) {
          await database(path, 'PATCH', { status: 'needs_review', error_message: 'Delivery is unconfirmed. Check Resend before sending another email.' });
          continue;
        }
        const unsubscribeUrl = campaign.purpose === 'marketing' ? `${siteUrl()}/api/email-unsubscribe?token=${(contact || external).unsubscribe_token}` : '';
        const payload = recipient.email_payload || message(campaign, recipient, settings, unsubscribeUrl);
        await database(path, 'PATCH', { status: 'sending', email_payload: payload, first_attempt_at: recipient.first_attempt_at || new Date().toISOString(), error_message: null });
        const delay = 650 - (Date.now() - lastSend);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        lastSend = Date.now();
        const providerId = await deliver(payload, `campaign/${recipient.id}`);
        await database(path, 'PATCH', { status: 'sent', provider_id: providerId, sent_at: new Date().toISOString(), error_message: null });
      } catch (e) {
        error = e.message;
        await database(path, 'PATCH', { error_message: error }).catch(() => {});
        break; // Pause on quotas/provider errors instead of repeatedly calling the provider.
      }
    }
    const counts = await progress(id);
    const status = counts.pending ? 'sending' : counts.needs_review ? 'needs_review' : 'complete';
    await database(lease, 'PATCH', { status, ...(status === 'complete' ? { sent_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() });
    return { ...counts, status, error };
  } finally {
    await database(lease, 'PATCH', { locked_until: null, lease_token: null });
  }
}
module.exports = { fail, uuid, database, rows, requireAdmin, parseBody, draft, getCampaign, audience, reviewHash, sender, siteUrl, message, deliver, progress, processCampaign };
