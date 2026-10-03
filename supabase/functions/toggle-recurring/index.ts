import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Turning auto-renew ON needs a confirmed booking: the renewal job copies
// from the vendor's latest paid / checked-in / completed booking.
const CAN_TURN_ON = ["paid", "checked_in", "completed"];
// Turning it OFF is allowed on any live or finished booking, so a vendor can
// always stop auto-renew: including on an auto-requested booking that is
// still pending/approved, and after the market is completed (the renewal
// job still reads the completed booking's flag).
const CAN_TURN_OFF = ["pending", "approved", "paid", "checked_in", "completed"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Business-rule refusals come back as a normal response with a readable
// message, so the app can show it. (supabase.functions.invoke hides the body
// of non-2xx responses behind a generic error.)
function refuse(message: string) {
  return json({ success: false, error: message });
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Identify the calling vendor from their own JWT, rather than trusting
    // a vendorId passed in the request body.
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } =
      await supabase.auth.getUser(jwt);
    if (userError || !userData.user) {
      return json({ error: "Invalid session" }, 401);
    }
    const vendorId = userData.user.id;

    let body: { bookingId?: unknown; isRecurring?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const { bookingId, isRecurring } = body;
    if (typeof bookingId !== "string" || typeof isRecurring !== "boolean") {
      return json({ error: "Missing bookingId or isRecurring" }, 400);
    }

    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("id, vendor_id, status")
      .eq("id", bookingId)
      .maybeSingle();

    // Same answer for "does not exist" and "not yours", so this cannot be
    // used to find out which booking ids exist.
    if (fetchError || !booking || booking.vendor_id !== vendorId) {
      return json({ error: "Booking not found" }, 404);
    }

    if (isRecurring) {
      if (!CAN_TURN_ON.includes(booking.status)) {
        return refuse("Auto-renew can only be turned on for a paid booking.");
      }
      // Only verified vendors can auto-renew. (create_booking and the
      // renewal job apply the same rule; this makes the switch honest
      // instead of showing "on" while nothing would ever renew.)
      const { data: vendor, error: vendorError } = await supabase
        .from("vendor_details")
        .select("is_verified")
        .eq("id", vendorId)
        .maybeSingle();
      if (vendorError) {
        console.error("toggle-recurring: vendor lookup failed", vendorError);
        return json({ error: "Something went wrong. Please try again." }, 500);
      }
      if (vendor?.is_verified !== true) {
        return refuse(
          "Auto-renew is available once the organizer has verified your business.",
        );
      }
    } else if (!CAN_TURN_OFF.includes(booking.status)) {
      return refuse("Auto-renew can't be changed on this booking.");
    }

    const { error: updateError } = await supabase
      .from("bookings")
      .update({ is_recurring: isRecurring })
      .eq("id", bookingId)
      .eq("vendor_id", vendorId);

    if (updateError) {
      console.error("toggle-recurring: update failed", updateError);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }

    return json({ success: true });
  } catch (err) {
    // Details stay in the function logs, not in the response.
    console.error("toggle-recurring: unexpected error", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
