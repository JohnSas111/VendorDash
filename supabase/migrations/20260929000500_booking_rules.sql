-- ============================================================
-- 20260929000500_booking_rules.sql
-- Booking rules agreed with the owner:
--   * One active stall per vendor per market session (DB-enforced).
--   * Unverified vendors may request, but with limits:
--       1 open request, 24h hold, no auto-renew, permit must be uploaded.
--   * Verified vendors: up to 3 open requests, 72h hold.
--   * A verified vendor's request releases an UNVERIFIED vendor's
--     PENDING request on the same stall (approved/paid are never touched).
--   * Fixes the vendor-protection trigger so lapsed reservations can
--     actually be expired (they could not be before).
-- Requires Steps 1-4.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. One active booking per vendor per session
-- ------------------------------------------------------------
create unique index if not exists uq_bookings_one_per_vendor_session
  on public.bookings (vendor_id, session_id)
  where status not in ('cancelled', 'rejected', 'expired');

-- ------------------------------------------------------------
-- 2. Vendor-protection trigger: same rules as before, plus one
--    narrow exception - a reservation whose hold has already lapsed
--    may be moved to 'expired'. (Previously ANY vendor-initiated
--    expiry, including expire_stale_bookings(), was rejected.)
-- ------------------------------------------------------------
create or replace function public.prevent_vendor_booking_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.prevent_vendor_booking_changes() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. create_booking - replaces the Step 2 version
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

revoke all on function public.create_booking(uuid, uuid, text[], boolean) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, uuid, text[], boolean) to authenticated;

commit;

-- ============================================================
-- ROLLBACK (manual, only if needed):
-- begin;
--   drop index if exists public.uq_bookings_one_per_vendor_session;
--   -- Restore create_booking from 20260929000200_lifecycle_functions.sql
--   -- and prevent_vendor_booking_changes from vendordash_schema.sql
--   -- (with "set search_path = ''" as set in step 3).
-- commit;
-- ============================================================
