(function () {
  const section = document.querySelector('[data-admin-section="emails"]');
  if (!section) return;
  const root = section.querySelector('[data-email-workspace]');
  const notice = section.querySelector('[data-email-workspace-message]');
  const { escape: esc, content, templates, parseAddresses } = window.KimsEmailContent;
  const settings = window.KIMS_SUPABASE || {};
  const client = settings.url && settings.anonKey && window.supabase ? window.supabase.createClient(settings.url, settings.anonKey) : null;
  let data, current = null, dirty = false, loading = false, busy = false, running = false, pause = false, reviewed = null;
  const $ = (selector) => root.querySelector(selector);
  const statusName = (status) => ({ draft: 'Draft', sending: 'In progress', complete: 'Finished', needs_review: 'Needs checking', subscribed: 'Subscribed', not_subscribed: 'Coaching emails only', unsubscribed: 'Unsubscribed', sent: 'Accepted by Resend', pending: 'Waiting', skipped: 'Skipped' }[status] || status);
  const badge = (status) => `<span class="email-status ${esc(status)}">${esc(statusName(status))}</span>`;
  const name = (c) => `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
  function say(message, error = false) { notice.textContent = message; notice.dataset.tone = error ? 'error' : 'success'; }
  async function api(action, values = {}) {
    const { data: session } = await client?.auth.getSession() || {};
    if (!session?.session?.access_token) throw new Error('Please sign in to your admin account, then refresh.');
    const response = await fetch('/api/email-campaigns', { method: action ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' }, ...(action ? { body: JSON.stringify({ action, ...values }) } : {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The email workspace is unavailable. Please try again.');
    return result;
  }
  function tab(value) {
    root.querySelectorAll('[data-email-panel]').forEach((el) => { el.hidden = el.dataset.emailPanel !== value; });
    root.querySelectorAll('[data-email-view]').forEach((el) => el.setAttribute('aria-current', el.dataset.emailView === value ? 'page' : 'false'));
  }
  function setup() {
    root.innerHTML = `
      <nav class="email-nav" aria-label="Email sections"><button type="button" data-email-view="compose" aria-current="page">Compose</button><button type="button" data-email-view="contacts">Contacts</button><button type="button" data-email-view="groups">Groups</button><button type="button" data-email-view="history">Drafts & history</button></nav>
      <div data-email-sender></div>
      <section data-email-panel="compose">
        <div class="email-toolbar"><p class="helper-text" data-email-draft-status>New email · not yet saved</p><button class="btn btn-secondary" type="button" data-email-action="new">New email</button></div>
        <form data-email-compose>
          <div class="email-columns">
            <aside class="email-card">
              <div class="email-card-head"><h3><span class="email-step">1</span>Choose recipients</h3></div>
              <label>Email type<select name="purpose"><option value="service">Coaching / booking update</option><option value="marketing">Newsletter / promotion</option></select></label>
              <p class="helper-text" data-email-purpose-note></p>
              <label>Paste email addresses<textarea name="extra_emails" rows="4" maxlength="100000" placeholder="alex@example.com, jamie@example.com" aria-describedby="email-extra-help email-extra-validation" spellcheck="false" autocapitalize="none"></textarea></label>
              <p class="helper-text" id="email-extra-help">No saved contact needed. Separate addresses with commas, semicolons, spaces or new lines. Up to 1,000 addresses.</p>
              <p class="helper-text" id="email-extra-validation" data-email-extra-validation aria-live="polite"></p>
              <label data-email-extra-consent hidden>Newsletter consent for pasted addresses<textarea name="extra_consent_note" rows="2" maxlength="1000" placeholder="When and how these recipients agreed to receive this newsletter"></textarea><span class="helper-text">Existing newsletter preferences and unsubscribes still apply. Pasting an address does not subscribe it.</span></label>
              <p class="helper-text">You can also choose saved contacts and groups:</p>
              <label class="email-check"><input type="checkbox" name="all_contacts"><span>All contacts</span></label>
              <div class="email-groups" data-email-recipient-groups></div>
              <label style="margin-top:1rem">Find an individual<input type="search" data-email-recipient-search placeholder="Name or email"></label>
              <div class="email-picker" data-email-recipient-contacts></div>
              <p data-email-recipient-count class="email-count" aria-live="polite"></p>
              <p class="helper-text">Each person receives their own email. Duplicate addresses across pasted lists, contacts and groups count once. Pasted addresses stay with this email; they are not added to Contacts.</p>
            </aside>
            <div class="email-card">
              <div class="email-card-head"><h3><span class="email-step">2</span>Write your email</h3><select aria-label="Start with a template" data-email-template><option value="">Start with a template…</option>${Object.entries(templates).map(([key, t]) => `<option value="${key}">${esc(t.label)}</option>`).join('')}</select></div>
              <label>Subject<input name="subject" maxlength="200" placeholder="What would you like to share?" required></label>
              <label>Inbox preview <span class="helper-text">Optional short line shown beside the subject.</span><input name="preview_text" maxlength="180" placeholder="A little more about your message"></label>
              <label>Message<textarea name="body" rows="11" maxlength="20000" placeholder="Hi {{first_name}}," required></textarea></label>
              <p class="helper-text">Use <strong>{{first_name}}</strong> for a personal greeting. Paragraphs and line breaks are kept.</p>
              <details><summary>Add a button (optional)</summary><div class="email-inline-fields" style="margin-top:1rem"><label>Button text<input name="button_label" maxlength="80" placeholder="Book your next session"></label><label>Button link<input name="button_url" type="url" maxlength="2000" placeholder="https://…"></label></div></details>
              <div class="email-actions"><button class="btn btn-secondary" type="button" data-email-action="save">Save draft</button><button class="btn btn-secondary" type="button" data-email-action="test">Send myself a test</button><button class="btn btn-primary" type="submit">Review & send</button></div>
              <p class="helper-text" data-email-test-note></p>
            </div>
          </div>
        </form>
        <div class="email-progress" data-email-progress hidden role="status" aria-live="polite"></div>
        <details class="email-card" style="margin-top:1rem" open><summary><strong>Email preview</strong></summary><div class="email-preview" data-email-preview></div></details>
      </section>
      <section data-email-panel="contacts" hidden><div class="email-toolbar"><div><h3>Your contacts</h3><p>Keep names and newsletter preferences in one place.</p></div><div class="email-actions"><button class="btn btn-secondary" data-email-action="sync">Sync website customers</button><button class="btn btn-primary" data-email-action="add-contact">Add contact</button></div></div><p class="email-note">Sync brings in customer accounts and confirmed junior group parents. Existing newsletter preferences are preserved; new contacts start with coaching emails only.</p><label>Search contacts<input type="search" data-email-contact-search placeholder="Name or email"></label><div class="email-list" data-email-contact-list></div><div data-email-contact-editor></div></section>
      <section data-email-panel="groups" hidden><div class="email-toolbar"><div><h3>A group for every occasion</h3><p>Create your own lists, or use your junior coaching groups.</p></div><button class="btn btn-primary" data-email-action="add-group">Create group</button></div><div class="email-list" data-email-group-list></div></section>
      <section data-email-panel="history" hidden><h3>Drafts & sending history</h3><p class="helper-text">Your latest 100 emails. Resume interrupted sends here. “Accepted by Resend” means submitted for delivery; it does not confirm inbox arrival.</p><div class="email-list" data-email-history></div><div data-email-history-detail></div></section>
      <dialog class="email-dialog" data-email-dialog aria-labelledby="email-dialog-title"></dialog>`;
    $('[data-email-compose]').addEventListener('submit', (event) => { event.preventDefault(); perform('review'); });
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    $('[data-email-dialog]').addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
    fillDraft();
  }
  let selectedContacts = new Set(), selectedGroups = new Set();
  function draftValue() {
    const form = $('[data-email-compose]');
    return { ...Object.fromEntries(['purpose', 'subject', 'preview_text', 'body', 'button_label', 'button_url', 'extra_emails', 'extra_consent_note'].map((key) => [key, form.elements[key].value])), all_contacts: form.elements.all_contacts.checked, contact_ids: [...selectedContacts], group_ids: [...selectedGroups] };
  }
  function fillDraft(value = null) {
    current = value?.id ? value : null;
    const form = $('[data-email-compose]');
    form.reset();
    for (const key of ['purpose', 'subject', 'preview_text', 'body', 'button_label', 'button_url']) form.elements[key].value = value?.[key] || (key === 'purpose' ? 'service' : '');
    form.elements.extra_emails.value = (value?.extra_emails || []).join('\n');
    form.elements.extra_consent_note.value = value?.extra_consent_note || '';
    form.elements.all_contacts.checked = Boolean(value?.all_contacts);
    selectedContacts = new Set(value?.contact_ids || []); selectedGroups = new Set(value?.group_ids || []);
    dirty = Boolean(value && !value.id); reviewed = null;
    $('[data-email-draft-status]').textContent = current ? `Draft · ${current.subject || 'Untitled email'}` : 'New email · not yet saved';
    renderRecipients(); updatePreview();
    form.querySelectorAll('input,textarea,select,button').forEach((el) => { el.disabled = current && current.status !== 'draft'; });
  }
  function eligibleRecipients() {
    const draft = draftValue();
    const ids = new Set(selectedContacts);
    data.memberships.filter((m) => selectedGroups.has(m.group_id)).forEach((m) => ids.add(m.contact_id));
    const extra = parseAddresses(draft.extra_emails);
    const pasted = new Set(extra.addresses);
    const selected = data.contacts.filter((c) => draft.all_contacts || ids.has(c.id) || pasted.has(c.email));
    const saved = new Set(data.contacts.map((c) => c.email));
    const unsubscribed = new Set(data.external_unsubscribed || []);
    for (const address of extra.addresses) if (!saved.has(address)) selected.push({ email: address, external: true, marketing_status: draft.extra_consent_note.trim() && !unsubscribed.has(address) ? 'subscribed' : 'not_subscribed' });
    return { selected, extra, eligible: selected.filter((c) => draft.purpose === 'service' || c.marketing_status === 'subscribed') };
  }
  function renderRecipients() {
    if (!data) return;
    $('[data-email-recipient-groups]').innerHTML = data.groups.map((g) => `<label class="email-check"><input type="checkbox" data-email-group-check="${g.id}" ${selectedGroups.has(g.id) ? 'checked' : ''}><span>${esc(g.name)}<small>${data.memberships.filter((m) => m.group_id === g.id).length} contacts${g.junior_group_id ? ' · junior coaching' : ''}</small></span></label>`).join('');
    const term = $('[data-email-recipient-search]').value.toLowerCase();
    const contacts = data.contacts.filter((c) => `${name(c)} ${c.email}`.toLowerCase().includes(term));
    $('[data-email-recipient-contacts]').innerHTML = contacts.slice(0, 200).map((c) => `<label class="email-check"><input type="checkbox" data-email-contact-check="${c.id}" ${selectedContacts.has(c.id) ? 'checked' : ''}><span>${esc(name(c))}<small>${esc(c.email)}</small></span></label>`).join('') || '<p class="helper-text">No contacts yet. Add contacts or sync website customers in the Contacts tab.</p>';
    if (contacts.length > 200) $('[data-email-recipient-contacts]').insertAdjacentHTML('beforeend', '<p class="helper-text">Showing 200 contacts. Search to find more.</p>');
    if (current && current.status !== 'draft') root.querySelectorAll('[data-email-contact-check], [data-email-group-check]').forEach((el) => { el.disabled = true; });
    updateCount();
  }
  function updateCount() {
    if (!data) return;
    const { selected, eligible, extra } = eligibleRecipients();
    const form = $('[data-email-compose]');
    const validation = $('[data-email-extra-validation]');
    const error = extra.tooMany ? 'Paste up to 1,000 addresses (100,000 characters maximum).' : extra.invalid.length ? `Check these addresses: ${extra.invalid.slice(0, 5).join(', ')}${extra.invalid.length > 5 ? '…' : ''}` : '';
    form.elements.extra_emails.setCustomValidity(error);
    form.elements.extra_emails.setAttribute('aria-invalid', String(Boolean(error)));
    validation.textContent = error || (extra.addresses.length ? `${extra.addresses.length} valid pasted addresses${extra.duplicates ? ` · ${extra.duplicates} duplicates removed` : ''}` : '');
    validation.style.color = error ? '#a32626' : '';
    const needsConsent = form.elements.purpose.value === 'marketing' && extra.addresses.length > 0;
    $('[data-email-extra-consent]').hidden = !needsConsent;
    form.elements.extra_consent_note.required = needsConsent;
    $('[data-email-recipient-count]').textContent = `${eligible.length} recipients${selected.length > eligible.length ? ` · ${selected.length - eligible.length} excluded without newsletter consent` : ''}`;
    $('[data-email-purpose-note]').textContent = draftValue().purpose === 'marketing' ? 'Use subscribed contacts or paste addresses with newsletter consent. An unsubscribe link is included.' : 'For updates about existing coaching or bookings. Choose Newsletter / promotion for news, offers and invitations.';
  }
  function updatePreview() {
    const value = draftValue();
    const preview = content(value, { first_name: 'Alex' });
    $('[data-email-preview]').innerHTML = `<div class="email-preview-meta">To: Alex (example recipient)<strong>${esc(preview.subject || 'Your email subject')}</strong></div>${preview.html}`;
  }
  function renderLists() {
    const term = $('[data-email-contact-search]').value.toLowerCase();
    const contacts = data.contacts.filter((c) => `${name(c)} ${c.email}`.toLowerCase().includes(term));
    $('[data-email-contact-list]').innerHTML = contacts.slice(0, 200).map((c) => `<article class="email-list-row"><div>${badge(c.marketing_status)}<br><strong>${esc(name(c))}</strong><p>${esc(c.email)}</p></div><button class="btn btn-secondary" data-email-action="edit-contact" data-id="${c.id}">Edit contact</button></article>`).join('') || '<p class="email-empty">Your contacts will appear here. Add someone or sync your website customers.</p>';
    if (contacts.length > 200) $('[data-email-contact-list]').insertAdjacentHTML('beforeend', '<p>Showing 200 contacts. Search to find more.</p>');
    $('[data-email-group-list]').innerHTML = data.groups.map((g) => `<article class="email-list-row"><div><strong>${esc(g.name)}</strong><p>${data.memberships.filter((m) => m.group_id === g.id).length} contacts · ${g.junior_group_id ? 'Managed in Junior Coaching; use Sync website customers to update.' : 'Custom group'}</p></div>${g.junior_group_id ? '' : `<button class="btn btn-secondary" data-email-action="edit-group" data-id="${g.id}">Edit group</button>`}</article>`).join('') || '<p class="email-empty">Save a group once, then select it whenever you write an email.</p>';
    $('[data-email-history]').innerHTML = data.campaigns.map((d) => `<article class="email-list-row"><div>${badge(d.status)}<br><strong>${esc(d.subject || 'Untitled email')}</strong><p>${new Date(d.updated_at).toLocaleString('en-NZ')} · ${d.purpose === 'marketing' ? 'Newsletter' : 'Coaching update'}</p></div><div class="email-actions"><button class="btn btn-secondary" data-email-action="${d.status === 'draft' ? 'open' : 'detail'}" data-id="${d.id}">${d.status === 'draft' ? 'Open draft' : 'View results'}</button>${d.status === 'sending' ? `<button class="btn btn-primary" data-email-action="resume" data-id="${d.id}">Resume sending</button>` : ''}<button class="btn btn-secondary" data-email-action="duplicate" data-id="${d.id}">Use again</button></div></article>`).join('') || '<p class="email-empty">Save your first draft and it will appear here.</p>';
    $('[data-email-sender]').innerHTML = data.sending.ready ? `<p class="helper-text">From ${esc(data.sending.from)} · Replies to ${esc(data.sending.reply_to)}</p>` : `<p class="email-note warning">${esc(data.sending.reason)} You can still prepare contacts, groups and drafts.</p>`;
    $('[data-email-test-note]').textContent = `Test emails go to your signed-in address: ${data.admin_email || ''}.`;
    renderRecipients();
  }
  async function load() {
    if (loading) return;
    loading = true;
    try {
      data = await api();
      if (!$('[data-email-compose]')) setup();
      if (current && current.status !== 'draft') {
        current = data.campaigns.find((d) => d.id === current.id) || current;
        $('[data-email-draft-status]').textContent = `${statusName(current.status)} · use New email to write another message`;
      }
      renderLists();
    }
    finally { loading = false; }
  }
  async function save() {
    const result = await api('save', { id: current?.id, version: current?.version, draft: draftValue() });
    current = result.campaign; dirty = false; reviewed = null;
    $('[data-email-draft-status]').textContent = `Saved · ${new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}`;
    return current;
  }
  function dialog(html) {
    const el = $('[data-email-dialog]');
    el.innerHTML = html + '<p class="form-message" data-email-dialog-message role="alert"></p>';
    el.querySelector('h2').id = 'email-dialog-title';
    el.showModal();
  }
  function closeDialog() { $('[data-email-dialog]').close(); }
  function confirmDiscard() { return !dirty || window.confirm('Leave this email without saving your latest changes?'); }
  function contactEditor(id) {
    const c = data.contacts.find((item) => item.id === id) || { marketing_status: 'not_subscribed' };
    dialog(`<h2>${id ? 'Edit' : 'Add'} contact</h2><form data-email-contact-form data-id="${id || ''}"><div class="email-inline-fields"><label>First name<input name="first_name" value="${esc(c.first_name || '')}" maxlength="100"></label><label>Last name<input name="last_name" value="${esc(c.last_name || '')}" maxlength="100"></label></div><label>Email address<input name="email" type="email" value="${esc(c.email || '')}" ${id ? 'readonly' : ''} required maxlength="254"></label><label>Newsletter preference<select name="marketing_status">${['not_subscribed', 'subscribed', 'unsubscribed'].map((s) => `<option value="${s}" ${c.marketing_status === s ? 'selected' : ''}>${statusName(s)}</option>`).join('')}</select></label><label>Consent note<textarea name="consent_note" maxlength="1000" rows="3" placeholder="For example: asked to join the newsletter by email on 22 September.">${esc(c.consent_note || '')}</textarea></label><p class="helper-text">Only choose Subscribed if this person has agreed to receive newsletters. A note is required for new subscriptions.</p><input type="hidden" name="original_status" value="${c.marketing_status}"><div class="email-actions"><button type="submit" class="btn btn-primary">Save contact</button><button type="button" class="btn btn-secondary" data-email-action="close-dialog">Cancel</button></div></form>`);
    $('[data-email-contact-form]').addEventListener('submit', (event) => { event.preventDefault(); perform('save-contact'); });
  }
  function groupEditor(id) {
    const group = data.groups.find((g) => g.id === id);
    const members = new Set(data.memberships.filter((m) => m.group_id === id).map((m) => m.contact_id));
    dialog(`<h2>${id ? 'Edit' : 'Create'} group</h2><form data-email-group-form data-id="${id || ''}"><label>Group name<input name="name" required maxlength="120" value="${esc(group?.name || '')}" placeholder="For example: Tuesday adults"></label><label>Find members<input type="search" data-email-group-search placeholder="Name or email"></label><div class="email-picker">${data.contacts.map((c) => `<label class="email-check" data-email-member-row><input type="checkbox" name="members" value="${c.id}" ${members.has(c.id) ? 'checked' : ''}><span>${esc(name(c))}<small>${esc(c.email)}</small></span></label>`).join('') || '<p>Add contacts before creating a group.</p>'}</div><div class="email-actions"><button type="submit" class="btn btn-primary">Save group</button><button type="button" class="btn btn-secondary" data-email-action="close-dialog">Cancel</button></div></form>`);
    $('[data-email-group-form]').addEventListener('submit', (event) => { event.preventDefault(); perform('save-group'); });
  }
  async function review() {
    if (!$('[data-email-compose]').reportValidity()) return;
    await save();
    reviewed = await api('preview', { id: current.id });
    const preview = content(current, reviewed.recipients[0] || { first_name: 'there' });
    dialog(`<h2>Ready to send?</h2><p><strong>${reviewed.recipients.length} individual emails</strong> · ${current.purpose === 'marketing' ? 'Newsletter / promotion' : 'Coaching / booking update'}</p><details><summary>Review recipients</summary><div class="email-picker">${reviewed.recipients.map((c) => `<p>${esc(c.first_name || '')} &lt;${esc(c.email)}&gt;</p>`).join('') || '<p>No eligible recipients. Choose contacts or check newsletter consent.</p>'}</div></details><div class="email-preview"><div class="email-preview-meta"><strong>${esc(preview.subject)}</strong></div>${preview.html}</div><p class="email-note">Keep this page open while sending. If interrupted, resume from Drafts & history. Recipients already accepted by Resend are not sent again.</p><div class="email-actions"><button type="button" class="btn btn-secondary" data-email-action="close-dialog">Back to editing</button><button type="button" class="btn btn-primary" data-email-action="send" ${reviewed.recipients.length && data.sending.ready ? '' : 'disabled'}>Send to ${reviewed.recipients.length} recipients</button></div>`);
  }
  async function sendLoop(id) {
    running = true; pause = false;
    const progress = $('[data-email-progress]'); progress.hidden = false;
    tab('compose');
    try {
      do {
        progress.innerHTML = '<p>Sending your email… Please keep this page open.</p><button type="button" class="btn btn-secondary" data-email-action="pause">Pause after this batch</button>';
        const result = await api('process', { id });
        progress.innerHTML = `<progress value="${result.total - result.pending}" max="${result.total || 1}" aria-label="Email progress"></progress><p>${result.sent} accepted by Resend · ${result.pending} waiting · ${result.skipped} skipped · ${result.needs_review} need checking</p>`;
        if (result.error) throw new Error(result.error);
        if (result.busy) throw new Error('This email is already being processed. Wait 90 seconds, then resume from Drafts & history if needed.');
        if (!result.pending) { say(result.needs_review ? 'Sending stopped. Some deliveries need checking in History.' : 'Sending finished. View each recipient’s result in Drafts & history.'); break; }
        if (pause) { say('Sending paused. Resume from Drafts & history when you are ready.'); break; }
      } while (true);
    } finally {
      running = false;
      await load();
    }
  }
  async function details(id) {
    const result = await api('detail', { id });
    $('[data-email-history-detail]').innerHTML = `<div class="email-card" style="margin-top:1rem"><h3>${esc(result.campaign.subject)}</h3><p>${result.sent} accepted by Resend · ${result.pending} waiting · ${result.skipped} skipped · ${result.needs_review} need checking</p><div class="email-picker">${result.recipients.map((r) => `<p>${badge(r.status)} ${esc(r.email)}${r.error_message ? `<br><small>${esc(r.error_message)}</small>` : ''}</p>`).join('')}</div></div>`;
  }
  function onInput(event) {
    if (event.target.matches('[data-email-recipient-search]')) return renderRecipients();
    if (event.target.matches('[data-email-contact-search]')) return renderLists();
    if (event.target.matches('[data-email-group-search]')) { root.querySelectorAll('[data-email-member-row]').forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(event.target.value.toLowerCase()); }); return; }
    if (event.target.closest('[data-email-compose]')) { dirty = true; reviewed = null; $('[data-email-draft-status]').textContent = 'Unsaved changes'; updatePreview(); updateCount(); }
  }
  function onChange(event) {
    const el = event.target;
    if (el.dataset.emailContactCheck) { el.checked ? selectedContacts.add(el.dataset.emailContactCheck) : selectedContacts.delete(el.dataset.emailContactCheck); }
    if (el.dataset.emailGroupCheck) { el.checked ? selectedGroups.add(el.dataset.emailGroupCheck) : selectedGroups.delete(el.dataset.emailGroupCheck); }
    if (el.matches('[data-email-template]') && templates[el.value]) {
      const template = templates[el.value];
      if ($('[data-email-compose]').elements.body.value && !window.confirm('Replace the current subject and message with this template?')) { el.value = ''; return; }
      for (const key of ['purpose', 'subject', 'body']) $('[data-email-compose]').elements[key].value = template[key];
      dirty = true; updatePreview();
    }
    updateCount();
  }
  async function perform(action, id) {
    if (action === 'pause') { pause = true; say('The current batch will finish, then sending will pause.'); return; }
    if (busy) return;
    busy = true;
    root.querySelectorAll('form').forEach((form) => { form.inert = true; });
    root.setAttribute('aria-busy', 'true');
    try {
      if (action === 'refresh') { await load(); say('Email workspace refreshed.'); }
      if (action === 'new' && confirmDiscard()) { fillDraft(); tab('compose'); }
      if (action === 'save') { await save(); say('Draft saved.'); await load(); }
      if (action === 'review') await review();
      if (action === 'test') { if (!$('[data-email-compose]').reportValidity()) return; await save(); const result = await api('test', { id: current.id }); say(`Test email sent to ${result.email}.`); await load(); }
      if (action === 'close-dialog') closeDialog();
      if (action === 'sync') { await api('sync'); await load(); say('Website customers and junior groups synced. Newsletter preferences have been preserved.'); }
      if (action === 'add-contact' || action === 'edit-contact') contactEditor(id);
      if (action === 'add-group' || action === 'edit-group') groupEditor(id);
      if (action === 'save-contact') {
        const form = $('[data-email-contact-form]');
        await api('contact', { contact: { ...Object.fromEntries(new FormData(form)), id: form.dataset.id || undefined } });
        closeDialog(); await load(); say('Contact saved.');
      }
      if (action === 'save-group') {
        const form = $('[data-email-group-form]'), values = new FormData(form);
        await api('group', { id: form.dataset.id || undefined, name: values.get('name'), contact_ids: values.getAll('members') });
        closeDialog(); await load(); say('Group saved.');
      }
      if (action === 'open' || action === 'duplicate') {
        if (!confirmDiscard()) return;
        const d = data.campaigns.find((item) => item.id === id);
        fillDraft(action === 'duplicate' ? { ...d, id: undefined, status: 'draft', subject: d.subject } : d); tab('compose');
      }
      if (action === 'detail') await details(id);
      if (action === 'send') {
        if (!reviewed || !current) return;
        await api('queue', { id: current.id, hash: reviewed.hash });
        current.status = 'sending'; dirty = false; closeDialog();
        $('[data-email-compose]').querySelectorAll('input,textarea,select,button').forEach((el) => { el.disabled = true; });
        await sendLoop(current.id);
      }
      if (action === 'resume') {
        if (!confirmDiscard()) return;
        fillDraft(data.campaigns.find((item) => item.id === id));
        await sendLoop(id);
      }
    } catch (error) {
      if ($('[data-email-dialog]')?.open) { const message = $('[data-email-dialog-message]'); message.textContent = error.message; message.dataset.tone = 'error'; }
      else say(error.message, true);
    } finally { busy = false; root.querySelectorAll('form').forEach((form) => { form.inert = false; }); root.setAttribute('aria-busy', 'false'); }
  }
  section.addEventListener('click', (event) => {
    const view = event.target.closest('[data-email-view]');
    if (view && !busy) { tab(view.dataset.emailView); if (view.dataset.emailView === 'history') load().catch((e) => say(e.message, true)); }
    const button = event.target.closest('[data-email-action]');
    if (button) { event.preventDefault(); perform(button.dataset.emailAction, button.dataset.id); }
  });
  window.addEventListener('beforeunload', (event) => { if (dirty || running) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('kims:admin-tab-changed', (event) => { if (event.detail.activeTab === 'emails' && !data) load().catch((e) => say(e.message, true)); });
})();
