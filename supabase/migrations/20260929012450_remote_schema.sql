


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


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."create_recurring_bookings_for_session"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  rec record;
  hold_expires timestamptz := now() + interval '24 hours';
begin
  for rec in
    select distinct on (b.stall_id)
      b.vendor_id, b.stall_id, b.attending_days, b.is_recurring
    from bookings b
    join stalls s on s.id = b.stall_id
    where b.status in ('paid', 'checked_in')
      and s.venue_id = new.venue_id
      and b.session_id <> new.id
    order by b.stall_id, b.requested_at desc
  loop
    if not rec.is_recurring then
      continue;
    end if;

    -- Only proceed if this stall doesn't already have an active booking
    -- in the new session (covers the edge case where it was somehow
    -- already booked before this trigger ran).
    if not exists (
      select 1 from bookings
      where stall_id = rec.stall_id
        and session_id = new.id
        and status not in ('cancelled', 'rejected', 'expired')
    ) then
      insert into bookings (
        vendor_id, stall_id, session_id, attending_days,
        is_recurring, status, reservation_expires_at
      ) values (
        rec.vendor_id, rec.stall_id, new.id, rec.attending_days,
        true, 'pending', hold_expires
      );

      insert into notifications (recipient_id, title, body, type)
      values (
        rec.vendor_id,
        'Your recurring stall is reserved',
        'Your usual stall has been auto-reserved for the upcoming market. Pay within 24 hours to confirm it, or the hold will be released.',
        'recurring_auto_reserved'
      );
    else
      insert into notifications (recipient_id, title, body, type)
      values (
        rec.vendor_id,
        'Your usual stall is unavailable',
        'We could not auto-reserve your usual stall for the upcoming market because it is no longer available. Check the floor map to pick a different one.',
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
    AS $$
  update bookings
  set status = 'expired'
  where status in ('pending', 'approved')
    and reservation_expires_at is not null
    and reservation_expires_at < now();
$$;


ALTER FUNCTION "public"."expire_stale_bookings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_profile_role_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
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

    -- Vendors may only cancel pending or approved bookings.
    if old.status in ('pending', 'approved')
       and new.status is distinct from old.status
       and new.status <> 'cancelled' then
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

SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'paid'::"text", 'cancelled'::"text", 'checked_in'::"text", 'expired'::"text"]))),
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
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organizer_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."venues" OWNER TO "postgres";


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



CREATE INDEX "idx_bookings_refund_requested" ON "public"."bookings" USING "btree" ("refund_requested") WHERE ("refund_requested" = true);



CREATE INDEX "idx_bookings_session" ON "public"."bookings" USING "btree" ("session_id");



CREATE INDEX "idx_bookings_vendor" ON "public"."bookings" USING "btree" ("vendor_id");



CREATE INDEX "idx_notifications_recipient" ON "public"."notifications" USING "btree" ("recipient_id", "is_read");



CREATE INDEX "idx_payments_booking" ON "public"."payments" USING "btree" ("booking_id");



CREATE INDEX "idx_sessions_venue" ON "public"."market_sessions" USING "btree" ("venue_id");



CREATE INDEX "idx_stalls_venue" ON "public"."stalls" USING "btree" ("venue_id");



CREATE OR REPLACE TRIGGER "prevent_profile_role_change" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_profile_role_change"();



CREATE OR REPLACE TRIGGER "prevent_vendor_booking_changes" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_vendor_booking_changes"();



CREATE OR REPLACE TRIGGER "prevent_vendor_verification_change" BEFORE UPDATE ON "public"."vendor_details" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_vendor_verification_change"();



CREATE OR REPLACE TRIGGER "trg_create_recurring_bookings" AFTER INSERT ON "public"."market_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."create_recurring_bookings_for_session"();



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



ALTER TABLE ONLY "public"."sales_submissions"
    ADD CONSTRAINT "sales_submissions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."sales_submissions"
    ADD CONSTRAINT "sales_submissions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stalls"
    ADD CONSTRAINT "stalls_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_details"
    ADD CONSTRAINT "vendor_details_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."profiles"("id");



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



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles viewable by authenticated users" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."sales_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions viewable by authenticated users" ON "public"."market_sessions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."stalls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stalls viewable by authenticated users" ON "public"."stalls" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "users insert their own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "users update their own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "recipient_id"));



CREATE POLICY "users update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "users view their own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "recipient_id"));



CREATE POLICY "vendor details viewable by authenticated users" ON "public"."vendor_details" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."vendor_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendors create their own bookings" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "vendor_id"));



CREATE POLICY "vendors insert their own details" ON "public"."vendor_details" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "vendors insert their own sales submissions" ON "public"."sales_submissions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "vendor_id"));



CREATE POLICY "vendors update allowed booking actions" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "vendor_id") AND (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text"])) OR ("status" = 'paid'::"text")))) WITH CHECK ((("auth"."uid"() = "vendor_id") AND (("status" = 'cancelled'::"text") OR (("status" = 'paid'::"text") AND ("refund_requested" = true)))));



CREATE POLICY "vendors update their own details" ON "public"."vendor_details" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "vendors view their own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "vendor_id"));



CREATE POLICY "vendors view their own payments" ON "public"."payments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings"
  WHERE (("bookings"."id" = "payments"."booking_id") AND ("bookings"."vendor_id" = "auth"."uid"())))));



CREATE POLICY "vendors view their own sales submissions" ON "public"."sales_submissions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "vendor_id"));



ALTER TABLE "public"."venues" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venues viewable by authenticated users" ON "public"."venues" FOR SELECT TO "authenticated" USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."create_recurring_bookings_for_session"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_recurring_bookings_for_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_recurring_bookings_for_session"() TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_stale_bookings"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_stale_bookings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_stale_bookings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_profile_role_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_profile_role_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_profile_role_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_vendor_booking_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_vendor_booking_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_vendor_booking_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_vendor_verification_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_vendor_verification_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_vendor_verification_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


















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



































