# Resend email setup

Kim's Coaching uses Resend for every live email. There are two sending paths:

1. The Vercel API sends booking, shop, waitlist, and admin notifications through the Resend HTTP API.
2. Supabase Auth sends account confirmation, password reset, email change, and magic-link messages through Resend SMTP.

## 1. Verify the sending domain in Resend

Verify the domain used by `EMAIL_FROM_ADDRESS` in the Resend dashboard. The sender must be on that verified domain. A public mailbox domain such as `outlook.com` cannot be used as the Resend sender domain.

## 2. Configure Vercel application email

Set these Production environment variables and redeploy:

```text
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM_NAME=Kim Jones Coaching
EMAIL_FROM_ADDRESS=notifications@your-verified-domain.example
EMAIL_REPLY_TO=kim@your-domain.example
EMAIL_ADMIN_TO=kim@your-domain.example
SUPABASE_URL=https://tbvfpaikyxqhncjvnusr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

`EMAIL_ADMIN_TO` is optional; the saved reply-to/from address is used when it is absent.

Run `supabase/migrations/20260624070000_resend_only_email_provider.sql` in Supabase SQL Editor, then select **Resend**, enable the provider, and save under **Admin > Settings > Email**.

## 3. Configure Supabase Auth email through Resend

This dashboard configuration is required. Vercel environment variables do not control Supabase Auth's confirmation or password-reset sender.

In the Supabase project:

1. Open **Authentication > Email > SMTP Settings**.
2. Enable custom SMTP.
3. Set **Sender name** to `Kim Jones Coaching`.
4. Set **Sender email** to the same verified-domain sender used in Resend.
5. Set **Host** to `smtp.resend.com`.
6. Set **Port** to `465`.
7. Set **Username** to `resend`.
8. Set **Password** to a Resend API key.
9. Save the settings.

After saving, test both account signup confirmation and Forgot password. These Auth messages will appear in Resend's email logs, separately from application messages sent by Vercel.

## 4. Verify

1. In **Admin > Settings > Email**, click **Send Resend Test Email**.
2. Create a test booking and confirm both customer and admin messages arrive.
3. Create a new test account and confirm the account-confirmation message appears in Resend logs.
4. Request a password reset and confirm that message also appears in Resend logs.
5. Check `notification_logs` for application email attempts. Supabase Auth messages are tracked in Supabase Auth logs and Resend logs, not `notification_logs`.
