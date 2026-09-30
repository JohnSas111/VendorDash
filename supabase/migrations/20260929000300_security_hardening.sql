-- ============================================================
-- 20260929000300_security_hardening.sql
-- Step 3: closes L-001, L-002 (insert + permit swap), L-018,
-- and fixes the recurring-booking trigger (L-019).
-- Requires Steps 1 and 2.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. L-001: self-registration may only create VENDOR profiles.
--    Organizers are provisioned via the Supabase dashboard / SQL editor.
-- ------------------------------------------------------------
drop policy if exists "users insert their own profile" on public.profiles;

create policy "users insert their own profile"
on public.profiles for insert to authenticated
with check (
  (select auth.uid()) = id
  and role = 'vendor'
);

-- ------------------------------------------------------------
-- 2. L-002: a vendor cannot create their details row pre-verified.
-- ------------------------------------------------------------
drop policy if exists "vendors insert their own details" on public.vendor_details;

create policy "vendors insert their own details"
on public.vendor_details for insert to authenticated
with check (
  (select auth.uid()) = id
  and coalesce(is_verified, false) = false
  and verified_by is null
  and verified_at is null
);

-- Changing the permit file after verification voids the verification.
-- (Runs after prevent_vendor_verification_change, alphabetically.)
create or replace function public.reset_verification_on_permit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
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

drop trigger if exists reset_verification_on_permit_change on public.vendor_details;
create trigger reset_verification_on_permit_change
before update on public.vendor_details
for each row execute function public.reset_verification_on_permit_change();

-- ------------------------------------------------------------
-- 3. L-018: expiry sweeper - qualified names, fixed search_path,
--    no anonymous access. (Signed-in clients still call it for now.)
-- ------------------------------------------------------------
create or replace function public.expire_stale_bookings()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.bookings
     set status = 'expired'
   where status in ('pending', 'approved')
     and reservation_expires_at is not null
     and reservation_expires_at < now();
$$;

revoke all on function public.expire_stale_bookings() from public, anon;
grant execute on function public.expire_stale_bookings() to authenticated, service_role;

-- Existing trigger functions: pin search_path (bodies already use public.*)
alter function public.prevent_profile_role_change()      set search_path = '';
alter function public.prevent_vendor_booking_changes()   set search_path = '';
alter function public.prevent_vendor_verification_change() set search_path = '';

-- Trigger functions never need to be callable by API clients.
revoke all on function public.prevent_profile_role_change()        from public, anon, authenticated;
revoke all on function public.prevent_vendor_booking_changes()     from public, anon, authenticated;
revoke all on function public.prevent_vendor_verification_change() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. L-019: recurring bookings for a new session.
--    - includes 'completed' source bookings
--    - vendor must still be verified, stall must still be active
--    - hold = min(72h, end of the vendor's last attending day)
--    - honest notification text (needs approval, THEN payment)
--    - audit event, and a race-safe insert
-- ------------------------------------------------------------
create or replace function public.create_recurring_bookings_for_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.create_recurring_bookings_for_session() from public, anon, authenticated;
revoke all on function public.reset_verification_on_permit_change()   from public, anon, authenticated;

commit;

-- ============================================================
-- ROLLBACK (manual, only if needed):
-- begin;
--   drop policy if exists "users insert their own profile" on public.profiles;
--   create policy "users insert their own profile" on public.profiles
--     for insert to authenticated with check (auth.uid() = id);
--   drop policy if exists "vendors insert their own details" on public.vendor_details;
--   create policy "vendors insert their own details" on public.vendor_details
--     for insert to authenticated with check (auth.uid() = id);
--   drop trigger if exists reset_verification_on_permit_change on public.vendor_details;
--   drop function if exists public.reset_verification_on_permit_change();
--   grant execute on function public.expire_stale_bookings() to anon;
--   -- The recurring trigger function can be restored from vendordash_schema.sql.
-- commit;
-- ============================================================
