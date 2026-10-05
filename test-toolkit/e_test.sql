-- Batch E tests: storage rules for permits and receipts. Needs storage_stub.sql + migrations 20261001000700 and ...800. Rolls back.
\set ON_ERROR_STOP off
set client_min_messages = notice;
begin;

create or replace function pg_temp.ck(p_id text, p_name text, p_ok boolean, p_info text default '') returns void language plpgsql as $$
begin raise notice '% | % %', case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end, p_id||' '||p_name, case when coalesce(p_ok,false) then '' else ' [ '||p_info||' ]' end; end $$;

-- run SQL as a role/user and return the first column as text ('ERR ...' on error)
create or replace function pg_temp.as_(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_sub is null then '{"role":"anon"}' else json_build_object('sub',p_sub,'role',p_role)::text end, true);
  execute 'set local role '||p_role;
  begin execute p_sql into r; exception when others then r := 'ERR '||sqlstate||' '||left(sqlerrm,70); end;
  reset role; perform set_config('request.jwt.claims','{}',true);
  return r;
end $$;

create or replace function pg_temp.u(n int) returns uuid language sql as $$ select ('a0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create or replace function pg_temp.b(n int) returns uuid language sql as $$ select ('e0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;

-- ===== seed: O1 (u900) owns venue A, O2 (u901) owns venue B. Vendors u1..u5.
insert into auth.users(id,email) select pg_temp.u(n),'u'||n||'@x' from generate_series(1,6) n;
insert into auth.users(id,email) values (pg_temp.u(900),'o1@x'),(pg_temp.u(901),'o2@x');
insert into public.profiles(id,role,full_name) select pg_temp.u(n),'vendor','Vendor '||n from generate_series(1,6) n;
-- verification state: u1,u2,u3,u4 VERIFIED; u5,u6 NOT verified
insert into public.vendor_details(id,business_name,category,description,is_verified) values
 (pg_temp.u(1),'Biz 1','Food','d',true),(pg_temp.u(2),'Biz 2','Food','d',true),(pg_temp.u(3),'Biz 3','Food','d',true),
 (pg_temp.u(4),'Biz 4','Food','d',true),(pg_temp.u(5),'Biz 5','Food','d',false),(pg_temp.u(6),'Biz 6','Food','d',false);
insert into public.profiles(id,role,full_name) values (pg_temp.u(900),'organizer','Org 1'),(pg_temp.u(901),'organizer','Org 2');
insert into public.venues(id,organizer_id,name,address,timezone) values
 ('b0000000-0000-0000-0000-00000000000a',pg_temp.u(900),'Venue A','x','Asia/Manila'),
 ('b0000000-0000-0000-0000-00000000000b',pg_temp.u(901),'Venue B','y','Asia/Manila');
insert into public.stalls(id,venue_id,stall_number,price_per_day_cents) values
 ('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a','A1',10000),
 ('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000a','A2',10000),
 ('c0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-00000000000a','A3',10000),
 ('c0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-00000000000a','A4',10000),
 ('c0000000-0000-0000-0000-000000000011','b0000000-0000-0000-0000-00000000000b','B1',10000);
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time) values
 ('d0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',current_date+14,current_date+15,current_date+16,'open','00:00','23:59'),
 ('d0000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b',current_date+14,current_date+15,current_date+16,'open','00:00','23:59');
-- u1: active booking at A | u2: active booking at B | u3: ONLY a cancelled booking at A (verified) | u4: none (verified) | u5: rejected booking at A (unverified) | u6: no booking, unverified
insert into public.bookings(id,vendor_id,stall_id,session_id,attending_days,status,completed_at) values
 (pg_temp.b(1),pg_temp.u(1),'c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000a','{friday}','completed',now()),
 (pg_temp.b(2),pg_temp.u(2),'c0000000-0000-0000-0000-000000000011','d0000000-0000-0000-0000-00000000000b','{friday}','completed',now()),
 (pg_temp.b(3),pg_temp.u(3),'c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-00000000000a','{friday}','cancelled',null),
 (pg_temp.b(5),pg_temp.u(5),'c0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-00000000000a','{friday}','rejected',null);
