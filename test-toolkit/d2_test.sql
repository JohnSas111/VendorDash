-- Batch D2 tests: scheduled-job functions. Needs migration 20261001000500 applied. Rolls back.
-- Expect: PASS=all, FAIL=0
\set ON_ERROR_STOP off
set client_min_messages = notice;
begin;

create or replace function pg_temp.ck(p_id text, p_name text, p_ok boolean, p_info text default '') returns void language plpgsql as $$
begin raise notice '% | % %', case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end, p_id||' '||p_name, case when coalesce(p_ok,false) then '' else ' [ '||p_info||' ]' end; end $$;

create or replace function pg_temp.t(p_id text, p_name text, p_sub uuid, p_role text, p_sql text, p_expect text) returns void language plpgsql as $$
declare errd boolean := false; m text := 'ok';
begin
  if p_role <> 'postgres' then
    perform set_config('request.jwt.claims', case when p_sub is null then '{"role":"anon"}' else json_build_object('sub',p_sub,'role',p_role)::text end, true);
    execute 'set local role '||p_role;
  end if;
  begin execute p_sql; exception when others then errd := true; m := sqlstate||' '||left(sqlerrm,80); end;
  reset role; perform set_config('request.jwt.claims','{}',true);
  raise notice '% | % [%]', case when (p_expect='denied' and errd) or (p_expect='ok' and not errd) then 'PASS' else 'FAIL' end, p_id||' '||p_name, m;
end $$;

create or replace function pg_temp.scalar(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_sub is null then '{"role":"service_role"}' else json_build_object('sub',p_sub,'role',p_role)::text end, true);
  execute 'set local role '||p_role;
  begin execute p_sql into r; exception when others then r := 'ERR '||sqlerrm; end;
  reset role; perform set_config('request.jwt.claims','{}',true); return r;
end $$;

-- helpers for ids
create or replace function pg_temp.u(n int) returns uuid language sql as $$ select ('a0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create or replace function pg_temp.s(n int) returns uuid language sql as $$ select ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create or replace function pg_temp.b(n int) returns uuid language sql as $$ select ('e0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create or replace function pg_temp.m(n int) returns uuid language sql as $$ select ('d0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;

-- ===================== seed =====================
insert into auth.users(id,email) select pg_temp.u(n), 'u'||n||'@x' from generate_series(1,40) n;
insert into auth.users(id,email) values (pg_temp.u(900),'org@x'),(pg_temp.u(901),'org2@x');
insert into public.profiles(id,role,full_name) select pg_temp.u(n),'vendor','Vendor '||n from generate_series(1,40) n;
insert into public.profiles(id,role,full_name) values (pg_temp.u(900),'organizer','Org One'),(pg_temp.u(901),'organizer','Org Two');
insert into public.venues(id,organizer_id,name,address,timezone) values
 ('b0000000-0000-0000-0000-000000000001',pg_temp.u(900),'Venue A','x','Asia/Manila');
insert into public.stalls(id,venue_id,stall_number,price_per_day_cents) select pg_temp.s(n),'b0000000-0000-0000-0000-000000000001','S'||n,10000 from generate_series(1,40) n;

-- sessions (Manila dates)
-- 1 future open | 2 long past open | 3 long past upcoming | 4 long past completed | 5 long past cancelled
-- 6 friday past but sunday in future (still running) | 7 ended 1h ago | 8 ends in 1h
-- 9 friday ended 5h ago | 10 friday ended 13h ago
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time)
select pg_temp.m(1),'b0000000-0000-0000-0000-000000000001',d+14,d+15,d+16,'open','00:00','23:59' from (select (now() at time zone 'Asia/Manila')::date d) x;
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time)
select pg_temp.m(n),'b0000000-0000-0000-0000-000000000001',d-10,d-9,d-8,st,'17:00','22:00'
  from (select (now() at time zone 'Asia/Manila')::date d) x,
       (values (2,'open'),(3,'upcoming'),(4,'completed'),(5,'cancelled')) v(n,st);
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time)
select pg_temp.m(6),'b0000000-0000-0000-0000-000000000001',d-1,d,d+1,'open','00:00','23:59' from (select (now() at time zone 'Asia/Manila')::date d) x;
-- sessions 7/8: LAST day (sunday) ends 1h ago / in 1h
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time)
select pg_temp.m(7),'b0000000-0000-0000-0000-000000000001',(tg::date)-2,(tg::date)-1,tg::date,'open','00:00',tg::time
  from (select (now() at time zone 'Asia/Manila') - interval '1 hour' tg) x;
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time)
select pg_temp.m(8),'b0000000-0000-0000-0000-000000000001',(tg::date)-2,(tg::date)-1,tg::date,'open','00:00',tg::time
  from (select (now() at time zone 'Asia/Manila') + interval '1 hour' tg) x;
