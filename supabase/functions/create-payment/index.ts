// supabase/functions/create-payment/index.ts
//
// Starts a GCash / Maya payment for an APPROVED booking.
// Deploy with verify_jwt ON (the default): only a signed-in vendor can call it.
//
// The amount is NEVER taken from the app. It is worked out by the database
// function payment_quote: stall price x attending days + the service fee.

import { createClient } from "jsr:@supabase/supabase-js@2";

const PAYMONGO_SECRET_KEY = Deno.env.get("PAYMONGO_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const REDIRECT_BASE = "https://vendordash-payment-page.vercel.app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Refusals come back as a normal response with a readable message, so the app
// can show it. (supabase.functions.invoke hides the body of non-2xx responses
// behind a generic error.)
function refuse(message: string) {
  return json({ error: message });
}

// Our database functions raise plain-language messages (SQLSTATE P0001).
// Those are safe to show. Anything else is logged and replaced.
function friendly(
  error: { code?: string; message?: string },
  fallback: string,
) {
  return error.code === "P0001" && error.message ? error.message : fallback;
}

Deno.serve(async (req) => {
  try {
    if (!PAYMONGO_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("create-payment: missing configuration");
      return json({ error: "Not configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Authentication required" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Identify the vendor from their own login, never from the request body.
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) {
      return json({ error: "Invalid authentication" }, 401);
    }

    let body: { bookingId?: unknown; method?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const { bookingId, method } = body;
    if (typeof bookingId !== "string" || typeof method !== "string") {
      return json({ error: "Missing bookingId or payment method" }, 400);
    }
    if (method !== "gcash" && method !== "paymaya") {
      return json({ error: "Invalid payment method" }, 400);
    }

    // 1. What does this vendor owe? Also checks: it is THEIR booking, it is
    //    approved, and the payment deadline has not passed.
    const { data: quoteRows, error: quoteError } = await supabase.rpc(
      "payment_quote",
      { p_booking_id: bookingId, p_vendor_id: user.id },
    );
    if (quoteError) {
      console.error("create-payment: quote refused", quoteError);
      return refuse(friendly(quoteError, "We couldn't start this payment."));
    }
    const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    if (!quote || !Number.isInteger(quote.amount_cents)) {
      console.error("create-payment: quote missing", quoteRows);
      return refuse("We couldn't work out the amount for this booking.");
    }

    // 2. Ask PayMongo for a checkout link for exactly that amount.
    let sourceResponse: Response;
    try {
      sourceResponse = await fetch("https://api.paymongo.com/v1/sources", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(PAYMONGO_SECRET_KEY + ":")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            attributes: {
              amount: quote.amount_cents,
              currency: "PHP",
              type: method,
              redirect: {
                success: `${REDIRECT_BASE}?status=success`,
                failed: `${REDIRECT_BASE}?status=failed`,
              },
            },
          },
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      console.error("create-payment: PayMongo unreachable", err);
      return refuse("The payment service is not responding. Please try again.");
    }

    const sourceData = await sourceResponse.json().catch(() => null);
    if (!sourceResponse.ok) {
      // PayMongo's raw message stays in the logs, not in the app.
      console.error("create-payment: PayMongo refused", {
        status: sourceResponse.status,
        body: JSON.stringify(sourceData),
      });
      return refuse("We couldn't start the payment. Please try again.");
    }

    const sourceId = sourceData?.data?.id;
    const checkoutUrl = sourceData?.data?.attributes?.redirect?.checkout_url;
    if (typeof sourceId !== "string" || !checkoutUrl) {
      console.error(
        "create-payment: no checkout URL",
        JSON.stringify(sourceData),
      );
      return refuse("We couldn't start the payment. Please try again.");
    }

    // 3. Remember it. This also retires any older open source for the same
    //    booking, so only the newest checkout can ever be charged.
    const { error: registerError } = await supabase.rpc("payment_register", {
      p_booking_id: bookingId,
      p_source_id: sourceId,
      p_source_type: method,
      p_amount_cents: quote.amount_cents,
    });
    if (registerError) {
      console.error("create-payment: could not record payment", registerError);
      return refuse(friendly(registerError, "We couldn't start this payment."));
    }

    return json({
      checkoutUrl,
      amountCents: quote.amount_cents,
      stallTotalCents: quote.stall_total_cents,
      feeCents: quote.fee_cents,
      days: quote.days,
    });
  } catch (err) {
    console.error("create-payment: unexpected error", err);
    return json({ error: "Unable to create payment" }, 500);
  }
});
