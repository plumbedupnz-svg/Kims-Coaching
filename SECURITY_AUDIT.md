# Kim Jones Coaching Security Audit

Audit date: 19 July 2026

Repository state reviewed: `origin/main` at `da28a97`

Scope: repository code and locally available Git history. Supabase, Stripe, Resend, DNS, and Vercel dashboard settings were not independently accessible.

## Executive Summary

**Overall status after this change set and after applying the migration: Moderate risk.**

The codebase is a static HTML/JavaScript application with Vercel Node functions, not a Next.js application. Supabase Auth runs in the browser. Authorisation therefore depends on Supabase RLS, column grants, checked database functions, and verification inside Vercel APIs. The static admin page is not itself a security boundary; protected data remains behind RLS and admin checks.

Eight High-severity issues were confirmed. The most serious allowed browser-supplied prices to become private-lesson totals, allowed direct writes to paid/admin workflow fields, exposed product costs through public table reads, and allowed unauthenticated use of the email API. The repository fixes are complete, but the database protections do not take effect until `20260719000000_security_hardening.sql` is applied in Supabase.

Finding count: **0 Critical, 8 High, 8 Medium, 3 Low, 3 Informational**.

This audit does not claim that the website is completely secure. External platform configuration and production data behaviour require the manual checks below.

## Current Architecture

- Auth: Supabase Auth through `@supabase/supabase-js`; browser sessions are refreshed by the SDK and logout calls Supabase `signOut`.
- Roles: trusted `public.profiles.role`; new-user trigger always creates `customer`; customers have no grant to update `role`.
- Browser data: direct Supabase queries protected by RLS and column grants. Admin pages also call checked `SECURITY DEFINER` RPCs.
- APIs: four Vercel handlers: public shop catalogue, email, Stripe Checkout, and Stripe webhook.
- Payments: Vercel creates Stripe Checkout sessions; raw-body webhook signatures confirm payment; success pages are informational only.
- Storage: public product images and private supplier invoice PDFs.
- Personal data: names, child/player details, age/date of birth, email, phone, addresses, levels, bookings, orders, payment references, and notes.

## Findings

