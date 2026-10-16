-- =====================================================================
-- Batch 3: push notifications - device tokens
--
-- One table (push_tokens) holds the Expo push token of each phone a vendor
-- is signed in on. The app never reads or writes the table directly:
-- it calls two functions.
--
--   register_push_token(p_token, p_platform)  save/move this phone's token to the caller
--   unregister_push_token(p_token)            remove this phone's token (called on logout)
--
-- Safety:
--   * RLS is ON and there are NO policies, so apps cannot touch the table.
--   * Only the Edge Function send-push (service_role) can read/delete tokens.
--   * A token belongs to ONE user. If another user signs in on the same phone,
--     register_push_token moves the token to them (the old user stops getting pushes).
--   * unregister only removes the CALLER's own token.
--   * Closed to anon and service_role. Safe to run twice.
--
-- ROLLBACK (comment):
--   drop function if exists public.register_push_token(text, text);
--   drop function if exists public.unregister_push_token(text);
--   drop table if exists public.push_tokens;
-- =====================================================================

create table if not exists public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null unique,
  platform   text not null default 'android',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_platform_check check (platform in ('android', 'ios')),
  constraint push_tokens_token_check check (token like 'ExponentPushToken[%]' or token like 'ExpoPushToken[%]')
);

create index if not exists idx_push_tokens_user on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
-- no policies on purpose: only the functions below and service_role can reach it
revoke all on table public.push_tokens from public, anon, authenticated;
grant select, delete on table public.push_tokens to service_role;

create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if p_token is null
     or not (p_token like 'ExponentPushToken[%]' or p_token like 'ExpoPushToken[%]') then
    raise exception 'invalid push token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;

  insert into public.push_tokens (user_id, token, platform)
  values (v_uid, p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from public.push_tokens where token = p_token and user_id = v_uid;
end;
$$;

revoke all on function public.register_push_token(text, text)  from public, anon, service_role;
revoke all on function public.unregister_push_token(text)      from public, anon, service_role;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text)     to authenticated;
