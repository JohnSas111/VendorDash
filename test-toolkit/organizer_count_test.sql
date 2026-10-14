-- Organizer sidebar badges: organizer_attention_counts(). Run after migration 20261013000100. Rolls back.
\set ON_ERROR_STOP off
set client_min_messages = notice;
begin;
create or replace function pg_temp.ck(p_id text, p_name text, p_ok boolean, p_info text default '') returns void language plpgsql as $$
begin raise notice '% | % %', case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end, p_id||' '||p_name, case when coalesce(p_ok,false) then '' else ' [ '||p_info||' ]' end; end $$;
create or replace function pg_temp.as_(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_sub is null then '{"role":"anon"}' else json_build_object('sub',p_sub,'role',p_role)::text end, true);
  execute 'set local role '||p_role;
  begin execute p_sql into r; exception when others then r := 'ERR '||sqlstate||' '||left(sqlerrm,80); end;
  reset role; perform set_config('request.jwt.claims','{}',true); return r; end $$;
create or replace function pg_temp.u(n int) returns uuid language sql as $$ select ('a0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create or replace function pg_temp.id(p char, n int) returns uuid language sql as $$ select (p||'0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;

-- users: 1-8 vendors at venue A, 9 vendor at venue B, 900/901 organizers with a venue, 902 organizer WITHOUT a venue
insert into auth.users(id,email) select pg_temp.u(n),'u'||n||'@x' from generate_series(1,10) n;
insert into auth.users(id,email) values (pg_temp.u(900),'o1@x'),(pg_temp.u(901),'o2@x'),(pg_temp.u(902),'o3@x');
insert into public.profiles(id,role,full_name) select pg_temp.u(n),'vendor','Person '||n from generate_series(1,10) n;
insert into public.profiles(id,role,full_name) values (pg_temp.u(900),'organizer','Org 1'),(pg_temp.u(901),'organizer','Org 2'),(pg_temp.u(902),'organizer','Org 3');

-- vendors: exactly 2 are "unverified WITH a permit" (u1, u5)
insert into public.vendor_details(id,business_name,category,description,is_verified,business_permit_url) values
 (pg_temp.u(1),'Biz 1','Food','d',false,'a/permit.jpg'),     -- counts
 (pg_temp.u(2),'Biz 2','Food','d',false,null),               -- no permit
 (pg_temp.u(3),'Biz 3','Food','d',false,'   '),              -- blank permit
 (pg_temp.u(4),'Biz 4','Food','d',true ,'a/permit.jpg'),     -- verified
 (pg_temp.u(5),'Biz 5','Food','d',false,'b/permit.jpg'),     -- counts
 (pg_temp.u(6),'Biz 6','Food','d',true ,'c/permit.jpg'),
 (pg_temp.u(7),'Biz 7','Food','d',true ,'d/permit.jpg'),
 (pg_temp.u(8),'Biz 8','Food','d',true ,'e/permit.jpg'),
 (pg_temp.u(9),'Biz 9','Food','d',true ,'f/permit.jpg'),
 (pg_temp.u(10),'Biz 10','Food','d',true ,'g/permit.jpg');

insert into public.venues(id,organizer_id,name,address,timezone) values
 (pg_temp.id('b',1),pg_temp.u(900),'A','x','Asia/Manila'),
 (pg_temp.id('b',2),pg_temp.u(901),'B','y','Asia/Manila');
insert into public.stalls(id,venue_id,stall_number,price_per_day_cents) select pg_temp.id('c',n),pg_temp.id('b',1),'A'||n,80000 from generate_series(1,8) n;
insert into public.stalls(id,venue_id,stall_number,price_per_day_cents) values (pg_temp.id('c',9),pg_temp.id('b',2),'B1',80000),(pg_temp.id('c',10),pg_temp.id('b',2),'B2',80000);
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time) values
 (pg_temp.id('d',1),pg_temp.id('b',1),current_date+14,current_date+15,current_date+16,'upcoming','17:00','22:00'),
 (pg_temp.id('d',2),pg_temp.id('b',2),current_date+14,current_date+15,current_date+16,'upcoming','17:00','22:00');