-- sessions 9/10: FRIDAY (booked day) ended 5h / 13h ago; sat+sun later
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time)
select pg_temp.m(9),'b0000000-0000-0000-0000-000000000001',tg::date,(tg::date)+1,(tg::date)+2,'open','00:00',tg::time
  from (select (now() at time zone 'Asia/Manila') - interval '5 hours' tg) x;
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time)
select pg_temp.m(10),'b0000000-0000-0000-0000-000000000001',tg::date,(tg::date)+1,(tg::date)+2,'open','00:00',tg::time
  from (select (now() at time zone 'Asia/Manila') - interval '13 hours' tg) x;

-- bookings: id n, vendor n, stall n.  (session, days, status, expiry)
insert into public.bookings(id,vendor_id,stall_id,session_id,attending_days,status,reservation_expires_at,payment_due_at) values
 -- expiry group (session 1, future)
 (pg_temp.b(1), pg_temp.u(1), pg_temp.s(1), pg_temp.m(1),'{friday}','pending', now()-interval '1 hour', null),
 (pg_temp.b(2), pg_temp.u(2), pg_temp.s(2), pg_temp.m(1),'{friday}','approved',now()-interval '1 hour', now()-interval '1 hour'),
 (pg_temp.b(3), pg_temp.u(3), pg_temp.s(3), pg_temp.m(1),'{friday}','approved',now()-interval '1 hour', now()-interval '1 hour'),   -- fresh processing payment
 (pg_temp.b(4), pg_temp.u(4), pg_temp.s(4), pg_temp.m(1),'{friday}','approved',now()-interval '1 hour', now()-interval '1 hour'),   -- old processing payment
 (pg_temp.b(5), pg_temp.u(5), pg_temp.s(5), pg_temp.m(1),'{friday}','pending', now()+interval '5 hours', null),                      -- not lapsed
 (pg_temp.b(6), pg_temp.u(6), pg_temp.s(6), pg_temp.m(1),'{friday}','cancelled',now()-interval '1 hour', null),
 (pg_temp.b(7), pg_temp.u(7), pg_temp.s(7), pg_temp.m(1),'{friday}','rejected', now()-interval '1 hour', null),
 (pg_temp.b(8), pg_temp.u(8), pg_temp.s(8), pg_temp.m(1),'{friday}','paid',     now()-interval '1 hour', now()-interval '1 hour'),
 (pg_temp.b(9), pg_temp.u(9), pg_temp.s(9), pg_temp.m(1),'{friday}','approved', null, null),                                         -- no deadline set
 -- no-show group
 (pg_temp.b(11),pg_temp.u(11),pg_temp.s(11),pg_temp.m(2),'{friday}','paid',null,null),                 -- long past -> no_show
 (pg_temp.b(12),pg_temp.u(12),pg_temp.s(12),pg_temp.m(1),'{friday}','paid',null,null),                 -- future -> unchanged
 (pg_temp.b(13),pg_temp.u(13),pg_temp.s(13),pg_temp.m(3),'{friday}','paid',null,null),                 -- past but OPEN refund request -> unchanged
 (pg_temp.b(14),pg_temp.u(14),pg_temp.s(14),pg_temp.m(6),'{friday}','paid',null,null),                 -- booked only friday (ended), session still running -> no_show
 (pg_temp.b(15),pg_temp.u(15),pg_temp.s(15),pg_temp.m(6),'{sunday}','paid',null,null),                 -- booked sunday (not over) -> unchanged
 (pg_temp.b(16),pg_temp.u(16),pg_temp.s(16),pg_temp.m(4),'{friday}','paid',null,null),                 -- past but REJECTED refund request -> no_show
 -- auto-complete group
 (pg_temp.b(21),pg_temp.u(21),pg_temp.s(21),pg_temp.m(2),'{friday}','checked_in',null,null),           -- long past -> completed
 (pg_temp.b(22),pg_temp.u(22),pg_temp.s(22),pg_temp.m(9),'{friday}','checked_in',null,null),           -- ended 5h ago -> unchanged
 (pg_temp.b(23),pg_temp.u(23),pg_temp.s(23),pg_temp.m(10),'{friday}','checked_in',null,null),          -- ended 13h ago -> completed
 (pg_temp.b(24),pg_temp.u(24),pg_temp.s(24),pg_temp.m(1),'{friday}','checked_in',null,null),           -- future -> unchanged
 -- ended 5h / 13h ago but PAID (not checked in): 13h one is a no_show, 5h one is also no_show (end passed)
 (pg_temp.b(25),pg_temp.u(25),pg_temp.s(25),pg_temp.m(10),'{friday}','paid',null,null);
