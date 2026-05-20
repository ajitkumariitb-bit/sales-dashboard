# Lead Recovery CRM

Next.js CRM/dashboard for ecommerce abandoned cart recovery, Shopify checkout stage tracking, Google Sheet sync, and Shiprocket Engage 360 browser lead imports.

## What Is Included

- Admin dashboard with recovery metrics, SLA risks, anti-fake performance checks, and salesperson leaderboard.
- Salesperson dashboard showing only assigned leads, with INIT hidden by default and leads sorted by checkout intent.
- Lead list with priority, stage, source, owner, status, location, cart value, follow-up, missed follow-up, and untouched hot lead filters.
- Lead detail page with customer/cart data, checkout and recovery URLs, stage/priority badges, activity timeline, follow-up history, quick call/WhatsApp links, and admin conversion capture.
- Activity logging that requires outcome and note, updates touch counts automatically, timestamps every action, and requires a next follow-up for outcomes that need another touch.
- Shiprocket CSV upload for browser leads, scored as P3 nurture leads.
- Google Sheet sync endpoint for abandoned cart rows with flexible column mapping and phone + checkout URL de-duplication.
- Supabase migrations and seed data for every required stage.
- Vercel cron config for 30-minute Google Sheet sync.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app runs in seeded demo mode when Supabase credentials are not set. Use the demo login switcher in the sidebar to move between Admin and Salesperson views.

## Supabase Setup

1. Create a Supabase project.
2. Run the SQL files in `supabase/migrations` in order.
3. Copy `.env.example` to `.env.local`.
4. Add:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The app uses the service role key only in server-side code for this internal CRM workflow.

## Google Sheet Sync

Set these variables:

```bash
GOOGLE_SHEET_ID=
GOOGLE_SHEET_RANGE=Sheet1!A:Z
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=
SYNC_SECRET=
```

For local setup, the easiest option is to use the downloaded JSON file directly instead of copying the private key. Put the JSON file in the project folder as `google-service-account.json`, then set:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=C:\Users\ajitm\OneDrive\Documents\Sales Dashboard\google-service-account.json
```

When this JSON path is set, `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` are not needed locally.

The sync route is:

```text
POST /api/sync/google-sheet
```

When `SYNC_SECRET` is present, send it as the `x-sync-secret` header. `vercel.json` schedules the endpoint every 30 minutes.

Flexible sheet columns are supported for phone, name, email, cart value, checkout URL, recovery URL, stage, product details, city/state, and created date.

## Shiprocket CSV Import

Go to `/import` and upload a CSV. Recognized columns include:

```text
customer_name, phone, product_names, product_url, event_date, whatsapp_status, source
```

Browser leads are imported as `shiprocket_csv`, shown separately, and scored from 35 to 45 depending on available product/cart information.

## Stage And Priority Logic

| Stage | Score | Priority |
| --- | ---: | --- |
| INIT | 20 | P3 Nurture |
| Phone received | 40 | P3 Nurture |
| OTP verified | 60 | P2 Warm |
| Address screen | 75 | P2 Warm |
| Order screen | 90 | P1 Hot |
| Payment initiated | 100 | P1 Hot |

Salesperson sorting defaults to:

1. Payment initiated
2. Order screen
3. Address screen
4. OTP verified
5. Phone received

## Deployment Notes

Deploy to Vercel after adding the environment variables. The included `vercel.json` enables the 30-minute sync schedule. For production auth, connect the sidebar demo selector to Supabase Auth or your identity provider while keeping the same `users.role` values: `admin` and `salesperson`.
