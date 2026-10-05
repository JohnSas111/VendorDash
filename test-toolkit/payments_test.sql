\set ON_ERROR_STOP off
\pset tuples_only on
set client_min_messages = notice;
begin;

create or replace function pg_temp.chk(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '% | %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, name; end $$;

create or replace function pg_temp.err(name text, q text, expect text) returns void language plpgsql as $$
declare m text;
begin
  begin execute q; m := '(no error)';
  exception when others then m := sqlerrm; end;
  raise notice '% | % (got: %)', case when m ilike '%'||expect||'%' then 'PASS' else 'FAIL' end, name, m;
end $$;

-- ---------- seed ----------
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','va@x'),('aaaaaaaa-0000-0000-0000-000000000002','vb@x'),('aaaaaaaa-0000-0000-0000-000000000009','org@x');
insert into public.profiles(id,role,full_name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','vendor','Vendor A'),
 ('aaaaaaaa-0000-0000-0000-000000000002','vendor','Vendor B'),
 ('aaaaaaaa-0000-0000-0000-000000000009','organizer','Org');
insert into public.venues(id,organizer_id,name,address) values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000009','Plaza','x');
insert into public.stalls(id,venue_id,stall_number,price_per_day_cents) values
 ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','S1',10000),
 ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','S2',10000),
 ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001','S3',10000),
 ('cccccccc-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000001','S4',10000),
 ('cccccccc-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000001','S5',10000),
 ('cccccccc-0000-0000-0000-000000000006','bbbbbbbb-0000-0000-0000-000000000001','S6',10000);
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status)
 values ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', current_date+7, current_date+8, current_date+9,'open');

-- bookings (inserted as superuser, i.e. no app user => triggers allow it)
-- B1: A, S1, 3 days, approved   B2: B, S2 approved   B3: A? one-per-session => use separate vendors/sessions via B only once each
-- one booking per vendor per session, so create extra sessions for extra bookings.
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status)
select ('dddddddd-0000-0000-0000-00000000010'||i)::uuid,'bbbbbbbb-0000-0000-0000-000000000001', current_date+7+i*7, current_date+8+i*7, current_date+9+i*7,'open' from generate_series(1,6) i;

insert into public.bookings(id,vendor_id,stall_id,session_id,attending_days,status,reservation_expires_at,payment_due_at) values
 ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','{friday,saturday,sunday}','approved', now()+interval '2 hours', now()+interval '2 hours'),
 ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001','{friday}','approved', now()+interval '2 hours', now()+interval '2 hours'),
 ('eeeeeeee-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000101','{friday}','approved', now()+interval '2 hours', now()+interval '2 hours'),
 ('eeeeeeee-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-000000000102','{friday}','approved', now()+interval '2 hours', now()+interval '2 hours'),
 ('eeeeeeee-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000005','dddddddd-0000-0000-0000-000000000102','{friday,friday}','approved', now()+interval '2 hours', now()+interval '2 hours'),
 ('eeeeeeee-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000006','dddddddd-0000-0000-0000-000000000103','{friday}','pending', null, null),
 ('eeeeeeee-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000006','dddddddd-0000-0000-0000-000000000105','{friday}','approved', now()-interval '1 hour', now()-interval '1 hour'),
 ('eeeeeeee-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000104','{friday}','approved', now()+interval '2 hours', now()+interval '2 hours');

\echo ===== QUOTE =====
select pg_temp.chk('Q1 3 days x 10000 + 400 = 30400, total 30000, fee 400, days 3',
  (select amount_cents=30400 and stall_total_cents=30000 and fee_cents=400 and days=3
     from public.payment_quote('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001')));
select pg_temp.chk('Q2 duplicate days counted once (friday,friday => 10400)',
  (select amount_cents=10400 and days=1 from public.payment_quote('eeeeeeee-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001')));
select pg_temp.err('Q3 NEG: another vendor cannot quote my booking',
  $q$select * from public.payment_quote('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002')$q$,'Booking not found');
select pg_temp.err('Q4 NEG: null vendor refused',
  $q$select * from public.payment_quote('eeeeeeee-0000-0000-0000-000000000001',null)$q$,'Booking not found');
select pg_temp.err('Q5 NEG: unknown booking',
  $q$select * from public.payment_quote('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000001')$q$,'Booking not found');
select pg_temp.err('Q6 NEG: pending booking not payable',
  $q$select * from public.payment_quote('eeeeeeee-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000002')$q$,'not ready for payment');
select pg_temp.err('Q7 NEG: payment deadline passed',
  $q$select * from public.payment_quote('eeeeeeee-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001')$q$,'deadline');

\echo ===== REGISTER / SUPERSEDE =====
select public.payment_register('eeeeeeee-0000-0000-0000-000000000001','src_1','gcash',30400);
select pg_temp.chk('R1 first source is processing',(select status='processing' from public.payments where paymongo_payment_intent_id='src_1'));
select public.payment_register('eeeeeeee-0000-0000-0000-000000000001','src_2','gcash',30400);
select pg_temp.chk('R2 double-tap: older source retired, newest processing',
  (select (select status from public.payments where paymongo_payment_intent_id='src_1')='failed'
      and (select status from public.payments where paymongo_payment_intent_id='src_2')='processing'));
