# VendorDash test toolkit

**What this is:** a set of automated checks that *the assistant* runs on a throw-away copy of your database (and on the app code) after every change, to prove that security rules, payments and screens still behave. About **370 checks** in total. **It is not part of the app. Supabase never uses it and the app never imports it.** Deleting this folder would not change anything that is running; you would only lose the safety net for future changes. Keep it, and upload it with the project when you start a new conversation.

## Which files can YOU run yourself?

| File | Run it yourself? | Where |
|---|---|---|
| `d2_live_demo.sql` | **Yes** | Supabase SQL Editor. It makes fake data, shows PASS/FAIL, then undoes everything (the "error" at the end is on purpose). |
| `ux_unit_test.js`, `floor_panel_test.js`, `scan_feedback_test.js`, `edge_harness.js` | **Yes** (optional) | Your laptop, in `cmd`, from the project folder: `set "PROJECT_ROOT=C:\Users\claire kettles\VendorDash"` then `node test-toolkit\floor_panel_test.js` |
| **Every other `.sql` file** (`payments_test`, `lockdown_test`, `d2_test`, `d2b_test`, `e_test`, `floor_panel_rls_test`, `storage_stub`, `stubs`) | **NO** | They use `psql`-only commands such as `\set` and create fake users. In the Supabase SQL Editor they fail with `42601 syntax error at or near "off"`. They are made for the assistant's own throw-away Postgres. |
| `rebuild.sh`, `start_postgres.sh` | **NO** | The assistant's sandbox only. |

**Do not be alarmed by `edge_harness.js` output.** It prints many error-looking lines on purpose (it simulates attacks, for example a log line containing `SECRET INTERNAL` or `sk_test_LEAK` to prove those never reach the app). Only the **last line** matters: `42/42 passed`.

**Where to keep this folder:** in your project root as `test-toolkit` (next to `app`, `screens`, `lib`). It does not affect the app, Metro or VS Code, and it travels with your project ZIP.

---

Full list of files (what each one is):

| File | What it is |
|---|---|
| `start_postgres.sh` | Installs and starts a scratch Postgres 16 on port 54329 (root + apt needed; safe to re-run; clears stale lock files). |
| `stubs.sql` | Minimal stand-ins for Supabase's `anon` / `authenticated` / `service_role` roles, `auth.users` and `auth.uid()`. |
| `rebuild.sh` | Drops and rebuilds the scratch database from your schema export (`SCHEMA=...`), then applies any migrations listed in `MIGRATIONS="..."` that are NOT yet inside the export. |
| `payments_test.sql` | 53 checks of the payment functions (quote, register, precheck, apply): replay, late failure, cancelled booking, forged source, wrong amount, who may call. Rolls back. |
| `lockdown_test.sql` | 67 checks: 10 "must be blocked" security checks that FAIL before migration 400 (the known holes) and PASS after; every legitimate app write; the full booking -> payment -> check-in -> complete -> sales chain through the real functions as app roles. Rolls back. |
| `d2_test.sql` | 74 checks of the scheduled jobs (run after migration 500): nobody from the app can run them; expiry, no-show, auto-complete, session close; idempotent; untouched bookings stay untouched. Rolls back. |
| `d2b_test.sql` | 6 checks (run after migration 600): the old sweeper is closed to anon/vendor/organizer, still open to service_role. Rolls back. |
| `storage_stub.sql` | Scratch stand-in for Supabase Storage plus the 5 storage rules that were live before Batch E. Pass it in `MIGRATIONS` BEFORE migration 700. |
| `e_test.sql` | 41 checks of the permit/receipt storage rules (run after migration 700): organizer sees only their own venues' files, cancelled/no-booking/other-organizer/vendor/anon see nothing, nobody can write or delete, helpers closed to anon, buckets private + images + 5 MB. Rolls back. |
| `ux_unit_test.js` | 23 checks of the UX helpers (business-name fallback, scroll-cue edges, container-style split). Needs `PROJECT_ROOT` like `edge_harness.js`. |
| `floor_panel_test.js` | 33 checks of the organizer Floor Map details panel logic (overview counts and money, every stall state, buttons, edge cases). Needs `PROJECT_ROOT`. |
| `floor_panel_rls_test.sql` | 11 checks of the data the Floor Map panel reads: the venue's organizer sees everything it needs; another organizer, other vendors and logged-out users see nothing. Run on the plain schema export (no migrations needed). Rolls back. |
| `scan_feedback_test.js` | 17 checks of the QR check-in result messages (green only for a real check-in, every error names the vendor, days in week order). Needs `PROJECT_ROOT`. |
| `edge_harness.js` | 42 checks of `paymongo-webhook` and `create-payment` using the real TypeScript with mocked Supabase/PayMongo and genuinely signed/forged requests. Needs `PROJECT_ROOT` (unzipped project with `node_modules`). |

## Usage
```bash
bash start_postgres.sh
# A fresh schema export already contains migrations 200-400, so no MIGRATIONS needed:
SCHEMA=/path/vendordash_schema_new.sql bash rebuild.sh
su postgres -c "psql -h /tmp -p 54329 -U postgres -d vd -f payments_test.sql"   # expect PASS=53 FAIL=0
su postgres -c "psql -h /tmp -p 54329 -U postgres -d vd -f lockdown_test.sql"   # expect PASS=67 FAIL=0   (after migration 600; F13 now checks the old sweeper is BLOCKED)
PROJECT_ROOT=/path/to/unzipped/project node edge_harness.js                       # expect 42/42 passed
```
Read results with: `... 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //; s/^NOTICE:  //' | grep -E "^(PASS|FAIL)"`.

## Running Batch E checks
```bash
SCHEMA=/path/vendordash_schema_new.sql MIGRATIONS="…500….sql …600….sql /path/storage_stub.sql …700….sql" bash rebuild.sh
su postgres -c "psql -h /tmp -p 54329 -U postgres -d vd -f e_test.sql"   # expect PASS=41 FAIL=0
```
(If the schema export is newer than migration 700, drop 500/600/700 from the list but keep `storage_stub.sql`, which does NOT come from the export and must be followed by migration 700 for the organizer rules.)

## Notes
- A schema export made with Postgres 17 contains `GRANT ... MAINTAIN`, which the scratch Postgres 16 rejects. `rebuild.sh` now removes `MAINTAIN` before loading. Without that fix, every app-role check fails with `permission denied` (the grants are silently missing).
- If the export is OLDER than migrations 200/300/400, pass them: `MIGRATIONS="…200….sql …300….sql …400….sql"`. On that state `lockdown_test.sql` shows exactly 10 FAIL until migration 400 is applied.
- The scratch database has no `pg_cron`, no Storage and no Edge runtime. It tests SQL logic and permissions, not scheduling, storage or real PayMongo.
- Everything under `/tmp` is lost when the conversation ends; keep these files.
- Keep tests honest: a "negative" test must fail with a real permission/RLS message, not an unrelated constraint.