| ID | Severity | Area | Evidence and impact | Remediation/status | Files and tests |
|---|---|---|---|---|---|
| KJC-001 | High | Email API | `/api/send-email` accepted an arbitrary type, payload, and recipient without authentication. It could be abused for branded spam and false notifications. | **Fixed.** Internal requests use a timing-safe shared secret; customer actions require a verified Supabase user plus record ownership; admin actions require the trusted profile role; recipients are authoritative. | `api/send-email.js`, `email-service.js`, `api/stripe/_helpers.js`; unauthenticated and internal-send tests. |
| KJC-002 | High | Private lessons | `create_private_lesson_booking` stored `p_total_price`, bundle count, discount, and email supplied by the browser. Checkout trusted that stored total. | **Fixed in migration.** Price, bundle terms, lesson type, and account email are loaded from trusted rows. The original signature remains compatible. | `20260719000000_security_hardening.sql`; trusted-total static test; manual Stripe test required. |
| KJC-003 | High | Junior enrolments | Customers could directly insert junior members or update temporary pending rows, including paid/converted fields. | **Fixed in migration.** Direct member/pending writes are revoked; the checked pending-booking RPC derives price/email and creates only a temporary hold. Paid enrolment remains webhook-owned. | Migration; unsafe-grant tests; two-account manual test required. |
| KJC-004 | High | Player profiles | Own-row RLS allowed customers to update admin level, internal notes, payment, placement, group, and Stripe fields. | **Fixed in migration.** A trigger permits ordinary profile edits but rejects customer changes to server/admin workflow fields. | Migration; protected-trigger test; customer/admin manual tests required. |
| KJC-005 | High | Shop orders | Customers could directly insert arbitrary order totals/status data. A legacy stock-order RPC also accepted browser totals. | **Fixed in migration.** Direct order insert and legacy RPC execution are removed from customer roles. Current Vercel checkout uses service-role reads and server-calculated totals. | Migration and `api/stripe/create-checkout-session.js`; manipulation assertions/manual Stripe test. |
| KJC-006 | High | Stripe webhook | Signatures had no age tolerance, permitting replay; failed-event retries were not claimed atomically, permitting concurrent duplicate work. Full event payloads were stored. | **Fixed.** Five-minute timestamp tolerance, minimal event payload, and conditional failed-event claim. | `api/stripe/_helpers.js`, `api/stripe/webhook.js`; valid/invalid/stale signature and duplicate-event tests. |
| KJC-007 | High | Catalogue data | Anonymous table-level selects exposed inventory supplier, cost, and purchase-price fields. | **Fixed in code/migration.** Public API queries omit costs; table grants are replaced with display-column allow-lists; admins reload full rows through checked RPCs. | `api/shop-products.js`, `app.js`, migration; manual anon/admin query test required. |
| KJC-008 | High | Privileged RPCs | Several `SECURITY DEFINER` helpers were executable by anonymous/authenticated roles without their own admin check, including stock movement, category/sync helpers, logging, and legacy stock order creation. | **Fixed in migration.** Direct execution is service-role-only. Guarded publishing RPCs remain available to admins. | Migration; grant regression assertions. |
| KJC-009 | Medium | API validation | Request bodies and cart sizes were unbounded; internal errors were returned too directly. | **Fixed.** 256KB JSON/email, 1MB webhook, 50 cart lines, quantities 1-99, generic internal failures. | API files; body-size tests. |
| KJC-010 | Medium | Storage uploads | Supplier invoice bucket had no enforced MIME or file-size limits. | **Fixed in migration and client.** Private, PDF-only, 10MB maximum, admin policies retained. | `admin-inventory.js`, migration; manual upload tests. |
| KJC-011 | Medium | Browser headers | No CSP, clickjacking, HSTS, referrer, MIME, permissions, or authenticated-cache policy existed. | **Fixed.** Vercel headers added and inline scripts moved to files. | `vercel.json`, `login-redirect.js`, `payment-success.js`; config test. |
| KJC-012 | Medium | Logging/PII | Logs included customer email context and full Stripe payloads; email subject logs could contain names. | **Fixed.** Logs retain IDs/status only, webhook payload is minimal, and user-facing API errors are generic. | Email, booking, checkout, webhook files; source review. |
| KJC-013 | Medium | Site settings | All site settings were readable anonymously. | **Fixed in migration.** Only `homepage_photo` is public; admins retain full access. | Migration; manual anon query required. |
| KJC-014 | Medium | Abuse prevention | Email and checkout had no throttling. | **Partially fixed.** In-process per-IP limits were added. Distributed Vercel Firewall rate limits are still required because serverless instances do not share memory. | `api/_rate-limit.js`, API handlers; 429 test. |
| KJC-015 | Medium | Platform auth/config | Email confirmation, redirect allow-list, password protection, live/test separation, and backup settings cannot be proven from the repository. | **Manual action.** Verify the dashboard checklist below. | No code change. |
| KJC-016 | Medium | Security audit trail | Inventory movements exist, but role changes, product-price changes, settings changes, refunds, and data exports do not have a complete immutable audit trail. | **Open.** Decide retention and audit requirements before adding a new PII-bearing log system. | Business/platform decision. |
| KJC-017 | Low | Supply chain | Supabase JS uses mutable major CDN tag `@2`; no lockfile or SRI protects CDN scripts. PDF.js is version-pinned and QR code is vendored. | **Open.** Pin an exact reviewed Supabase bundle or adopt a reproducible bundled build in a separate tested change. | HTML entry points. |
| KJC-018 | Low | Session storage | Static architecture uses the Supabase SDK's browser storage for access/refresh tokens. XSS would therefore threaten sessions. | **Mitigated, open architectural risk.** CSP and escaping reduce exposure; HTTP-only server sessions would require a larger architecture change. | `vercel.json`; no workflow change. |
| KJC-019 | Low | Admin route shell | `/admin` HTML is public and can briefly show a shell before auth resolves. Protected data is not embedded and remains behind RLS. | **Accepted with mitigation.** `no-store` added; route redirects remain UX only. Vercel preview protection is recommended. | `vercel.json`, existing auth/RLS. |
| KJC-020 | Informational | Framework | The supplied scope described Next.js, but the repository is static HTML/JS plus Vercel CommonJS functions. | Recorded so deployment/security assumptions match the actual app. | No change. |
| KJC-021 | Informational | Secrets | Current files and available Git history contained no service-role, Stripe secret, webhook secret, Resend secret, private key, database URI, or Vercel token. The browser Supabase publishable key is expected. | `.gitignore` added. No rotation is indicated by repository evidence; rotate any credential known to have been shared elsewhere. | `.gitignore`; pattern/history scan. |
| KJC-022 | Informational | Retention/backups | Data retention, account deletion, backup access, and use of real PII in test data are business/platform concerns not represented in code. | Decide and document retention/deletion policy; verify private backups and non-production test data. | Manual/business action. |

## Access-Control Matrix

`S/I/U/D` means select, insert, update, and delete. Service role is server-only and bypasses RLS by design.

| Role | Customer/private records | Bookings and payments | Shop/admin records | Admin operations |
|---|---|---|---|---|
| Logged-out visitor | No private data | Public availability/programmes only; waitlist insert | Active catalogue display columns/settings only | None |
| Customer | Own profile and players; protected player fields blocked | Own records read; booking creation only through checked RPC; no paid/status writes | Own paid-order history read; Checkout created by Vercel | None; role is not user-updatable |
| Admin | Read/manage records needed by admin UI | Manage through admin RLS/checked RPCs | Full inventory/product/order/report access; private supplier documents | Trusted `profiles.role = admin` check in RLS/RPC/API |
| Service role | Full server-side access | Creates checkout records and confirms webhook payments | Full server-side fulfilment/email access | Never shipped to browser; Vercel environment only |

