// supabase/functions/paymongo-webhook/index.ts
//
// PayMongo calls THIS function directly (not your app) when a payment's
// status changes. This is what actually marks a booking as paid — never
// trust the app itself to report "I paid," always trust PayMongo's
// server-to-server call.

import { createClient } from "jsr:@supabase/supabase-js@2";

const PAYMONGO_SECRET_KEY = Deno.env.get("PAYMONGO_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const event = await req.json();
    const eventType = event?.data?.attributes?.type;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (eventType === "source.chargeable") {
      const source = event.data.attributes.data;
      const sourceId = source.id;
      const amount = source.attributes.amount;

      // Correct endpoint per PayMongo's Sources workflow docs: /v1/payments,
      // not /v1/charges (that was the bug — wrong endpoint entirely).
      const paymentResponse = await fetch(
        "https://api.paymongo.com/v1/payments",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(PAYMONGO_SECRET_KEY + ":")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: {
              attributes: {
                amount,
                currency: "PHP",
                source: { id: sourceId, type: "source" },
                description: "VendorDash stall booking",
              },
            },
          }),
        },
      );

      const paymentData = await paymentResponse.json();
      const paymentStatus = paymentData?.data?.attributes?.status;

      if (!paymentResponse.ok) {
        console.error("Create payment failed:", JSON.stringify(paymentData));
      }

      if (paymentResponse.ok && paymentStatus === "paid") {
        const { data: paymentRow } = await supabase
          .from("payments")
          .select("id, booking_id")
          .eq("paymongo_payment_intent_id", sourceId)
          .single();

        if (paymentRow) {
          await supabase
            .from("payments")
            .update({ status: "paid", paid_at: new Date().toISOString() })
            .eq("id", paymentRow.id);

          const { data: bookingRow } = await supabase
            .from("bookings")
            .update({ status: "paid" })
            .eq("id", paymentRow.booking_id)
            .select("vendor_id, stall_id, stalls(stall_number)")
            .single();

          if (bookingRow?.vendor_id) {
            const stallNumber =
              (bookingRow as any).stalls?.stall_number ?? "your stall";
            await supabase.from("notifications").insert({
              recipient_id: bookingRow.vendor_id,
              title: "Payment confirmed",
              body: `Your payment for ${stallNumber} was received. See you at the market!`,
              type: "payment_confirmed",
            });
          }
        }
      } else {
        await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("paymongo_payment_intent_id", sourceId);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
