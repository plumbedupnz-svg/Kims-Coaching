# Email workspace

The website now includes **Admin → Emails**. This is a focused email tool built on the site's existing Resend account.

## What Kim can do

- Send a personal email or choose multiple individuals, custom groups, confirmed junior coaching groups, or all contacts.
- Paste up to 1,000 additional email addresses directly into a draft, without creating saved contacts or customer accounts. Commas, semicolons, spaces, tabs and new lines are supported; invalid addresses are flagged and duplicates are removed across the whole recipient list.
- Write a coaching update or a newsletter using three starter templates, a personalised `{{first_name}}` greeting, an inbox preview and an optional linked button.
- Save and reopen drafts, preview the branded message, send a test to her signed-in admin address, and review the exact recipient list before sending.
- Add/edit contacts, record newsletter consent, create/edit groups, and sync website customers.
- View recipient results and resume an interrupted send. Recipients receive separate messages; addresses are never exposed to the rest of the group.

## Enable on the live website

The local implementation does not apply production database changes or deploy itself.

1. Apply `supabase/migrations/20260922000000_email_campaigns.sql`, then `supabase/migrations/20260922010000_email_campaign_extra_recipients.sql` to the existing Supabase project, after its earlier migrations. They add email workspace tables and service-only functions; they do not send messages. Both migrations can be run again safely. If the first migration is already applied, only the second is needed for pasted address lists.
2. Keep the existing Vercel configuration described in `RESEND_EMAIL_SETUP.md`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and the existing sender configuration. Confirm **Settings → Email** is enabled with a verified-domain sender and Kim's reply-to address.
3. Set `EMAIL_SITE_URL=https://www.kimjonescoaching.co.nz` in Vercel Production. This is the trusted origin used in unsubscribe links. An existing `NEXT_PUBLIC_SITE_URL` (then `SITE_URL`) is also accepted when it is an HTTPS origin with no path. Set the correct origin separately for any staging environment.
4. Deploy the updated website and API files, including `vercel.json`. The campaign endpoint has a 60-second execution allowance.
5. Sign in as an administrator, open **Emails → Contacts**, and choose **Sync website customers**. Create any additional contacts or groups.
6. Prepare a draft and use **Send myself a test** to check the real sender, reply-to and layout. Only use **Review & send** when ready to send the selected message to its listed recipients.

No extra mail-provider account, client-side secret or scheduled job is required.

## Newsletter preferences

Importing customer accounts does **not** mark them as newsletter subscribers. New contacts begin with coaching emails only. To subscribe someone, edit their contact, choose **Subscribed**, and record when and how they agreed. Sync does not overwrite existing consent or unsubscribes.

Use **Compose → Paste email addresses** for recipients who are not saved. The list is kept with the draft, including when reopening or reusing an email. A person without a saved first name is greeted as “Hi there” when the template uses `{{first_name}}`. For newsletters, add a note recording when and how the pasted recipients agreed to receive the message. Existing contact preferences still apply. Newsletter unsubscribe preferences for external recipients are remembered separately and checked on future pasted lists; this does not create customer accounts or entries in Contacts.

Choose **Coaching / booking update** for a message about existing coaching or bookings. Choose **Newsletter / promotion** for news, invitations and offers. Newsletters go only to subscribed contacts, with a personalised unsubscribe link and one-click unsubscribe headers. Opening the link displays a confirmation page; only submitting it changes the preference, so link scanners do not unsubscribe people merely by visiting the URL. Unsubscribing does not stop transactional booking emails.

Junior group recipients are refreshed before review and again at send confirmation. Only confirmed members in active groups are included, excluding cancelled, refunded and inactive placements. A changed audience requires another review. A recipient's address and newsletter preference are also checked immediately before each send.

## Sending and recovery

Keep the admin page open while sending. It processes up to ten recipients per request, pacing provider calls. If the browser closes, the connection drops or the provider rejects a request, reopen **Drafts & history → Resume sending**. Pausing waits for the current batch; it does not recall messages already submitted. Sending does not continue unattended after closing the page.

Each campaign freezes its recipient list and content at confirmation. A database lease prevents two tabs processing the same campaign concurrently. Each recipient has a saved payload and stable provider idempotency key, so an uncertain send can retry the same request safely. After 23 hours, uncertain deliveries become **Needs checking** instead of being retried automatically. Check the corresponding Resend log before creating any replacement message, and target only people confirmed not to have received the original.

**Accepted by Resend** means the provider accepted the send request. It is not proof of inbox delivery or an open. This version does not include scheduling, attachments, CSV import, a drag-and-drop editor, open/click tracking, or automated sequences. Provider account sending limits still apply.

Resend's [idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys) explains its 24-hour retry window; the app uses a 23-hour cutoff. The payload follows the [Send Email API](https://resend.com/docs/api-reference/emails/send-email).

## Local verification

```sh
npm test
npm run preview:emails
```

Open `http://127.0.0.1:4176/admin.html#emails` for the sample-data preview. It uses the real API handlers, an in-memory PostgreSQL database and an intercepted email provider. Every send in this preview is simulated, and it cannot connect to the live database or provider. Preview data disappears when the process stops.

Tests cover admin-only access, service-only database permissions, pasted address parsing and validation, deduplication across lists and groups, external recipient delivery without contact creation, persistent external opt-outs, group updates, consent evidence, concurrent preference changes, draft version conflicts, recipient review, worker leases, individual recipient privacy, retries after an uncertain send, expired retries, unsubscribe behavior, administrator-only tests, and pagination beyond one database page.
