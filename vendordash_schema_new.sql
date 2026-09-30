


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."_log_booking_event"("p_booking" "uuid", "p_session" "uuid", "p_actor" "uuid", "p_role" "text", "p_action" "text", "p_from" "text", "p_to" "text", "p_note" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  insert into public.booking_events
    (booking_id, session_id, actor_id, actor_role, action, from_status, to_status, note)
  values
    (p_booking, p_session, p_actor, p_role, p_action, p_from, p_to, p_note);
$$;


ALTER FUNCTION "public"."_log_booking_event"("p_booking" "uuid", "p_session" "uuid", "p_actor" "uuid", "p_role" "text", "p_action" "text", "p_from" "text", "p_to" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_notify"("p_recipient" "uuid", "p_title" "text", "p_body" "text", "p_type" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  insert into public.notifications (recipient_id, title, body, type)
  values (p_recipient, p_title, p_body, p_type);
$$;


ALTER FUNCTION "public"."_notify"("p_recipient" "uuid", "p_title" "text", "p_body" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_require_role"("p_role" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  if not exists (
    select 1 from public.profiles where id = v_uid and role = p_role
  ) then
    raise exception 'This action is only available to % accounts.', p_role;
  end if;
  return v_uid;
end;
$$;


ALTER FUNCTION "public"."_require_role"("p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_booking"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := public._require_role('organizer');
  v_b   record;
  v_end timestamptz;
  v_due timestamptz;
begin
  select b.id, b.vendor_id, b.status, b.session_id, b.reservation_expires_at,
         s.stall_number, v.organizer_id, v.timezone
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
    join public.venues v on v.id = s.venue_id
    join public.market_sessions ms
      on ms.id = b.session_id and ms.venue_id = s.venue_id
   where b.id = p_booking_id
     for update of b;

  if not found or v_b.organizer_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'pending' then
    raise exception 'Only pending bookings can be approved (current status: %).', v_b.status;
  end if;
  if v_b.reservation_expires_at is not null and v_b.reservation_expires_at < now() then
    raise exception 'This request has expired.';
  end if;
  if not exists (
    select 1 from public.vendor_details
     where id = v_b.vendor_id and is_verified = true
  ) then
    raise exception 'This vendor is not verified yet.';
  end if;

  v_end := public.booking_end_at(p_booking_id);
  if v_end is null or v_end <= now() then
    raise exception 'The booked market days have already ended.';
  end if;

  v_due := least(now() + interval '24 hours', v_end);

  update public.bookings
     set status = 'approved',
         decided_at = now(),
         payment_due_at = v_due,
         reservation_expires_at = v_due
   where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'organizer',
                                    'approved', 'pending', 'approved', null);
  perform public._notify(v_b.vendor_id, 'Booking approved!',
    format('Stall %s is approved. Please pay by %s.',
           v_b.stall_number,
           to_char(v_due at time zone v_b.timezone, 'Mon DD, HH12:MI AM')),
    'booking_approved');
end;
$$;


ALTER FUNCTION "public"."approve_booking"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_refund"("p_request_id" "uuid", "p_note" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid     uuid := public._require_role('organizer');
  v_r       record;
  v_bstatus text;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is not null and length(v_note) > 500 then
    raise exception 'Note is too long (500 characters max).';
  end if;

  select r.id, r.status, r.booking_id, r.vendor_id,
         b.session_id, s.stall_number, v.organizer_id
    into v_r
    from public.refund_requests r
    join public.bookings b on b.id = r.booking_id
    join public.stalls   s on s.id = b.stall_id
    join public.venues   v on v.id = s.venue_id
   where r.id = p_request_id
     for update of r;

  if not found or v_r.organizer_id <> v_uid then
    raise exception 'Refund request not found.';
  end if;
  if v_r.status <> 'requested' then
    raise exception 'Only open requests can be approved (current status: %).', v_r.status;
  end if;

  select status into v_bstatus
    from public.bookings where id = v_r.booking_id for update;
  if v_bstatus <> 'paid' then
    raise exception 'This booking is no longer in the paid state (current status: %). Undo the check-in first, or reject the request.', v_bstatus;
  end if;

  update public.refund_requests
     set status = 'approved',
         decision_comment = v_note,
         decided_by = v_uid,
         decided_at = now(),
         updated_at = now()
   where id = p_request_id;

  update public.bookings
     set status = 'cancelled', refund_requested = false
   where id = v_r.booking_id;

  perform public._log_booking_event(v_r.booking_id, v_r.session_id, v_uid, 'organizer',
                                    'refund_approved', 'paid', 'cancelled', v_note);
  perform public._notify(v_r.vendor_id, 'Refund approved',
    format('Your refund request for stall %s was approved. Please bring a valid ID to the organizer to receive your refund.%s',
           v_r.stall_number,
           case when v_note is null then '' else ' Note: ' || v_note end),
    'refund_approved');
end;
$$;


ALTER FUNCTION "public"."approve_refund"("p_request_id" "uuid", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booking_end_at"("p_booking_id" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select (
    (case
       when 'sunday'   = any (b.attending_days) then s.sunday_date
       when 'saturday' = any (b.attending_days) then s.saturday_date
       when 'friday'   = any (b.attending_days) then s.friday_date
     end + s.end_time)
    at time zone v.timezone
  )
  from public.bookings b
  join public.market_sessions s on s.id = b.session_id
  join public.venues v          on v.id = s.venue_id
  where b.id = p_booking_id;
$$;


ALTER FUNCTION "public"."booking_end_at"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := public._require_role('vendor');
  v_b   record;
begin
  select b.id, b.vendor_id, b.status, b.session_id, s.stall_number
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
   where b.id = p_booking_id
     for update of b;

  if not found or v_b.vendor_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status not in ('pending', 'approved') then
    raise exception 'Only unpaid reservations can be cancelled. For a paid booking, request a refund instead.';
  end if;
  if exists (
    select 1 from public.payments
     where booking_id = p_booking_id
       and status = 'processing'
       and created_at > now() - interval '30 minutes'
  ) then
    raise exception 'A payment for this booking is in progress. Please wait a few minutes and try again.';
  end if;

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'vendor',
                                    'cancelled', v_b.status, 'cancelled', null);
end;
$$;


ALTER FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_in_booking"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := public._require_role('organizer');
  v_b   record;
  v_ok  boolean;
begin
  select b.id, b.vendor_id, b.status, b.session_id, b.attending_days,
         s.stall_number, v.organizer_id, v.timezone,
         ms.status as session_status,
         ms.friday_date, ms.saturday_date, ms.sunday_date,
         ms.start_time, ms.end_time
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
    join public.venues v on v.id = s.venue_id
    join public.market_sessions ms
      on ms.id = b.session_id and ms.venue_id = s.venue_id
   where b.id = p_booking_id
     for update of b;

  if not found or v_b.organizer_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status = 'checked_in' then
    raise exception 'This vendor is already checked in.';
  end if;
  if v_b.status <> 'paid' then
    raise exception 'Only paid bookings can be checked in (current status: %).', v_b.status;
  end if;
  if v_b.session_status not in ('upcoming', 'open') then
    raise exception 'This market session is not active.';
  end if;

  select exists (
    select 1
      from unnest(v_b.attending_days) as u(day)
      cross join lateral (
        select case u.day
                 when 'friday'   then v_b.friday_date
                 when 'saturday' then v_b.saturday_date
                 when 'sunday'   then v_b.sunday_date
               end as dt
      ) x
     where now() >= ((x.dt + v_b.start_time) at time zone v_b.timezone) - interval '2 hours'
       and now() <= ((x.dt + v_b.end_time)   at time zone v_b.timezone)
  ) into v_ok;

  if not v_ok then
    raise exception 'Check-in is only allowed on the vendor''s booked days, from 2 hours before opening until closing.';
  end if;

  update public.bookings
     set status = 'checked_in', checked_in_at = now()
   where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'organizer',
                                    'checked_in', 'paid', 'checked_in', null);
  perform public._notify(v_b.vendor_id, 'You''re checked in',
    format('You were checked in at stall %s. Have a great market!', v_b.stall_number),
    'checked_in');