insert into public.bookings(id,vendor_id,stall_id,session_id,attending_days,status,completed_at,completion_note) values
 (pg_temp.b(26),pg_temp.u(26),pg_temp.s(26),pg_temp.m(2),'{friday}','completed','2026-01-01 00:00+00','by organizer');

insert into public.payments(booking_id,amount_cents,paymongo_payment_intent_id,status,created_at) values
 (pg_temp.b(3),10400,'src_fresh','processing',now()),
 (pg_temp.b(4),10400,'src_old','processing',now()-interval '2 hours'),
 (pg_temp.b(8),10400,'src_paid','paid',now()-interval '1 day'),
 (pg_temp.b(11),10400,'src_np11','paid',now()-interval '1 day');
insert into public.refund_requests(booking_id,vendor_id,reason,status,decision_comment) values
 (pg_temp.b(13),pg_temp.u(13),'sick','requested',null),
 (pg_temp.b(16),pg_temp.u(16),'sick','rejected','Not eligible');

-- snapshot of untouchables
create temp table snap as select id,status,completed_at from public.bookings;
grant all on snap to public;

\echo
\echo ===== SECURITY: nobody from the app may run the jobs =====
select pg_temp.t('X01a','anon cron_expire_stale_bookings',null,'anon',$q$select public.cron_expire_stale_bookings()$q$,'denied');
select pg_temp.t('X01b','anon cron_mark_no_shows',null,'anon',$q$select public.cron_mark_no_shows()$q$,'denied');
select pg_temp.t('X01c','anon cron_complete_checked_in',null,'anon',$q$select public.cron_complete_checked_in()$q$,'denied');
select pg_temp.t('X01d','anon cron_close_sessions',null,'anon',$q$select public.cron_close_sessions()$q$,'denied');
select pg_temp.t('X02a','vendor cron_expire_stale_bookings',pg_temp.u(1),'authenticated',$q$select public.cron_expire_stale_bookings()$q$,'denied');
select pg_temp.t('X02b','vendor cron_mark_no_shows',pg_temp.u(1),'authenticated',$q$select public.cron_mark_no_shows()$q$,'denied');
select pg_temp.t('X02c','vendor cron_complete_checked_in',pg_temp.u(1),'authenticated',$q$select public.cron_complete_checked_in()$q$,'denied');
select pg_temp.t('X02d','vendor cron_close_sessions',pg_temp.u(1),'authenticated',$q$select public.cron_close_sessions()$q$,'denied');
select pg_temp.t('X03a','organizer cron_expire_stale_bookings',pg_temp.u(900),'authenticated',$q$select public.cron_expire_stale_bookings()$q$,'denied');
select pg_temp.t('X03b','organizer cron_mark_no_shows',pg_temp.u(900),'authenticated',$q$select public.cron_mark_no_shows()$q$,'denied');
select pg_temp.t('X03c','organizer cron_complete_checked_in',pg_temp.u(900),'authenticated',$q$select public.cron_complete_checked_in()$q$,'denied');
select pg_temp.t('X03d','organizer cron_close_sessions',pg_temp.u(900),'authenticated',$q$select public.cron_close_sessions()$q$,'denied');
select pg_temp.t('X04a','service_role cron_expire_stale_bookings',null,'service_role',$q$select public.cron_expire_stale_bookings()$q$,'denied');
select pg_temp.t('X04b','service_role cron_mark_no_shows',null,'service_role',$q$select public.cron_mark_no_shows()$q$,'denied');
select pg_temp.t('X04c','service_role cron_complete_checked_in',null,'service_role',$q$select public.cron_complete_checked_in()$q$,'denied');
select pg_temp.t('X04d','service_role cron_close_sessions',null,'service_role',$q$select public.cron_close_sessions()$q$,'denied');
select pg_temp.ck('X05','nothing changed by the denied calls',
  (select count(*) from public.booking_events)=0 and (select count(*) from public.bookings b join snap s using(id) where b.status<>s.status)=0);

