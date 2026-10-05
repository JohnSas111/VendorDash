-- =====================================================================
-- Batch D2 (part 2): the app no longer calls expire_stale_bookings
--
-- Apply ONLY AFTER:
--   * migration 20261001000500_scheduled_jobs.sql is applied and the 4 cron jobs exist
--   * the app no longer calls supabase.rpc("expire_stale_bookings")
--     (screens\vendor\FloorMapScreen.tsx and screens\vendor\StallDetailScreen.tsx)
--
-- Why this is safe: create_booking releases lapsed holds itself and
-- stall_availability ignores lapsed holds; the cron job now does the cleanup
-- (with audit event + notification).
--
-- service_role keeps access (server side only).
--
-- ROLLBACK (comment):
--   grant execute on function public.expire_stale_bookings() to authenticated;
-- =====================================================================
revoke all on function public.expire_stale_bookings() from public, anon, authenticated;
grant execute on function public.expire_stale_bookings() to service_role;