end;
$$;


ALTER FUNCTION "public"."check_in_booking"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_booking"("p_booking_id" "uuid", "p_early" boolean DEFAULT false, "p_note" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid  uuid := public._require_role('organizer');
  v_b    record;
  v_end  timestamptz;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_early boolean := false;
begin
  select b.id, b.vendor_id, b.status, b.session_id,
         s.stall_number, v.organizer_id, v.timezone
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
    join public.venues v on v.id = s.venue_id
    join public.market_sessions ms
      on ms.id = b.session_id and ms.venue_id = s.venue_id
   where b.id = p_booking_id
     for update of b;

  if not found or v_b.organizer_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'checked_in' then
    raise exception 'Only checked-in vendors can be completed (current status: %).', v_b.status;
  end if;

  v_end := public.booking_end_at(p_booking_id);
  if v_end is null then
    raise exception 'Could not determine when this booking ends.';
  end if;

  if now() < v_end then
    if not coalesce(p_early, false) or v_note is null or length(v_note) < 3 then
      raise exception 'This vendor''s booked days have not ended yet (ends %). To complete early, confirm and give a reason.',
        to_char(v_end at time zone v_b.timezone, 'Dy Mon DD, HH12:MI AM');
    end if;
    v_early := true;
  end if;

  update public.bookings
     set status = 'completed',
         completed_at = now(),
         completed_by = v_uid,
         completed_early = v_early,
         completion_note = case when v_early then v_note else v_note end
   where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'organizer',
                                    case when v_early then 'completed_early' else 'completed' end,
                                    'checked_in', 'completed', v_note);
  perform public._notify(v_b.vendor_id, 'Market day complete',
    format('You can now submit your sales for stall %s.', v_b.stall_number),
    'booking_completed');
end;
$$;