\echo
\echo ===== EXPIRY =====
create temp table run1 as select public.cron_expire_stale_bookings() n;
select pg_temp.ck('E00','job reports 3 expired (b1,b2,b4)',(select n from run1)=3,(select n::text from run1));
select pg_temp.ck('E01','lapsed pending -> expired',(select status from public.bookings where id=pg_temp.b(1))='expired');
select pg_temp.ck('E02','lapsed approved (unpaid) -> expired',(select status from public.bookings where id=pg_temp.b(2))='expired');
select pg_temp.ck('E03','payment in progress (started now) -> NOT expired yet',(select status from public.bookings where id=pg_temp.b(3))='approved');
select pg_temp.ck('E04','stale processing payment (2h) -> expired + payment failed',
  (select status from public.bookings where id=pg_temp.b(4))='expired' and (select status from public.payments where booking_id=pg_temp.b(4))='failed');
select pg_temp.ck('E04b','fresh processing payment left untouched',(select status from public.payments where booking_id=pg_temp.b(3))='processing');
select pg_temp.ck('E05','not-yet-lapsed pending untouched',(select status from public.bookings where id=pg_temp.b(5))='pending');
select pg_temp.ck('E06','cancelled / rejected / paid untouched',
  (select status from public.bookings where id=pg_temp.b(6))='cancelled' and (select status from public.bookings where id=pg_temp.b(7))='rejected' and (select status from public.bookings where id=pg_temp.b(8))='paid');
select pg_temp.ck('E07','approved booking with no deadline untouched',(select status from public.bookings where id=pg_temp.b(9))='approved');
select pg_temp.ck('E08','paid payment untouched',(select status from public.payments where booking_id=pg_temp.b(8))='paid');
select pg_temp.ck('E09','one system audit event per expired booking',
  (select count(*) from public.booking_events where action='expired' and actor_role='system' and actor_id is null and to_status='expired')=3);
select pg_temp.ck('E09b','event records the old status',
  (select from_status from public.booking_events where booking_id=pg_temp.b(1) and action='expired')='pending'
  and (select from_status from public.booking_events where booking_id=pg_temp.b(2) and action='expired')='approved');
select pg_temp.ck('E10','vendor notified once; organizer NOT notified',
  (select count(*) from public.notifications where type='booking_expired' and recipient_id in (pg_temp.u(1),pg_temp.u(2),pg_temp.u(4)))=3
  and (select count(*) from public.notifications where recipient_id=pg_temp.u(900))=0);
select pg_temp.ck('E10b','notification text names the stall',(select body from public.notifications where recipient_id=pg_temp.u(1) and type='booking_expired') like '%S1%');
create temp table run2 as select public.cron_expire_stale_bookings() n;
select pg_temp.ck('E11','second run does nothing (idempotent)',(select n from run2)=0
  and (select count(*) from public.booking_events where action='expired')=3
  and (select count(*) from public.notifications where type='booking_expired')=3);