-- files
insert into storage.objects(bucket_id,name,owner) values
 ('business-permits', pg_temp.u(1)||'/permit.jpg', pg_temp.u(1)),
 ('business-permits', pg_temp.u(2)||'/permit.jpg', pg_temp.u(2)),
 ('business-permits', pg_temp.u(3)||'/permit.jpg', pg_temp.u(3)),
 ('business-permits', pg_temp.u(4)||'/permit.jpg', pg_temp.u(4)),
 ('business-permits', pg_temp.u(5)||'/permit.jpg', pg_temp.u(5)),
 ('business-permits', pg_temp.u(6)||'/permit.jpg', pg_temp.u(6)),
 ('sales-receipts',   pg_temp.b(1)||'/receipt-1.jpg', pg_temp.u(1)),
 ('sales-receipts',   pg_temp.b(2)||'/receipt-1.jpg', pg_temp.u(2));

create or replace function pg_temp.seen(p_sub uuid, p_role text, p_bucket text, p_path text) returns text language sql as $$
  select pg_temp.as_(p_sub, p_role, format('select count(*) from storage.objects where bucket_id=%L and name=%L', p_bucket, p_path)) $$;

\echo
\echo ===== ORGANIZER CAN READ (what they should see) =====
select pg_temp.ck('P01','O1 reads permit of V1 (active booking at venue A)', pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(1)||'/permit.jpg')='1');
select pg_temp.ck('P02','O1 reads receipt of a booking at venue A',          pg_temp.seen(pg_temp.u(900),'authenticated','sales-receipts',pg_temp.b(1)||'/receipt-1.jpg')='1');
select pg_temp.ck('P03','O2 reads permit of V2 (booking at venue B)',        pg_temp.seen(pg_temp.u(901),'authenticated','business-permits',pg_temp.u(2)||'/permit.jpg')='1');
select pg_temp.ck('P04','O2 reads receipt of a booking at venue B',          pg_temp.seen(pg_temp.u(901),'authenticated','sales-receipts',pg_temp.b(2)||'/receipt-1.jpg')='1');
select pg_temp.ck('P05','O1 reads permit of V5 (REJECTED booking still counts)', pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(5)||'/permit.jpg')='1');

\echo
\echo ===== VENDOR KEEPS WHAT THEY HAD =====
select pg_temp.ck('P06','V1 reads own permit',   pg_temp.seen(pg_temp.u(1),'authenticated','business-permits',pg_temp.u(1)||'/permit.jpg')='1');
select pg_temp.ck('P07','V1 reads own receipt',  pg_temp.seen(pg_temp.u(1),'authenticated','sales-receipts',pg_temp.b(1)||'/receipt-1.jpg')='1');
select pg_temp.ck('P08','V1 uploads own permit file',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$insert into storage.objects(bucket_id,name,owner) values ('business-permits',%L,%L) returning 'ok'$q$, pg_temp.u(1)||'/permit2.jpg', pg_temp.u(1))) = 'ok');
select pg_temp.ck('P09','V1 uploads own receipt (own booking)',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$insert into storage.objects(bucket_id,name,owner) values ('sales-receipts',%L,%L) returning 'ok'$q$, pg_temp.b(1)||'/receipt-2.jpg', pg_temp.u(1))) = 'ok');