ALTER FUNCTION "public"."complete_booking"("p_booking_id" "uuid", "p_early" boolean, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_ready_bookings"("p_session_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid   uuid := public._require_role('organizer');
  v_count integer := 0;
begin
  if not exists (
    select 1
      from public.market_sessions ms
      join public.venues v on v.id = ms.venue_id
     where ms.id = p_session_id and v.organizer_id = v_uid
  ) then
    raise exception 'Session not found.';
  end if;

  with done as (
    update public.bookings b
       set status = 'completed',
           completed_at = now(),
           completed_by = v_uid,
           completed_early = false
      from public.stalls s, public.market_sessions ms
     where s.id = b.stall_id
       and ms.id = b.session_id
       and ms.venue_id = s.venue_id
       and ms.id = p_session_id
       and b.status = 'checked_in'
       and public.booking_end_at(b.id) <= now()
    returning b.id as bk_id, b.session_id as sess_id, b.vendor_id as vend_id, s.stall_number as stall_no
  ),
  ev as (
    insert into public.booking_events
      (booking_id, session_id, actor_id, actor_role, action, from_status, to_status, note)
    select bk_id, sess_id, v_uid, 'organizer', 'completed', 'checked_in', 'completed', 'bulk complete'
      from done
    returning 1
  )
  insert into public.notifications (recipient_id, title, body, type)
  select vend_id, 'Market day complete',
         format('You can now submit your sales for stall %s.', stall_no),
         'booking_completed'
    from done;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."complete_ready_bookings"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_refund_paid"("p_request_id" "uuid", "p_amount_cents" integer, "p_id_verified" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid  uuid := public._require_role('organizer');
  v_r    record;
  v_paid integer;
begin
  if not coalesce(p_id_verified, false) then
    raise exception 'Confirm that you checked the vendor''s valid ID before recording the refund.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter the refund amount.';
  end if;

  select r.id, r.status, r.booking_id, r.vendor_id,
         b.session_id, s.stall_number, v.organizer_id
    into v_r
    from public.refund_requests r
    join public.bookings b on b.id = r.booking_id
    join public.stalls   s on s.id = b.stall_id
    join public.venues   v on v.id = s.venue_id
   where r.id = p_request_id
     for update of r;

  if not found or v_r.organizer_id <> v_uid then
    raise exception 'Refund request not found.';
  end if;
  if v_r.status <> 'approved' then
    raise exception 'Only approved requests can be paid out (current status: %).', v_r.status;
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments
   where booking_id = v_r.booking_id and status = 'paid';
  if v_paid <= 0 then
    raise exception 'No completed payment found for this booking.';
  end if;
  if p_amount_cents > v_paid then
    raise exception 'The refund cannot be more than the amount paid (PHP %).',
      to_char(v_paid / 100.0, 'FM999,999,990.00');
  end if;

  update public.refund_requests
     set status = 'refunded',
         refund_amount_cents = p_amount_cents,
         id_verified = true,
         refunded_by = v_uid,
         refunded_at = now(),
         updated_at = now()
   where id = p_request_id;

  update public.payments
     set status = 'refunded'
   where booking_id = v_r.booking_id and status = 'paid';

  perform public._log_booking_event(v_r.booking_id, v_r.session_id, v_uid, 'organizer',
                                    'refund_paid', 'cancelled', 'cancelled',
                                    format('PHP %s handed over, ID verified',
                                           to_char(p_amount_cents / 100.0, 'FM999,999,990.00')));
  perform public._notify(v_r.vendor_id, 'Refund completed',
    format('Your refund of PHP %s for stall %s has been recorded as paid out.',
           to_char(p_amount_cents / 100.0, 'FM999,999,990.00'), v_r.stall_number),
    'refund_paid');
end;
$$;


ALTER FUNCTION "public"."confirm_refund_paid"("p_request_id" "uuid", "p_amount_cents" integer, "p_id_verified" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_booking"("p_stall_id" "uuid", "p_session_id" "uuid", "p_attending_days" "text"[], "p_is_recurring" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid       uuid := public._require_role('vendor');
  v_verified  boolean;
  v_permit    boolean;
  v_days      text[];
  v_session   record;
  v_stall     record;
  v_existing  record;
  v_last      date;
  v_end       timestamptz;
  v_holds     int;
  v_cap       int;
  v_hold      interval;
  v_recurring boolean;
  v_id        uuid;
begin
  -- Business profile must exist; unverified vendors must at least have
  -- uploaded a permit so the organizer has something to review.
  select coalesce(vd.is_verified, false),
         (vd.business_permit_url is not null and btrim(vd.business_permit_url) <> '')
    into v_verified, v_permit
    from public.vendor_details vd
   where vd.id = v_uid;

  if not found then
    raise exception 'Complete your business profile before requesting a stall.';
  end if;
  if not v_verified and not v_permit then
    raise exception 'Upload your business permit before requesting a stall.';
  end if;

  select array_agg(distinct lower(d)) into v_days
    from unnest(coalesce(p_attending_days, '{}'::text[])) as d;

  if v_days is null or cardinality(v_days) = 0 then
    raise exception 'Select at least one day you will attend.';
  end if;
  if not (v_days <@ array['friday', 'saturday', 'sunday']) then
    raise exception 'Invalid attending day.';
  end if;

  select ms.id, ms.venue_id, ms.status, ms.booking_deadline,
         ms.friday_date, ms.saturday_date, ms.sunday_date, ms.end_time,
         v.timezone
    into v_session
    from public.market_sessions ms
    join public.venues v on v.id = ms.venue_id
   where ms.id = p_session_id;

  if not found then
    raise exception 'Market session not found.';
  end if;
  if v_session.status not in ('upcoming', 'open') then
    raise exception 'This market session is not open for booking.';
  end if;
  if v_session.booking_deadline is not null and v_session.booking_deadline < now() then
    raise exception 'The booking deadline for this session has passed.';
  end if;

  select id, venue_id, is_active, stall_number
    into v_stall
    from public.stalls
   where id = p_stall_id;

  if not found or v_stall.venue_id <> v_session.venue_id then
    raise exception 'Stall not found for this market.';
  end if;
  if v_stall.is_active is not true then
    raise exception 'This stall is not available.';
  end if;

  v_last := case
    when 'sunday'   = any (v_days) then v_session.sunday_date
    when 'saturday' = any (v_days) then v_session.saturday_date
    else v_session.friday_date
  end;
  v_end := (v_last + v_session.end_time) at time zone v_session.timezone;

  if v_end <= now() then
    raise exception 'The days you selected have already ended.';
  end if;

  -- Release lapsed holds first: this vendor's own, and any on this stall.
  update public.bookings
     set status = 'expired'
   where status in ('pending', 'approved')
     and reservation_expires_at is not null
     and reservation_expires_at < now()
     and (vendor_id = v_uid
          or (stall_id = p_stall_id and session_id = p_session_id));

  -- One stall per vendor per market.
  if exists (
    select 1 from public.bookings
     where vendor_id = v_uid
       and session_id = p_session_id
       and status not in ('cancelled', 'rejected', 'expired')
  ) then
    raise exception 'You already have a stall for this market. Cancel it first if you want to switch.';
  end if;

  -- Open-request cap (across sessions).
  v_cap := case when v_verified then 3 else 1 end;
  select count(*) into v_holds
    from public.bookings
   where vendor_id = v_uid
     and status in ('pending', 'approved');

  if v_holds >= v_cap then
    if v_verified then
      raise exception 'You already have % open reservations. Pay for or cancel one first.', v_cap;
    else
      raise exception 'You can have 1 open request until your business is verified. Wait for a decision or cancel it first.';
    end if;
  end if;

  -- Is the stall already taken?
  select b.id, b.vendor_id, b.status,
         coalesce(vd.is_verified, false) as vendor_verified
    into v_existing
    from public.bookings b
    left join public.vendor_details vd on vd.id = b.vendor_id
   where b.stall_id = p_stall_id
     and b.session_id = p_session_id
     and b.status not in ('cancelled', 'rejected', 'expired')
     for update of b;

  if found then
    -- Only a verified vendor may release an unverified vendor's PENDING request.
    if v_verified
       and v_existing.status = 'pending'
       and not v_existing.vendor_verified then

      update public.bookings
         set status = 'cancelled'
       where id = v_existing.id;

      perform public._log_booking_event(v_existing.id, p_session_id, null, 'system',
        'released_for_verified', 'pending', 'cancelled',
        'Released because a verified vendor requested this stall');
      perform public._notify(v_existing.vendor_id, 'Your request was released',
        format('Your request for stall %s was released because a verified vendor requested it. Get your business verified to keep priority, or pick another stall.',
               v_stall.stall_number),
        'booking_released');
    else
      raise exception 'This stall was just reserved by someone else.'
        using errcode = '23505';
    end if;
  end if;

  v_recurring := coalesce(p_is_recurring, false) and v_verified;
  v_hold := case when v_verified then interval '72 hours' else interval '24 hours' end;

  begin
    insert into public.bookings
      (vendor_id, stall_id, session_id, attending_days, is_recurring,
       status, reservation_expires_at)
    values
      (v_uid, p_stall_id, p_session_id, v_days, v_recurring,
       'pending', least(now() + v_hold, v_end))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That stall was just taken, or you already have a stall for this market.'
      using errcode = '23505';
  end;

  perform public._log_booking_event(v_id, p_session_id, v_uid, 'vendor',
    'requested', null, 'pending',
    case when v_verified then null else 'unverified vendor' end);
  perform public._notify(v_uid, 'Booking request submitted',
    format('Your request for stall %s is pending organizer approval.%s',
           v_stall.stall_number,
           case when v_verified then ''
                else ' Your business is not verified yet, so this request may be released if a verified vendor wants the same stall.' end),
    'booking_submitted');

  return v_id;
end;
$$;


ALTER FUNCTION "public"."create_booking"("p_stall_id" "uuid", "p_session_id" "uuid", "p_attending_days" "text"[], "p_is_recurring" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_recurring_bookings_for_session"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  rec    record;
  v_tz   text;
  v_last date;
  v_end  timestamptz;
  v_hold timestamptz;
  v_id   uuid;
begin
  select timezone into v_tz from public.venues where id = new.venue_id;
  v_tz := coalesce(v_tz, 'Asia/Manila');

  for rec in
    select *
      from (
        select distinct on (b.stall_id)
               b.vendor_id, b.stall_id, b.attending_days, b.is_recurring,
               s.stall_number, s.is_active
          from public.bookings b
          join public.stalls s on s.id = b.stall_id
         where b.status in ('paid', 'checked_in', 'completed')
           and s.venue_id = new.venue_id
           and b.session_id <> new.id
         order by b.stall_id, b.requested_at desc
      ) latest
     where latest.is_recurring
  loop
    v_last := case
      when 'sunday'   = any (rec.attending_days) then new.sunday_date
      when 'saturday' = any (rec.attending_days) then new.saturday_date
      else new.friday_date
    end;
    v_end := (v_last + new.end_time) at time zone v_tz;

    -- Session already over (e.g. back-dated): nothing to reserve.
    if v_end <= now() then
      continue;
    end if;

    v_id := null;

    if rec.is_active is true
       and exists (select 1 from public.vendor_details
                    where id = rec.vendor_id and is_verified = true)
       and not exists (select 1 from public.bookings
                        where stall_id = rec.stall_id
                          and session_id = new.id
                          and status not in ('cancelled', 'rejected', 'expired'))
    then
      v_hold := least(now() + interval '72 hours', v_end);
      begin
        insert into public.bookings
          (vendor_id, stall_id, session_id, attending_days,
           is_recurring, status, reservation_expires_at)
        values
          (rec.vendor_id, rec.stall_id, new.id, rec.attending_days,
           true, 'pending', v_hold)
        returning id into v_id;
      exception when unique_violation then
        v_id := null;   -- someone grabbed it a moment ago
      end;
    end if;

    if v_id is not null then
      insert into public.booking_events
        (booking_id, session_id, actor_id, actor_role, action, from_status, to_status, note)
      values
        (v_id, new.id, null, 'system', 'auto_requested', null, 'pending',
         'recurring booking');

      insert into public.notifications (recipient_id, title, body, type)
      values (
        rec.vendor_id,
        'Your usual stall was requested',
        format('We requested stall %s again for the upcoming market. The organizer will review it, and you will be asked to pay once it is approved.',
               rec.stall_number),
        'recurring_auto_reserved'
      );
    else
      insert into public.notifications (recipient_id, title, body, type)
      values (
        rec.vendor_id,
        'Your usual stall is unavailable',
        format('We could not auto-reserve stall %s for the upcoming market. It may be unavailable, or your business verification may need attention. Check the floor map to pick a stall.',
               rec.stall_number),
        'recurring_auto_reserve_failed'
      );
    end if;
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."create_recurring_bookings_for_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_bookings"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.bookings
     set status = 'expired'
   where status in ('pending', 'approved')
     and reservation_expires_at is not null
     and reservation_expires_at < now();
$$;


ALTER FUNCTION "public"."expire_stale_bookings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_booking_event_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'booking_events is append-only';
end;
$$;


ALTER FUNCTION "public"."prevent_booking_event_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_profile_role_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.role is distinct from old.role then
    raise exception 'Changing your role is not allowed';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_profile_role_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_vendor_booking_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'vendor'
  ) then

    -- Vendors cannot change the booking's ownership or reservation details.
    if new.vendor_id is distinct from old.vendor_id
       or new.stall_id is distinct from old.stall_id
       or new.session_id is distinct from old.session_id
       or new.attending_days is distinct from old.attending_days
       or new.is_recurring is distinct from old.is_recurring then
      raise exception 'Booking details cannot be changed by the vendor';
    end if;

    -- Vendors cannot change a paid booking's status.
    if old.status = 'paid' and new.status is distinct from old.status then
      raise exception 'Paid booking status cannot be changed by the vendor';
    end if;

    -- Vendors cannot change a cancelled booking.
    if old.status = 'cancelled' and new.status is distinct from old.status then
      raise exception 'Cancelled bookings cannot be changed';
    end if;

    -- Vendors may only cancel pending or approved bookings
    -- (or let a genuinely lapsed reservation expire).
    if old.status in ('pending', 'approved')
       and new.status is distinct from old.status
       and new.status <> 'cancelled'
       and not (
         new.status = 'expired'
         and old.reservation_expires_at is not null
         and old.reservation_expires_at < now()
       ) then
      raise exception 'Vendors may only cancel unpaid bookings';
    end if;

    -- Refund requests must not be removed or changed after submission.
    if old.refund_requested = true
       and (
         new.refund_requested is distinct from old.refund_requested
         or new.refund_reason is distinct from old.refund_reason
       ) then
      raise exception 'A refund request cannot be changed after submission';
    end if;

    -- A refund request is only valid for a paid booking.
    if new.refund_requested = true
       and old.status <> 'paid' then
      raise exception 'Refunds may only be requested for paid bookings';
    end if;

  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_vendor_booking_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_vendor_verification_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.is_verified is distinct from old.is_verified then
    if not exists (
      select 1
      from public.profiles
      where id = auth.uid()
      and role = 'organizer'
    ) then
      raise exception 'You are not allowed to change vendor verification status';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_vendor_verification_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_booking"("p_booking_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := public._require_role('organizer');
  v_b   record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select b.id, b.vendor_id, b.status, b.session_id, s.stall_number, v.organizer_id
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
    join public.venues v on v.id = s.venue_id
    join public.market_sessions ms
      on ms.id = b.session_id and ms.venue_id = s.venue_id
   where b.id = p_booking_id
     for update of b;

  if not found or v_b.organizer_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'pending' then
    raise exception 'Only pending bookings can be rejected (current status: %).', v_b.status;
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'Reason is too long (500 characters max).';
  end if;

  update public.bookings
     set status = 'rejected',
         decided_at = now(),
         organizer_notes = v_reason
   where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'organizer',
                                    'rejected', 'pending', 'rejected', v_reason);
  perform public._notify(v_b.vendor_id, 'Booking not approved',
    format('Your request for stall %s was not approved.%s',
           v_b.stall_number,
           case when v_reason is null then '' else ' Reason: ' || v_reason end),
    'booking_rejected');
end;
$$;


ALTER FUNCTION "public"."reject_booking"("p_booking_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_refund"("p_request_id" "uuid", "p_comment" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid     uuid := public._require_role('organizer');
  v_r       record;
  v_comment text := btrim(coalesce(p_comment, ''));
begin
  if length(v_comment) < 3 then
    raise exception 'A comment is required to reject a refund request, so the vendor knows why.';
  end if;
  if length(v_comment) > 500 then
    raise exception 'Comment is too long (500 characters max).';
  end if;

  select r.id, r.status, r.booking_id, r.vendor_id,
         b.session_id, s.stall_number, v.organizer_id
    into v_r
    from public.refund_requests r
    join public.bookings b on b.id = r.booking_id
    join public.stalls   s on s.id = b.stall_id
    join public.venues   v on v.id = s.venue_id
   where r.id = p_request_id
     for update of r;

  if not found or v_r.organizer_id <> v_uid then
    raise exception 'Refund request not found.';
  end if;
  if v_r.status <> 'requested' then
    raise exception 'Only open requests can be rejected (current status: %).', v_r.status;
  end if;

  update public.refund_requests
     set status = 'rejected',
         decision_comment = v_comment,
         decided_by = v_uid,
         decided_at = now(),
         updated_at = now()
   where id = p_request_id;

  update public.bookings
     set refund_requested = false
   where id = v_r.booking_id;

  perform public._log_booking_event(v_r.booking_id, v_r.session_id, v_uid, 'organizer',
                                    'refund_rejected', 'paid', 'paid', v_comment);
  perform public._notify(v_r.vendor_id, 'Refund request declined',
    format('Your refund request for stall %s was declined. Reason: %s',
           v_r.stall_number, v_comment),
    'refund_rejected');
end;
$$;


ALTER FUNCTION "public"."reject_refund"("p_request_id" "uuid", "p_comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_refund"("p_booking_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid    uuid := public._require_role('vendor');
  v_b      record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_paid   integer;
  v_prior  integer;
begin
  if length(v_reason) < 3 then
    raise exception 'Add a short reason so the organizer knows what happened.';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Reason is too long (500 characters max).';
  end if;

  select id, vendor_id, status, session_id
    into v_b
    from public.bookings
   where id = p_booking_id
     for update;

  if not found or v_b.vendor_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'paid' then
    raise exception 'Refunds can only be requested for paid bookings that have not been checked in.';
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments
   where booking_id = p_booking_id and status = 'paid';
  if v_paid <= 0 then
    raise exception 'We could not find a completed payment for this booking.';
  end if;

  if exists (
    select 1 from public.refund_requests
     where booking_id = p_booking_id and status in ('requested', 'approved')
  ) then
    raise exception 'You already have an open refund request for this booking.';
  end if;

  select count(*) into v_prior
    from public.refund_requests where booking_id = p_booking_id;
  if v_prior >= 2 then
    raise exception 'You have reached the limit of refund requests for this booking. Please contact the organizer.';
  end if;

  insert into public.refund_requests (booking_id, vendor_id, reason)
  values (p_booking_id, v_uid, v_reason);

  -- Kept in sync so screens that still read the old flag keep working.
  update public.bookings
     set refund_requested = true, refund_reason = v_reason
   where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'vendor',
                                    'refund_requested', 'paid', 'paid', v_reason);
end;
$$;


ALTER FUNCTION "public"."request_refund"("p_booking_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_verification_on_permit_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.business_permit_url is distinct from old.business_permit_url
     and auth.uid() = old.id then
    new.is_verified := false;
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."reset_verification_on_permit_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stall_availability"("p_session_id" "uuid") RETURNS TABLE("stall_id" "uuid", "availability" "text", "is_mine" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select b.stall_id,
         case when b.status = 'pending' then 'reserved' else 'booked' end,
         (b.vendor_id = auth.uid())
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
    join public.market_sessions ms
      on ms.id = b.session_id and ms.venue_id = s.venue_id
   where b.session_id = p_session_id
     and b.status in ('pending', 'approved', 'paid', 'checked_in', 'completed')
     and (b.status not in ('pending', 'approved')
          or b.reservation_expires_at is null
          or b.reservation_expires_at >= now())
     and auth.uid() is not null;
$$;


ALTER FUNCTION "public"."stall_availability"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_sales"("p_booking_id" "uuid", "p_gross_sales_cents" integer, "p_items_sold" integer DEFAULT NULL::integer, "p_notes" "text" DEFAULT NULL::"text", "p_receipt_path" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := public._require_role('vendor');
  v_b   record;
  v_ex  record;
  v_id  uuid;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select id, vendor_id, status, session_id
    into v_b
    from public.bookings
   where id = p_booking_id
     for update;

  if not found or v_b.vendor_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'completed' then
    raise exception 'Sales can only be submitted after the organizer has completed your market day.';
  end if;

  if p_gross_sales_cents is null or p_gross_sales_cents < 0 or p_gross_sales_cents > 100000000 then
    raise exception 'Enter a valid gross sales amount.';
  end if;
  if p_items_sold is not null and (p_items_sold < 0 or p_items_sold > 1000000) then
    raise exception 'Enter a valid item count.';
  end if;
  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'Notes are too long (1000 characters max).';
  end if;
  if p_receipt_path is not null
     and p_receipt_path not like (p_booking_id::text || '/%') then
    raise exception 'Invalid receipt file.';
  end if;

  select id, submitted_at into v_ex
    from public.sales_submissions
   where booking_id = p_booking_id;

  if found then
    if v_ex.submitted_at < now() - interval '48 hours' then
      raise exception 'This sales report can no longer be edited.';
    end if;
    update public.sales_submissions
       set gross_sales_cents = p_gross_sales_cents,
           items_sold_count  = p_items_sold,
           notes             = v_notes,
           receipt_photo_url = p_receipt_path
     where id = v_ex.id;
    v_id := v_ex.id;
    perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'vendor',
                                      'sales_updated', 'completed', 'completed', null);
  else
    insert into public.sales_submissions
      (booking_id, vendor_id, gross_sales_cents, items_sold_count, notes, receipt_photo_url)
    values
      (p_booking_id, v_uid, p_gross_sales_cents, p_items_sold, v_notes, p_receipt_path)
    returning id into v_id;
    perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'vendor',
                                      'sales_submitted', 'completed', 'completed', null);
  end if;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."submit_sales"("p_booking_id" "uuid", "p_gross_sales_cents" integer, "p_items_sold" integer, "p_notes" "text", "p_receipt_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."undo_check_in"("p_booking_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := public._require_role('organizer');
  v_b   record;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 then
    raise exception 'A reason is required to undo a check-in.';
  end if;

  select b.id, b.status, b.session_id, v.organizer_id
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
    join public.venues v on v.id = s.venue_id
    join public.market_sessions ms
      on ms.id = b.session_id and ms.venue_id = s.venue_id
   where b.id = p_booking_id
     for update of b;

  if not found or v_b.organizer_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'checked_in' then
    raise exception 'Only checked-in bookings can be undone (current status: %).', v_b.status;
  end if;

  update public.bookings
     set status = 'paid', checked_in_at = null
   where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'organizer',
                                    'check_in_undone', 'checked_in', 'paid', v_reason);
end;
$$;


ALTER FUNCTION "public"."undo_check_in"("p_booking_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_vendor"("p_vendor_id" "uuid", "p_verified" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := public._require_role('organizer');
begin
  if p_verified is null then
    raise exception 'Verification value is required.';
  end if;

  update public.vendor_details
     set is_verified = p_verified,
         verified_by = v_uid,
         verified_at = now()
   where id = p_vendor_id;

  if not found then
    raise exception 'Vendor not found.';
  end if;

  perform public._notify(p_vendor_id,
    case when p_verified then 'Business verified' else 'Verification removed' end,
    case when p_verified
      then 'Your business has been verified. You can now reserve stalls.'
      else 'Your business verification was removed. Please contact the organizer.'
    end,
    case when p_verified then 'vendor_verified' else 'vendor_unverified' end);
end;
$$;


ALTER FUNCTION "public"."verify_vendor"("p_vendor_id" "uuid", "p_verified" boolean) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."booking_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "actor_id" "uuid",
    "actor_role" "text" NOT NULL,
    "action" "text" NOT NULL,
    "from_status" "text",
    "to_status" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_events_actor_role_check" CHECK (("actor_role" = ANY (ARRAY['vendor'::"text", 'organizer'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."booking_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "stall_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "attending_days" "text"[] NOT NULL,
    "is_recurring" boolean DEFAULT false,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "organizer_notes" "text",
    "requested_at" timestamp with time zone DEFAULT "now"(),
    "decided_at" timestamp with time zone,
    "reservation_expires_at" timestamp with time zone,
    "refund_requested" boolean DEFAULT false NOT NULL,
    "refund_reason" "text",
    "payment_due_at" timestamp with time zone,
    "checked_in_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "completed_early" boolean DEFAULT false NOT NULL,
    "completion_note" "text",
    CONSTRAINT "bookings_completion_consistency" CHECK (((("status" <> 'completed'::"text") OR ("completed_at" IS NOT NULL)) AND ((NOT "completed_early") OR ("completion_note" IS NOT NULL)))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'paid'::"text", 'cancelled'::"text", 'checked_in'::"text", 'expired'::"text", 'completed'::"text", 'no_show'::"text"]))),
    CONSTRAINT "valid_attending_days" CHECK (("attending_days" <@ ARRAY['friday'::"text", 'saturday'::"text", 'sunday'::"text"]))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "friday_date" "date" NOT NULL,
    "saturday_date" "date" NOT NULL,
    "sunday_date" "date" NOT NULL,
    "start_time" time without time zone DEFAULT '17:00:00'::time without time zone NOT NULL,
    "end_time" time without time zone DEFAULT '22:00:00'::time without time zone NOT NULL,
    "booking_deadline" timestamp with time zone,
    "status" "text" DEFAULT 'upcoming'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "market_sessions_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'open'::"text", 'closed'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."market_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "type" "text",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "amount_cents" integer NOT NULL,
    "paymongo_payment_intent_id" "text",
    "paymongo_source_type" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'paid'::"text", 'failed'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['vendor'::"text", 'organizer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refund_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'requested'::"text" NOT NULL,
    "reason" "text" NOT NULL,
    "decision_comment" "text",
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "refund_amount_cents" integer,
    "id_verified" boolean DEFAULT false NOT NULL,
    "refunded_by" "uuid",
    "refunded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "refund_paid_needs_details" CHECK ((("status" <> 'refunded'::"text") OR (("refund_amount_cents" IS NOT NULL) AND ("id_verified" = true) AND ("refunded_by" IS NOT NULL) AND ("refunded_at" IS NOT NULL)))),
    CONSTRAINT "refund_rejected_needs_comment" CHECK ((("status" <> 'rejected'::"text") OR ("char_length"("btrim"(COALESCE("decision_comment", ''::"text"))) >= 3))),
    CONSTRAINT "refund_requests_decision_comment_check" CHECK ((("decision_comment" IS NULL) OR ("char_length"("decision_comment") <= 500))),
    CONSTRAINT "refund_requests_reason_check" CHECK ((("char_length"("btrim"("reason")) >= 3) AND ("char_length"("btrim"("reason")) <= 500))),
    CONSTRAINT "refund_requests_refund_amount_cents_check" CHECK ((("refund_amount_cents" IS NULL) OR ("refund_amount_cents" > 0))),
    CONSTRAINT "refund_requests_status_check" CHECK (("status" = ANY (ARRAY['requested'::"text", 'rejected'::"text", 'approved'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."refund_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "gross_sales_cents" integer NOT NULL,
    "items_sold_count" integer,
    "notes" "text",
    "receipt_photo_url" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stalls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "stall_number" "text" NOT NULL,
    "size" "text",
    "price_per_day_cents" integer NOT NULL,
    "position_x" numeric,
    "position_y" numeric,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stalls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_details" (
    "id" "uuid" NOT NULL,
    "business_name" "text" NOT NULL,
    "category" "text",
    "description" "text",
    "business_permit_url" "text",
    "is_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "verified_by" "uuid",
    "verified_at" timestamp with time zone
);


ALTER TABLE "public"."vendor_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organizer_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "timezone" "text" DEFAULT 'Asia/Manila'::"text" NOT NULL
);


ALTER TABLE "public"."venues" OWNER TO "postgres";


ALTER TABLE ONLY "public"."booking_events"
    ADD CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "bookings_attending_days_not_empty" CHECK (("cardinality"("attending_days") > 0)) NOT VALID;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."market_sessions"
    ADD CONSTRAINT "market_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."sales_submissions"
    ADD CONSTRAINT "sales_amount_sane" CHECK ((("gross_sales_cents" >= 0) AND ("gross_sales_cents" <= 100000000))) NOT VALID;



ALTER TABLE "public"."sales_submissions"
    ADD CONSTRAINT "sales_items_sane" CHECK ((("items_sold_count" IS NULL) OR ("items_sold_count" >= 0))) NOT VALID;



ALTER TABLE ONLY "public"."sales_submissions"
    ADD CONSTRAINT "sales_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stalls"
    ADD CONSTRAINT "stalls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stalls"
    ADD CONSTRAINT "stalls_venue_id_stall_number_key" UNIQUE ("venue_id", "stall_number");



ALTER TABLE ONLY "public"."sales_submissions"
    ADD CONSTRAINT "uq_sales_submission_booking" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."vendor_details"
    ADD CONSTRAINT "vendor_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "bookings_active_stall_session_unique" ON "public"."bookings" USING "btree" ("stall_id", "session_id") WHERE ("status" <> ALL (ARRAY['cancelled'::"text", 'rejected'::"text", 'expired'::"text"]));



CREATE INDEX "idx_booking_events_booking" ON "public"."booking_events" USING "btree" ("booking_id", "created_at");



CREATE INDEX "idx_booking_events_session" ON "public"."booking_events" USING "btree" ("session_id");



CREATE INDEX "idx_bookings_refund_requested" ON "public"."bookings" USING "btree" ("refund_requested") WHERE ("refund_requested" = true);



CREATE INDEX "idx_bookings_session" ON "public"."bookings" USING "btree" ("session_id");



CREATE INDEX "idx_bookings_session_status" ON "public"."bookings" USING "btree" ("session_id", "status");



CREATE INDEX "idx_bookings_stall" ON "public"."bookings" USING "btree" ("stall_id");



CREATE INDEX "idx_bookings_vendor" ON "public"."bookings" USING "btree" ("vendor_id");



CREATE INDEX "idx_notifications_recipient" ON "public"."notifications" USING "btree" ("recipient_id", "is_read");



CREATE INDEX "idx_notifications_recipient_created" ON "public"."notifications" USING "btree" ("recipient_id", "created_at" DESC);



CREATE INDEX "idx_payments_booking" ON "public"."payments" USING "btree" ("booking_id");



CREATE INDEX "idx_refund_requests_booking" ON "public"."refund_requests" USING "btree" ("booking_id");



CREATE INDEX "idx_refund_requests_status" ON "public"."refund_requests" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_refund_requests_vendor" ON "public"."refund_requests" USING "btree" ("vendor_id");



CREATE INDEX "idx_sessions_venue" ON "public"."market_sessions" USING "btree" ("venue_id");



CREATE INDEX "idx_stalls_venue" ON "public"."stalls" USING "btree" ("venue_id");



CREATE UNIQUE INDEX "uq_bookings_one_per_vendor_session" ON "public"."bookings" USING "btree" ("vendor_id", "session_id") WHERE ("status" <> ALL (ARRAY['cancelled'::"text", 'rejected'::"text", 'expired'::"text"]));



CREATE UNIQUE INDEX "uq_refund_requests_open_per_booking" ON "public"."refund_requests" USING "btree" ("booking_id") WHERE ("status" = ANY (ARRAY['requested'::"text", 'approved'::"text"]));



CREATE OR REPLACE TRIGGER "booking_events_immutable" BEFORE DELETE OR UPDATE ON "public"."booking_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_booking_event_change"();



CREATE OR REPLACE TRIGGER "prevent_profile_role_change" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_profile_role_change"();



CREATE OR REPLACE TRIGGER "prevent_vendor_booking_changes" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_vendor_booking_changes"();



CREATE OR REPLACE TRIGGER "prevent_vendor_verification_change" BEFORE UPDATE ON "public"."vendor_details" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_vendor_verification_change"();



CREATE OR REPLACE TRIGGER "reset_verification_on_permit_change" BEFORE UPDATE ON "public"."vendor_details" FOR EACH ROW EXECUTE FUNCTION "public"."reset_verification_on_permit_change"();



CREATE OR REPLACE TRIGGER "trg_create_recurring_bookings" AFTER INSERT ON "public"."market_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."create_recurring_bookings_for_session"();



ALTER TABLE ONLY "public"."booking_events"
    ADD CONSTRAINT "booking_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."booking_events"
    ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."booking_events"
    ADD CONSTRAINT "booking_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."market_sessions"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."market_sessions"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."market_sessions"
    ADD CONSTRAINT "market_sessions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_refunded_by_fkey" FOREIGN KEY ("refunded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_submissions"
    ADD CONSTRAINT "sales_submissions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."sales_submissions"
    ADD CONSTRAINT "sales_submissions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stalls"
    ADD CONSTRAINT "stalls_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_details"
    ADD CONSTRAINT "vendor_details_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_details"
    ADD CONSTRAINT "vendor_details_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE "public"."booking_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizer inserts own venue" ON "public"."venues" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "organizer_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text"))))));



CREATE POLICY "organizer manages sessions for their venue" ON "public"."market_sessions" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."venues"
  WHERE (("venues"."id" = "market_sessions"."venue_id") AND ("venues"."organizer_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text"))))));



CREATE POLICY "organizer manages stalls in their venue" ON "public"."stalls" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."venues"
  WHERE (("venues"."id" = "stalls"."venue_id") AND ("venues"."organizer_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text"))))));