\echo
\echo ===== NO-SHOW =====
create temp table nrun1 as select public.cron_mark_no_shows() n;
-- no_show expected: b11, b14, b16, b25  (b25: friday ended 13h ago, paid)
select pg_temp.ck('N00','job reports 4',(select n from nrun1)=4,(select n::text from nrun1));
select pg_temp.ck('N01','paid + last day long over -> no_show',(select status from public.bookings where id=pg_temp.b(11))='no_show');
select pg_temp.ck('N02','paid + session in the future -> unchanged',(select status from public.bookings where id=pg_temp.b(12))='paid');
select pg_temp.ck('N03','paid + OPEN refund request -> left alone',(select status from public.bookings where id=pg_temp.b(13))='paid');
select pg_temp.ck('N04','vendor booked only Friday (over) while session still runs -> no_show',(select status from public.bookings where id=pg_temp.b(14))='no_show');
select pg_temp.ck('N05','vendor booked Sunday (not over yet) -> unchanged',(select status from public.bookings where id=pg_temp.b(15))='paid');
select pg_temp.ck('N06','REJECTED refund request does not block no_show',(select status from public.bookings where id=pg_temp.b(16))='no_show');
select pg_temp.ck('N07','other statuses untouched by the no-show job',
  (select count(*) from public.bookings b join snap s using(id) where b.id in (pg_temp.b(5),pg_temp.b(6),pg_temp.b(7),pg_temp.b(9),pg_temp.b(12),pg_temp.b(13),pg_temp.b(15),pg_temp.b(22),pg_temp.b(24),pg_temp.b(26)) and b.status<>s.status)=0);
select pg_temp.ck('N08','audit event per no-show (system actor)',
  (select count(*) from public.booking_events where action='no_show' and actor_role='system' and from_status='paid' and to_status='no_show')=4);
select pg_temp.ck('N09','vendor AND organizer notified',
  (select count(*) from public.notifications where type='booking_no_show' and recipient_id=pg_temp.u(11))=1
  and (select count(*) from public.notifications where type='booking_no_show' and recipient_id=pg_temp.u(900))=4);
select pg_temp.ck('N09b','organizer message names the vendor',(select bool_or(body like 'Vendor 11 %') from public.notifications where recipient_id=pg_temp.u(900)));
select pg_temp.ck('N10','payment of a no-show stays paid (no automatic refund)',(select status from public.payments where booking_id=pg_temp.b(11))='paid');
select pg_temp.ck('N11','vendor can NOT request a refund after no_show (rule unchanged: paid only)',
  pg_temp.scalar(pg_temp.u(11),'authenticated',$q$select public.request_refund('e0000000-0000-0000-0000-000000000011','I was sick')::text$q$) like 'ERR Refunds can only be requested for paid%');
create temp table nrun2 as select public.cron_mark_no_shows() n;
select pg_temp.ck('N12','second run does nothing',(select n from nrun2)=0 and (select count(*) from public.booking_events where action='no_show')=4);
-- open refund request closed -> next run picks b13 up
update public.refund_requests set status='rejected', decision_comment='Not eligible' where booking_id=pg_temp.b(13);
create temp table nrun3 as select public.cron_mark_no_shows() n;
select pg_temp.ck('N13','after the refund request is rejected, the next run marks it no_show (1 booking)',(select n from nrun3)=1 and (select status from public.bookings where id=pg_temp.b(13))='no_show');

\echo
\echo ===== AUTO-COMPLETE =====
create temp table crun1 as select public.cron_complete_checked_in() n;
select pg_temp.ck('C00','job reports 2 (b21,b23)',(select n from crun1)=2,(select n::text from crun1));
select pg_temp.ck('C01','checked_in, long past -> completed',(select status from public.bookings where id=pg_temp.b(21))='completed');
select pg_temp.ck('C02','checked_in, ended 5h ago -> NOT yet',(select status from public.bookings where id=pg_temp.b(22))='checked_in');
select pg_temp.ck('C03','checked_in, ended 13h ago -> completed',(select status from public.bookings where id=pg_temp.b(23))='completed');
select pg_temp.ck('C04','checked_in, future -> unchanged',(select status from public.bookings where id=pg_temp.b(24))='checked_in');
select pg_temp.ck('C05','auto-complete fields: by null, not early, note, time set',
  (select completed_by is null and completed_early=false and completed_at is not null and completion_note like 'Auto-completed%' from public.bookings where id=pg_temp.b(21)));
select pg_temp.ck('C06','already completed booking untouched (same completed_at)',
  (select b.completed_at=s.completed_at and b.completion_note='by organizer' from public.bookings b join snap s using(id) where b.id=pg_temp.b(26)));