select pg_temp.err('R3 NEG: invalid method',$q$select public.payment_register('eeeeeeee-0000-0000-0000-000000000001','src_x','bitcoin',30400)$q$,'Invalid payment method');
select pg_temp.err('R4 NEG: pending booking cannot register',$q$select public.payment_register('eeeeeeee-0000-0000-0000-000000000006','src_y','gcash',30400)$q$,'not ready');
select pg_temp.err('R5 NEG: same source id twice (unique index)',$q$insert into public.payments(booking_id,amount_cents,paymongo_payment_intent_id,status) values ('eeeeeeee-0000-0000-0000-000000000001',1,'src_2','processing')$q$,'uq_payments_source');

\echo ===== PRECHECK =====
select pg_temp.chk('P1 retired source is never charged (not_open)',(select public.payment_precheck('src_1',30400)='not_open'));
select pg_temp.chk('P2 unknown source (forged id) => unknown_source',(select public.payment_precheck('src_forged',100)='unknown_source'));
select pg_temp.chk('P3 NEG: wrong amount => amount_mismatch and payment failed',(select public.payment_precheck('src_2',100)='amount_mismatch'));
select pg_temp.chk('P3b mismatch marked payment failed',(select status='failed' from public.payments where paymongo_payment_intent_id='src_2'));
select pg_temp.chk('P3c mismatch logged in booking_events',(select count(*)=1 from public.booking_events where booking_id='eeeeeeee-0000-0000-0000-000000000001' and action='payment_rejected'));
select public.payment_register('eeeeeeee-0000-0000-0000-000000000001','src_3','gcash',30400);
select pg_temp.chk('P4 correct source + amount + approved booking => ok',(select public.payment_precheck('src_3',30400)='ok'));

\echo ===== APPLY (happy path + replay) =====
select pg_temp.chk('A1 paid => paid',(select public.payment_apply_result('src_3','paid','pay_111',30400)='paid'));
select pg_temp.chk('A1b booking is now paid',(select status='paid' from public.bookings where id='eeeeeeee-0000-0000-0000-000000000001'));
select pg_temp.chk('A1c payment row paid with PayMongo payment id',(select status='paid' and paymongo_payment_id='pay_111' and paid_at is not null from public.payments where paymongo_payment_intent_id='src_3'));
select pg_temp.chk('A1d event payment_confirmed (system actor)',(select count(*)=1 from public.booking_events where booking_id='eeeeeeee-0000-0000-0000-000000000001' and action='payment_confirmed' and actor_role='system' and from_status='approved' and to_status='paid'));
select pg_temp.chk('A1e vendor notified exactly once',(select count(*)=1 from public.notifications where recipient_id='aaaaaaaa-0000-0000-0000-000000000001' and type='payment_confirmed'));
select pg_temp.chk('A2 REPLAY of same paid event => already_paid',(select public.payment_apply_result('src_3','paid','pay_111',30400)='already_paid'));
select pg_temp.chk('A2b replay created no extra events/notifications',(select (select count(*) from public.booking_events where action='payment_confirmed')=1 and (select count(*) from public.notifications where type='payment_confirmed')=1));
select pg_temp.chk('A3 NEG: late failure after paid does NOT downgrade',(select public.payment_apply_result('src_3','failed',null,null)='already_paid'));
select pg_temp.chk('A3b payment still paid, booking still paid',(select (select status from public.payments where paymongo_payment_intent_id='src_3')='paid' and (select status from public.bookings where id='eeeeeeee-0000-0000-0000-000000000001')='paid'));
select pg_temp.chk('A4 precheck on a paid source => already_paid (no second charge)',(select public.payment_precheck('src_3',30400)='already_paid'));
select pg_temp.err('A5 NEG: cannot register another payment on a paid booking',$q$select public.payment_register('eeeeeeee-0000-0000-0000-000000000001','src_z','gcash',30400)$q$,'not ready');
select pg_temp.chk('A6 unknown source on apply => unknown_source (no changes)',(select public.payment_apply_result('src_forged','paid','pay_x',100)='unknown_source'));
select pg_temp.err('A7 NEG: invalid outcome',$q$select public.payment_apply_result('src_3','refunded',null,null)$q$,'Invalid outcome');

