-- Vendors can READ the receipt files inside their own bookings' folders.
--
-- Why: the sales-receipts bucket only had an INSERT rule. Uploading a file
-- also needs to read the new row back, and the app can only show a receipt
-- (via a signed link) if the vendor is allowed to read it.
--
-- Scope: only bucket sales-receipts, only a folder named after a booking
-- that belongs to the signed-in vendor. Other vendors' files stay hidden.
-- (Organizers cannot read receipts yet; that is added with the organizer
-- screens.)
--
-- Run ONLY if diagnostic Test B failed (plain insert OK, insert ... returning
-- failed).

begin;

drop policy if exists "vendors read receipts for their own bookings"
  on storage.objects;

create policy "vendors read receipts for their own bookings"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'sales-receipts'
    and exists (
      select 1
        from public.bookings b
       where b.id::text = (storage.foldername(name))[1]
         and b.vendor_id = auth.uid()
    )
  );

commit;

-- ============================================================
-- ROLLBACK (manual, only if needed):
-- drop policy if exists "vendors read receipts for their own bookings"
--   on storage.objects;
-- ============================================================

-- ------------------------------------------------------------
-- VERIFY (run each as its own block after applying)
--
-- 1) Fisheatery CAN read their own folder's files (count may be 0 if no
--    file exists yet, but it must not error):
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', json_build_object('sub','c559163b-19b5-4763-ad6f-ac3a8f9ae0bc','role','authenticated')::text, true);
-- select count(*) from storage.objects
--  where bucket_id = 'sales-receipts'
--    and name like '24dd8c9f-4b1f-44e3-b49b-eebcf23fe4cf/%';
-- rollback;
--
-- 2) NEGATIVE: Seafoods must see 0 of Fisheatery's files:
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', json_build_object('sub','7dd962fe-82e7-43c7-a151-dc20197047a5','role','authenticated')::text, true);
-- select count(*) from storage.objects
--  where bucket_id = 'sales-receipts'
--    and name like '24dd8c9f-4b1f-44e3-b49b-eebcf23fe4cf/%';
-- rollback;
-- Expected: 0
-- ------------------------------------------------------------