\echo
\echo ===== NEGATIVE: organizer must NOT see these =====
select pg_temp.ck('N01','O1 cannot read permit of V2 (vendor of ANOTHER organizer)',   pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(2)||'/permit.jpg')='0');
select pg_temp.ck('N02','O1 cannot read receipt at venue B',                            pg_temp.seen(pg_temp.u(900),'authenticated','sales-receipts',pg_temp.b(2)||'/receipt-1.jpg')='0');
select pg_temp.ck('N03','O2 cannot read permit of V1',                                  pg_temp.seen(pg_temp.u(901),'authenticated','business-permits',pg_temp.u(1)||'/permit.jpg')='0');
select pg_temp.ck('N04','O2 cannot read receipt at venue A',                            pg_temp.seen(pg_temp.u(901),'authenticated','sales-receipts',pg_temp.b(1)||'/receipt-1.jpg')='0');
select pg_temp.ck('N05','O1 cannot read permit of V3 (VERIFIED, ONLY a cancelled booking)',       pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(3)||'/permit.jpg')='0');
select pg_temp.ck('N06','O1 cannot read permit of V4 (VERIFIED, no booking at all)',              pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(4)||'/permit.jpg')='0');
select pg_temp.ck('N07','O1 cannot read a permit through the RECEIPTS bucket rule',     pg_temp.seen(pg_temp.u(900),'authenticated','sales-receipts',pg_temp.u(1)||'/permit.jpg')='0');
select pg_temp.ck('N08','O1 cannot read a receipt through the PERMITS bucket rule',     pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.b(1)||'/receipt-1.jpg')='0');

\echo
\echo ===== NEGATIVE: vendors, anon =====
select pg_temp.ck('N09','V1 cannot read V2 permit',                 pg_temp.seen(pg_temp.u(1),'authenticated','business-permits',pg_temp.u(2)||'/permit.jpg')='0');
select pg_temp.ck('N10','V1 cannot read V2 receipt',                pg_temp.seen(pg_temp.u(1),'authenticated','sales-receipts',pg_temp.b(2)||'/receipt-1.jpg')='0');
select pg_temp.ck('N11','V4 (no bookings) cannot read V1 permit',   pg_temp.seen(pg_temp.u(4),'authenticated','business-permits',pg_temp.u(1)||'/permit.jpg')='0');
select pg_temp.ck('N12','anon cannot read any permit',              coalesce(pg_temp.seen(null,'anon','business-permits',pg_temp.u(1)||'/permit.jpg'),'x') in ('0') or pg_temp.seen(null,'anon','business-permits',pg_temp.u(1)||'/permit.jpg') like 'ERR%');
select pg_temp.ck('N13','anon cannot read any receipt',             pg_temp.seen(null,'anon','sales-receipts',pg_temp.b(1)||'/receipt-1.jpg') in ('0') or pg_temp.seen(null,'anon','sales-receipts',pg_temp.b(1)||'/receipt-1.jpg') like 'ERR%');
select pg_temp.ck('N14','V1 cannot upload into V2 folder (permits)',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$insert into storage.objects(bucket_id,name,owner) values ('business-permits',%L,%L) returning 'ok'$q$, pg_temp.u(2)||'/evil.jpg', pg_temp.u(1))) like 'ERR%');
select pg_temp.ck('N15','V1 cannot upload a receipt for V2''s booking',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$insert into storage.objects(bucket_id,name,owner) values ('sales-receipts',%L,%L) returning 'ok'$q$, pg_temp.b(2)||'/evil.jpg', pg_temp.u(1))) like 'ERR%');