\echo ===== DEAD BOOKINGS =====
-- D1: booking cancelled BEFORE the vendor finishes on GCash => NOT charged
select public.payment_register('eeeeeeee-0000-0000-0000-000000000002','src_b','gcash',10400);
update public.bookings set status='cancelled' where id='eeeeeeee-0000-0000-0000-000000000002';
select pg_temp.chk('D1 cancelled booking => booking_not_payable (money NOT taken)',(select public.payment_precheck('src_b',10400)='booking_not_payable'));
select pg_temp.chk('D1b payment failed, booking stays cancelled',(select (select status from public.payments where paymongo_payment_intent_id='src_b')='failed' and (select status from public.bookings where id='eeeeeeee-0000-0000-0000-000000000002')='cancelled'));
select pg_temp.chk('D1c vendor told they were not charged',(select count(*)=1 from public.notifications where recipient_id='aaaaaaaa-0000-0000-0000-000000000002' and title='Payment not taken'));
-- D2: the tiny race: precheck ok, booking cancelled, THEN the charge succeeds
select public.payment_register('eeeeeeee-0000-0000-0000-000000000003','src_c','gcash',10400);
select pg_temp.chk('D2 precheck ok',(select public.payment_precheck('src_c',10400)='ok'));
update public.bookings set status='cancelled' where id='eeeeeeee-0000-0000-0000-000000000003';
select pg_temp.chk('D2b charge succeeded on a dead booking => paid_needs_refund',(select public.payment_apply_result('src_c','paid','pay_222',10400)='paid_needs_refund'));
select pg_temp.chk('D2c booking NOT resurrected (still cancelled)',(select status='cancelled' from public.bookings where id='eeeeeeee-0000-0000-0000-000000000003'));
select pg_temp.chk('D2d payment recorded as paid (truth) with PayMongo id for the refund',(select status='paid' and paymongo_payment_id='pay_222' from public.payments where paymongo_payment_intent_id='src_c'));
select pg_temp.chk('D2e organizer + vendor notified, event logged',(select (select count(*) from public.notifications where recipient_id='aaaaaaaa-0000-0000-0000-000000000009' and title='Payment needs a refund')=1 and (select count(*) from public.notifications where recipient_id='aaaaaaaa-0000-0000-0000-000000000001' and title='Payment needs attention')=1 and (select count(*) from public.booking_events where booking_id='eeeeeeee-0000-0000-0000-000000000003' and action='payment_needs_refund')=1));
-- D3: amount differs at apply time
select public.payment_register('eeeeeeee-0000-0000-0000-000000000004','src_d','gcash',10400);
select pg_temp.chk('D3 charged amount differs from record => paid_needs_refund, booking left approved',(select public.payment_apply_result('src_d','paid','pay_333',500)='paid_needs_refund' and (select status from public.bookings where id='eeeeeeee-0000-0000-0000-000000000004')='approved'));
-- D4: failed charge on an open payment
select public.payment_register('eeeeeeee-0000-0000-0000-000000000008','src_e','paymaya',10400);
select pg_temp.chk('D4 failed charge on open payment => failed, booking still approved',(select public.payment_apply_result('src_e','failed',null,null)='failed' and (select status from public.bookings where id='eeeeeeee-0000-0000-0000-000000000008')='approved'));
select public.payment_register('eeeeeeee-0000-0000-0000-000000000008','src_f','paymaya',10400);
select pg_temp.chk('D4b vendor can immediately retry (new source allowed)',(select status='processing' from public.payments where paymongo_payment_intent_id='src_f'));

\echo ===== WHO MAY CALL (negative security) =====
do $$ declare f text; r text; begin
 foreach r in array array['anon','authenticated'] loop
  foreach f in array array[
   $f$select * from public.payment_quote('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001')$f$,
   $f$select public.payment_register('eeeeeeee-0000-0000-0000-000000000001','s','gcash',1)$f$,
   $f$select public.payment_precheck('src_3',1)$f$,
   $f$select public.payment_apply_result('src_3','paid','p',1)$f$ ] loop
   begin execute 'set local role '||r; execute f; perform pg_temp.chk('S NEG '||r||' blocked: '||left(f,40), false);
   exception when insufficient_privilege then perform pg_temp.chk('S NEG '||r||' blocked: '||left(f,40), true);
             when others then perform pg_temp.chk('S NEG '||r||' blocked (other error: '||sqlerrm||')', false); end;
   reset role;
  end loop;
 end loop;
end $$;
do $$ begin set local role service_role; perform * from public.payment_quote('eeeeeeee-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001'); reset role; perform pg_temp.chk('S service_role CAN call',true);
 exception when others then perform pg_temp.chk('S service_role CAN call (got '||sqlerrm||')',false); end $$;

\echo ===== TABLE RLS: vendors cannot write payments directly =====
do $$ begin
 set local role authenticated; perform set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
 begin update public.payments set status='paid' where booking_id='eeeeeeee-0000-0000-0000-000000000008'; perform pg_temp.chk('T vendor direct UPDATE on payments changes 0 rows', not found);
 exception when others then perform pg_temp.chk('T vendor direct UPDATE on payments blocked',true); end;
 begin insert into public.payments(booking_id,amount_cents,status) values ('eeeeeeee-0000-0000-0000-000000000008',1,'paid'); perform pg_temp.chk('T vendor direct INSERT on payments',false);
 exception when others then perform pg_temp.chk('T vendor direct INSERT on payments blocked',true); end;
 reset role;
end $$;

rollback;
