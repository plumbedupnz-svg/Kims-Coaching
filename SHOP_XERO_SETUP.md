# Shop services, invoices and Xero

Implementation is on `codex/shop-xero-invoices`. Live activation requires the migration, server configuration and Kim's Xero authorisation. Existing Stripe checkout continues while invoice checkout is disabled.

## Everyday use

- Inventory contains **Racket stringing – labour**, SKU **KJC-STRING-LABOUR**, initially **NZ$50 per racket**. Edit its selling price or discount in Inventory. Add the appropriate strings as a separate shop item. Labour has no stock quantity and never triggers an out-of-stock warning. Item type is chosen when an inventory item is created; create another item if its type needs to change.
- Customers add labour, strings and/or other products to the same cart. Optional racket/player details are saved with the order. Service-only orders use pickup with no delivery charge.
- When enabled, **every new shop order** creates one Xero sales invoice, for either card or online banking. Existing private/junior lesson payment flows are unchanged.
- The customer receives the Xero invoice email and sees the invoice payment link plus bank details. Bank payments must use the `KJC-000001` style invoice number as reference.
- Reconcile the bank receipt against that invoice in Xero. Xero's Stripe service handles card payments on the invoice. The shop retrieves Xero's current invoice balance after a signed notification and marks it paid only when Xero reports `PAID` and zero owing. Recording a payment manually in Xero also counts; the shop reflects the invoice balance, not a separate bank-reconciliation flag.
- Admin → Products → Shop orders shows the invoice, payment method, balance, email status, sync issues and a **Refresh from Xero** action. Fulfilment is independent: unfulfilled, in progress, ready, completed or cancelled. Changing fulfilment does not cancel an invoice or refund a payment.

## Activate in this order

