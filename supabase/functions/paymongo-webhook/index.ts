// supabase/functions/paymongo-webhook/index.ts
//
// PayMongo calls THIS function directly (not your app) when a payment source
// becomes chargeable. It must be deployed with --no-verify-jwt (PayMongo has
// no Supabase login), so the ONLY thing protecting it is the signature check
// below. Everything else in the project trusts this function to be honest.
//
// Order of work (never change this order):
//   1. verify PayMongo's signature on the RAW body   -> else 401, do nothing
//   2. payment_precheck  (DB)  is this source still safe to charge?
//   3. charge it at PayMongo (idempotency key => a retry never double-charges)
//   4. payment_apply_result (DB) mark paid/failed in ONE transaction
//
// Replayed or retried events are harmless: the database functions are
// idempotent and a paid payment can never be downgraded.

import { createClient } from "jsr:@supabase/supabase-js@2";

const PAYMONGO_SECRET_KEY = Deno.env.get("PAYMONGO_SECRET_KEY");
const PAYMONGO_WEBHOOK_SECRET = Deno.env.get("PAYMONGO_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null; // SHA-256 = 64 hex chars
  const out = new Uint8Array(new ArrayBuffer(32));
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// PayMongo sends:  Paymongo-Signature: t=<timestamp>,te=<test sig>,li=<live sig>
// The signed text is  "<t>.<raw request body>"  hashed with HMAC-SHA256 using
// the webhook's secret key. A request is genuine only if the test signature
// (test events) or the live signature (live events) matches.
// crypto.subtle.verify compares in constant time.
async function isValidSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;

  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i > 0) parts.set(piece.slice(0, i).trim(), piece.slice(i + 1).trim());
  }
  const timestamp = parts.get("t");
  if (!timestamp) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedText = encoder.encode(`${timestamp}.${rawBody}`);

  for (const field of ["te", "li"]) {
    const signature = hexToBytes(parts.get(field) ?? "");
    if (
      signature &&
      (await crypto.subtle.verify("HMAC", key, signature, signedText))
    ) {
      return true;
    }
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Fail CLOSED: with no secrets configured we refuse everything.
    if (
      !PAYMONGO_WEBHOOK_SECRET ||
      !PAYMONGO_SECRET_KEY ||
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      console.error("paymongo-webhook: missing configuration");
      return json({ error: "Not configured" }, 500);
    }

    // 1. Signature, on the raw body, before anything else is touched.
    const rawBody = await req.text();
    const valid = await isValidSignature(
      rawBody,
      req.headers.get("Paymongo-Signature"),
      PAYMONGO_WEBHOOK_SECRET,
    );
    if (!valid) {
      console.warn("paymongo-webhook: rejected request with invalid signature");
      return json({ error: "Invalid signature" }, 401);
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const eventType = event?.data?.attributes?.type;
    if (eventType !== "source.chargeable") {
      // Signed, but not an event we act on.
      return json({ received: true, ignored: eventType ?? "unknown" });
    }

    const source = event?.data?.attributes?.data;
    const sourceId = source?.id;
    const amount = source?.attributes?.amount;
    const currency = source?.attributes?.currency;
    if (
      typeof sourceId !== "string" ||
      !Number.isInteger(amount) ||
      (currency && currency !== "PHP")
    ) {
      console.warn("paymongo-webhook: malformed or non-PHP source event");
      return json({ received: true, ignored: "malformed" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 2. Is this source still safe to charge? (amount, booking state, replays)
    const { data: precheck, error: precheckError } = await supabase.rpc(
      "payment_precheck",
      { p_source_id: sourceId, p_amount_cents: amount },
    );
    if (precheckError) {
      console.error("paymongo-webhook: precheck failed", precheckError);
      return json({ error: "Temporary error" }, 500); // PayMongo retries
    }
    if (precheck !== "ok") {
      // already_paid / unknown_source / not_open / amount_mismatch /
      // booking_not_payable: all final. Nothing is charged. Answer 200 so
      // PayMongo does not retry.
      console.log("paymongo-webhook: not charging", { sourceId, precheck });
      return json({ received: true, result: precheck });
    }

    // 3. Charge. The idempotency key means a retried webhook cannot
    //    charge the same source twice.
    let paymentResponse: Response;
    try {
      paymentResponse = await fetch("https://api.paymongo.com/v1/payments", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(PAYMONGO_SECRET_KEY + ":")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `vendordash-charge-${sourceId}`,
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
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      console.error("paymongo-webhook: PayMongo unreachable", err);
      return json({ error: "Temporary error" }, 500); // retry later
    }

    const paymentData = await paymentResponse.json().catch(() => null);
    const paymentStatus = paymentData?.data?.attributes?.status;

    // Temporary trouble at PayMongo, or a charge still pending: let PayMongo
    // retry this webhook. The idempotency key makes the retry safe.
    if (
      paymentResponse.status >= 500 ||
      paymentResponse.status === 429 ||
      (paymentResponse.ok && paymentStatus === "pending")
    ) {
      console.error("paymongo-webhook: charge not final yet", {
        sourceId,
        status: paymentResponse.status,
        paymentStatus,
      });
      return json({ error: "Temporary error" }, 500);
    }

    // 4. Record the outcome in one database transaction.
    const paid = paymentResponse.ok && paymentStatus === "paid";
    if (!paid) {
      console.error("paymongo-webhook: charge failed", {
        sourceId,
        status: paymentResponse.status,
        body: JSON.stringify(paymentData),
      });
    }

    const { data: result, error: applyError } = await supabase.rpc(
      "payment_apply_result",
      {
        p_source_id: sourceId,
        p_outcome: paid ? "paid" : "failed",
        p_paymongo_payment_id: paid ? (paymentData?.data?.id ?? null) : null,
        p_amount_cents: paid
          ? (paymentData?.data?.attributes?.amount ?? null)
          : null,
      },
    );
    if (applyError) {
      console.error("paymongo-webhook: could not record result", applyError);
      return json({ error: "Temporary error" }, 500); // retry: idempotent
    }

    return json({ received: true, result });
  } catch (err) {
    // Details stay in the function logs, never in the response.
    console.error("paymongo-webhook: unexpected error", err);
    return json({ error: "Unexpected error" }, 500);
  }
});
