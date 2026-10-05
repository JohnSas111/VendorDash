\set ON_ERROR_STOP off
set client_min_messages = notice;
begin;

-- ===================== helpers =====================
create or replace function pg_temp.t(p_id text, p_name text, p_sub uuid, p_role text, p_sql text, p_expect text) returns void language plpgsql as $$
declare n bigint := 0; m text := 'ok'; good boolean; errd boolean := false;
begin
  if p_role <> 'postgres' then
    perform set_config('request.jwt.claims', case when p_sub is null then '{"role":"anon"}' else json_build_object('sub',p_sub,'role',p_role)::text end, true);
    execute 'set local role '||p_role;
  end if;
  begin execute p_sql; get diagnostics n = row_count;
  exception when others then errd := true; m := sqlstate||' '||left(sqlerrm,90); end;
  reset role;
  good := case p_expect
    when 'ok'      then not errd
    when 'rows'    then (not errd) and n >= 1
    when 'blocked' then errd or n = 0
    when 'denied'  then errd
  end;
  raise notice '% | % %  [%]', case when good then 'PASS' else 'FAIL' end, p_id, p_name, case when errd then 'error: '||m else 'rows='||n end;
end $$;

create or replace function pg_temp.scalar(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_sub is null then '{"role":"service_role"}' else json_build_object('sub',p_sub,'role',p_role)::text end, true);
  execute 'set local role '||p_role;
  begin execute p_sql into r; exception when others then r := 'ERR '||sqlerrm; end;
  reset role; return r;
end $$;

-- ===================== seed (as superuser) =====================
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','v1@x'),('aaaaaaaa-0000-0000-0000-000000000002','v2@x'),
 ('aaaaaaaa-0000-0000-0000-000000000003','v3@x'),('aaaaaaaa-0000-0000-0000-000000000004','v4@x'),
 ('aaaaaaaa-0000-0000-0000-000000000009','o1@x'),('aaaaaaaa-0000-0000-0000-00000000000a','o2@x');
