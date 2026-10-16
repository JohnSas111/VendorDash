// supabase/functions/send-push/index.ts
//
// Called by a Database Webhook every time a row is INSERTED into
// public.notifications. It sends that notification to the recipient's phone(s)
// through the Expo Push API (Expo forwards it to Firebase/FCM).
//
// Deploy with --no-verify-jwt (the database calls it, not a signed-in user).
// The ONLY protection is the shared secret check below, so keep it first:
//   header  x-webhook-secret  must equal the PUSH_WEBHOOK_SECRET function secret.
//
// A push that fails never affects the notification itself: the row is already
// saved and still shows in the in-app Notifications screen.

import { createClient } from "jsr:@supabase/supabase-js@2";

const PUSH_WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN"); // optional

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time comparison (hash both sides first so lengths always match).
async function safeEqual(a: string, b: string) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

type NotificationRecord = {
  id?: string;
  recipient_id?: string;
  title?: string;
  body?: string;
  type?: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!PUSH_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("send-push: missing function secrets");
    return json({ error: "server not configured" }, 500);
  }

  // 1. Is this really our database calling?
  const given = req.headers.get("x-webhook-secret") ?? "";
  if (!(await safeEqual(given, PUSH_WEBHOOK_SECRET))) {
    return json({ error: "unauthorized" }, 401);
  }

  // 2. Read the INSERT event.
  let payload: { type?: string; table?: string; record?: NotificationRecord };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const rec = payload.record;
  if (
    payload.type !== "INSERT" ||
    payload.table !== "notifications" ||
    !rec?.recipient_id ||
    !rec.title ||
    !rec.body
  ) {
    return json({ skipped: "not a notification insert" });
  }

  // 3. Find the recipient's phones.
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: rows, error } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", rec.recipient_id);
  if (error) {
    console.error("send-push: token lookup failed", error.message);
    return json({ error: "lookup failed" }, 500);
  }
  const tokens = (rows ?? []).map((r) => r.token as string);
  if (tokens.length === 0) return json({ sent: 0 });

  // 4. Send through Expo.
  const messages = tokens.map((to) => ({
    to,
    title: rec.title,
    body: rec.body,
    sound: "default",
    channelId: "default",
    priority: "high",
    data: { notificationId: rec.id ?? null, type: rec.type ?? null },
  }));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;

  let tickets: { status: string; details?: { error?: string } }[] = [];
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error("send-push: Expo returned", res.status);
      return json({ error: "expo failed" }, 502);
    }
    const out = await res.json();
    tickets = Array.isArray(out?.data) ? out.data : [];
  } catch (e) {
    console.error("send-push: Expo request failed", String(e));
    return json({ error: "expo unreachable" }, 502);
  }

  // 5. Remove tokens that Expo says are dead (app uninstalled, etc.).
  const dead = tokens.filter(
    (_t, i) =>
      tickets[i]?.status === "error" &&
      tickets[i]?.details?.error === "DeviceNotRegistered",
  );
  if (dead.length > 0) {
    const { error: delError } = await supabase
      .from("push_tokens")
      .delete()
      .in("token", dead);
    if (delError) console.error("send-push: cleanup failed", delError.message);
  }

  return json({
    sent: tickets.filter((t) => t.status === "ok").length,
    removed: dead.length,
  });
});
