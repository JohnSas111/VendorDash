-- ============================================================
-- migration-organizer-web.sql
-- Reconstructed from the VendorDash handoff summary description
-- (the original file wasn't part of this upload) — review before
-- running, especially the vendor_details policy scope.
-- Run in Supabase SQL editor.
-- ============================================================

-- ========================================
-- 1. Refund Requests support
-- Lets a vendor (eventually) flag a paid booking as
-- refund-requested, and the Refund Requests screen query for it.
-- No vendor-facing UI sets this column yet — to test the
-- Refund Requests screen before that UI exists, set it manually:
--   update bookings set refund_requested = true where id = '<booking-id>';
-- ========================================
alter table bookings
  add column if not exists refund_requested boolean not null default false;

create index if not exists idx_bookings_refund_requested
  on bookings(refund_requested) where refund_requested = true;

-- ========================================
-- 2. Vendor Verification support
-- Organizers had ZERO update permission on vendor_details before
-- this — the original schema only lets a vendor update their own
-- row. This policy lets any authenticated organizer flip
-- is_verified on any vendor_details row.
--
-- NOTE: this is intentionally not scoped to "vendors who booked at
-- this organizer's venue" — with a single organizer/venue (per the
-- schema's current design) that distinction doesn't exist yet. If
-- you ever support multiple organizers/venues, tighten this policy
-- to join through bookings -> stalls -> venues like the other
-- organizer policies do.
-- ========================================
create policy "organizer updates vendor_details for verification"
on vendor_details for update to authenticated using (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
      and profiles.role = 'organizer'
  )
);
