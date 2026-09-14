import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Identify the calling vendor from their own JWT, rather than trusting
    // a vendorId passed in the request body.
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } =
      await supabase.auth.getUser(jwt);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
      });
    }
    const vendorId = userData.user.id;

    const { bookingId, isRecurring } = await req.json();
    if (!bookingId || typeof isRecurring !== "boolean") {
      return new Response(
        JSON.stringify({ error: "Missing bookingId or isRecurring" }),
        { status: 400 },
      );
    }

    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("id, vendor_id, status")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
      });
    }
    if (booking.vendor_id !== vendorId) {
      return new Response(JSON.stringify({ error: "Not your booking" }), {
        status: 403,
      });
    }
    // Auto-renew only makes sense once a booking is actually confirmed —
    // pending/approved bookings use the checkbox on Stall Detail instead.
    if (!["paid", "checked_in"].includes(booking.status)) {
      return new Response(
        JSON.stringify({
          error: "Auto-renew can only be changed on a paid booking",
        }),
        { status: 400 },
      );
    }

    const { error: updateError } = await supabase
      .from("bookings")
      .update({ is_recurring: isRecurring })
      .eq("id", bookingId);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
