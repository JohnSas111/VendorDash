-- D2 live demo: makes FAKE data, runs the 4 jobs, shows PASS/FAIL, then undoes everything.
-- It ends with an "error" ON PURPOSE: that error is what cancels (rolls back) all the fake data.
-- Uses your real organizer and vendor (Seafoods) ids only to own the fake rows.
do $$
declare
  v_org  uuid := '080c9331-f370-4d56-9c3c-705978eb9c03';
  v_ven  uuid := '7dd962fe-82e7-43c7-a151-dc20197047a5';
  venue  uuid := gen_random_uuid();
  stall  uuid := gen_random_uuid();
  tz     text := 'Asia/Manila';
  d      date := (now() at time zone 'Asia/Manila')::date;
  tg     timestamp := (now() at time zone 'Asia/Manila') - interval '5 hours';
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); s4 uuid := gen_random_uuid();
  s5 uuid := gen_random_uuid(); s6 uuid := gen_random_uuid(); s7 uuid := gen_random_uuid(); s8 uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid(); b4 uuid := gen_random_uuid();
  b5 uuid := gen_random_uuid(); b6 uuid := gen_random_uuid(); b7 uuid := gen_random_uuid();
  a1 int; a2 int; a3 int; a4 int;     -- first run
  c1 int; c2 int; c3 int; c4 int;     -- second run (must be all 0)
  res text; ev int; nt int; sess text;
begin
  if not exists (select 1 from public.profiles where id = v_org and role = 'organizer')
     or not exists (select 1 from public.profiles where id = v_ven and role = 'vendor') then
    raise exception 'STOP: the organizer or vendor id in this script is not in your profiles table. Nothing was changed.';
  end if;

  -- fake venue + stall
  insert into public.venues(id, organizer_id, name, address, timezone) values (venue, v_org, 'D2 TEST VENUE', 'x', tz);
  insert into public.stalls(id, venue_id, stall_number, price_per_day_cents) values (stall, venue, 'D2-TEST', 500);

  -- fake sessions
  -- s1,s2,s3,s5,s8 = in the future | s4,s6 = ended 10 days ago | s7 = last day ended 5 hours ago
  insert into public.market_sessions(id, venue_id, friday_date, saturday_date, sunday_date, status, start_time, end_time) values
    (s1, venue, d+14, d+15, d+16, 'open', '00:00', '23:59'),
    (s2, venue, d+14, d+15, d+16, 'open', '00:00', '23:59'),
    (s3, venue, d+14, d+15, d+16, 'open', '00:00', '23:59'),
    (s5, venue, d+14, d+15, d+16, 'open', '00:00', '23:59'),
    (s8, venue, d+14, d+15, d+16, 'open', '00:00', '23:59'),
    (s4, venue, d-10, d-9,  d-8,  'open', '17:00', '22:00'),
    (s6, venue, d-10, d-9,  d-8,  'open', '17:00', '22:00'),
    (s7, venue, tg::date-2, tg::date-1, tg::date, 'open', '00:00', tg::time);

  -- fake bookings (one per session, all for the same vendor)
  insert into public.bookings(id, vendor_id, stall_id, session_id, attending_days, status, reservation_expires_at, payment_due_at) values
    (b1, v_ven, stall, s1, '{friday}', 'pending',    now() - interval '1 hour', null),
    (b2, v_ven, stall, s2, '{friday}', 'approved',   now() - interval '1 hour', now() - interval '1 hour'),
    (b3, v_ven, stall, s3, '{friday}', 'pending',    now() + interval '5 hours', null),
    (b4, v_ven, stall, s4, '{friday}', 'paid',       null, null),
    (b5, v_ven, stall, s5, '{friday}', 'paid',       null, null),
    (b6, v_ven, stall, s6, '{friday}', 'checked_in', null, null),
    (b7, v_ven, stall, s7, '{sunday}', 'checked_in', null, null);

  -- run the four jobs, then run them AGAIN (second run must do nothing)
  a1 := public.cron_expire_stale_bookings(); a2 := public.cron_mark_no_shows();
  a3 := public.cron_complete_checked_in();   a4 := public.cron_close_sessions();
  c1 := public.cron_expire_stale_bookings(); c2 := public.cron_mark_no_shows();
  c3 := public.cron_complete_checked_in();   c4 := public.cron_close_sessions();

  select string_agg(format('%s  %-44s -> %-10s (expected %s)',
           case when x.status = e.expect then 'PASS' else 'FAIL' end, e.label, x.status, e.expect), E'\n' order by e.n)
    into res
    from (values
      (1,'b1 pending, hold ran out',                 b1,'expired'),
      (2,'b2 approved, not paid in time',            b2,'expired'),
      (3,'b3 pending, still has time',               b3,'pending'),
      (4,'b4 paid, market ended 10 days ago',        b4,'no_show'),
      (5,'b5 paid, market is in the future',         b5,'paid'),
      (6,'b6 checked in, ended 10 days ago',         b6,'completed'),
      (7,'b7 checked in, ended only 5 hours ago',    b7,'checked_in')
    ) e(n,label,id,expect)
    join public.bookings x on x.id = e.id;

  select string_agg(format('%s  session %s -> %-6s (expected %s)',
           case when x.status = e.expect then 'PASS' else 'FAIL' end, e.label, x.status, e.expect), E'\n' order by e.n)
    into sess
    from (values
      (1,'s1 future',                   s1,'open'),
      (2,'s4 ended 10 days ago',        s4,'closed'),
      (3,'s6 ended 10 days ago',        s6,'closed'),
      (4,'s7 last day ended 5h ago',    s7,'closed'),
      (5,'s8 future, no bookings',      s8,'open')
    ) e(n,label,id,expect)
    join public.market_sessions x on x.id = e.id;

  select count(*) into ev from public.booking_events where booking_id in (b1,b2,b3,b4,b5,b6,b7) and actor_role = 'system';
  select count(*) into nt from public.notifications where created_at >= now() and recipient_id in (v_ven, v_org);

  raise exception E'\n===== D2 DEMO RESULT (everything below is UNDONE, nothing saved) =====\n\nFirst run  : expired=% (expect 2), no_shows=% (expect 1), completed=% (expect 1), closed=% (expect 3)\nSecond run : % % % %  (expect 0 0 0 0)\n\nBOOKINGS\n%\n\nSESSIONS\n%\n\nAudit events written by the system: % (expect 4)\nNotifications written: % (expect 5: 2 expiry + 2 no-show + 1 complete)\n',
    a1, a2, a3, a4, c1, c2, c3, c4, res, sess, ev, nt;
end $$;
