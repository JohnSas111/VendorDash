-- Batch C: payment rules live in the database, callable ONLY by the server
-- (service_role, i.e. the Edge Functions). No app user can call these.
--
--   payment_quote      price x attending days + fee, for an approved booking
--   payment_register   record a new PayMongo source; supersede older open ones
--   payment_precheck   BEFORE charging: is this source still safe to charge?
--   payment_apply_result  AFTER charging: mark paid / failed, in one transaction
--
-- Fixes: L-007 (wrong amount), L-008 (race / not idempotent / revived dead
-- bookings), and gives the webhook one place to reconcile payments + bookings.

begin;

-- The PayMongo payment id (pay_...) was never stored. Organizers need it to
-- find the payment in the PayMongo dashboard when refunding manually.
alter table public.payments
  add column if not exists paymongo_payment_id text;

-- One payment row per PayMongo source (a source id must never appear twice).
create unique index if not exists uq_payments_source
  on public.payments (paymongo_payment_intent_id)
  where paymongo_payment_intent_id is not null;

-- ------------------------------------------------------------
-- 1) QUOTE: what does this vendor owe for this booking?
-- ------------------------------------------------------------
create or replace function public.payment_quote(
  p_booking_id uuid,
  p_vendor_id  uuid
) returns table (
  amount_cents      integer,
  stall_total_cents integer,
  fee_cents         integer,
  days              integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee constant integer := 400;   -- flat PHP 4.00 service fee per payment
  v_b   record;
  v_days integer;
begin
  select b.vendor_id, b.status, b.attending_days, b.reservation_expires_at,
         s.price_per_day_cents
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
   where b.id = p_booking_id;

  -- Same answer for "does not exist" and "not yours".
  if not found or p_vendor_id is null or v_b.vendor_id <> p_vendor_id then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'approved' then
    raise exception 'This booking is not ready for payment.';
  end if;
  if v_b.reservation_expires_at is not null and v_b.reservation_expires_at < now() then
    raise exception 'The payment deadline for this booking has passed.';
  end if;
  if v_b.price_per_day_cents is null or v_b.price_per_day_cents <= 0 then
    raise exception 'This stall does not have a valid price.';
  end if;

  select count(distinct d) into v_days from unnest(v_b.attending_days) as d;
  if coalesce(v_days, 0) = 0 then
    raise exception 'This booking has no attending days.';
  end if;

  amount_cents      := v_b.price_per_day_cents * v_days + v_fee;
  stall_total_cents := v_b.price_per_day_cents * v_days;
  fee_cents         := v_fee;
  days              := v_days;
  return next;
end;
$$;

-- ------------------------------------------------------------
-- 2) REGISTER: remember a new PayMongo source for this booking
-- ------------------------------------------------------------
create or replace function public.payment_register(
  p_booking_id  uuid,
  p_source_id   text,
  p_source_type text,
  p_amount_cents integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b record;
begin
  if p_source_id is null or length(p_source_id) = 0 then
    raise exception 'Missing payment source.';
  end if;
  if p_source_type not in ('gcash', 'paymaya') then
    raise exception 'Invalid payment method.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Invalid payment amount.';
  end if;

  select b.id, b.status, b.session_id
    into v_b
    from public.bookings b
   where b.id = p_booking_id
     for update of b;

  if not found then
    raise exception 'Booking not found.';
  end if;
  if v_b.status <> 'approved' then
    raise exception 'This booking is not ready for payment.';
  end if;
  if exists (select 1 from public.payments
              where booking_id = p_booking_id and status = 'paid') then
    raise exception 'This booking has already been paid.';
  end if;

  -- Only the NEWEST source is honoured. Older open ones (a double tap, an
  -- abandoned checkout) are retired so they can never be charged later.
  update public.payments
     set status = 'failed'
   where booking_id = p_booking_id
     and status in ('pending', 'processing');

  insert into public.payments
    (booking_id, amount_cents, paymongo_payment_intent_id,
     paymongo_source_type, status)
  values
    (p_booking_id, p_amount_cents, p_source_id, p_source_type, 'processing');

  perform public._log_booking_event(p_booking_id, v_b.session_id, null, 'system',
                                    'payment_started', v_b.status, v_b.status,
                                    p_source_type);
end;
$$;

-- ------------------------------------------------------------
-- 3) PRECHECK: called BEFORE the money is taken.
--    Returns: ok | already_paid | unknown_source | not_open
--             | amount_mismatch | booking_not_payable
--    Only 'ok' means "go ahead and charge".
-- ------------------------------------------------------------
create or replace function public.payment_precheck(
  p_source_id    text,
  p_amount_cents integer
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_b record;
begin
  select * into v_p
    from public.payments
   where paymongo_payment_intent_id = p_source_id
     for update;

  if not found then
    return 'unknown_source';
  end if;
  if v_p.status = 'paid' then
    return 'already_paid';
  end if;
  -- failed / superseded / refunded: never charge these.
  if v_p.status <> 'processing' then
    return 'not_open';
  end if;

  select b.id, b.status, b.session_id, b.vendor_id, s.stall_number
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
   where b.id = v_p.booking_id
     for update of b;

  if p_amount_cents is distinct from v_p.amount_cents then
    update public.payments set status = 'failed' where id = v_p.id;
    perform public._log_booking_event(v_b.id, v_b.session_id, null, 'system',
      'payment_rejected', v_b.status, v_b.status,
      format('Amount mismatch: source %s vs recorded %s', p_amount_cents, v_p.amount_cents));
    return 'amount_mismatch';
  end if;

  -- If the booking is no longer open for payment (cancelled, expired,
  -- rejected...) we do NOT take the money. Not charging is cleaner than
  -- charging and refunding by hand.
  if v_b.status <> 'approved' then
    update public.payments set status = 'failed' where id = v_p.id;
    perform public._log_booking_event(v_b.id, v_b.session_id, null, 'system',
      'payment_rejected', v_b.status, v_b.status,
      'Booking no longer open for payment; vendor was not charged');
    perform public._notify(v_b.vendor_id, 'Payment not taken',
      format('Stall %s is no longer open for payment, so you were not charged.',
             v_b.stall_number),
      'payment_failed');
    return 'booking_not_payable';
  end if;

  return 'ok';
end;
$$;

-- ------------------------------------------------------------
-- 4) APPLY RESULT: called AFTER PayMongo answers the charge.
--    p_outcome = 'paid' | 'failed'.
--    Returns: paid | paid_needs_refund | already_paid | failed
--             | ignored | unknown_source
--    Idempotent: running it again changes nothing.
-- ------------------------------------------------------------
create or replace function public.payment_apply_result(
  p_source_id          text,
  p_outcome            text,
  p_paymongo_payment_id text,
  p_amount_cents       integer
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_b record;
  v_organizer uuid;
begin
  if p_outcome not in ('paid', 'failed') then
    raise exception 'Invalid outcome.';
  end if;

  select * into v_p
    from public.payments
   where paymongo_payment_intent_id = p_source_id
     for update;

  if not found then
    return 'unknown_source';
  end if;

  -- ---- charge did not go through ----
  if p_outcome = 'failed' then
    if v_p.status = 'paid' then
      return 'already_paid';          -- never downgrade a paid payment
    end if;
    if v_p.status in ('pending', 'processing') then
      update public.payments set status = 'failed' where id = v_p.id;
      return 'failed';
    end if;
    return 'ignored';
  end if;

  -- ---- charge succeeded ----
  if v_p.status = 'paid' then
    return 'already_paid';            -- replayed event: nothing to do
  end if;

  select b.id, b.status, b.session_id, b.vendor_id, s.stall_number, v.organizer_id
    into v_b
    from public.bookings b
    join public.stalls s on s.id = b.stall_id
    join public.venues v on v.id = s.venue_id
   where b.id = v_p.booking_id
     for update of b;

  -- Record the truth: PayMongo took this money.
  update public.payments
     set status = 'paid',
         paid_at = now(),
         paymongo_payment_id = p_paymongo_payment_id
   where id = v_p.id;

  if v_b.status = 'approved' and p_amount_cents is not distinct from v_p.amount_cents then
    update public.bookings set status = 'paid' where id = v_b.id and status = 'approved';

    perform public._log_booking_event(v_b.id, v_b.session_id, null, 'system',
      'payment_confirmed', 'approved', 'paid', p_paymongo_payment_id);
    perform public._notify(v_b.vendor_id, 'Payment confirmed',
      format('Your payment for stall %s was received. See you at the market!',
             v_b.stall_number),
      'payment_confirmed');
    return 'paid';
  end if;

  -- Money was taken but the booking cannot be marked paid (it changed in the
  -- seconds between the check and the charge, or the amount differs). Leave
  -- the booking alone and flag it for a manual refund.
  perform public._log_booking_event(v_b.id, v_b.session_id, null, 'system',
    'payment_needs_refund', v_b.status, v_b.status,
    format('Paid %s (PayMongo %s) but booking was %s; refund manually',
           p_amount_cents, p_paymongo_payment_id, v_b.status));
  perform public._notify(v_b.vendor_id, 'Payment needs attention',
    format('We received your payment for stall %s, but the booking is no longer active. The organizer will refund you.',
           v_b.stall_number),
    'payment_failed');
  perform public._notify(v_b.organizer_id, 'Payment needs a refund',
    format('A payment arrived for stall %s but the booking was %s. Please refund it in PayMongo (payment %s).',
           v_b.stall_number, v_b.status, coalesce(p_paymongo_payment_id, 'unknown')),
    'payment_failed');
  return 'paid_needs_refund';
end;
$$;

-- ------------------------------------------------------------
-- Permissions: ONLY the server (service_role). Never an app user.
-- ------------------------------------------------------------
revoke all on function public.payment_quote(uuid, uuid)                      from public, anon, authenticated;
revoke all on function public.payment_register(uuid, text, text, integer)    from public, anon, authenticated;
revoke all on function public.payment_precheck(text, integer)                from public, anon, authenticated;
revoke all on function public.payment_apply_result(text, text, text, integer) from public, anon, authenticated;

grant execute on function public.payment_quote(uuid, uuid)                      to service_role;
grant execute on function public.payment_register(uuid, text, text, integer)    to service_role;
grant execute on function public.payment_precheck(text, integer)                to service_role;
grant execute on function public.payment_apply_result(text, text, text, integer) to service_role;

commit;

-- ============================================================
-- ROLLBACK (manual, only if needed):
-- begin;
--   drop function if exists public.payment_apply_result(text, text, text, integer);
--   drop function if exists public.payment_precheck(text, integer);
--   drop function if exists public.payment_register(uuid, text, text, integer);
--   drop function if exists public.payment_quote(uuid, uuid);
--   drop index if exists public.uq_payments_source;
--   alter table public.payments drop column if exists paymongo_payment_id;
-- commit;
-- (Roll the Edge Functions back to the old versions first.)
-- ============================================================