## Supabase RLS Matrix

All listed public tables enable RLS in the migration history. This matrix describes effective intent after the new migration; database verification is still required after applying it.

| Table | Visitor | Customer | Admin | Service role | Assessment |
|---|---|---|---|---|---|
| `profiles` | - | own S/U on allowed columns | all S/U allowed by grants | all | Safe; role not customer-updatable |
| `players` | - | own S/I/U, protected workflow fields blocked; no D | all S/I/U/D | all | Safe after migration |
| `lesson_types` | active S | active S | S/I/U/D | all | Safe |
| `lesson_bundles` | active S | active S | S/I/U/D | all | Safe |
| `availability` | available S | available S | S/I/U/D | all | Safe |
| `bookings` | - | own S; I only through trusted RPC | S/I/U/D | all | Safe after migration |
| `waitlist` | I | own S/I/U/D | S/I/U/D | all | Public form is intentional; rate-limit at platform |
| `coaching_clubs` | active S | active S | S/I/U/D | all | Safe |
| `coaches` | public fields via RPC | public fields via RPC | S/I/U/D | all | Safe |
| `junior_programmes` | published S | published S | S/I/U/D | all | Safe |
| `junior_groups` | published S | published S | S/I/U/D | all | Safe |
| `junior_group_sessions` | published S | published or paid-member S | S/I/U/D | all | Safe |
| `junior_group_members` | - | own S; no direct I/U/D | S/I/U/D | all | Safe after migration |
| `junior_group_pending_bookings` | - | own S; I only through RPC; no direct U | S/I/U/D | all | Safe after migration |
| `session_plans` | - | S for own confirmed paid group | S/I/U/D | all | Safe |
| `payments` | - | own S | S/I/U/D | all | Safe |
| `payment_reminders` | - | - | S/I/U/D | all | Safe |
| `accounting_links` | - | - | S/I/U/D | all | Safe |
| `product_categories` | S | S | S/I/U/D | all | Public classification data only |
| `inventory_items` | active public-column S | active public-column S | full via checked RPC; manage via RLS | all | Safe after migration |
| `inventory_item_images` | public-item S | public-item S | S/I/U/D | all | Safe; image URLs only |
| `products` | active public-column S | active public-column S | full via checked RPC; manage via RLS | all | Safe after migration |
| `shop_products` | active S | active S | S/I/U/D | all | Legacy public product data; no cost fields |
| `shop_inventory_settings` | S | S | S/I/U | all | Contains non-secret checkout/tax settings |
| `shop_orders` | - | own S; no direct I/U/D | S/I/U/D | all | Safe after migration |
| `supplier_invoices` | - | - | S/I/U/D | all | Safe |
| `supplier_invoice_items` | - | - | S/I/U/D | all | Safe |
| `stock_movements` | - | - | S/I through checked RPCs | all | Safe after RPC revocation |
| `email_settings` | - | - | S/I/U | all | Safe; secrets remain in Vercel, not rows |
| `notification_logs` | - | - | S | I/U via API | Safe after RPC revocation |
| `stripe_webhook_events` | - | - | S | S/I/U/D | Safe; minimal payload only |
| `site_settings` | homepage photo S | homepage photo S | S/I/U/D | all | Safe after migration |

## Storage Security Matrix

| Bucket | Public | Read | Upload/update/delete | Limits | Assessment |
|---|---|---|---|---|---|
| `product-images` | Yes | Anyone | Admin only | JPG/PNG/WebP, 20MB bucket maximum; product UI compresses to 2MB | Appropriate for public catalogue/homepage media; SVG/HTML excluded |
| `supplier-invoices` | No | Admin only | Admin only | PDF only, 10MB after migration | Appropriate for supplier documents; no permanent public URL |

Storage paths are generated by the app and server policy, not trusted as an authorisation boundary. RLS checks remain the boundary. No customer-document bucket exists in the reviewed schema.

## Secrets Review

