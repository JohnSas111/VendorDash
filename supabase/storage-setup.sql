-- ========================================================================
-- STORAGE: private buckets + the vendors' own access rules
--
-- Run this ONCE on a NEW Supabase project (SQL Editor), BEFORE running the
-- migration 20261001000700_storage_organizer_read.sql.
-- Your existing project already has all of this: do not run it there.
--
-- Result:
--   * `business-permits` and `sales-receipts` are PRIVATE, images only, 5 MB.
--   * A vendor can read/upload/replace their OWN permit (folder = their user id)
--     and read/upload receipts for their OWN bookings (folder = booking id).
--   * Nobody can delete files from the app. Anonymous users see nothing.
--   * Organizers get read access through migrations 700 and 800.
--
-- This replaces an older version of this file that created PUBLIC buckets and a
-- "anyone can view" rule. Those rules are removed below if they exist.
-- ========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('business-permits', 'business-permits', false, 5242880,
   array['image/jpeg','image/png','image/webp','image/heic','image/heif']),
  ('sales-receipts',   'sales-receipts',   false, 5242880,
   array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif'];

-- Remove the old public-read rules from the first version of this file.
drop policy if exists "anyone can view business permits" on storage.objects;
drop policy if exists "anyone can view sales receipts"   on storage.objects;

-- Business permits: a vendor's own folder only ("<user id>/permit.<ext>").
drop policy if exists "vendors view their own business permit" on storage.objects;
create policy "vendors view their own business permit"
  on storage.objects for select
  using (bucket_id = 'business-permits'
         and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "vendors upload their own business permit" on storage.objects;
create policy "vendors upload their own business permit"
  on storage.objects for insert
  with check (bucket_id = 'business-permits'
              and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "vendors update their own business permit" on storage.objects;
create policy "vendors update their own business permit"
  on storage.objects for update
  using (bucket_id = 'business-permits'
         and (storage.foldername(name))[1] = (auth.uid())::text)
  with check (bucket_id = 'business-permits'
              and (storage.foldername(name))[1] = (auth.uid())::text);

-- Sales receipts: only for the vendor's own bookings ("<booking id>/receipt-...").
drop policy if exists "vendors read receipts for their own bookings" on storage.objects;
create policy "vendors read receipts for their own bookings"
  on storage.objects for select
  using (bucket_id = 'sales-receipts'
         and exists (select 1 from public.bookings b
                      where b.id::text = (storage.foldername(objects.name))[1]
                        and b.vendor_id = auth.uid()));

drop policy if exists "vendors upload receipts for their own bookings" on storage.objects;
create policy "vendors upload receipts for their own bookings"
  on storage.objects for insert
  with check (bucket_id = 'sales-receipts'
              and exists (select 1 from public.bookings
                           where bookings.id::text = (storage.foldername(objects.name))[1]
                             and bookings.vendor_id = auth.uid()));