CREATE POLICY "organizer updates bookings for their venue" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."stalls"
     JOIN "public"."venues" ON (("venues"."id" = "stalls"."venue_id")))
  WHERE (("stalls"."id" = "bookings"."stall_id") AND ("venues"."organizer_id" = "auth"."uid"())))));



CREATE POLICY "organizer updates own venue" ON "public"."venues" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "organizer_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text")))))) WITH CHECK ((("auth"."uid"() = "organizer_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text"))))));



CREATE POLICY "organizer updates sessions for their venue" ON "public"."market_sessions" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venues"
  WHERE (("venues"."id" = "market_sessions"."venue_id") AND ("venues"."organizer_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."venues"
  WHERE (("venues"."id" = "market_sessions"."venue_id") AND ("venues"."organizer_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text"))))));



CREATE POLICY "organizer updates stalls in their venue" ON "public"."stalls" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venues"
  WHERE (("venues"."id" = "stalls"."venue_id") AND ("venues"."organizer_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."venues"
  WHERE (("venues"."id" = "stalls"."venue_id") AND ("venues"."organizer_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text"))))));



CREATE POLICY "organizer updates vendor_details for verification" ON "public"."vendor_details" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'organizer'::"text")))));



CREATE POLICY "organizer views bookings for their venue" ON "public"."bookings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."stalls"
     JOIN "public"."venues" ON (("venues"."id" = "stalls"."venue_id")))
  WHERE (("stalls"."id" = "bookings"."stall_id") AND ("venues"."organizer_id" = "auth"."uid"())))));