- No committed privileged credential was found in current files or available local Git history.
- `supabase-config.js` contains a publishable/anonymous project key. That is expected in a browser app and must be protected by RLS, not treated as a secret.
- `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, and `EMAIL_INTERNAL_SECRET` are referenced only in server functions/environment documentation.
- No `NEXT_PUBLIC_` privileged secret was found.
- `.env*`, Vercel state, logs, coverage, and dependency directories are now ignored.
- **Credential rotation required from this audit: none.** Rotate immediately if any privileged value has been pasted into a public issue/chat, exposed in a dashboard screenshot, or stored outside the history available here.

## Automated Verification

- `node --check` passed for every non-vendored JavaScript file.
- `node --test` passed: 10/10 after endpoint throttling was added.
- Tests cover unauthenticated email use, oversized API bodies, receipt XSS escaping, recent/invalid/stale Stripe signatures, duplicate webhook suppression, rate limiting, security headers, trusted totals, and revoked write/RPC grants.
- `npm test` could not be invoked because this workspace runtime has no `npm`; `node --test` is the exact script in `package.json` and was run directly.
- Typecheck, lint, and production-build scripts do not exist. The site is static and has no build step.
- Dependency audit cannot run because there are no package dependencies or lockfile. CDN dependencies were reviewed manually.
- Live Supabase RLS tests were not run because no isolated test project/customer credentials were provided. Do not run destructive role tests against production data.

## Manual Security Tests

Run these in a staging/preview project after the migration, using two new test customers A/B and one admin:

1. Log out and confirm `/admin` exposes no data; direct REST selects of profiles, players, bookings, orders, payments, and supplier tables return no rows/permission denied.
2. As Customer A, read A's profile/players/bookings/orders. Substitute B's UUID in REST filters, RPC arguments, URLs, and JSON bodies; every cross-account operation must return no row or an authorisation error.
3. As Customer A, attempt to update `profiles.role`, player payment/placement/admin fields, booking payment/status, junior paid/status fields, and shop order status/totals. All must fail.
4. Create a private lesson while changing `p_total_price`, bundle count, discount, user ID, and email in the request. The saved amount/email must match trusted database/account values. Stripe must charge that trusted amount.
5. Create a junior checkout, abandon it, and verify no paid member appears. Complete payment and verify exactly one paid member appears. Replay the same webhook and verify no duplicate.
6. As anonymous/customer, select inventory/products including `cost_price`, `purchase_price`, or supplier fields. The request must be denied while normal shop fields still load.
7. As admin, confirm product/inventory lists still include cost fields through admin RPCs and all legitimate edits, placements, archive, reports, and stock adjustments work.
8. Upload a valid PDF under 10MB to supplier invoices. Reject non-PDF and over-10MB files. Confirm the private URL is not anonymously readable.
9. Send a stored XSS string such as `<img src=x onerror=alert(1)>` in a test customer/product field. It must render as text in customer/admin pages and email HTML.
10. Confirm `/api/send-email` rejects no-token and non-owner requests; admin diagnostics work only for an admin; repeated abuse receives 429.

Policy verification query after deployment:

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

## Required Deployment Actions

### Supabase

1. Back up/confirm a restore point according to the current plan. Do not reset or delete production data.
2. Run the complete file `supabase/migrations/20260719000000_security_hardening.sql` in the SQL Editor or normal migration pipeline.
3. Confirm `notify pgrst, 'reload schema'` completes, then run the policy verification query above.
4. Authentication: require email confirmation; set the Site URL to the exact production HTTPS origin; restrict redirect URLs to production and known previews; enable leaked-password protection and admin MFA where available.
5. Confirm database backups/exports are private and retention meets the business requirement.

### Stripe

1. Verify the production webhook points only to the production domain `/api/stripe/webhook` and subscribes only to required Checkout events.
2. Keep test/live keys separated by Vercel environment; verify the production webhook signing secret matches production.
3. Do not rotate based on this audit alone. Rotate if exposure is suspected, then update Vercel atomically.

### Vercel

1. Add a strong random `EMAIL_INTERNAL_SECRET` to Production and Preview. Do not prefix it with `NEXT_PUBLIC_`.
2. Confirm service-role, Stripe secret/webhook, and Resend values are server-only and scoped to the correct environments.
3. Add distributed Firewall rate limits for `/api/send-email` and `/api/stripe/create-checkout-session`; the code limit is only per warm instance.
4. Protect preview deployments, restrict deployment access, disable public source maps if enabled externally, and review function logs for old PII.
5. Redeploy from the commit containing these files after the Supabase migration succeeds. Verify response headers on production.

## Remaining Recommendations

**Fixed in this change set:** all eight High findings; safe Medium fixes for limits, headers, logs, settings, storage, and basic throttling.

**Credential rotation:** none indicated by repository/history evidence. Rotation is mandatory if exposure occurred outside the reviewed material.

**Dashboard work:** Auth/redirect/backups in Supabase; webhook/live-test separation in Stripe; environment scoping, preview protection, and distributed rate limiting in Vercel.

**Business decisions:** retention/account deletion, audit-log retention and access, export controls, and whether admin MFA is mandatory.

**Optional follow-up:** replace mutable CDN imports with an exact, reproducible bundled dependency set; add a staging Supabase integration suite that exercises A/B/admin JWTs on every RLS boundary; add an immutable minimal admin security-event log without storing unnecessary customer data.
