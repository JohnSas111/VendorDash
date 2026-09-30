-- ============================================================
-- 20260929000400_manual_refunds.sql
-- Manual refund workflow (no PayMongo refund API):
--   vendor requests -> organizer rejects (comment required)
--                   -> organizer approves (booking cancelled, stall freed)
--                      -> vendor shows valid ID to the organizer
--                      -> organizer confirms the payout in the app
-- Requires Steps 1-3 (foundation, functions, hardening).
-- Replaces request_refund (Step 2) and removes deny_refund (Step 2),
-- because a denial without a comment must no longer be possible.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. refund_requests: one row per request, with full history
-- ------------------------------------------------------------
create table if not exists public.refund_requests (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings(id) on delete restrict,
  vendor_id           uuid not null references public.profiles(id),
  status              text not null default 'requested'
                        check (status in ('requested', 'rejected', 'approved', 'refunded')),
  reason              text not null check (char_length(btrim(reason)) between 3 and 500),
  decision_comment    text check (decision_comment is null or char_length(decision_comment) <= 500),
  decided_by          uuid references public.profiles(id),
  decided_at          timestamptz,
  refund_amount_cents integer check (refund_amount_cents is null or refund_amount_cents > 0),
  id_verified         boolean not null default false,
  refunded_by         uuid references public.profiles(id),
  refunded_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A rejection must always carry an explanation.
  constraint refund_rejected_needs_comment
    check (status <> 'rejected' or char_length(btrim(coalesce(decision_comment, ''))) >= 3),
  -- A payout must record the amount, the ID check, and who/when.
  constraint refund_paid_needs_details
    check (status <> 'refunded'
           or (refund_amount_cents is not null
               and id_verified = true
               and refunded_by is not null
               and refunded_at is not null))
);

-- Only one OPEN request (requested or approved) per booking.
create unique index if not exists uq_refund_requests_open_per_booking
  on public.refund_requests (booking_id)
  where status in ('requested', 'approved');

create index if not exists idx_refund_requests_booking on public.refund_requests (booking_id);
create index if not exists idx_refund_requests_vendor  on public.refund_requests (vendor_id);
create index if not exists idx_refund_requests_status  on public.refund_requests (status, created_at desc);

alter table public.refund_requests enable row level security;

-- Clients may only READ. All writes go through the functions below.
revoke all on public.refund_requests from anon, authenticated;
grant select on public.refund_requests to authenticated;
grant all on public.refund_requests to service_role;

create policy "vendors view their own refund requests"
on public.refund_requests for select to authenticated
using (vendor_id = (select auth.uid()));

create policy "organizers view refund requests for their venue"
on public.refund_requests for select to authenticated
using (
  exists (
    select 1
      from public.bookings b
      join public.stalls  s on s.id = b.stall_id
      join public.venues  v on v.id = s.venue_id
     where b.id = refund_requests.booking_id
       and v.organizer_id = (select auth.uid())
  )
);

-- ------------------------------------------------------------
-- 2. Carry over any refund request that is open under the old
--    bookings.refund_requested flag.
-- ------------------------------------------------------------
insert into public.refund_requests (booking_id, vendor_id, status, reason)
select b.id, b.vendor_id, 'requested',
       coalesce(nullif(btrim(b.refund_reason), ''), 'Refund requested (no reason given)')
  from public.bookings b
 where b.refund_requested = true
   and b.status = 'paid'
   and not exists (select 1 from public.refund_requests r where r.booking_id = b.id);

-- ------------------------------------------------------------
-- 3. request_refund (vendor)  - replaces the Step 2 version
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

-- ------------------------------------------------------------
-- 4. reject_refund (organizer) - comment REQUIRED
-- ------------------------------------------------------------
create or replace function public.reject_refund(
  p_request_id uuid,
  p_comment    text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 5. approve_refund (organizer) - cancels the booking, frees the stall
-- ------------------------------------------------------------
create or replace function public.approve_refund(
  p_request_id uuid,
  p_note       text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 6. confirm_refund_paid (organizer) - after ID check and hand-over
-- ------------------------------------------------------------
create or replace function public.confirm_refund_paid(
  p_request_id   uuid,
  p_amount_cents integer,
  p_id_verified  boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ------------------------------------------------------------
-- 7. Remove the comment-less denial from Step 2
-- ------------------------------------------------------------
drop function if exists public.deny_refund(uuid);

-- ------------------------------------------------------------
-- 8. Grants (default privileges hand EXECUTE to anon/authenticated)
-- ------------------------------------------------------------
revoke all on function public.request_refund(uuid, text)               from public, anon, authenticated;
revoke all on function public.reject_refund(uuid, text)                from public, anon, authenticated;
revoke all on function public.approve_refund(uuid, text)               from public, anon, authenticated;
revoke all on function public.confirm_refund_paid(uuid, integer, boolean) from public, anon, authenticated;

grant execute on function public.request_refund(uuid, text)               to authenticated;
grant execute on function public.reject_refund(uuid, text)                to authenticated;
grant execute on function public.approve_refund(uuid, text)               to authenticated;
grant execute on function public.confirm_refund_paid(uuid, integer, boolean) to authenticated;

commit;

-- ============================================================
-- ROLLBACK (manual, only if needed):
-- begin;
--   drop function if exists public.confirm_refund_paid(uuid, integer, boolean);
--   drop function if exists public.approve_refund(uuid, text);
--   drop function if exists public.reject_refund(uuid, text);
--   -- restore the Step 2 request_refund and deny_refund from
--   -- 20260929000200_lifecycle_functions.sql, then:
--   drop table if exists public.refund_requests;
-- commit;
-- ============================================================