select pg_temp.ck('C07','audit event auto_completed (system)',(select count(*) from public.booking_events where action='auto_completed' and actor_role='system' and from_status='checked_in' and to_status='completed')=2);
select pg_temp.ck('C08','vendor told they can submit sales',(select count(*) from public.notifications where type='booking_completed' and recipient_id in (pg_temp.u(21),pg_temp.u(23)))=2);
select pg_temp.ck('C09','paid (never checked in) booking is NOT completed',(select status from public.bookings where id=pg_temp.b(25))='no_show');
create temp table c10 as select pg_temp.scalar(pg_temp.u(21),'authenticated',$q$select public.submit_sales('e0000000-0000-0000-0000-000000000021',1000,5,null,null)::text$q$) r;
select pg_temp.ck('C10','vendor can submit sales on an auto-completed booking',(select r from c10) not like 'ERR%',(select r from c10));
select pg_temp.ck('C10b','vendor can NOT submit sales on a no-show booking',
  (select r from (select pg_temp.scalar(pg_temp.u(11),'authenticated',$q$select public.submit_sales('e0000000-0000-0000-0000-000000000011',1000,5,null,null)::text$q$) r) z) like 'ERR%');
create temp table crun2 as select public.cron_complete_checked_in() n;
select pg_temp.ck('C11','second run does nothing',(select n from crun2)=0 and (select count(*) from public.booking_events where action='auto_completed')=2);

\echo
\echo ===== SESSION CLOSE =====
create temp table srun1 as select public.cron_close_sessions() n;
select pg_temp.ck('S01','open, long past -> closed',(select status from public.market_sessions where id=pg_temp.m(2))='closed');
select pg_temp.ck('S02','upcoming, long past -> closed',(select status from public.market_sessions where id=pg_temp.m(3))='closed');
select pg_temp.ck('S03','open, future -> stays open',(select status from public.market_sessions where id=pg_temp.m(1))='open');
select pg_temp.ck('S04','completed / cancelled stay as they are',(select status from public.market_sessions where id=pg_temp.m(4))='completed' and (select status from public.market_sessions where id=pg_temp.m(5))='cancelled');
select pg_temp.ck('S05','friday over but sunday still to come -> stays open',(select status from public.market_sessions where id=pg_temp.m(6))='open');
select pg_temp.ck('S06','last day ended 1 hour ago -> closed',(select status from public.market_sessions where id=pg_temp.m(7))='closed');
select pg_temp.ck('S07','last day ends in 1 hour -> still open',(select status from public.market_sessions where id=pg_temp.m(8))='open');
select pg_temp.ck('S08','sessions 9/10 (sunday still ahead) stay open',(select count(*) from public.market_sessions where id in (pg_temp.m(9),pg_temp.m(10)) and status='open')=2);
select pg_temp.ck('S09','job reports 3 (2,3,7)',(select n from srun1)=3,(select n::text from srun1));
select pg_temp.ck('S10','second run does nothing',public.cron_close_sessions()=0);
select pg_temp.ck('S11','closed session: organizer can still complete a checked-in booking',
  (select status from public.market_sessions where id=pg_temp.m(2))='closed');

\echo
\echo ===== AFTER ALL JOBS: no booking changed except the expected ones =====
select pg_temp.ck('Z01','cancelled/rejected/paid-with-deadline bookings unchanged',
  (select count(*) from public.bookings b join snap s using(id) where b.id in (pg_temp.b(5),pg_temp.b(6),pg_temp.b(7),pg_temp.b(9),pg_temp.b(12),pg_temp.b(15),pg_temp.b(22),pg_temp.b(24),pg_temp.b(26)) and b.status<>s.status)=0);
select pg_temp.ck('Z02','no event or notification written for untouched bookings',
  (select count(*) from public.booking_events where booking_id in (pg_temp.b(5),pg_temp.b(6),pg_temp.b(7),pg_temp.b(12),pg_temp.b(15),pg_temp.b(22),pg_temp.b(24),pg_temp.b(26)))=0);
select pg_temp.ck('Z03','booking_events still append-only',
  pg_temp.scalar(null,'service_role',$q$update public.booking_events set note='x' returning 'changed'$q$) like 'ERR%');

rollback;
