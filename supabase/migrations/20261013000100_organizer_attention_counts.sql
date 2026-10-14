-- Batch: organizer sidebar badges
--
-- One read-only function that tells an organizer how many things need their
-- attention. The sidebar shows these as small number badges.
--
--   pending_bookings   requests waiting for a decision at THIS organizer's
--                      venues (a request whose hold already ran out is not
--                      counted: it can no longer be approved)
--   pending_refunds    refund requests waiting for a decision, plus approved
--                      refunds still waiting for the payout to be recorded
--   unverified_vendors vendors who uploaded a permit and are not verified yet
--                      (the same list the Verification screen shows)
--
-- Safety: organizers only (checked inside), scoped to the caller's own
-- venues, changes nothing, closed to anon and service_role. Safe to run twice.

create or replace function public.organizer_attention_counts()
returns table (
  pending_bookings   integer,
  pending_refunds    integer,
  unverified_vendors integer
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid uuid := public._require_role('organizer');
begin
  return query
  select
    (select count(*)::integer
       from public.bookings b
       join public.stalls s on s.id = b.stall_id
       join public.venues v on v.id = s.venue_id
      where v.organizer_id = v_uid
        and b.status = 'pending'
        and (b.reservation_expires_at is null
             or b.reservation_expires_at >= now())),
    (select count(*)::integer
       from public.refund_requests rr
       join public.bookings b on b.id = rr.booking_id
       join public.stalls s on s.id = b.stall_id
       join public.venues v on v.id = s.venue_id
      where v.organizer_id = v_uid
        and rr.status in ('requested', 'approved')),
    (select count(*)::integer
       from public.vendor_details vd
      where coalesce(vd.is_verified, false) = false
        and vd.business_permit_url is not null
        and btrim(vd.business_permit_url) <> '');
end;
$$;

revoke all on function public.organizer_attention_counts() from public, anon, service_role;
grant execute on function public.organizer_attention_counts() to authenticated;
