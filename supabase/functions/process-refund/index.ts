import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Missing Authorization header", {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { booking_id, payment_id } = await req.json();
    if (!booking_id || !payment_id) {
      return new Response("booking_id and payment_id are required", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client scoped to the caller's own JWT, just to verify identity/role.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response("Not signed in", {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { data: profile } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "organizer") {
      return new Response("Organizer role required", {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Service-role client for the actual writes (bypasses RLS).
    const admin = createClient(supabaseUrl, serviceKey);

    // Confirm this booking's stall belongs to a venue this organizer owns.
    const { data: booking } = await admin
      .from("bookings")
      .select("id, status, stalls(venue_id, venues(organizer_id))")
      .eq("id", booking_id)
      .single();

    // @ts-ignore - nested select typing
    const venueOrganizerId = booking?.stalls?.venues?.organizer_id;
    if (!booking || venueOrganizerId !== user.id) {
      return new Response("Booking not found or not yours to refund", {
        status: 404,
        headers: corsHeaders,
      });
    }

    const { error: paymentErr } = await admin
      .from("payments")
      .update({ status: "refunded" })
      .eq("id", payment_id)
      .eq("booking_id", booking_id);

    if (paymentErr) {
      return new Response(`Failed to update payment: ${paymentErr.message}`, {
        status: 500,
        headers: corsHeaders,
      });
    }

    const { error: bookingErr } = await admin
      .from("bookings")
      .update({ status: "cancelled", refund_requested: false })
      .eq("id", booking_id);

    if (bookingErr) {
      return new Response(`Failed to update booking: ${bookingErr.message}`, {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(`Unexpected error: ${err.message}`, {
      status: 500,
      headers: corsHeaders,
    });
  }
});
