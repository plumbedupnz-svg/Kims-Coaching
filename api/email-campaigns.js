const { randomUUID } = require('node:crypto');
const { enforceRateLimit } = require('./_rate-limit');
const { email } = require('../email-campaign-content');
const c = require('../lib/email-campaigns');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const user = await c.requireAdmin(req);
    if (!enforceRateLimit(req, res, { scope: `campaign-${user.id}`, limit: 180, windowMs: 60000 })) return;
    if (req.method === 'GET') {
      const [contacts, groups, memberships, campaigns, externalPreferences] = await Promise.all([
        c.rows('email_contacts?select=id,email,first_name,last_name,marketing_status,consent_note,consent_at,unsubscribed_at&order=first_name,id'),
        c.rows('email_groups?order=name,id'), c.rows('email_group_members?order=group_id,contact_id'),
        c.database('email_campaigns?select=id,subject,preview_text,body,button_label,button_url,purpose,contact_ids,group_ids,all_contacts,extra_emails,extra_consent_note,status,version,created_at,updated_at,sent_at&order=updated_at.desc&limit=100'),
        c.rows('email_external_preferences?select=email,unsubscribed_at&order=email')
      ]);
      let sending = { ready: true };
      try { const settings = await c.sender(); sending.from = settings.from_email; sending.reply_to = settings.reply_to_email || settings.from_email; } catch (e) { sending = { ready: false, reason: e.message }; }
      return res.status(200).json({ contacts, groups, memberships, campaigns, sending, external_unsubscribed: externalPreferences.filter((p) => p.unsubscribed_at).map((p) => p.email), admin_email: user.email });
    }
    const body = c.parseBody(req);
    if (body.action === 'sync') {
      await c.database('rpc/sync_email_contacts', 'POST', {});
      return res.status(200).json({ saved: true });
    }
    if (body.action === 'contact') {
      const value = body.contact || {};
      const address = String(value.email || '').trim().toLowerCase();
      if (!email(address) || String(value.first_name || '').length > 100 || String(value.last_name || '').length > 100) throw c.fail(400, 'Enter a valid email address and name.');
      if (!['not_subscribed', 'subscribed', 'unsubscribed'].includes(value.marketing_status)) throw c.fail(400, 'Choose a newsletter preference.');
      const note = String(value.consent_note || '').trim();
      if (note.length > 1000) throw c.fail(400, 'Keep the consent note under 1,000 characters.');
      let previous;
      if (value.id) {
        if (!c.uuid(value.id)) throw c.fail(400, 'Invalid contact.');
        [previous] = await c.database(`email_contacts?id=eq.${value.id}&limit=1`);
        if (!previous) throw c.fail(404, 'Contact not found.');
        if (previous.email !== address) throw c.fail(400, 'Add a new contact for a different email address.');
      }
      const optedIn = value.marketing_status === 'subscribed' && previous?.marketing_status !== 'subscribed';
      if (optedIn && !note) throw c.fail(400, 'Record when and how this person agreed to receive newsletters.');
      const record = { email: address, first_name: String(value.first_name || '').trim(), last_name: String(value.last_name || '').trim(), marketing_status: value.marketing_status, consent_note: note,
        ...(optedIn ? { consent_at: new Date().toISOString(), unsubscribed_at: null } : {}), ...(value.marketing_status === 'unsubscribed' ? { unsubscribed_at: previous?.unsubscribed_at || new Date().toISOString() } : {}) };
      // Guard against overwriting an unsubscribe that happened while the editor was open.
      const path = previous ? `email_contacts?id=eq.${previous.id}&marketing_status=eq.${encodeURIComponent(value.original_status || '')}` : 'email_contacts';
      const saved = await c.database(path, previous ? 'PATCH' : 'POST', record);
      if (!saved?.length) throw c.fail(409, 'This contact’s preferences changed. Reload before editing.');
      return res.status(200).json({ saved: true });
    }
    if (body.action === 'group') {
      if ((body.id && !c.uuid(body.id)) || !Array.isArray(body.contact_ids) || body.contact_ids.length > 5000 || body.contact_ids.some((id) => !c.uuid(id))) throw c.fail(400, 'Invalid group members.');
      const id = await c.database('rpc/save_email_group', 'POST', { p_id: body.id || null, p_name: String(body.name || ''), p_contacts: body.contact_ids });
      return res.status(200).json({ id });
    }
    if (body.action === 'save') {
      const draft = c.draft(body.draft);
      let saved;
      if (body.id) {
        if (!c.uuid(body.id) || !Number.isInteger(body.version)) throw c.fail(400, 'Invalid draft version.');
        [saved] = await c.database(`email_campaigns?id=eq.${body.id}&status=eq.draft&version=eq.${body.version}`, 'PATCH', { ...draft, version: body.version + 1, updated_at: new Date().toISOString() });
        if (!saved) throw c.fail(409, 'This draft changed or has already started sending. Reload it from History.');
      } else {
        [saved] = await c.database('email_campaigns', 'POST', { ...draft, created_by: user.id });
      }
      return res.status(200).json({ campaign: saved });
    }
    const campaign = await c.getCampaign(body.id);
    if (body.action === 'detail') {
      const recipients = await c.rows(`email_campaign_recipients?campaign_id=eq.${campaign.id}&select=id,email,first_name,status,sent_at,error_message&order=id`);
      return res.status(200).json({ campaign, recipients, ...(await c.progress(campaign.id)) });
    }
    if (body.action === 'preview' || body.action === 'queue') {
      if (campaign.purpose === 'marketing' && campaign.extra_emails?.length && !campaign.extra_consent_note?.trim()) throw c.fail(400, 'Add a note about when and how the pasted recipients agreed to receive this newsletter.');
      // Refresh junior membership before review and recheck it again at confirmation.
      await c.database('rpc/sync_email_contacts', 'POST', {});
      const recipients = await c.audience(campaign.id);
      const hash = c.reviewHash(campaign, recipients);
      if (body.action === 'preview') return res.status(200).json({ recipients, hash, version: campaign.version });
      if (campaign.status !== 'draft') return res.status(200).json({ queued: true });
      if (!campaign.subject || !campaign.body) throw c.fail(400, 'Add a subject and message before sending.');
      if (body.hash !== hash) throw c.fail(409, 'Your draft or recipients changed. Review the email again before sending.');
      await c.sender();
      if (campaign.purpose === 'marketing') c.siteUrl();
      await c.database('rpc/queue_email_campaign', 'POST', { p_id: campaign.id, p_version: campaign.version, p_audience: recipients });
      return res.status(200).json({ queued: true });
    }
    if (body.action === 'test') {
      if (!campaign.subject || !campaign.body || !email(user.email)) throw c.fail(400, 'Add a subject and message before sending a test.');
      const settings = await c.sender();
      const payload = c.message({ ...campaign, subject: `[Test] ${campaign.subject}` }, { email: user.email, first_name: 'Kim' }, settings);
      await c.deliver(payload, `campaign-test/${randomUUID()}`);
      return res.status(200).json({ sent: true, email: user.email });
    }
    if (body.action === 'process') {
      return res.status(200).json(await c.processCampaign(campaign.id));
    }
    throw c.fail(400, 'Unknown email action.');
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.status ? error.message : 'The email workspace is temporarily unavailable. Please try again.' });
  }
};
