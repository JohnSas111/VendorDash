-- ============================================================
-- 20260929000100_lifecycle_foundation.sql
-- Step 1: additive foundation. No existing policy, trigger or
-- function is modified. Safe to run while the current app is live.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Venue timezone (used to decide when a session day "ends")
-- ------------------------------------------------------------
alter table public.venues
  add column if not exists timezone text not null default 'Asia/Manila';

-- ------------------------------------------------------------
-- 2. Booking lifecycle columns
-- ------------------------------------------------------------
alter table public.bookings
  add column if not exists payment_due_at  timestamptz,
  add column if not exists checked_in_at   timestamptz,
  add column if not exists completed_at    timestamptz,
  add column if not exists completed_by    uuid references public.profiles(id),
  add column if not exists completed_early boolean not null default false,
  add column if not exists completion_note text;

-- Backfill: currently-approved bookings already have a payment deadline
-- stored in reservation_expires_at.
update public.bookings
   set payment_due_at = reservation_expires_at
 where status = 'approved'
   and payment_due_at is null;

-- ------------------------------------------------------------
-- 3. Allow the two new statuses
-- ------------------------------------------------------------
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status = any (array[
    'pending','approved','rejected','paid','cancelled',
    'checked_in','expired','completed','no_show'
  ]));

-- ------------------------------------------------------------
-- 4. Data-integrity constraints
-- ------------------------------------------------------------
alter table public.bookings
  add constraint bookings_completion_consistency
  check (
    (status <> 'completed' or completed_at is not null)
    and (not completed_early or completion_note is not null)
  );

-- NOT VALID: enforced for new/updated rows, but existing rows are not
-- re-checked, so legacy data cannot make this migration fail.
-- After cleaning any legacy rows, you may run:
--   alter table public.bookings validate constraint bookings_attending_days_not_empty;
alter table public.bookings
  add constraint bookings_attending_days_not_empty
  check (cardinality(attending_days) > 0) not valid;

alter table public.sales_submissions
  add constraint sales_amount_sane
  check (gross_sales_cents >= 0 and gross_sales_cents <= 100000000) not valid;

alter table public.sales_submissions
  add constraint sales_items_sane
  check (items_sold_count is null or items_sold_count >= 0) not valid;

-- ------------------------------------------------------------
-- 5. Append-only audit log
-- ------------------------------------------------------------
create table if not exists public.booking_events (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete restrict,
  session_id  uuid references public.market_sessions(id),
  actor_id    uuid references public.profiles(id),          -- NULL = system
  actor_role  text not null check (actor_role in ('vendor','organizer','system')),
  action      text not null,
  from_status text,
  to_status   text,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_booking_events_booking
  on public.booking_events (booking_id, created_at);
create index if not exists idx_booking_events_session
  on public.booking_events (session_id);

alter table public.booking_events enable row level security;

-- Default privileges in this project grant ALL to anon/authenticated,
-- so revoke explicitly. Rows are written ONLY by SECURITY DEFINER
-- functions added in later migrations.
revoke all on public.booking_events from anon, authenticated;
grant select on public.booking_events to authenticated;
grant all on public.booking_events to service_role;

create policy "vendors view events of their bookings"
on public.booking_events for select to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = booking_events.booking_id
      and b.vendor_id = (select auth.uid())
  )
);

create policy "organizers view events for their venue"
on public.booking_events for select to authenticated
using (
  exists (
    select 1
    from public.bookings b
    join public.stalls  s on s.id = b.stall_id
    join public.venues  v on v.id = s.venue_id
    where b.id = booking_events.booking_id
      and v.organizer_id = (select auth.uid())
  )
);

-- Belt and braces: even a buggy privileged function cannot rewrite history.
create or replace function public.prevent_booking_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'booking_events is append-only';
end;
$$;

create trigger booking_events_immutable
before update or delete on public.booking_events
for each row execute function public.prevent_booking_event_change();

-- ------------------------------------------------------------
-- 6. When does this booking's LAST attending day end?
--    = last attending date + session end_time, in the venue timezone.
--    Returns NULL if attending_days is empty or the booking is unknown.
-- ------------------------------------------------------------
create or replace function public.booking_end_at(p_booking_id uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (
    (case
       when 'sunday'   = any (b.attending_days) then s.sunday_date
       when 'saturday' = any (b.attending_days) then s.saturday_date
       when 'friday'   = any (b.attending_days) then s.friday_date
     end + s.end_time)
    at time zone v.timezone
  )
  from public.bookings b
  join public.market_sessions s on s.id = b.session_id
  join public.venues v          on v.id = s.venue_id
  where b.id = p_booking_id;
$$;

revoke all on function public.booking_end_at(uuid) from public, anon, authenticated;
grant execute on function public.booking_end_at(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 7. Indexes for growth
-- ------------------------------------------------------------
create index if not exists idx_bookings_stall
  on public.bookings (stall_id);
create index if not exists idx_bookings_session_status
  on public.bookings (session_id, status);
create index if not exists idx_notifications_recipient_created
  on public.notifications (recipient_id, created_at desc);

commit;

-- ============================================================
-- ROLLBACK (run manually only if you need to undo this step):
--
-- begin;
--   drop function if exists public.booking_end_at(uuid);
--   drop table if exists public.booking_events;
--   drop function if exists public.prevent_booking_event_change();
--   alter table public.sales_submissions drop constraint if exists sales_items_sane;
--   alter table public.sales_submissions drop constraint if exists sales_amount_sane;
--   alter table public.bookings drop constraint if exists bookings_attending_days_not_empty;
--   alter table public.bookings drop constraint if exists bookings_completion_consistency;
--   -- Only safe if no row uses the new statuses yet:
--   alter table public.bookings drop constraint if exists bookings_status_check;
--   alter table public.bookings add constraint bookings_status_check check (status = any (array[
--     'pending','approved','rejected','paid','cancelled','checked_in','expired']));
--   alter table public.bookings
--     drop column if exists completion_note, drop column if exists completed_early,
--     drop column if exists completed_by,   drop column if exists completed_at,
--     drop column if exists checked_in_at,  drop column if exists payment_due_at;
--   alter table public.venues drop column if exists timezone;
--   drop index if exists idx_bookings_stall, idx_bookings_session_status,
--                        idx_notifications_recipient_created;
-- commit;
-- ============================================================
