import { createClient } from "jsr:@supabase/supabase-js@2";

const PAYMONGO_SECRET_KEY = Deno.env.get("PAYMONGO_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SERVICE_FEE_CENTS = 400;

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify the logged-in user.
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { bookingId, method } = await req.json();

    if (!bookingId || !method) {
      console.log("CREATE PAYMENT VALIDATION FAILED:", {
        bookingId,
        method,
      });

      return new Response(
        JSON.stringify({
          error: "Missing bookingId or payment method",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (method !== "gcash" && method !== "paymaya") {
      return new Response(JSON.stringify({ error: "Invalid payment method" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Load the booking together with its stall.
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select(
        `
        id,
        vendor_id,
        status,
        stall_id,
        stalls (
          id,
          price_per_day_cents,
          venue_id
        )
      `,
      )
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      console.log("BOOKING LOOKUP FAILED:", bookingError);

      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // The booking must belong to the logged-in vendor.
    if (booking.vendor_id !== user.id) {
      return new Response(
        JSON.stringify({
          error: "You are not allowed to pay for this booking",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Only approved bookings can be paid.
    if (booking.status !== "approved") {
      console.log("BOOKING STATUS NOT APPROVED:", booking.status);

      return new Response(
        JSON.stringify({
          error: "This booking is not available for payment",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const stall = Array.isArray(booking.stalls)
      ? booking.stalls[0]
      : booking.stalls;

    if (!stall?.price_per_day_cents) {
      console.log("STALL PRICE MISSING:", stall);

      return new Response(
        JSON.stringify({
          error: "Stall price could not be determined",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Calculate the amount from the database.
    const stallTotal = stall.price_per_day_cents;
    const amountCents = stallTotal + SERVICE_FEE_CENTS;

    console.log("PAYMENT AMOUNT:", {
      stallTotal,
      serviceFee: SERVICE_FEE_CENTS,
      amountCents,
      method,
    });

    const redirectBase = "https://vendordash-payment-page.vercel.app";

    const sourceResponse = await fetch("https://api.paymongo.com/v1/sources", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(PAYMONGO_SECRET_KEY + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: amountCents,
            currency: "PHP",
            type: method,
            redirect: {
              success: `${redirectBase}?status=success`,
              failed: `${redirectBase}?status=failed`,
            },
          },
        },
      }),
    });

    const sourceData = await sourceResponse.json();

    if (!sourceResponse.ok) {
      console.log("PAYMONGO STATUS:", sourceResponse.status);

      console.log("PAYMONGO RESPONSE:", JSON.stringify(sourceData));

      return new Response(
        JSON.stringify({
          error: sourceData?.errors?.[0]?.detail ?? "PayMongo error",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    const sourceId = sourceData.data.id;
    const checkoutUrl = sourceData.data.attributes.redirect.checkout_url;

    if (!checkoutUrl) {
      console.log(
        "PAYMONGO DID NOT RETURN CHECKOUT URL:",
        JSON.stringify(sourceData),
      );

      return new Response(
        JSON.stringify({
          error: "PayMongo did not return a checkout URL",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        booking_id: bookingId,
        amount_cents: amountCents,
        paymongo_payment_intent_id: sourceId,
        paymongo_source_type: method,
        status: "processing",
      });

    if (paymentError) {
      console.error("Failed to create payment record:", paymentError);

      return new Response(
        JSON.stringify({
          error: "Failed to create payment record",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        checkoutUrl,
        amountCents,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("create-payment error:", err);

    return new Response(
      JSON.stringify({
        error: "Unable to create payment",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
