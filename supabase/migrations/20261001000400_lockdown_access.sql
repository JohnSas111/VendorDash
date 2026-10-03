-- Batch D1: ACCESS LOCKDOWN
--
-- Goal: the app can only change protected data through the audited database
-- functions (create_booking, approve_booking, verify_vendor, submit_sales...)
-- or the Edge Functions (service role). A signed-in user can no longer write
-- bookings, payments, sales, refunds, events or other people's profiles
-- directly, even by calling the API by hand.
--
-- What the app STILL writes directly (and keeps working; verified by test):
--   profiles          sign-up insert; update full_name / phone
--   vendor_details    sign-up insert; update category / description / permit
--   venues            update name / address / description
--   market_sessions   insert + update dates / status
--   stalls            insert / update / delete
--   notifications     mark as read
--
-- NOT in this migration (Batch D2): pg_cron jobs. The app still calls
-- expire_stale_bookings itself, so that stays executable for now.
--
-- Fixes: L-012 (profiles / vendor_details readable by everyone),
--        L-027 (vendor could edit organizer_notes / decided_at),
--        the direct-write paths found in testing (vendor insert on
--        sales_submissions, organizer and vendor UPDATE on bookings,
--        vendor-editable verified_by / verified_at, editable notifications).

begin;

-- ------------------------------------------------------------
-- 0) Helper for read rules: "is the caller an organizer?"
--    SECURITY DEFINER so a policy on profiles can ask about profiles
--    without recursing into itself.
-- ------------------------------------------------------------
create or replace function public.is_organizer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles
     where id = (select auth.uid())
       and role = 'organizer'
  );
$$;

revoke all on function public.is_organizer() from public, anon;
grant execute on function public.is_organizer() to authenticated;

-- ------------------------------------------------------------
-- 1) Drop the write policies that let clients change protected state
-- ------------------------------------------------------------
drop policy if exists "vendors create their own bookings"                  on public.bookings;
drop policy if exists "organizer updates bookings for their venue"         on public.bookings;
drop policy if exists "vendors update allowed booking actions"             on public.bookings;
drop policy if exists "vendors insert their own sales submissions"         on public.sales_submissions;
drop policy if exists "organizer updates vendor_details for verification"  on public.vendor_details;

-- ------------------------------------------------------------
-- 2) Reads: only your own profile / details; organizers see vendors
--    (an organizer must see every vendor, including ones who have not
--     booked yet, because that is how vendors get verified).
-- ------------------------------------------------------------
drop policy if exists "profiles viewable by authenticated users"        on public.profiles;
drop policy if exists "vendor details viewable by authenticated users"  on public.vendor_details;
drop policy if exists "users view their own profile"                    on public.profiles;
drop policy if exists "organizers view vendor profiles"                 on public.profiles;
drop policy if exists "vendors view their own details"                  on public.vendor_details;
drop policy if exists "organizers view vendor details"                  on public.vendor_details;

create policy "users view their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "organizers view vendor profiles"
  on public.profiles for select to authenticated
  using (public.is_organizer() and role = 'vendor');

create policy "vendors view their own details"
  on public.vendor_details for select to authenticated
  using (id = (select auth.uid()));

create policy "organizers view vendor details"
  on public.vendor_details for select to authenticated
  using (public.is_organizer());

-- ------------------------------------------------------------
-- 3) Privileges. Start from NOTHING for writes, then give back only
--    what the app needs, column by column. Column rules are what stop a
--    user from touching role, is_verified, verified_by, organizer_id,
--    venue_id, and so on.
--    (SELECT is untouched here except for anon, which needs no table.)
-- ------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

-- profiles
grant insert (id, role, full_name)           on public.profiles       to authenticated;
grant update (full_name, phone)              on public.profiles       to authenticated;
-- vendor_details (is_verified / verified_by / verified_at: verify_vendor only)
grant insert (id, business_name)             on public.vendor_details to authenticated;
grant update (category, description, business_permit_url)
                                             on public.vendor_details to authenticated;
-- venues (organizer_id / timezone cannot be changed by the client)
grant insert                                 on public.venues         to authenticated;
grant update (name, address, description)    on public.venues         to authenticated;
-- market_sessions
grant insert (venue_id, friday_date, saturday_date, sunday_date)
                                             on public.market_sessions to authenticated;
grant update (friday_date, saturday_date, sunday_date, status)
                                             on public.market_sessions to authenticated;
-- stalls (venue_id cannot be moved)
grant insert (venue_id, stall_number, size, price_per_day_cents)
                                             on public.stalls         to authenticated;
grant update (stall_number, size, price_per_day_cents, is_active)
                                             on public.stalls         to authenticated;
grant delete                                 on public.stalls         to authenticated;
-- notifications: the owner may only flip is_read; only the server creates them
grant update (is_read)                       on public.notifications  to authenticated;

-- Tables created from now on start with NO client write access; a new
-- table must be granted deliberately (fail closed).
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;

-- ------------------------------------------------------------
-- 4) Internal helper nobody outside the database needs
-- ------------------------------------------------------------
revoke all on function public.booking_end_at(uuid) from public, anon, authenticated;

commit;

-- ============================================================
-- ROLLBACK (manual, only if needed). Restores the previous rules.
--
-- begin;
--   -- privileges back to the old wide-open state
--   grant all on all tables in schema public to anon, authenticated;
--   alter default privileges for role postgres in schema public
--     grant insert, update, delete, truncate on tables to anon, authenticated;
--   grant execute on function public.booking_end_at(uuid) to authenticated;
--
--   -- reads back to "everyone"
--   drop policy if exists "users view their own profile"     on public.profiles;
--   drop policy if exists "organizers view vendor profiles"  on public.profiles;
--   drop policy if exists "vendors view their own details"   on public.vendor_details;
--   drop policy if exists "organizers view vendor details"   on public.vendor_details;
--   create policy "profiles viewable by authenticated users" on public.profiles
--     for select to authenticated using (true);
--   create policy "vendor details viewable by authenticated users" on public.vendor_details
--     for select to authenticated using (true);
--
--   -- old write policies
--   create policy "vendors create their own bookings" on public.bookings
--     for insert to authenticated with check ((auth.uid() = vendor_id));
--   create policy "organizer updates bookings for their venue" on public.bookings
--     for update to authenticated using ((exists (select 1 from public.stalls
--       join public.venues on venues.id = stalls.venue_id
--       where stalls.id = bookings.stall_id and venues.organizer_id = auth.uid())));
--   create policy "vendors update allowed booking actions" on public.bookings
--     for update to authenticated
--     using ((auth.uid() = vendor_id) and ((status = any (array['pending','approved'])) or (status = 'paid')))
--     with check ((auth.uid() = vendor_id) and ((status = 'cancelled') or ((status = 'paid') and (refund_requested = true))));
--   create policy "vendors insert their own sales submissions" on public.sales_submissions
--     for insert to authenticated with check ((auth.uid() = vendor_id));
--   create policy "organizer updates vendor_details for verification" on public.vendor_details
--     for update to authenticated using ((exists (select 1 from public.profiles
--       where profiles.id = auth.uid() and profiles.role = 'organizer')));
--
--   drop function if exists public.is_organizer();
-- commit;
-- ============================================================