CREATE POLICY "organizer views payments for their venue" ON "public"."payments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."bookings"
     JOIN "public"."stalls" ON (("stalls"."id" = "bookings"."stall_id")))
     JOIN "public"."venues" ON (("venues"."id" = "stalls"."venue_id")))
  WHERE (("bookings"."id" = "payments"."booking_id") AND ("venues"."organizer_id" = "auth"."uid"())))));



CREATE POLICY "organizer views sales submissions for their venue" ON "public"."sales_submissions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."bookings"
     JOIN "public"."stalls" ON (("stalls"."id" = "bookings"."stall_id")))
     JOIN "public"."venues" ON (("venues"."id" = "stalls"."venue_id")))
  WHERE (("bookings"."id" = "sales_submissions"."booking_id") AND ("venues"."organizer_id" = "auth"."uid"())))));



CREATE POLICY "organizers view events for their venue" ON "public"."booking_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."bookings" "b"
     JOIN "public"."stalls" "s" ON (("s"."id" = "b"."stall_id")))
     JOIN "public"."venues" "v" ON (("v"."id" = "s"."venue_id")))
  WHERE (("b"."id" = "booking_events"."booking_id") AND ("v"."organizer_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "organizers view refund requests for their venue" ON "public"."refund_requests" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."bookings" "b"
     JOIN "public"."stalls" "s" ON (("s"."id" = "b"."stall_id")))
     JOIN "public"."venues" "v" ON (("v"."id" = "s"."venue_id")))
  WHERE (("b"."id" = "refund_requests"."booking_id") AND ("v"."organizer_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles viewable by authenticated users" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."refund_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions viewable by authenticated users" ON "public"."market_sessions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."stalls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stalls viewable by authenticated users" ON "public"."stalls" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "users insert their own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "id") AND ("role" = 'vendor'::"text")));



