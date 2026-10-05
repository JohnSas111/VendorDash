-- =====================================================================
-- Batch E fix: an organizer must be able to open the permit of a vendor
-- who still needs verification.
--
-- Before (migration 700): an organizer could open a vendor's permit only if
-- that vendor had a booking (not cancelled) at one of the organizer's venues.
-- That made the Verification screen useless for a brand-new vendor, because
-- verifying happens BEFORE or WITH the first booking.
--
-- Now an organizer can open a permit when EITHER
--   (a) the vendor is NOT yet verified  (verifying vendors is the organizer's job), OR
--   (b) the vendor has a booking (not cancelled) at a venue the organizer owns.
-- The caller must really be an organizer (is_organizer()); a vendor or any
-- other logged-in user still gets nothing. Read-only: no write or delete.
--
-- Only the helper function changes; the storage policy that calls it is
-- untouched, so this is safe to run on top of migration 700.
--
-- ROLLBACK (comment): re-run the function body from migration 700:
--   create or replace function public._org_can_read_permit(p_vendor_folder text)
--   returns boolean language sql stable security definer set search_path = '' as $$
--     select exists (select 1 from public.bookings b
--       join public.stalls s on s.id = b.stall_id
--       join public.venues v on v.id = s.venue_id
--      where b.vendor_id::text = p_vendor_folder
--        and v.organizer_id = auth.uid() and b.status <> 'cancelled');
--   $$;
-- =====================================================================

create or replace function public._org_can_read_permit(p_vendor_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_organizer()
     and (
       -- (a) the vendor still needs verification
       exists (
         select 1
           from public.vendor_details vd
          where vd.id::text = p_vendor_folder
            and coalesce(vd.is_verified, false) = false
       )
       or
       -- (b) the vendor has a booking at one of this organizer's venues
       exists (
         select 1
           from public.bookings b
           join public.stalls  s on s.id = b.stall_id
           join public.venues  v on v.id = s.venue_id
          where b.vendor_id::text = p_vendor_folder
            and v.organizer_id = auth.uid()
            and b.status <> 'cancelled'
       )
     );
$$;

-- Same lock-down as before (create or replace keeps grants, restated for safety).
revoke all on function public._org_can_read_permit(text) from public, anon, service_role;
grant execute on function public._org_can_read_permit(text) to authenticated;
