-- L-020: an organizer can delete a stall in THEIR OWN venue.
--
-- Why: the stalls table had insert/update rules but no delete rule, so a
-- delete changed 0 rows and the app said "Stall deleted" anyway.
--
-- Safety: bookings.stall_id references stalls(id), so the database itself
-- refuses to delete any stall that has ever had a booking (error 23503).
-- Stalls with history must be deactivated instead (is_active = false).
-- Only the stall's own venue organizer matches the rule below; vendors and
-- other organizers delete nothing.

begin;

drop policy if exists "organizer deletes stalls in their venue" on public.stalls;

create policy "organizer deletes stalls in their venue"
  on public.stalls
  for delete
  to authenticated
  using (
    exists (
      select 1
        from public.venues v
       where v.id = stalls.venue_id
         and v.organizer_id = auth.uid()
    )
  );

commit;

-- ============================================================
-- ROLLBACK (manual, only if needed):
-- drop policy if exists "organizer deletes stalls in their venue" on public.stalls;
-- ============================================================

-- ------------------------------------------------------------
-- VERIFY (each as its own block; all end with rollback so nothing is kept)
-- Replace the placeholders using the helper query at the bottom.
--
-- 1) Organizer CAN delete a stall that has no bookings:
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', json_build_object('sub','<ORGANIZER_ID>','role','authenticated')::text, true);
-- delete from public.stalls where id = '<STALL_WITH_NO_BOOKINGS>' returning stall_number;
-- rollback;
-- Expected: one row.
--
-- 2) NEGATIVE: a vendor cannot delete any stall (0 rows):
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', json_build_object('sub','<VENDOR_ID>','role','authenticated')::text, true);
-- delete from public.stalls where id = '<STALL_WITH_NO_BOOKINGS>' returning stall_number;
-- rollback;
-- Expected: no rows.
--
-- 3) NEGATIVE: even the organizer cannot delete a stall that has booking history:
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', json_build_object('sub','<ORGANIZER_ID>','role','authenticated')::text, true);
-- delete from public.stalls where id = '<STALL_WITH_BOOKINGS>' returning stall_number;
-- rollback;
-- Expected: error 23503 (violates foreign key constraint "bookings_stall_id_fkey").
--
-- Helper: find one stall of each kind
-- select s.id, s.stall_number,
--        (select count(*) from public.bookings b where b.stall_id = s.id) as bookings
--   from public.stalls s order by bookings, s.stall_number;
-- ------------------------------------------------------------
