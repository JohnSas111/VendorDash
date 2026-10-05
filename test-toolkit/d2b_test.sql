-- Batch D2 part 2 tests: run AFTER migration 20261001000600. Rolls back.
\set ON_ERROR_STOP off
set client_min_messages = notice;
begin;
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
insert into auth.users(id,email) values ('a0000000-0000-0000-0000-000000000001','v@x'),('a0000000-0000-0000-0000-000000000009','o@x');
insert into public.profiles(id,role,full_name) values ('a0000000-0000-0000-0000-000000000001','vendor','V'),('a0000000-0000-0000-0000-000000000009','organizer','O');
select pg_temp.t('R01','anon cannot run old sweeper',null,'anon',$q$select public.expire_stale_bookings()$q$,'denied');
select pg_temp.t('R02','vendor cannot run old sweeper','a0000000-0000-0000-0000-000000000001','authenticated',$q$select public.expire_stale_bookings()$q$,'denied');
select pg_temp.t('R03','organizer cannot run old sweeper','a0000000-0000-0000-0000-000000000009','authenticated',$q$select public.expire_stale_bookings()$q$,'denied');
select pg_temp.t('R04','service_role (server side) still can',null,'service_role',$q$select public.expire_stale_bookings()$q$,'ok');
select pg_temp.t('R05','the new cron functions are still closed to vendor','a0000000-0000-0000-0000-000000000001','authenticated',$q$select public.cron_expire_stale_bookings()$q$,'denied');
select pg_temp.t('R06','vendor can still use stall_availability (app needs it)','a0000000-0000-0000-0000-000000000001','authenticated',$q$select * from public.stall_availability('d0000000-0000-0000-0000-000000000099')$q$,'ok');
rollback;