-- venue A bookings
--  b1 pending (no expiry)            -> counts
--  b2 pending (hold in the future)   -> counts
--  b3 pending but hold ALREADY ran out -> NOT counted
--  b4 approved                       -> not a booking request
--  b5 paid + refund requested        -> refund counts
--  b6 paid + refund approved         -> refund counts (awaiting payout)
--  b7 paid + refund rejected         -> not counted
--  b8 paid + refund refunded         -> not counted
insert into public.bookings(id,vendor_id,stall_id,session_id,attending_days,status,reservation_expires_at) values
 (pg_temp.id('e',1),pg_temp.u(1),pg_temp.id('c',1),pg_temp.id('d',1),'{friday}','pending',null),
 (pg_temp.id('e',2),pg_temp.u(2),pg_temp.id('c',2),pg_temp.id('d',1),'{friday}','pending',now()+interval '2 days'),
 (pg_temp.id('e',3),pg_temp.u(3),pg_temp.id('c',3),pg_temp.id('d',1),'{friday}','pending',now()-interval '1 hour'),
 (pg_temp.id('e',4),pg_temp.u(4),pg_temp.id('c',4),pg_temp.id('d',1),'{friday}','approved',now()+interval '1 day'),
 (pg_temp.id('e',5),pg_temp.u(5),pg_temp.id('c',5),pg_temp.id('d',1),'{friday}','paid',null),
 (pg_temp.id('e',6),pg_temp.u(6),pg_temp.id('c',6),pg_temp.id('d',1),'{friday}','paid',null),
 (pg_temp.id('e',7),pg_temp.u(7),pg_temp.id('c',7),pg_temp.id('d',1),'{friday}','paid',null),
 (pg_temp.id('e',8),pg_temp.u(8),pg_temp.id('c',8),pg_temp.id('d',1),'{friday}','paid',null);
-- venue B: one pending booking (e9) and one paid booking with a refund request (e10).
-- They must never leak into organizer A's numbers.
insert into public.bookings(id,vendor_id,stall_id,session_id,attending_days,status,reservation_expires_at) values
 (pg_temp.id('e',9),pg_temp.u(9),pg_temp.id('c',9),pg_temp.id('d',2),'{friday}','pending',now()+interval '1 day'),
 (pg_temp.id('e',10),pg_temp.u(10),pg_temp.id('c',10),pg_temp.id('d',2),'{friday}','paid',null);
insert into public.refund_requests(booking_id,vendor_id,status,reason) values
 (pg_temp.id('e',5),pg_temp.u(5),'requested','changed my mind'),
 (pg_temp.id('e',6),pg_temp.u(6),'approved','changed my mind'),
 (pg_temp.id('e',10),pg_temp.u(10),'requested','changed my mind');
insert into public.refund_requests(booking_id,vendor_id,status,reason,decision_comment) values
 (pg_temp.id('e',7),pg_temp.u(7),'rejected','changed my mind','not allowed');
insert into public.refund_requests(booking_id,vendor_id,status,reason,refund_amount_cents,id_verified,refunded_by,refunded_at) values
 (pg_temp.id('e',8),pg_temp.u(8),'refunded','changed my mind',80400,true,pg_temp.u(900),now());

create or replace function pg_temp.counts() returns text language sql as $$
 select 'select pending_bookings||''/''||pending_refunds||''/''||unverified_vendors from public.organizer_attention_counts()' $$;

\echo ===== organizer A (owns venue A) =====
select pg_temp.ck('C01','pending booking requests = 2 (hold already over is not counted)', split_part(pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()),'/',1)='2', pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()));
select pg_temp.ck('C02','refunds needing attention = 2 (requested + awaiting payout; rejected and refunded not counted)', split_part(pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()),'/',2)='2', pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()));
select pg_temp.ck('C03','unverified vendors with a permit = 2 (no permit and blank permit are not counted)', split_part(pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()),'/',3)='2', pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()));
select pg_temp.ck('C04','returns exactly one row', pg_temp.as_(pg_temp.u(900),'authenticated','select count(*) from public.organizer_attention_counts()')='1');