CREATE POLICY "users update their own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "recipient_id"));



CREATE POLICY "users update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "users view their own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "recipient_id"));



CREATE POLICY "vendor details viewable by authenticated users" ON "public"."vendor_details" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."vendor_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendors create their own bookings" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "vendor_id"));



CREATE POLICY "vendors insert their own details" ON "public"."vendor_details" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "id") AND (COALESCE("is_verified", false) = false) AND ("verified_by" IS NULL) AND ("verified_at" IS NULL)));



CREATE POLICY "vendors insert their own sales submissions" ON "public"."sales_submissions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "vendor_id"));



CREATE POLICY "vendors update allowed booking actions" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "vendor_id") AND (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text"])) OR ("status" = 'paid'::"text")))) WITH CHECK ((("auth"."uid"() = "vendor_id") AND (("status" = 'cancelled'::"text") OR (("status" = 'paid'::"text") AND ("refund_requested" = true)))));



CREATE POLICY "vendors update their own details" ON "public"."vendor_details" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "vendors view events of their bookings" ON "public"."booking_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "booking_events"."booking_id") AND ("b"."vendor_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "vendors view their own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "vendor_id"));



CREATE POLICY "vendors view their own payments" ON "public"."payments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings"
  WHERE (("bookings"."id" = "payments"."booking_id") AND ("bookings"."vendor_id" = "auth"."uid"())))));



