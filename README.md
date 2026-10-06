# VendorDash

A night-market booking app. **Vendors** (Android app) browse a stall map, request a
stall, pay by GCash/Maya, show a QR code at check-in, and submit sales.
**Organizers** (website) manage venues, sessions and stalls, approve bookings,
check vendors in, handle refunds and read sales reports.

School project. Built with Expo (React Native + Expo Router), Supabase
(Auth, Postgres with row-level security, private Storage, pg_cron, Edge
Functions) and PayMongo (test mode).

---

## Project layout

| Folder                       | What is in it                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `app/`                       | Expo Router routes. Each file is a one-line re-export.                                        |
| `screens/`                   | The real screen code (`auth`, `vendor`, `organizer`).                                         |
| `components/`, `lib/`        | Shared UI and helpers (Supabase client, storage, theme).                                      |
| `supabase/migrations/`       | Database changes, in order.                                                                   |
| `supabase/functions/`        | Edge Functions: `create-payment`, `paymongo-webhook`, `toggle-recurring`, `payment-redirect`. |
| `supabase/storage-setup.sql` | Private storage buckets and vendor rules. **New projects only.**                              |
| `test-toolkit/`              | Automated checks for the database, payments and app logic. Not part of the app.               |

---

## Run locally

```bash
npm install
copy .env.example .env      # then fill in the two values (Windows cmd)
npx expo start
```

`.env` needs only:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

These come from Supabase: Project settings, API. The anon key is meant to be
public. **Never put a PayMongo key or the Supabase service-role key in `.env`
or in the repository.** `.env` is ignored by git.

---

## Database setup (new Supabase project)

1. In the SQL Editor, run every file in `supabase/migrations/` in name order.
2. Run `supabase/storage-setup.sql` just before
   `20261001000700_storage_organizer_read.sql`. It creates two **private**
   buckets (`business-permits`, `sales-receipts`): images only, 5 MB.
3. In Supabase Auth, keep **Confirm email OFF** (see Known limitations).
4. Enable the `pg_cron` extension. Migration `…000500` schedules four jobs.

Organizer accounts are created by the owner: add the user in Supabase Auth,
then insert a row in `public.profiles` with `role = 'organizer'`, and a row
in `public.venues` for that organizer.

## Edge Functions and secrets

```bash
supabase functions deploy create-payment
supabase functions deploy toggle-recurring
supabase functions deploy payment-redirect
supabase functions deploy paymongo-webhook --no-verify-jwt
supabase secrets set PAYMONGO_SECRET_KEY=...
supabase secrets set PAYMONGO_WEBHOOK_SECRET=...
```

The webhook must be public (no JWT) because PayMongo calls it. It verifies
PayMongo's signature on the raw request body instead.

---

## Deploy

Vendors use the **Android APK**. Organizers use the **website**.

1. `npx eas-cli@latest login`, then `npx eas-cli@latest init`.
2. In expo.dev, add the two `EXPO_PUBLIC_SUPABASE_*` environment variables
   to the project (the cloud build cannot see your local `.env`).
3. Website: `npx expo export --platform web`, then
   `npx eas-cli@latest deploy --prod`.
4. APK: `npx eas-cli@latest build --platform android --profile preview`.

Website and APK must point to the **same** Supabase project.

---

## Security model (short)

- Row-level security is on for every table. Apps cannot write bookings,
  payments, refunds, sales or the audit log directly. They call database
  functions that check who the caller is and the booking status.
- Payment amounts are calculated on the server. The webhook checks the
  PayMongo signature and never charges a booking that is no longer payable.
- Permits and receipts are private. Images open through signed links that
  expire after 10 minutes. Organizers can read only files they need.
- Scheduled jobs (hold expiry, no-show, auto-complete, session close) cannot
  be called from the app.

## Tests

`test-toolkit/README.md` explains the automated checks and which ones you
can run yourself.

---

## Known limitations

- **Vendors must use the Android app.** Paying and the recurring switch call
  Edge Functions that have no CORS headers, so they fail in a web browser.
- **Confirm email must stay OFF.** Signup creates the account first and then
  writes the profile from the app. With email confirmation on, the profile
  would not be created.
- **No password reset yet.**
- **Organizer screens do not refresh on their own.** Reload the page to see
  new data.
- **QR scanning** is implemented and tested on the server, but not tested on a
  physical device.
- **Refunds are manual.** The organizer records the payout. No PayMongo refund
  calls are made.
- **No "money taken but booking not payable" queue.** A notification and an
  audit event are created, but there is no screen for it.
- **iOS is not set up** (needs a paid Apple developer account).
- **Free-tier limits:** Supabase pauses idle free projects, and Expo free
  builds are limited and slow.
