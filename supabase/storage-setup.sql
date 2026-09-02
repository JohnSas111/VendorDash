-- ========================================
-- STORAGE BUCKETS for business permits and sales receipts
-- Run this in Supabase SQL editor.
-- ========================================

insert into storage.buckets (id, name, public)
values ('business-permits', 'business-permits', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('sales-receipts', 'sales-receipts', true)
on conflict (id) do nothing;

-- Buckets are set to public=true for simplicity — anyone with the exact
-- file URL can view it, but URLs aren't guessable (they include the
-- vendor's user ID or booking ID). This is fine for a first version; if you
-- later want stricter privacy, switch to public=false and use signed URLs
-- instead of getPublicUrl() in lib/upload.ts.

-- ========================================
-- RLS POLICIES for storage.objects
-- ========================================

-- Business permits: anyone can view (needed so the app can display the
-- thumbnail), but only the vendor who owns the folder can upload to it.
create policy "anyone can view business permits"
on storage.objects for select
using (bucket_id = 'business-permits');

create policy "vendors upload their own business permit"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'business-permits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "vendors update their own business permit"
on storage.objects for update to authenticated
using (
  bucket_id = 'business-permits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Sales receipts: same pattern, but folder is keyed by booking_id instead
-- of vendor_id (matches the path used in lib upload calls: {bookingId}/receipt).
create policy "anyone can view sales receipts"
on storage.objects for select
using (bucket_id = 'sales-receipts');

create policy "vendors upload receipts for their own bookings"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sales-receipts'
  and exists (
    select 1 from bookings
    where bookings.id::text = (storage.foldername(name))[1]
    and bookings.vendor_id = auth.uid()
  )
);