\echo
\echo ===== NEGATIVE: nobody can change or delete (organizer read is READ-ONLY) =====
select pg_temp.ck('N16','organizer cannot upload into a vendor permit folder',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$insert into storage.objects(bucket_id,name,owner) values ('business-permits',%L,%L) returning 'ok'$q$, pg_temp.u(1)||'/fake.jpg', pg_temp.u(900))) like 'ERR%');
select pg_temp.ck('N17','organizer cannot upload a receipt for a booking at their venue',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$insert into storage.objects(bucket_id,name,owner) values ('sales-receipts',%L,%L) returning 'ok'$q$, pg_temp.b(1)||'/fake.jpg', pg_temp.u(900))) like 'ERR%');
select pg_temp.ck('N18','organizer cannot delete a permit (0 rows)',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$with d as (delete from storage.objects where name=%L returning 1) select count(*) from d$q$, pg_temp.u(1)||'/permit.jpg'))='0');
select pg_temp.ck('N19','organizer cannot delete a receipt (0 rows)',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$with d as (delete from storage.objects where name=%L returning 1) select count(*) from d$q$, pg_temp.b(1)||'/receipt-1.jpg'))='0');
select pg_temp.ck('N20','organizer cannot rename/overwrite a permit (0 rows)',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$with d as (update storage.objects set name=name||'x' where name=%L returning 1) select count(*) from d$q$, pg_temp.u(1)||'/permit.jpg'))='0');
select pg_temp.ck('N21','vendor cannot delete own receipt (kept as submitted)',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$with d as (delete from storage.objects where name=%L returning 1) select count(*) from d$q$, pg_temp.b(1)||'/receipt-1.jpg'))='0');
select pg_temp.ck('N22','vendor cannot change own receipt (0 rows)',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$with d as (update storage.objects set name=name||'x' where name=%L returning 1) select count(*) from d$q$, pg_temp.b(1)||'/receipt-1.jpg'))='0');
select pg_temp.ck('N23','vendor cannot delete own permit (0 rows)',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$with d as (delete from storage.objects where name=%L returning 1) select count(*) from d$q$, pg_temp.u(1)||'/permit.jpg'))='0');
select pg_temp.ck('N24','after all attempts the 8 original files still exist',
  (select count(*) from storage.objects where name not like '%2.jpg')=8);

\echo
\echo ===== UNVERIFIED VENDORS: an organizer must be able to verify them (migration 800) =====
select pg_temp.ck('U01','O1 reads permit of V6 (unverified, NO booking anywhere)', pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(6)||'/permit.jpg')='1');
select pg_temp.ck('U02','O2 (another organizer) also reads it: verifying vendors is every organizer''s job', pg_temp.seen(pg_temp.u(901),'authenticated','business-permits',pg_temp.u(6)||'/permit.jpg')='1');
select pg_temp.ck('U03','V1 (a VENDOR) cannot read V6''s permit', pg_temp.seen(pg_temp.u(1),'authenticated','business-permits',pg_temp.u(6)||'/permit.jpg')='0');
select pg_temp.ck('U04','V4 (a verified vendor) cannot read V6''s permit', pg_temp.seen(pg_temp.u(4),'authenticated','business-permits',pg_temp.u(6)||'/permit.jpg')='0');
select pg_temp.ck('U05','V5 (another unverified vendor) cannot read V6''s permit', pg_temp.seen(pg_temp.u(5),'authenticated','business-permits',pg_temp.u(6)||'/permit.jpg')='0');
select pg_temp.ck('U06','anon cannot read V6''s permit', pg_temp.seen(null,'anon','business-permits',pg_temp.u(6)||'/permit.jpg') in ('0') or pg_temp.seen(null,'anon','business-permits',pg_temp.u(6)||'/permit.jpg') like 'ERR%');
select pg_temp.ck('U07','organizer cannot upload into V6''s permit folder',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$insert into storage.objects(bucket_id,name,owner) values ('business-permits',%L,%L) returning 'ok'$q$, pg_temp.u(6)||'/fake.jpg', pg_temp.u(900))) like 'ERR%');
select pg_temp.ck('U08','organizer cannot delete or rename V6''s permit (0 rows)',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$with d as (update storage.objects set name=name||'x' where name=%L returning 1) select count(*) from d$q$, pg_temp.u(6)||'/permit.jpg'))='0');
select pg_temp.ck('U09','unverified permit is NOT readable through the RECEIPTS bucket rule', pg_temp.seen(pg_temp.u(900),'authenticated','sales-receipts',pg_temp.u(6)||'/permit.jpg')='0');
select pg_temp.ck('U10','helper: organizer -> true for unverified V6',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$select public._org_can_read_permit(%L)::text$q$, pg_temp.u(6)::text))='true');
select pg_temp.ck('U11','helper: a vendor asking about V6 gets false (the organizer check)',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$select public._org_can_read_permit(%L)::text$q$, pg_temp.u(6)::text))='false');
-- U12 needs a NULL flag, which the app can never produce, so set it with the guard trigger bypassed (test setup only)
set local session_replication_role = replica;
update public.vendor_details set is_verified=null where id=pg_temp.u(4);
reset session_replication_role;
select pg_temp.ck('U12','a vendor with NO verification flag (null) counts as unverified for organizers', pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(4)||'/permit.jpg')='1');
set local session_replication_role = replica;
update public.vendor_details set is_verified=true where id=pg_temp.u(4);
reset session_replication_role;
-- U13..U15 use the REAL function the app calls (verify_vendor), as the organizer
select pg_temp.as_(pg_temp.u(900),'authenticated',format($q$select public.verify_vendor(%L, true)::text$q$, pg_temp.u(6)::text));
select pg_temp.ck('U13','once the organizer VERIFIES V6 (no booking), organizers can no longer open the permit', pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(6)||'/permit.jpg')='0');
select pg_temp.ck('U14','a verified vendor WITH a booking at the venue is still readable (rule b)', pg_temp.seen(pg_temp.u(900),'authenticated','business-permits',pg_temp.u(1)||'/permit.jpg')='1');
select pg_temp.as_(pg_temp.u(900),'authenticated',format($q$select public.verify_vendor(%L, false)::text$q$, pg_temp.u(6)::text));
select pg_temp.ck('U15','un-verifying V6 makes the permit readable again (re-check), also for the other organizer', pg_temp.seen(pg_temp.u(901),'authenticated','business-permits',pg_temp.u(6)||'/permit.jpg')='1');
select pg_temp.ck('U16','a VENDOR cannot verify anyone (so cannot hide/expose permits)',
  pg_temp.as_(pg_temp.u(1),'authenticated',format($q$select public.verify_vendor(%L, true)::text$q$, pg_temp.u(6)::text)) like 'ERR%');

