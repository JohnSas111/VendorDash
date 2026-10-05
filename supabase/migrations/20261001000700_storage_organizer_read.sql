-- =====================================================================
-- Batch E (part 1): storage rules for permits and receipts
--
-- 1) An organizer can READ (never write or delete) a vendor's business permit
--    only if that vendor has a booking (any status except cancelled) at a
--    venue the organizer owns.
-- 2) An organizer can READ a sales receipt only for a booking at their venue.
-- 3) Both buckets are forced private and limited to images, 5 MB each.
--
-- Vendors keep exactly what they had: read/upload/update their own permit,
-- read/upload their own receipts. Vendors still cannot update or delete a
-- receipt (the record stays as submitted). Anon gets nothing.
--
-- The rules call two small helper functions so the check does not depend on
-- the caller's own table permissions. Helpers only answer for the logged-in
-- organizer's own venues.
--
-- ROLLBACK (comment):
--   drop policy if exists "organizers read permits of vendors at their venues" on storage.objects;
--   drop policy if exists "organizers read receipts for bookings at their venues" on storage.objects;
--   drop function if exists public._org_can_read_permit(text);
--   drop function if exists public._org_can_read_receipt(text);
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null
--    where id in ('business-permits','sales-receipts');
-- =====================================================================

create or replace function public._org_can_read_permit(p_vendor_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.bookings b
      join public.stalls  s on s.id = b.stall_id
      join public.venues  v on v.id = s.venue_id
     where b.vendor_id::text = p_vendor_folder
       and v.organizer_id = auth.uid()
       and b.status <> 'cancelled'
  );
$$;

create or replace function public._org_can_read_receipt(p_booking_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.bookings b
      join public.stalls  s on s.id = b.stall_id
      join public.venues  v on v.id = s.venue_id
     where b.id::text = p_booking_folder
       and v.organizer_id = auth.uid()
  );
$$;

revoke all on function public._org_can_read_permit(text)  from public, anon, service_role;
revoke all on function public._org_can_read_receipt(text) from public, anon, service_role;
grant execute on function public._org_can_read_permit(text)  to authenticated;
grant execute on function public._org_can_read_receipt(text) to authenticated;

drop policy if exists "organizers read permits of vendors at their venues" on storage.objects;
create policy "organizers read permits of vendors at their venues"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'business-permits'
    and public._org_can_read_permit((storage.foldername(name))[1])
  );

drop policy if exists "organizers read receipts for bookings at their venues" on storage.objects;
create policy "organizers read receipts for bookings at their venues"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sales-receipts'
    and public._org_can_read_receipt((storage.foldername(name))[1])
  );

-- Private buckets, images only, 5 MB max.
update storage.buckets
   set public = false,
       file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id in ('business-permits','sales-receipts');