1. Apply `supabase/migrations/20260917000000_shop_services_xero.sql` in this project's Supabase SQL editor after the existing migrations. It is transactional and safe to rerun. It adds the service once, preserves later edits to its price and leaves invoicing disabled. Back up the database as part of the normal release process.
2. In [Xero developer apps](https://developer.xero.com/app/manage), create a standard OAuth 2.0 **web app**, with the website `https://www.kimjonescoaching.co.nz` and this exact redirect URI:

   `https://www.kimjonescoaching.co.nz/api/xero?action=callback`

   The website requests `offline_access accounting.invoices accounting.contacts accounting.settings.read`. Keep the client secret on the server only. Do not place secrets in the public repository or chat.
3. Configure production Vercel environment variables, then deploy:

   | Variable | Value |
   | --- | --- |
   | `XERO_CLIENT_ID` | The web app client ID |
   | `XERO_CLIENT_SECRET` | The web app client secret |
   | `XERO_TOKEN_ENCRYPTION_KEY` | A securely generated 32-byte random key encoded as base64; retain it securely for token decryption |
   | `XERO_WEBHOOK_KEY` | The signing key from the app's webhook settings |
   | `CRON_SECRET` | Existing private cron secret, or a new securely generated secret if absent |
   | `SUPABASE_SERVICE_ROLE_KEY` | Existing server database key |
   | `NEXT_PUBLIC_SITE_URL` | `https://www.kimjonescoaching.co.nz` (check existing server site URL configuration) |

   Keep Xero production credentials out of preview deployments. Do not replace existing Stripe, Supabase or reminder configuration. The encryption key must remain stable; replacing it requires reconnecting Xero.
4. Configure the Xero app's **Invoice** webhooks to:

   `https://www.kimjonescoaching.co.nz/api/xero-webhook`

   Complete Xero's intent-to-receive validation and check that delivery is enabled. Correctly signed requests get HTTP 200, invalid signatures get 401. The route verifies the raw body and queues the work before responding.
5. In website Admin → Settings → **Xero & Invoices**, click **Connect Xero**, authorise Kim's organisation, select it and save the connection. A different organisation cannot replace one already selected by this integration.
6. In Xero, configure the invoice branding theme with the business name **Kim Jones Coaching Limited** and these payment details:

   **KIM JONES COACHING LTD**

   **01-0286-0978708-00**

   Enable [Stripe payments on that Xero invoice template](https://central.xero.com/0/article/Stripe). Use standard NZ online banking to the account above; Xero's separate Stripe Bank Transfer product is not the mechanism used here. Review any Stripe processing/surcharge settings in Xero before activation.
7. Select the appropriate **sales revenue account** and that **invoice template** in the website settings. Leave shop tax settings on **No GST**: Kim is not GST registered. The integration sends `NoTax`/`NONE`; a future GST registration requires a tax-mapping review before enabling GST invoice checkout.
8. Payment terms default to **due on receipt**, because no due period was specified. Adjust the setting to 0–90 days if required. Confirm the template has bank details and Stripe enabled, then enable invoice checkout.
9. Verify one authorised real order end to end: correct invoice, price, email, bank details, card payment availability and Xero → shop payment update. Do not send test invoices to real customers or run a charge without the business owner's explicit approval. A Xero demo organisation with separate test deployment is preferable for payment integration acceptance.

## Operations and recovery

- Each checkout key creates at most one saved order. A stable invoice number and order UUID recover a lost Xero creation response without creating another invoice. Client-supplied prices, stock flags and totals are ignored.
- Physical stock is reserved once when the invoice order is saved. Services and order-to-sale items do not reduce stock. Void an **unpaid, unfulfilled** invoice in Xero to cancel it and release the reservation once. Orders with a previously recorded payment or fulfilment already in progress require a manual stock review. Already paid/fulfilled returns and refunds need review in Xero and an explicit inventory adjustment; they are not automated here.
- If invoice creation is blocked before an invoice exists, fix the connection/settings and use **Refresh from Xero** to issue the original invoice. Stock remains reserved until the order can be reviewed. Do not delete the order or manually issue a duplicate invoice.
- Xero failures remain queued. Signed webhooks, the customer payment page and admin refresh trigger workers. A daily recovery cron also queues older invoices, including paid invoices so missed payment removals can be detected. The worker is time bounded; larger backlogs need repeated admin refreshes or a more frequent scheduler supported by the hosting plan.
- A changed Xero invoice number, reference, currency or total is a review issue. The shop will not automatically accept the changed financial record. Correct the invoice or resolve the order deliberately before fulfilment.
- If an invoice email response is uncertain, its status becomes **Needs review**. Check Xero's invoice history and email it manually from Xero if needed. The integration does not blindly resend an email whose first delivery may have succeeded.
- Reconnect Xero if authorisation expires or is revoked. Tokens are encrypted in a private database table. Only server credentials can access tokens, settings, OAuth state and the job queue.
- Turning off invoice checkout only affects new checkouts. Previously saved invoice links and payment syncing continue; their bank details are snapshots. Orders that have not yet obtained an authorised invoice need administrator review while invoice checkout is disabled.
- Existing Stripe-only orders are not retroactively posted to Xero. Do not also enable a separate connector that creates invoices for these new shop orders, or it may duplicate the accounting records.
- Existing GA4 checkout/purchase verification covers the legacy direct Stripe flow. Xero invoice conversions are not reported as verified GA4 purchases by this change.
- This integration records purchases in Shop orders. Recording the actual string and tension used on the customer's racket remains a separate admin step in Customers.

## Verification

`npm test` exercises database permissions, stock reservation/release, partial/paid/reversed payments, retries, queue leases, signed webhooks, token encryption, authoritative prices and provider routing, as well as the existing application tests.

`node scripts/preview-invoices.cjs` serves synthetic UI data at `http://127.0.0.1:4175/shop.html`; its admin preview is `/admin.html#settings`. It makes no Xero calls, sends no emails and takes no payments. It is for local review, not production.