\echo
\echo ===== HELPER FUNCTIONS: closed to anon =====
select pg_temp.ck('H01','anon cannot call _org_can_read_permit',  pg_temp.as_(null,'anon',format($q$select public._org_can_read_permit(%L)::text$q$, pg_temp.u(1)::text)) like 'ERR 42501%');
select pg_temp.ck('H02','anon cannot call _org_can_read_receipt', pg_temp.as_(null,'anon',format($q$select public._org_can_read_receipt(%L)::text$q$, pg_temp.b(1)::text)) like 'ERR 42501%');
select pg_temp.ck('H03','a vendor asking the helper about another vendor gets false',
  pg_temp.as_(pg_temp.u(4),'authenticated',format($q$select public._org_can_read_permit(%L)::text$q$, pg_temp.u(1)::text))='false');
select pg_temp.ck('H04','the right organizer gets true; the other organizer false',
  pg_temp.as_(pg_temp.u(900),'authenticated',format($q$select public._org_can_read_permit(%L)::text$q$, pg_temp.u(1)::text))='true'
  and pg_temp.as_(pg_temp.u(901),'authenticated',format($q$select public._org_can_read_permit(%L)::text$q$, pg_temp.u(1)::text))='false');
select pg_temp.ck('H05','junk folder names do not crash the helper',
  pg_temp.as_(pg_temp.u(900),'authenticated',$q$select public._org_can_read_receipt('not-a-uuid; drop table x')::text$q$)='false');

\echo
\echo ===== BUCKET SETTINGS =====
select pg_temp.ck('B01','both buckets private', (select count(*) from storage.buckets where id in ('business-permits','sales-receipts') and public=false)=2);
select pg_temp.ck('B02','both buckets limited to 5 MB', (select count(*) from storage.buckets where id in ('business-permits','sales-receipts') and file_size_limit=5242880)=2);
select pg_temp.ck('B03','only image types allowed (no pdf/html/svg)',
  (select count(*) from storage.buckets where id in ('business-permits','sales-receipts')
     and allowed_mime_types @> array['image/jpeg','image/png','image/webp']
     and not (allowed_mime_types && array['application/pdf','text/html','image/svg+xml']))=2);
rollback;