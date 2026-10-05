-- =====================================================================
-- Batch D2 (part 1): scheduled jobs (pg_cron)
--
-- Four internal functions, run by pg_cron as the database owner:
--   cron_expire_stale_bookings()  every 5 min  pending/approved holds that ran out -> expired
--   cron_mark_no_shows()          every 10 min paid, never checked in, last day over -> no_show
--   cron_complete_checked_in()    every 10 min checked_in, 12 h after last day ended -> completed
--   cron_close_sessions()         every 10 min upcoming/open sessions whose last day ended -> closed
--
-- Each function writes an audit event (actor_role 'system') and a notification,
-- and is safe to run twice (the second run finds nothing to do).
-- Nobody can call these from the app: execute is revoked from public, anon,
-- authenticated and service_role.
--
-- NOT in this file: revoking expire_stale_bookings from the app (that is
-- migration 20261001000600, applied AFTER the 3 app call sites are removed).
--
-- ROLLBACK (comment):
--   select cron.unschedule(jobid) from cron.job where jobname like 'vendordash-%';
--   drop function if exists public.cron_expire_stale_bookings();
--   drop function if exists public.cron_mark_no_shows();
--   drop function if exists public.cron_complete_checked_in();
--   drop function if exists public.cron_close_sessions();
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Expire lapsed holds
--    A booking with a payment in progress (processing, started < 30 min ago)
--    is skipped for now and handled on a later run. Stale 'processing'
--    payments of an expired booking are marked failed.
-- ---------------------------------------------------------------------
create or replace function public.cron_expire_stale_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select b.id, b.vendor_id, b.session_id, b.status, s.stall_number
      from public.bookings b
      join public.stalls s on s.id = b.stall_id
     where b.status in ('pending', 'approved')
       and b.reservation_expires_at is not null
       and b.reservation_expires_at < now()
       and not exists (
         select 1 from public.payments p
          where p.booking_id = b.id
            and p.status = 'processing'
            and p.created_at > now() - interval '30 minutes'
       )
       for update of b skip locked
  loop
    update public.bookings set status = 'expired' where id = r.id;

    update public.payments
       set status = 'failed'
     where booking_id = r.id and status = 'processing';

    perform public._log_booking_event(r.id, r.session_id, null, 'system',
      'expired', r.status, 'expired',
      case when r.status = 'pending'
           then 'Not approved before the request time ran out.'
           else 'Not paid before the payment deadline.' end);

    perform public._notify(r.vendor_id, 'Reservation expired',
      case when r.status = 'pending'
           then format('Your request for stall %s was not approved in time, so it was released.', r.stall_number)
           else format('Stall %s was not paid for in time, so your reservation was released.', r.stall_number) end,
      'booking_expired');

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) No-shows: paid, never checked in, and the vendor's last booked day is over.
--    A booking with an open refund request is left alone until the organizer
--    decides (approve_refund needs the booking to still be 'paid').
-- ---------------------------------------------------------------------
create or replace function public.cron_mark_no_shows()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select b.id, b.vendor_id, b.session_id, s.stall_number,
           v.organizer_id, coalesce(p.full_name, 'A vendor') as vendor_name
      from public.bookings b
      join public.stalls s on s.id = b.stall_id
      join public.venues v on v.id = s.venue_id
      left join public.profiles p on p.id = b.vendor_id
     where b.status = 'paid'
       and public.booking_end_at(b.id) < now()
       and not exists (
         select 1 from public.refund_requests rr
          where rr.booking_id = b.id and rr.status = 'requested'
       )
       for update of b skip locked
  loop
    update public.bookings set status = 'no_show' where id = r.id;

    perform public._log_booking_event(r.id, r.session_id, null, 'system',
      'no_show', 'paid', 'no_show', 'Paid but never checked in before the last booked day ended.');

    perform public._notify(r.vendor_id, 'Marked as no-show',
      format('You paid for stall %s but were not checked in on your booked days, so the booking was marked as a no-show.', r.stall_number),
      'booking_no_show');

    perform public._notify(r.organizer_id, 'Vendor did not check in',
      format('%s (stall %s) paid but was never checked in. The booking was marked as a no-show.', r.vendor_name, r.stall_number),
      'booking_no_show');

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Auto-complete: checked_in bookings, 12 hours after the last booked day ended.
--    completed_by stays null (nobody pressed the button); the note says why.
-- ---------------------------------------------------------------------
create or replace function public.cron_complete_checked_in()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select b.id, b.vendor_id, b.session_id, s.stall_number
      from public.bookings b
      join public.stalls s on s.id = b.stall_id
     where b.status = 'checked_in'
       and public.booking_end_at(b.id) + interval '12 hours' < now()
       for update of b skip locked
  loop
    update public.bookings
       set status = 'completed',
           completed_at = now(),
           completed_by = null,
           completed_early = false,
           completion_note = 'Auto-completed 12 hours after the market ended.'
     where id = r.id;

    perform public._log_booking_event(r.id, r.session_id, null, 'system',
      'auto_completed', 'checked_in', 'completed', 'Auto-completed 12 hours after the market ended.');

    perform public._notify(r.vendor_id, 'Market day complete',
      format('You can now submit your sales for stall %s.', r.stall_number),
      'booking_completed');

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Close sessions whose last day has ended (venue timezone).
--    Only upcoming/open change. completed/cancelled stay organizer-driven.
-- ---------------------------------------------------------------------
create or replace function public.cron_close_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.market_sessions ms
     set status = 'closed'
    from public.venues v
   where v.id = ms.venue_id
     and ms.status in ('upcoming', 'open')
     and ((greatest(ms.friday_date, ms.saturday_date, ms.sunday_date) + ms.end_time)
            at time zone v.timezone) < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Lock the functions down: default privileges in this project grant EXECUTE
-- to anon/authenticated/service_role on new functions, so revoke explicitly.
-- (pg_cron runs as the owner, postgres, which keeps access.)
-- ---------------------------------------------------------------------
revoke all on function public.cron_expire_stale_bookings() from public, anon, authenticated, service_role;
revoke all on function public.cron_mark_no_shows()         from public, anon, authenticated, service_role;
revoke all on function public.cron_complete_checked_in()   from public, anon, authenticated, service_role;
revoke all on function public.cron_close_sessions()        from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Schedule (only where pg_cron exists). cron.schedule with a job name
-- replaces a job of the same name, so running this file twice is safe.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('vendordash-expire-holds',   '*/5 * * * *',  'select public.cron_expire_stale_bookings()');
    perform cron.schedule('vendordash-mark-no-shows',  '*/10 * * * *', 'select public.cron_mark_no_shows()');
    perform cron.schedule('vendordash-auto-complete',  '*/10 * * * *', 'select public.cron_complete_checked_in()');
    perform cron.schedule('vendordash-close-sessions', '*/10 * * * *', 'select public.cron_close_sessions()');
  else
    raise notice 'pg_cron is not installed: functions were created but NOT scheduled.';
  end if;
end;
$$;