insert into public.profiles(id,role,full_name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','vendor','Vendor One'),('aaaaaaaa-0000-0000-0000-000000000002','vendor','Vendor Two'),
 ('aaaaaaaa-0000-0000-0000-000000000009','organizer','Org One'),('aaaaaaaa-0000-0000-0000-00000000000a','organizer','Org Two');
insert into public.vendor_details(id,business_name,category,is_verified) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Biz One','food',true),('aaaaaaaa-0000-0000-0000-000000000002','Biz Two','crafts',false);
insert into public.venues(id,organizer_id,name,address,timezone) values
 ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000009','Venue A','x','Asia/Manila'),
 ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','Venue B','y','Asia/Manila');
insert into public.stalls(id,venue_id,stall_number,price_per_day_cents) values
 ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','S1',10000),
 ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','S2',10000),
 ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001','S3',10000),
 ('cccccccc-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000001','S4',10000),
 ('cccccccc-0000-0000-0000-000000000006','bbbbbbbb-0000-0000-0000-000000000001','S6',10000),
 ('cccccccc-0000-0000-0000-000000000011','bbbbbbbb-0000-0000-0000-000000000002','SB1',10000);
insert into public.market_sessions(id,venue_id,friday_date,saturday_date,sunday_date,status,start_time,end_time) values
 ('dddddddd-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001', current_date+14,current_date+15,current_date+16,'open','00:00','23:59'),
 ('dddddddd-0000-0000-0000-0000000000a3','bbbbbbbb-0000-0000-0000-000000000001', current_date+21,current_date+22,current_date+23,'open','00:00','23:59'),
 ('dddddddd-0000-0000-0000-0000000000a5','bbbbbbbb-0000-0000-0000-000000000001', (now() at time zone 'Asia/Manila')::date,(now() at time zone 'Asia/Manila')::date+1,(now() at time zone 'Asia/Manila')::date+2,'open','00:00','23:59'),
 ('dddddddd-0000-0000-0000-0000000000b6','bbbbbbbb-0000-0000-0000-000000000002', current_date+14,current_date+15,current_date+16,'open','00:00','23:59');
insert into public.bookings(id,vendor_id,stall_id,session_id,attending_days,status,reservation_expires_at,payment_due_at) values
 ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-0000000000a1','{friday}','approved',now()+interval '2 hours',now()+interval '2 hours'),
 ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-0000000000a1','{friday}','pending',now()+interval '20 hours',null),
 ('eeeeeeee-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000011','dddddddd-0000-0000-0000-0000000000b6','{friday}','approved',now()+interval '2 hours',now()+interval '2 hours');
insert into public.notifications(id,recipient_id,title,body,type) values
 ('99999999-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','N1','b','t'),
 ('99999999-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','N2','b','t');

\echo
\echo ===== SECURITY: these must be BLOCKED =====
select pg_temp.t('S01','vendor sets own booking status approved -> paid','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.bookings set status='paid' where id='eeeeeeee-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S02','vendor INSERTs a booking with forged status paid','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$insert into public.bookings(vendor_id,stall_id,session_id,attending_days,status) values ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-0000000000a3','{friday}','paid')$q$,'blocked');
select pg_temp.t('S03','vendor edits organizer_notes on own booking (L-027)','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.bookings set organizer_notes='forged' where id='eeeeeeee-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S04','organizer sets booking status paid DIRECTLY','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.bookings set status='paid' where id='eeeeeeee-0000-0000-0000-000000000002'$q$,'blocked');
select pg_temp.t('S05','organizer of OTHER venue updates venue A booking','aaaaaaaa-0000-0000-0000-00000000000a','authenticated',$q$update public.bookings set status='cancelled' where id='eeeeeeee-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S06','vendor inserts sales report directly (booking not completed)','aaaaaaaa-0000-0000-0000-000000000002','authenticated',$q$insert into public.sales_submissions(booking_id,vendor_id,gross_sales_cents) values ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002',999999)$q$,'blocked');
select pg_temp.t('S07','vendor sets own is_verified = true','aaaaaaaa-0000-0000-0000-000000000002','authenticated',$q$update public.vendor_details set is_verified=true where id='aaaaaaaa-0000-0000-0000-000000000002'$q$,'blocked');
select pg_temp.t('S08','vendor forges verified_by / verified_at','aaaaaaaa-0000-0000-0000-000000000002','authenticated',$q$update public.vendor_details set verified_by='aaaaaaaa-0000-0000-0000-000000000009', verified_at=now() where id='aaaaaaaa-0000-0000-0000-000000000002'$q$,'blocked');
select pg_temp.t('S09','organizer sets is_verified directly (must use verify_vendor)','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.vendor_details set is_verified=true where id='aaaaaaaa-0000-0000-0000-000000000002'$q$,'blocked');
select pg_temp.t('S10','vendor promotes own role to organizer','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.profiles set role='organizer' where id='aaaaaaaa-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S12a','vendor reads ANOTHER vendor''s profile','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select * from public.profiles where id='aaaaaaaa-0000-0000-0000-000000000002'$q$,'blocked');
select pg_temp.t('S12b','vendor reads ANOTHER vendor''s business details','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select * from public.vendor_details where id='aaaaaaaa-0000-0000-0000-000000000002'$q$,'blocked');
select pg_temp.t('S13','vendor reads the organizer''s profile','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select * from public.profiles where role='organizer'$q$,'blocked');
select pg_temp.t('S14a','vendor INSERTs a notification for someone else','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$insert into public.notifications(recipient_id,title,body,type) values ('aaaaaaaa-0000-0000-0000-000000000002','fake','x','t')$q$,'blocked');
select pg_temp.t('S14b','vendor rewrites the TEXT of own notification','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.notifications set title='forged' where id='99999999-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S14c','vendor marks SOMEONE ELSE''s notification read','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.notifications set is_read=true where id='99999999-0000-0000-0000-000000000002'$q$,'blocked');
select pg_temp.t('S15','vendor deletes own notification','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$delete from public.notifications where id='99999999-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S16a','vendor inserts a PAID payment row','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$insert into public.payments(booking_id,amount_cents,status) values ('eeeeeeee-0000-0000-0000-000000000001',1,'paid')$q$,'blocked');
select pg_temp.t('S16b','vendor deletes bookings','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$delete from public.bookings where id='eeeeeeee-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S17','vendor writes an audit event','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$insert into public.booking_events(booking_id,session_id,actor_role,action) values ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-0000000000a1','vendor','forged')$q$,'blocked');
select pg_temp.t('S18a','vendor inserts a stall','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$insert into public.stalls(venue_id,stall_number,price_per_day_cents) values ('bbbbbbbb-0000-0000-0000-000000000001','HACK',1)$q$,'blocked');
select pg_temp.t('S18b','vendor changes a stall price','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.stalls set price_per_day_cents=1 where id='cccccccc-0000-0000-0000-000000000006'$q$,'blocked');
select pg_temp.t('S18c','vendor deletes a stall','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$delete from public.stalls where id='cccccccc-0000-0000-0000-000000000006'$q$,'blocked');
select pg_temp.t('S19','vendor changes a session status','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.market_sessions set status='cancelled' where id='dddddddd-0000-0000-0000-0000000000a1'$q$,'blocked');
select pg_temp.t('S20','vendor renames a venue','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.venues set name='hacked' where id='bbbbbbbb-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S21a','other organizer renames venue A','aaaaaaaa-0000-0000-0000-00000000000a','authenticated',$q$update public.venues set name='hacked' where id='bbbbbbbb-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S21b','other organizer adds a stall to venue A','aaaaaaaa-0000-0000-0000-00000000000a','authenticated',$q$insert into public.stalls(venue_id,stall_number,price_per_day_cents) values ('bbbbbbbb-0000-0000-0000-000000000001','HACK',1)$q$,'blocked');
select pg_temp.t('S21c','other organizer edits a venue A stall','aaaaaaaa-0000-0000-0000-00000000000a','authenticated',$q$update public.stalls set price_per_day_cents=1 where id='cccccccc-0000-0000-0000-000000000006'$q$,'blocked');
select pg_temp.t('S21d','other organizer deletes a venue A stall','aaaaaaaa-0000-0000-0000-00000000000a','authenticated',$q$delete from public.stalls where id='cccccccc-0000-0000-0000-000000000006'$q$,'blocked');
select pg_temp.t('S21e','other organizer adds a session to venue A','aaaaaaaa-0000-0000-0000-00000000000a','authenticated',$q$insert into public.market_sessions(venue_id,friday_date,saturday_date,sunday_date) values ('bbbbbbbb-0000-0000-0000-000000000001',current_date+60,current_date+61,current_date+62)$q$,'blocked');
select pg_temp.t('S21f','other organizer cancels a venue A session','aaaaaaaa-0000-0000-0000-00000000000a','authenticated',$q$update public.market_sessions set status='cancelled' where id='dddddddd-0000-0000-0000-0000000000a1'$q$,'blocked');
select pg_temp.t('S22','organizer moves a stall to another venue','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.stalls set venue_id='bbbbbbbb-0000-0000-0000-000000000002' where id='cccccccc-0000-0000-0000-000000000006'$q$,'blocked');
select pg_temp.t('S23','organizer reassigns venue ownership','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.venues set organizer_id='aaaaaaaa-0000-0000-0000-00000000000a' where id='bbbbbbbb-0000-0000-0000-000000000001'$q$,'blocked');
select pg_temp.t('S24a','ANON reads profiles','00000000-0000-0000-0000-000000000000'::uuid,'anon',$q$select * from public.profiles$q$,'blocked');
select pg_temp.t('S24b','ANON reads bookings','00000000-0000-0000-0000-000000000000'::uuid,'anon',$q$select * from public.bookings$q$,'blocked');
select pg_temp.t('S24c','ANON writes a profile','00000000-0000-0000-0000-000000000000'::uuid,'anon',$q$insert into public.profiles(id,role,full_name) values (gen_random_uuid(),'vendor','x')$q$,'blocked');
select pg_temp.t('S25a','vendor calls internal _notify','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select public._notify('aaaaaaaa-0000-0000-0000-000000000002','x','y','t')$q$,'denied');
select pg_temp.t('S25b','vendor calls verify_vendor','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select public.verify_vendor('aaaaaaaa-0000-0000-0000-000000000002'::uuid,true)$q$,'denied');
select pg_temp.t('S25c','vendor calls booking_end_at on someone else''s booking','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select public.booking_end_at('eeeeeeee-0000-0000-0000-000000000002')$q$,'denied');
select pg_temp.t('S25d','vendor calls payment_apply_result','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select public.payment_apply_result('s','paid','p',1)$q$,'denied');
select pg_temp.t('S26a','vendor reads ANOTHER vendor''s bookings','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select * from public.bookings where vendor_id='aaaaaaaa-0000-0000-0000-000000000002'$q$,'blocked');
select pg_temp.t('S26b','organizer A reads a venue B booking','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$select * from public.bookings where id='eeeeeeee-0000-0000-0000-000000000003'$q$,'blocked');

\echo
\echo ===== MUST STILL WORK: direct writes the app really makes =====
select pg_temp.t('W01a','SIGN-UP: new user inserts own vendor profile','aaaaaaaa-0000-0000-0000-000000000003','authenticated',$q$insert into public.profiles(id,role,full_name) values ('aaaaaaaa-0000-0000-0000-000000000003','vendor','New Vendor')$q$,'rows');
select pg_temp.t('W01b','SIGN-UP: new user inserts own business row','aaaaaaaa-0000-0000-0000-000000000003','authenticated',$q$insert into public.vendor_details(id,business_name) values ('aaaaaaaa-0000-0000-0000-000000000003','New Biz')$q$,'rows');
select pg_temp.t('W02a','NEG sign-up as ORGANIZER','aaaaaaaa-0000-0000-0000-000000000004','authenticated',$q$insert into public.profiles(id,role,full_name) values ('aaaaaaaa-0000-0000-0000-000000000004','organizer','Evil')$q$,'blocked');
insert into public.profiles(id,role,full_name) values ('aaaaaaaa-0000-0000-0000-000000000004','vendor','V4');
select pg_temp.t('W02b','NEG sign-up already verified','aaaaaaaa-0000-0000-0000-000000000004','authenticated',$q$insert into public.vendor_details(id,business_name,is_verified) values ('aaaaaaaa-0000-0000-0000-000000000004','Biz4',true)$q$,'blocked');
select pg_temp.t('W02c','NEG sign-up as someone ELSE','aaaaaaaa-0000-0000-0000-000000000004','authenticated',$q$insert into public.vendor_details(id,business_name) values ('aaaaaaaa-0000-0000-0000-000000000001','steal')$q$,'blocked');
select pg_temp.t('W03','COMPLETE PROFILE: vendor updates own phone','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.profiles set phone='09171234567' where id='aaaaaaaa-0000-0000-0000-000000000001'$q$,'rows');
select pg_temp.t('W04','COMPLETE PROFILE: category/description/permit','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.vendor_details set category='food', description='tasty', business_permit_url='aaaaaaaa-0000-0000-0000-000000000001/permit.jpg' where id='aaaaaaaa-0000-0000-0000-000000000001'$q$,'rows');
select pg_temp.t('W05','SETTINGS: organizer updates own name/phone','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.profiles set full_name='Org One', phone='0917' where id='aaaaaaaa-0000-0000-0000-000000000009'$q$,'rows');
select pg_temp.t('W06','SETTINGS: organizer updates own venue','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.venues set name='Venue A+', address='addr', description='d' where id='bbbbbbbb-0000-0000-0000-000000000001'$q$,'rows');
select pg_temp.t('W07a','SESSIONS: organizer creates a session','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$insert into public.market_sessions(venue_id,friday_date,saturday_date,sunday_date) values ('bbbbbbbb-0000-0000-0000-000000000001',current_date+70,current_date+71,current_date+72)$q$,'rows');
select pg_temp.t('W07b','SESSIONS: organizer edits dates','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.market_sessions set friday_date=current_date+28, saturday_date=current_date+29, sunday_date=current_date+30 where id='dddddddd-0000-0000-0000-0000000000a3'$q$,'rows');
select pg_temp.t('W07c','SESSIONS: organizer changes status','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.market_sessions set status='closed' where id='dddddddd-0000-0000-0000-0000000000a3'$q$,'rows');
select pg_temp.t('W08a','STALLS: organizer adds a stall','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$insert into public.stalls(venue_id,stall_number,size,price_per_day_cents) values ('bbbbbbbb-0000-0000-0000-000000000001','NEW1','3x3',5000)$q$,'rows');
select pg_temp.t('W08b','STALLS: organizer edits price / deactivates','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$update public.stalls set price_per_day_cents=6000, is_active=false, size='4x4', stall_number='S6b' where id='cccccccc-0000-0000-0000-000000000006'$q$,'rows');
select pg_temp.t('W08c','STALLS: organizer deletes an unused stall','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$delete from public.stalls where stall_number='NEW1'$q$,'rows');
select pg_temp.t('W09','NOTIFICATIONS: user marks own notification read','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.notifications set is_read=true where id='99999999-0000-0000-0000-000000000001'$q$,'rows');
select pg_temp.t('W10a','READ: vendor sees own profile','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select * from public.profiles where id='aaaaaaaa-0000-0000-0000-000000000001'$q$,'rows');
select pg_temp.t('W10b','READ: vendor sees own business row','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select * from public.vendor_details where id='aaaaaaaa-0000-0000-0000-000000000001'$q$,'rows');
select pg_temp.t('W10c','READ: organizer sees ALL vendor profiles (verification list)','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$select * from public.profiles where role='vendor'$q$,'rows');
select pg_temp.t('W10d','READ: organizer sees vendor_details with profile embed data','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$select vd.*, p.full_name from public.vendor_details vd join public.profiles p on p.id=vd.id$q$,'rows');
select pg_temp.t('W10e','READ: organizer sees own profile','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$select * from public.profiles where id='aaaaaaaa-0000-0000-0000-000000000009'$q$,'rows');
select pg_temp.t('W11','READ: vendor sees stalls / sessions / venues (public market info)','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select s.id from public.stalls s join public.venues v on v.id=s.venue_id join public.market_sessions m on m.venue_id=v.id$q$,'rows');
select pg_temp.t('W12','READ: vendor sees own bookings','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$select * from public.bookings where vendor_id='aaaaaaaa-0000-0000-0000-000000000001'$q$,'rows');
select pg_temp.t('W13','READ: organizer sees own venue bookings','aaaaaaaa-0000-0000-0000-000000000009','authenticated',$q$select * from public.bookings where id='eeeeeeee-0000-0000-0000-000000000001'$q$,'rows');

\echo
\echo ===== PERMIT CHANGE still resets verification (trigger survives) =====
select pg_temp.t('W14','vendor changes permit -> verification reset','aaaaaaaa-0000-0000-0000-000000000001','authenticated',$q$update public.vendor_details set business_permit_url='aaaaaaaa-0000-0000-0000-000000000001/permit2.jpg' where id='aaaaaaaa-0000-0000-0000-000000000001'$q$,'rows');
select case when (select is_verified from public.vendor_details where id='aaaaaaaa-0000-0000-0000-000000000001')=false then 'PASS' else 'FAIL' end||' | W14b verification was reset by the trigger after the permit change';
update public.vendor_details set is_verified=true where id='aaaaaaaa-0000-0000-0000-000000000001';

\echo
\echo ===== FULL FLOW through the real functions as app roles =====
do $$
declare
  v1 uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; v2 uuid := 'aaaaaaaa-0000-0000-0000-000000000002'; o1 uuid := 'aaaaaaaa-0000-0000-0000-000000000009';
  b1 text; b2 text; r text; st text;
  procedure_ok boolean;
begin
  b1 := pg_temp.scalar(v1,'authenticated',$s$select public.create_booking('cccccccc-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-0000000000a5',array['friday'],false)::text$s$);
  raise notice '% | F01 vendor create_booking [%]', case when b1 like 'ERR%' or b1 is null then 'FAIL' else 'PASS' end, left(coalesce(b1,'null'),90);
  r := pg_temp.scalar(o1,'authenticated', format($s$select public.approve_booking(%L::uuid)::text$s$, b1));
  select status into st from public.bookings where id = b1::uuid;
  raise notice '% | F02 organizer approve_booking -> %  [%]', case when st='approved' then 'PASS' else 'FAIL' end, st, left(coalesce(r,''),80);
  r := pg_temp.scalar(null,'service_role', format($s$select public.payment_register(%L::uuid,'src_flow','gcash',10400)::text$s$, b1));
  r := pg_temp.scalar(null,'service_role', $s$select public.payment_precheck('src_flow',10400)$s$);
  raise notice '% | F03 service role payment_precheck = %', case when r='ok' then 'PASS' else 'FAIL' end, r;
  r := pg_temp.scalar(null,'service_role', $s$select public.payment_apply_result('src_flow','paid','pay_flow',10400)$s$);
  select status into st from public.bookings where id = b1::uuid;
  raise notice '% | F04 payment applied -> booking %  [%]', case when st='paid' then 'PASS' else 'FAIL' end, st, r;
  r := pg_temp.scalar(o1,'authenticated', format($s$select public.check_in_booking(%L::uuid)::text$s$, b1));
  select status into st from public.bookings where id = b1::uuid;
  raise notice '% | F05 organizer check_in_booking -> %  [%]', case when st='checked_in' then 'PASS' else 'FAIL' end, st, left(coalesce(r,''),80);
  r := pg_temp.scalar(o1,'authenticated', format($s$select public.complete_booking(%L::uuid,true,'ok')::text$s$, b1));
  select status into st from public.bookings where id = b1::uuid;
  raise notice '% | F06 organizer complete_booking -> %  [%]', case when st='completed' then 'PASS' else 'FAIL' end, st, left(coalesce(r,''),80);
  r := pg_temp.scalar(v1,'authenticated', format($s$select public.submit_sales(%L::uuid,12345,5,'note',null)::text$s$, b1));
  raise notice '% | F07 vendor submit_sales on completed booking [%]', case when r like 'ERR%' or r is null then 'FAIL' else 'PASS' end, left(coalesce(r,'null'),80);
  b2 := pg_temp.scalar(v2,'authenticated',$s$select public.create_booking('cccccccc-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-0000000000a5',array['friday'],false)::text$s$);
  raise notice '% | F08 unverified vendor create_booking [%]', case when b2 like 'ERR%' or b2 is null then 'FAIL' else 'PASS' end, left(coalesce(b2,'null'),80);
  r := pg_temp.scalar(v2,'authenticated', format($s$select public.cancel_booking(%L::uuid)::text$s$, b2));
  select status into st from public.bookings where id = b2::uuid;
  raise notice '% | F09 vendor cancel_booking -> %  [%]', case when st='cancelled' then 'PASS' else 'FAIL' end, st, left(coalesce(r,''),80);
  r := pg_temp.scalar(o1,'authenticated',$s$select public.verify_vendor('aaaaaaaa-0000-0000-0000-000000000002'::uuid,true)::text$s$);
  raise notice '% | F10 organizer verify_vendor -> is_verified=%', case when (select is_verified from public.vendor_details where id=v2) then 'PASS' else 'FAIL' end, (select is_verified from public.vendor_details where id=v2);
  b2 := pg_temp.scalar(v2,'authenticated',$s$select public.create_booking('cccccccc-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-0000000000a5',array['saturday'],false)::text$s$);
  r := pg_temp.scalar(o1,'authenticated', format($s$select public.reject_booking(%L::uuid,'nope')::text$s$, b2));
  select status into st from public.bookings where id = b2::uuid;
  raise notice '% | F11 organizer reject_booking -> %  [%]', case when st='rejected' then 'PASS' else 'FAIL' end, st, left(coalesce(r,''),80);
  r := pg_temp.scalar(v1,'authenticated',$s$select count(*)::text from public.stall_availability('dddddddd-0000-0000-0000-0000000000a5')$s$);
  raise notice '% | F12 vendor stall_availability rows=%', case when r not like 'ERR%' then 'PASS' else 'FAIL' end, r;
  r := pg_temp.scalar(v1,'authenticated',$s$select public.expire_stale_bookings()::text$s$);
  raise notice '% | F13 vendor can NOT run expire_stale_bookings any more (cron does it; migration 600) [%]', case when r like 'ERR%' then 'PASS' else 'FAIL' end, left(coalesce(r,'ok'),60);
  raise notice '% | F14 sales row exists and notifications were created server-side (%, %)',
    case when (select count(*) from public.sales_submissions where booking_id=b1::uuid)=1 and (select count(*) from public.notifications where recipient_id=v1)>=2 then 'PASS' else 'FAIL' end,
    (select count(*) from public.sales_submissions where booking_id=b1::uuid), (select count(*) from public.notifications where recipient_id=v1);
end $$;

rollback;