CREATE POLICY "vendors view their own refund requests" ON "public"."refund_requests" FOR SELECT TO "authenticated" USING (("vendor_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "vendors view their own sales submissions" ON "public"."sales_submissions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "vendor_id"));



ALTER TABLE "public"."venues" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venues viewable by authenticated users" ON "public"."venues" FOR SELECT TO "authenticated" USING (true);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."_log_booking_event"("p_booking" "uuid", "p_session" "uuid", "p_actor" "uuid", "p_role" "text", "p_action" "text", "p_from" "text", "p_to" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_log_booking_event"("p_booking" "uuid", "p_session" "uuid", "p_actor" "uuid", "p_role" "text", "p_action" "text", "p_from" "text", "p_to" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_notify"("p_recipient" "uuid", "p_title" "text", "p_body" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_notify"("p_recipient" "uuid", "p_title" "text", "p_body" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_require_role"("p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_require_role"("p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_booking"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_booking"("p_booking_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."approve_booking"("p_booking_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."approve_refund"("p_request_id" "uuid", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_refund"("p_request_id" "uuid", "p_note" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."approve_refund"("p_request_id" "uuid", "p_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."booking_end_at"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booking_end_at"("p_booking_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."booking_end_at"("p_booking_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."check_in_booking"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_in_booking"("p_booking_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."check_in_booking"("p_booking_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."complete_booking"("p_booking_id" "uuid", "p_early" boolean, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_booking"("p_booking_id" "uuid", "p_early" boolean, "p_note" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."complete_booking"("p_booking_id" "uuid", "p_early" boolean, "p_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."complete_ready_bookings"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_ready_bookings"("p_session_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."complete_ready_bookings"("p_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."confirm_refund_paid"("p_request_id" "uuid", "p_amount_cents" integer, "p_id_verified" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_refund_paid"("p_request_id" "uuid", "p_amount_cents" integer, "p_id_verified" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."confirm_refund_paid"("p_request_id" "uuid", "p_amount_cents" integer, "p_id_verified" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_booking"("p_stall_id" "uuid", "p_session_id" "uuid", "p_attending_days" "text"[], "p_is_recurring" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_booking"("p_stall_id" "uuid", "p_session_id" "uuid", "p_attending_days" "text"[], "p_is_recurring" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."create_booking"("p_stall_id" "uuid", "p_session_id" "uuid", "p_attending_days" "text"[], "p_is_recurring" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_recurring_bookings_for_session"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_recurring_bookings_for_session"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_bookings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_bookings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_stale_bookings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_booking_event_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_booking_event_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_booking_event_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_profile_role_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_profile_role_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_vendor_booking_changes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_vendor_booking_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_vendor_verification_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_vendor_verification_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_booking"("p_booking_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_booking"("p_booking_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."reject_booking"("p_booking_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reject_refund"("p_request_id" "uuid", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_refund"("p_request_id" "uuid", "p_comment" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."reject_refund"("p_request_id" "uuid", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."request_refund"("p_booking_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_refund"("p_booking_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."request_refund"("p_booking_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reset_verification_on_permit_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_verification_on_permit_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."stall_availability"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stall_availability"("p_session_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."stall_availability"("p_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."submit_sales"("p_booking_id" "uuid", "p_gross_sales_cents" integer, "p_items_sold" integer, "p_notes" "text", "p_receipt_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_sales"("p_booking_id" "uuid", "p_gross_sales_cents" integer, "p_items_sold" integer, "p_notes" "text", "p_receipt_path" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."submit_sales"("p_booking_id" "uuid", "p_gross_sales_cents" integer, "p_items_sold" integer, "p_notes" "text", "p_receipt_path" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."undo_check_in"("p_booking_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."undo_check_in"("p_booking_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."undo_check_in"("p_booking_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."verify_vendor"("p_vendor_id" "uuid", "p_verified" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_vendor"("p_vendor_id" "uuid", "p_verified" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."verify_vendor"("p_vendor_id" "uuid", "p_verified" boolean) TO "authenticated";



GRANT ALL ON TABLE "public"."booking_events" TO "service_role";
GRANT SELECT ON TABLE "public"."booking_events" TO "authenticated";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."market_sessions" TO "anon";
GRANT ALL ON TABLE "public"."market_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."market_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."refund_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."refund_requests" TO "authenticated";



GRANT ALL ON TABLE "public"."sales_submissions" TO "anon";
GRANT ALL ON TABLE "public"."sales_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."stalls" TO "anon";
GRANT ALL ON TABLE "public"."stalls" TO "authenticated";
GRANT ALL ON TABLE "public"."stalls" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_details" TO "anon";
GRANT ALL ON TABLE "public"."vendor_details" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_details" TO "service_role";



GRANT ALL ON TABLE "public"."venues" TO "anon";
GRANT ALL ON TABLE "public"."venues" TO "authenticated";
GRANT ALL ON TABLE "public"."venues" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







