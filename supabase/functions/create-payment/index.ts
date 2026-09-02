import { createClient } from "jsr:@supabase/supabase-js@2";

const PAYMONGO_SECRET_KEY = Deno.env.get("PAYMONGO_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const { bookingId, amountCents, method } = await req.json();

    if (!bookingId || !amountCents || !method) {
      return new Response(
        JSON.stringify({ error: "Missing bookingId, amountCents, or method" }),
        {
          status: 400,
        },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
      console.error(
        "PayMongo rejected the request:",
        JSON.stringify(sourceData),
      );
      return new Response(
        JSON.stringify({
          error: sourceData?.errors?.[0]?.detail ?? "PayMongo error",
        }),
        {
          status: 400,
        },
      );
    }

    const sourceId = sourceData.data.id;
    const checkoutUrl = sourceData.data.attributes.redirect.checkout_url;

    await supabase.from("payments").insert({
      booking_id: bookingId,
      amount_cents: amountCents,
      paymongo_payment_intent_id: sourceId,
      paymongo_source_type: method,
      status: "processing",
    });

    return new Response(JSON.stringify({ checkoutUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
