-- Scratch stand-in for Supabase Storage + the 5 storage policies that were LIVE before Batch E.
-- Apply AFTER the schema export and BEFORE migration 20261001000700 (rebuild.sh MIGRATIONS list).
create schema if not exists storage;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now());
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts,1)-1]; end $$;
insert into storage.buckets(id,name,public) values ('business-permits','business-permits',false),('sales-receipts','sales-receipts',false);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

create policy "vendors read receipts for their own bookings" on storage.objects for select
  using (bucket_id = 'sales-receipts' and exists (select 1 from public.bookings b where b.id::text = (storage.foldername(objects.name))[1] and b.vendor_id = auth.uid()));
create policy "vendors update their own business permit" on storage.objects for update
  using (bucket_id = 'business-permits' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'business-permits' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vendors upload receipts for their own bookings" on storage.objects for insert
  with check (bucket_id = 'sales-receipts' and exists (select 1 from public.bookings where bookings.id::text = (storage.foldername(objects.name))[1] and bookings.vendor_id = auth.uid()));
create policy "vendors upload their own business permit" on storage.objects for insert
  with check (bucket_id = 'business-permits' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vendors view their own business permit" on storage.objects for select
  using (bucket_id = 'business-permits' and (storage.foldername(name))[1] = auth.uid()::text);
