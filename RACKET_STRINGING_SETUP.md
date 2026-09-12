# Rackets and restring reminders

Under **Admin → Customers → Rackets & stringing**, staff can:

- Keep several rackets for a customer or family, with the player name and racket brand/model.
- Record the date strung, strings and tension in lb or kg, including separate mains/crosses for hybrids.
- Reuse the previous settings for a new stringing, inspect history and correct individual entries.
- Record customer consent and choose a reminder interval from 1–104 weeks or months.
- Turn reminders off at any time. Customers can reply to the reminder to change their interval or opt out; staff then update the preference here.

The newest stringing date determines the reminder date. Adding older history does not replace the latest stringing. Calendar months clamp to the end of the destination month. Operational dates use Pacific/Auckland. One reminder is sent per stringing; changing its interval after an email has been sent does not send another email for that same stringing.

## Release setup

1. Apply `supabase/migrations/20260912000000_customer_racket_stringing.sql` to the existing Kims Coaching Supabase project. It creates new tables and functions; existing customer profiles and booking records are preserved. Run this migration once using the normal migration process, before publishing the updated UI.
2. Confirm these server-only Vercel environment variables are configured: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and a random `CRON_SECRET` of at least 32 characters. The last variable is new. Never put these values in browser JavaScript.
3. Confirm **Admin → Settings → Email** has live email enabled and the Resend sender and reply-to addresses are correct. The reminder worker uses these existing saved settings.
4. Deploy the branch to production. `vercel.json` registers `/api/racket-reminders` daily at 21:00 UTC (9am NZ standard time / 10am daylight time). Vercel cron runs only in production; preview deployments do not send scheduled reminders. See [Vercel cron setup](https://vercel.com/docs/cron-jobs/quickstart) and [cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
5. Check that the scheduler is registered and its next run returns successfully. Saving a racket itself never sends an email. Only customers whose recorded preference is enabled are eligible.

Production activation requires the migration, server credentials and a production deployment. Merging this change does not apply the SQL migration or configure the server credentials.

## Sending and recovery

The endpoint requires `Authorization: Bearer <CRON_SECRET>`. Each run leases up to 20 due reminders, stopping early near its execution limit. Unprocessed reminders remain due for the next daily run. If volume regularly exceeds that capacity, raise the batch size and/or use a more frequent schedule supported by the hosting plan.

The worker checks current consent and the latest stringing before each send. It stores the exact email payload before sending and uses a stable Resend idempotency key. An overlapping run cannot claim the same leased reminder. A successful response stores the provider ID and the sent date. The rackets UI displays delivery issues; the detailed delivery records are stored in `racket_reminder_deliveries` and failures appear in Vercel function logs.

[Resend keeps idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys). After an ambiguous failure, an operator can repeat the authenticated cron invocation after the five-minute lease expires and within 23 hours of the first attempt. The payload and key remain unchanged. After that, the worker marks the delivery `needs_review` rather than risking a duplicate email. A daily run alone will normally put an uncertain prior-day attempt into review.

For `needs_review`, check the corresponding Resend record before taking action. If it was delivered, reconcile its provider ID, sent date and status. If Resend confirms no email was accepted, an administrator may reset that delivery to pending and clear `first_attempt_at`, `locked_until`, `lease_token`, `email_payload` and `error_message` for a controlled retry. Never blindly reset an uncertain send. Turning reminders off stops future sends; an email already accepted by the provider cannot be recalled.

## Local verification

```sh
npm ci
npm test
npm run preview:rackets
```

Open `http://127.0.0.1:4173/admin.html#customers`. The preview serves the actual customer UI against synthetic profiles in an in-memory PostgreSQL database. It never connects to production Supabase or Resend. Preview saves disappear when the server is restarted.

Automated tests execute the new SQL against PGlite (PostgreSQL), including administrator/customer permissions, atomic validation, opt-out, overdue selection, overlapping claims, historical edits, calendar arithmetic and retry expiry. API tests mock external HTTP calls and cover cron authorization, disabled email, persistent payloads, idempotency, cancellation and failed delivery confirmation. Existing booking and shop email tests remain in the suite.
