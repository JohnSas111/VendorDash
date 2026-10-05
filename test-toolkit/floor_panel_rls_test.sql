-- Floor Map panel: the exact data the screen asks for, read as each kind of user. Rolls back.
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
  begin execute p_sql into r; exception when others then r := 'ERR '||sqlstate||' '||left(sqlerrm,70); end;
  reset role; perform set_config('request.jwt.claims','{}',true); return r; end $$;
create or replace function pg_temp.u(n int) returns uuid language sql as $$ select ('a0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;

insert into auth.users(id,email) select pg_temp.u(n),'u'||n||'@x' from generate_series(1,4) n;
insert into auth.users(id,email) values (pg_temp.u(900),'o1@x'),(pg_temp.u(901),'o2@x');
insert into public.profiles(id,role,full_name) select pg_temp.u(n),'vendor','Person '||n from generate_series(1,4) n;
insert into public.profiles(id,role,full_name) values (pg_temp.u(900),'organizer','Org 1'),(pg_temp.u(901),'organizer','Org 2');
insert into public.vendor_details(id,business_name,category,description,is_verified) select pg_temp.u(n),'Biz '||n,'Seafood','d',(n%2=1) from generate_series(1,4) n;
insert into public.venues(id,organizer_id,name,address,timezone) values ('b0000000-0000-0000-0000-00000000000a',pg_temp.u(900),'A','x','Asia/Manila'),('b0000000-0000-0000-0000-00000000000b',pg_temp.u(901),'B','y','Asia/Manila');
insert into public.stalls(id,venue_id,stall_number,price_per_day_cents) select ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'b0000000-0000-0000-0000-00000000000a','A'||n,80000 from generate_series(1,4) n;
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time) values
 ('d0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',current_date+14,current_date+15,current_date+16,'open','00:00','23:59');
insert into public.bookings(id,vendor_id,stall_id,session_id,attending_days,status,payment_due_at,checked_in_at) values
 ('e0000000-0000-0000-0000-000000000001',pg_temp.u(1),'c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000a','{friday,saturday,sunday}','paid',now()-interval '1 day',null),
 ('e0000000-0000-0000-0000-000000000002',pg_temp.u(2),'c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-00000000000a','{friday}','approved',now()+interval '1 day',null),
 ('e0000000-0000-0000-0000-000000000003',pg_temp.u(3),'c0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-00000000000a','{sunday}','pending',null,null),
 ('e0000000-0000-0000-0000-000000000004',pg_temp.u(4),'c0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-00000000000a','{saturday}','checked_in',now()-interval '1 day',now());
insert into public.payments(booking_id,amount_cents,paymongo_payment_intent_id,status,paid_at) values
 ('e0000000-0000-0000-0000-000000000001',240400,'src1','paid',now()-interval '2 days'),
 ('e0000000-0000-0000-0000-000000000004',80400,'src4','paid',now()-interval '2 days'),
 ('e0000000-0000-0000-0000-000000000002',80400,'src2','processing',null);

-- the same shape the screen's query produces (bookings + stall price + vendor details + paid payment)
create or replace function pg_temp.q(p_what text) returns text language sql as $$
 select 'select '||p_what||' from public.bookings b
   join public.stalls s on s.id=b.stall_id
   left join public.profiles pr on pr.id=b.vendor_id
   left join public.vendor_details vd on vd.id=b.vendor_id
   left join public.payments p on p.booking_id=b.id and p.status=''paid''
  where b.session_id=''d0000000-0000-0000-0000-00000000000a''' $$;

\echo ===== the organizer who owns the venue =====
select pg_temp.ck('R01','organizer sees all 4 bookings of the session', pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.q('count(*)'))='4');
select pg_temp.ck('R02','organizer reads price, business name, category, verified flag',
  pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.q($w$count(*) filter (where s.price_per_day_cents=80000 and vd.business_name is not null and vd.category='Seafood' and vd.is_verified is not null)$w$))='4');
select pg_temp.ck('R03','organizer reads when each paid booking was paid (paid_at)',
  pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.q($w$count(p.paid_at)$w$))='2');
select pg_temp.ck('R04','organizer reads requested_at, payment_due_at and checked_in_at',
  pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.q($w$count(b.requested_at)||'/'||count(b.payment_due_at)||'/'||count(b.checked_in_at)$w$))='4/3/1');
select pg_temp.ck('R05','a vendor who is NOT verified shows is_verified=false (2 of 4)',
  pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.q($w$count(*) filter (where vd.is_verified=false)$w$))='2');
select pg_temp.ck('R06','the in-progress (processing) payment is not mistaken for a paid one',
  pg_temp.as_(pg_temp.u(900),'authenticated',pg_temp.q($w$count(*) filter (where b.id='e0000000-0000-0000-0000-000000000002' and p.paid_at is not null)$w$))='0');

\echo ===== NEGATIVE: everyone else =====
select pg_temp.ck('N01','another organizer sees NO bookings of this venue', pg_temp.as_(pg_temp.u(901),'authenticated',pg_temp.q('count(*)'))='0');
select pg_temp.ck('N02','another organizer sees NO payment rows of this venue',
  pg_temp.as_(pg_temp.u(901),'authenticated','select count(*) from public.payments')='0');
select pg_temp.ck('N03','vendor 2 sees only their own booking', pg_temp.as_(pg_temp.u(2),'authenticated',pg_temp.q('count(*)'))='1');
select pg_temp.ck('N04','vendor 2 cannot see other vendors'' payments', pg_temp.as_(pg_temp.u(2),'authenticated','select count(*) from public.payments where booking_id <> ''e0000000-0000-0000-0000-000000000002''')='0');
select pg_temp.ck('N05','logged-out user sees nothing (or is refused)',
  pg_temp.as_(null,'anon',pg_temp.q('count(*)')) in ('0') or pg_temp.as_(null,'anon',pg_temp.q('count(*)')) like 'ERR%');
rollback;
