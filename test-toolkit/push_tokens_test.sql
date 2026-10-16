-- Batch 3: push_tokens + register/unregister functions. Run after migration 20261016000100. Rolls back.
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

insert into auth.users(id,email) select pg_temp.u(n),'u'||n||'@x' from generate_series(1,2) n;
insert into public.profiles(id,role,full_name) select pg_temp.u(n),'vendor','P'||n from generate_series(1,2) n;

-- 1 register works and saves the caller as owner
select pg_temp.as_(pg_temp.u(1),'authenticated',$$select public.register_push_token('ExponentPushToken[aaa]','android')::text$$);
select pg_temp.ck('P1','vendor 1 registers a token', (select user_id=pg_temp.u(1) from public.push_tokens where token='ExponentPushToken[aaa]'));
-- 2 registering twice keeps ONE row
select pg_temp.as_(pg_temp.u(1),'authenticated',$$select public.register_push_token('ExponentPushToken[aaa]','android')::text$$);
select pg_temp.ck('P2','same token twice = one row', (select count(*)=1 from public.push_tokens where token='ExponentPushToken[aaa]'));
-- 3 another user on the same phone takes the token over
select pg_temp.as_(pg_temp.u(2),'authenticated',$$select public.register_push_token('ExponentPushToken[aaa]','android')::text$$);
select pg_temp.ck('P3','token moves to the new user', (select user_id=pg_temp.u(2) and (select count(*) from public.push_tokens)=1 from public.push_tokens where token='ExponentPushToken[aaa]'));
-- 4 user 1 cannot delete user 2's token
select pg_temp.as_(pg_temp.u(1),'authenticated',$$select public.unregister_push_token('ExponentPushToken[aaa]')::text$$);
select pg_temp.ck('P4','user 1 cannot remove user 2 token', (select count(*)=1 from public.push_tokens where token='ExponentPushToken[aaa]'));
-- 5 owner removes own token
select pg_temp.as_(pg_temp.u(2),'authenticated',$$select public.unregister_push_token('ExponentPushToken[aaa]')::text$$);
select pg_temp.ck('P5','owner removes own token', (select count(*)=0 from public.push_tokens));
-- 6 bad token / bad platform / null rejected
select pg_temp.ck('P6','garbage token rejected', pg_temp.as_(pg_temp.u(1),'authenticated',$$select public.register_push_token('hello','android')::text$$) like 'ERR 22023%');
select pg_temp.ck('P7','null token rejected', pg_temp.as_(pg_temp.u(1),'authenticated',$$select public.register_push_token(null,'android')::text$$) like 'ERR 22023%');
select pg_temp.ck('P8','bad platform rejected', pg_temp.as_(pg_temp.u(1),'authenticated',$$select public.register_push_token('ExponentPushToken[b]','web')::text$$) like 'ERR 22023%');
-- 9 anon / service_role cannot call
select pg_temp.ck('P9','anon cannot register', pg_temp.as_(null,'anon',$$select public.register_push_token('ExponentPushToken[c]','android')::text$$) like 'ERR 42501%');
select pg_temp.ck('P10','anon cannot unregister', pg_temp.as_(null,'anon',$$select public.unregister_push_token('ExponentPushToken[c]')::text$$) like 'ERR 42501%');
select pg_temp.ck('P11','service_role cannot register', pg_temp.as_(pg_temp.u(1),'service_role',$$select public.register_push_token('ExponentPushToken[c]','android')::text$$) like 'ERR 42501%');
-- 12 signed-in user without a profile rejected
select pg_temp.ck('P12','no profile = rejected', pg_temp.as_(gen_random_uuid(),'authenticated',$$select public.register_push_token('ExponentPushToken[d]','android')::text$$) like 'ERR P0002%');
-- 13 app roles cannot read or write the table directly
select pg_temp.as_(pg_temp.u(1),'authenticated',$$select public.register_push_token('ExponentPushToken[e]','android')::text$$);
select pg_temp.ck('P13','vendor cannot SELECT table', pg_temp.as_(pg_temp.u(1),'authenticated',$$select count(*)::text from public.push_tokens$$) like 'ERR 42501%');
select pg_temp.ck('P14','vendor cannot INSERT table', pg_temp.as_(pg_temp.u(1),'authenticated',$$insert into public.push_tokens(user_id,token) values (gen_random_uuid(),'ExponentPushToken[z]') returning 'x'$$) like 'ERR 42501%');
select pg_temp.ck('P15','vendor cannot DELETE table', pg_temp.as_(pg_temp.u(1),'authenticated',$$delete from public.push_tokens returning 'x'$$) like 'ERR 42501%');
select pg_temp.ck('P16','anon cannot SELECT table', pg_temp.as_(null,'anon',$$select count(*)::text from public.push_tokens$$) like 'ERR 42501%');
-- 17 service_role (the Edge Function) can read tokens
select pg_temp.ck('P17','service_role can read tokens', pg_temp.as_(pg_temp.u(1),'service_role',$$select count(*)::text from public.push_tokens$$) = '1');
rollback;