\echo ===== organizer B (other venue): numbers must be B''s own =====
select pg_temp.ck('C05','organizer B sees only own venue: bookings 1, refunds 1', pg_temp.as_(pg_temp.u(901),'authenticated',pg_temp.counts()) like '1/1/%', pg_temp.as_(pg_temp.u(901),'authenticated',pg_temp.counts()));
select pg_temp.ck('C06','organizer with NO venue sees 0 bookings and 0 refunds', pg_temp.as_(pg_temp.u(902),'authenticated',pg_temp.counts()) like '0/0/%', pg_temp.as_(pg_temp.u(902),'authenticated',pg_temp.counts()));
select pg_temp.ck('C07','unverified-vendor number is the same for every organizer (it is not per venue, like the Verification screen)',
  split_part(pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()),'/',3)=split_part(pg_temp.as_(pg_temp.u(901),'authenticated',pg_temp.counts()),'/',3));

\echo ===== counts follow real changes =====
update public.bookings set status='approved' where id=pg_temp.id('e',1);
select pg_temp.ck('C08','approving a request lowers the booking number 2 -> 1', split_part(pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()),'/',1)='1');
update public.refund_requests set status='refunded', refund_amount_cents=80400, id_verified=true, refunded_by=pg_temp.u(900), refunded_at=now() where booking_id=pg_temp.id('e',6);
select pg_temp.ck('C09','recording a payout lowers the refund number 2 -> 1', split_part(pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()),'/',2)='1');
update public.bookings set reservation_expires_at=now()-interval '1 minute' where id=pg_temp.id('e',2);
select pg_temp.ck('C10','a request whose hold just ran out stops counting 1 -> 0', split_part(pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.counts()),'/',1)='0');

\echo ===== NEGATIVE / SECURITY =====
select pg_temp.ck('N01','a vendor is refused (real message about organizer accounts)',
  pg_temp.as_(pg_temp.u(1),'authenticated','select count(*) from public.organizer_attention_counts()') like 'ERR P0001 This action is only available to organizer%', pg_temp.as_(pg_temp.u(1),'authenticated','select count(*) from public.organizer_attention_counts()'));
select pg_temp.ck('N02','a logged-out user (anon) is refused with permission denied',
  pg_temp.as_(null,'anon','select count(*) from public.organizer_attention_counts()') like 'ERR 42501%', pg_temp.as_(null,'anon','select count(*) from public.organizer_attention_counts()'));
select pg_temp.ck('N03','service_role is refused with permission denied',
  pg_temp.as_(pg_temp.u(900),'service_role','select count(*) from public.organizer_attention_counts()') like 'ERR 42501%', pg_temp.as_(pg_temp.u(900),'service_role','select count(*) from public.organizer_attention_counts()'));
select pg_temp.ck('N04','signed in but no/unknown account is refused',
  pg_temp.as_(pg_temp.u(5000),'authenticated','select count(*) from public.organizer_attention_counts()') like 'ERR P0001%', pg_temp.as_(pg_temp.u(5000),'authenticated','select count(*) from public.organizer_attention_counts()'));
select pg_temp.ck('N05','function is SECURITY DEFINER with an empty search_path',
  (select p.prosecdef and p.proconfig[1] = 'search_path=""' from pg_proc p where p.proname='organizer_attention_counts'));
select pg_temp.ck('N06','execute rights: authenticated yes; anon, service_role, public no',
  has_function_privilege('authenticated','public.organizer_attention_counts()','execute')
  and not has_function_privilege('anon','public.organizer_attention_counts()','execute')
  and not has_function_privilege('service_role','public.organizer_attention_counts()','execute')
  and not has_function_privilege('public','public.organizer_attention_counts()','execute'));
select pg_temp.ck('N07','the function is read-only (STABLE) and returns whole numbers only',
  (select p.provolatile='s' from pg_proc p where p.proname='organizer_attention_counts'));
select pg_temp.ck('N08','calling it does not change any data (booking and refund rows unchanged)',
  (select count(*) from public.bookings)=10 and (select count(*) from public.refund_requests)=5);
rollback;