-- ============================================================
-- 20260929000200_lifecycle_functions.sql
-- Step 2: server-side workflow functions. Additive only.
-- Existing policies/triggers/functions are NOT modified.
-- Requires 20260929000100_lifecycle_foundation.sql.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0. Small additive columns for verification audit
-- ------------------------------------------------------------
alter table public.vendor_details
  add column if not exists verified_by uuid references public.profiles(id),
  add column if not exists verified_at timestamptz;

-- ------------------------------------------------------------
-- 1. Internal helpers (NOT callable by clients)
-- ------------------------------------------------------------
create or replace function public._require_role(p_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public._log_booking_event(
  p_booking uuid, p_session uuid, p_actor uuid, p_role text,
  p_action text, p_from text, p_to text, p_note text
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.booking_events
    (booking_id, session_id, actor_id, actor_role, action, from_status, to_status, note)
  values
    (p_booking, p_session, p_actor, p_role, p_action, p_from, p_to, p_note);
$$;

create or replace function public._notify(
  p_recipient uuid, p_title text, p_body text, p_type text
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, title, body, type)
  values (p_recipient, p_title, p_body, p_type);
$$;

-- ------------------------------------------------------------
-- 2. create_booking  (vendor)
-- ------------------------------------------------------------
create or replace function public.create_booking(
  p_stall_id       uuid,
  p_session_id     uuid,
  p_attending_days text[],
  p_is_recurring   boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := public._require_role('vendor');
  v_days    text[];
  v_session record;
  v_stall   record;
  v_last    date;
  v_end     timestamptz;
  v_holds   int;
  v_id      uuid;
begin
  if not exists (
    select 1 from public.vendor_details
     where id = v_uid and is_verified = true
  ) then
    raise exception 'Your business must be verified before you can book a stall.';
  end if;

  select array_agg(distinct lower(d)) into v_days
    from unnest(coalesce(p_attending_days, '{}'::text[])) as d;

  if v_days is null or cardinality(v_days) = 0 then
    raise exception 'Select at least one day you will attend.';
  end if;
  if not (v_days <@ array['friday','saturday','sunday']) then
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

  -- Free any stale hold on this exact stall/session before inserting.
  update public.bookings
     set status = 'expired'
   where stall_id = p_stall_id
     and session_id = p_session_id
     and status in ('pending', 'approved')
     and reservation_expires_at is not null
     and reservation_expires_at < now();

  select count(*) into v_holds
    from public.bookings
   where vendor_id = v_uid
     and status in ('pending', 'approved')
     and (reservation_expires_at is null or reservation_expires_at >= now());

  if v_holds >= 5 then
    raise exception 'You already have 5 open reservations. Pay for or cancel one first.';
  end if;

  -- A unique_violation (23505) on the stall/session index propagates as-is.
  insert into public.bookings
    (vendor_id, stall_id, session_id, attending_days, is_recurring,
     status, reservation_expires_at)
  values
    (v_uid, p_stall_id, p_session_id, v_days, coalesce(p_is_recurring, false),
     'pending', least(now() + interval '72 hours', v_end))
  returning id into v_id;

  perform public._log_booking_event(v_id, p_session_id, v_uid, 'vendor',
                                    'requested', null, 'pending', null);
  perform public._notify(v_uid, 'Booking request submitted',
    format('Your request for stall %s is pending organizer approval.', v_stall.stall_number),
    'booking_submitted');

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 3. approve_booking  (organizer)
-- ------------------------------------------------------------
create or replace function public.approve_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 4. reject_booking  (organizer)
-- ------------------------------------------------------------
create or replace function public.reject_booking(
  p_booking_id uuid,
  p_reason     text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 5. cancel_booking  (vendor, unpaid bookings only)
-- ------------------------------------------------------------
create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 6. request_refund (vendor) / deny_refund (organizer)
-- ------------------------------------------------------------
create or replace function public.request_refund(
  p_booking_id uuid,
  p_reason     text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('vendor');
  v_b   record;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 then
    raise exception 'Add a short reason so the organizer knows what happened.';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Reason is too long (500 characters max).';
  end if;

  select id, vendor_id, status, session_id, refund_requested
    into v_b
    from public.bookings
   where id = p_booking_id
     for update;

  if not found or v_b.vendor_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'paid' then
    raise exception 'Refunds can only be requested for paid bookings.';
  end if;
  if v_b.refund_requested then
    raise exception 'A refund has already been requested for this booking.';
  end if;

  update public.bookings
     set refund_requested = true, refund_reason = v_reason
   where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'vendor',
                                    'refund_requested', 'paid', 'paid', v_reason);
end;
$$;

create or replace function public.deny_refund(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('organizer');
  v_b   record;
begin
  select b.id, b.vendor_id, b.status, b.session_id, b.refund_requested,
         s.stall_number, v.organizer_id
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
    join public.venues v on v.id = s.venue_id
   where b.id = p_booking_id
     for update of b;

  if not found or v_b.organizer_id <> v_uid then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'paid' or not v_b.refund_requested then
    raise exception 'There is no open refund request on this booking.';
  end if;

  update public.bookings
     set refund_requested = false, refund_reason = null
   where id = p_booking_id;

  perform public._log_booking_event(p_booking_id, v_b.session_id, v_uid, 'organizer',
                                    'refund_denied', 'paid', 'paid', null);
  perform public._notify(v_b.vendor_id, 'Refund request declined',
    format('Your refund request for stall %s was declined.', v_b.stall_number),
    'refund_denied');
end;
$$;

-- ------------------------------------------------------------
-- 7. check_in_booking / undo_check_in  (organizer)
-- ------------------------------------------------------------
create or replace function public.check_in_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.undo_check_in(
  p_booking_id uuid,
  p_reason     text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 8. complete_booking  (organizer)
-- ------------------------------------------------------------
create or replace function public.complete_booking(
  p_booking_id uuid,
  p_early      boolean default false,
  p_note       text    default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- Bulk: complete every checked-in vendor in a session whose last booked day
-- has already ended. Returns how many were completed.
create or replace function public.complete_ready_bookings(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 9. submit_sales  (vendor, completed bookings only)
-- ------------------------------------------------------------
create or replace function public.submit_sales(
  p_booking_id        uuid,
  p_gross_sales_cents integer,
  p_items_sold        integer default null,
  p_notes             text    default null,
  p_receipt_path      text    default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 10. verify_vendor  (organizer)
-- ------------------------------------------------------------
create or replace function public.verify_vendor(
  p_vendor_id uuid,
  p_verified  boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 11. stall_availability  (any signed-in user; no vendor details leaked)
-- ------------------------------------------------------------
create or replace function public.stall_availability(p_session_id uuid)
returns table (stall_id uuid, availability text, is_mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 12. Grants: default privileges hand EXECUTE to anon/authenticated,
--     so revoke explicitly, then grant only what clients need.
-- ------------------------------------------------------------
revoke all on function public._require_role(text) from public, anon, authenticated;
revoke all on function public._log_booking_event(uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public._notify(uuid, text, text, text) from public, anon, authenticated;

revoke all on function public.create_booking(uuid, uuid, text[], boolean) from public, anon, authenticated;
revoke all on function public.approve_booking(uuid) from public, anon, authenticated;
revoke all on function public.reject_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_booking(uuid) from public, anon, authenticated;
revoke all on function public.request_refund(uuid, text) from public, anon, authenticated;
revoke all on function public.deny_refund(uuid) from public, anon, authenticated;
revoke all on function public.check_in_booking(uuid) from public, anon, authenticated;
revoke all on function public.undo_check_in(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_booking(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.complete_ready_bookings(uuid) from public, anon, authenticated;
revoke all on function public.submit_sales(uuid, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.verify_vendor(uuid, boolean) from public, anon, authenticated;
revoke all on function public.stall_availability(uuid) from public, anon, authenticated;

grant execute on function public.create_booking(uuid, uuid, text[], boolean) to authenticated;
grant execute on function public.approve_booking(uuid) to authenticated;
grant execute on function public.reject_booking(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.request_refund(uuid, text) to authenticated;
grant execute on function public.deny_refund(uuid) to authenticated;
grant execute on function public.check_in_booking(uuid) to authenticated;
grant execute on function public.undo_check_in(uuid, text) to authenticated;
grant execute on function public.complete_booking(uuid, boolean, text) to authenticated;
grant execute on function public.complete_ready_bookings(uuid) to authenticated;
grant execute on function public.submit_sales(uuid, integer, integer, text, text) to authenticated;
grant execute on function public.verify_vendor(uuid, boolean) to authenticated;
grant execute on function public.stall_availability(uuid) to authenticated;

commit;

-- ============================================================
-- ROLLBACK (manual, only if needed):
-- begin;
--   drop function if exists public.stall_availability(uuid);
--   drop function if exists public.verify_vendor(uuid, boolean);
--   drop function if exists public.submit_sales(uuid, integer, integer, text, text);
--   drop function if exists public.complete_ready_bookings(uuid);
--   drop function if exists public.complete_booking(uuid, boolean, text);
--   drop function if exists public.undo_check_in(uuid, text);
--   drop function if exists public.check_in_booking(uuid);
--   drop function if exists public.deny_refund(uuid);
--   drop function if exists public.request_refund(uuid, text);
--   drop function if exists public.cancel_booking(uuid);
--   drop function if exists public.reject_booking(uuid, text);
--   drop function if exists public.approve_booking(uuid);
--   drop function if exists public.create_booking(uuid, uuid, text[], boolean);
--   drop function if exists public._notify(uuid, text, text, text);
--   drop function if exists public._log_booking_event(uuid, uuid, uuid, text, text, text, text, text);
--   drop function if exists public._require_role(text);
--   alter table public.vendor_details drop column if exists verified_at, drop column if exists verified_by;
-- commit;
-- ============================================================
