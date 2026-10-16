// Batch 3: send-push Edge Function (real TypeScript, mocked Supabase + Expo). Needs PROJECT_ROOT + node_modules.
const ROOT = process.env.PROJECT_ROOT;
if (!ROOT) {
  console.error("Set PROJECT_ROOT to the project folder");
  process.exit(1);
}
const ts = require(ROOT + "/node_modules/typescript");
const fs = require("fs");
const Module = require("module");
let res = [];
const pass = (n, ok, extra = "") => {
  res.push(ok);
  console.log(
    (ok ? "PASS" : "FAIL") + " | " + n + (ok ? "" : "  <-- " + extra),
  );
};

const SECRET = "push_secret_123";
const ENV = {
  PUSH_WEBHOOK_SECRET: SECRET,
  SUPABASE_URL: "http://x",
  SUPABASE_SERVICE_ROLE_KEY: "srv",
};
function load(env, db) {
  const file = ROOT + "/supabase/functions/send-push/index.ts";
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: "CommonJS", target: "ES2022" },
  }).outputText;
  let handler = null;
  const m = new Module(file);
  m.require = (id) =>
    id === "jsr:@supabase/supabase-js@2"
      ? { createClient: () => db }
      : require(id);
  new Function("Deno", "require", "module", "exports", js)(
    {
      env: { get: (k) => env[k] },
      serve: (h) => {
        handler = h;
      },
    },
    m.require,
    m,
    m.exports,
  );
  return handler;
}
function mkdb(tokens, lookupError) {
  const log = { deleted: null, user: null };
  return {
    log,
    from: () => ({
      select: () => ({
        eq: async (_c, v) => {
          log.user = v;
          return lookupError
            ? { data: null, error: { message: "boom" } }
            : { data: tokens.map((t) => ({ token: t })), error: null };
        },
      }),
      delete: () => ({
        in: async (_c, v) => {
          log.deleted = v;
          return { error: null };
        },
      }),
    }),
  };
}
let fetchCalls = [],
  fetchImpl;
global.fetch = async (u, o) => {
  fetchCalls.push({ u, o });
  return fetchImpl(u, o);
};
const ev = (o = {}) =>
  JSON.stringify({
    type: "INSERT",
    table: "notifications",
    record: {
      id: "n1",
      recipient_id: "u1",
      title: "Approved",
      body: "Stall A1 approved",
      type: "booking_approved",
      ...o,
    },
  });
const req = (body, hdr = { "x-webhook-secret": SECRET }, method = "POST") =>
  new Request("http://f/x", {
    method,
    headers: hdr,
    body: method === "GET" ? undefined : body,
  });
const ok = (data) => new Response(JSON.stringify({ data }), { status: 200 });

(async () => {
  {
    fetchCalls = [];
    fetchImpl = async () => ok([{ status: "ok" }]);
    const db = mkdb(["ExponentPushToken[a]"]);
    const r = await load(ENV, db)(req(ev()));
    const j = await r.json();
    const sent = JSON.parse(fetchCalls[0].o.body)[0];
    pass(
      "S1 valid event sends one push to the recipient's phone",
      r.status === 200 &&
        j.sent === 1 &&
        db.log.user === "u1" &&
        sent.to === "ExponentPushToken[a]" &&
        sent.title === "Approved" &&
        sent.body === "Stall A1 approved" &&
        sent.channelId === "default" &&
        sent.data.type === "booking_approved",
    );
  }
  {
    fetchCalls = [];
    fetchImpl = async () => ok([{ status: "ok" }, { status: "ok" }]);
    const r = await load(
      ENV,
      mkdb(["ExponentPushToken[a]", "ExponentPushToken[b]"]),
    )(req(ev()));
    const j = await r.json();
    pass(
      "S2 two phones => two messages, sent=2",
      j.sent === 2 && JSON.parse(fetchCalls[0].o.body).length === 2,
    );
  }
  {
    fetchCalls = [];
    const r = await load(ENV, mkdb([]))(req(ev()));
    const j = await r.json();
    pass(
      "S3 recipient has no phone => sent 0, Expo not called",
      r.status === 200 && j.sent === 0 && fetchCalls.length === 0,
    );
  }
  {
    fetchCalls = [];
    fetchImpl = async () =>
      ok([
        { status: "error", details: { error: "DeviceNotRegistered" } },
        { status: "ok" },
      ]);
    const db = mkdb(["ExponentPushToken[dead]", "ExponentPushToken[live]"]);
    const r = await load(ENV, db)(req(ev()));
    const j = await r.json();
    pass(
      "S4 dead token removed, live token kept",
      j.removed === 1 &&
        j.sent === 1 &&
        db.log.deleted.length === 1 &&
        db.log.deleted[0] === "ExponentPushToken[dead]",
    );
  }
  {
    fetchCalls = [];
    fetchImpl = async () =>
      ok([{ status: "error", details: { error: "MessageRateExceeded" } }]);
    const db = mkdb(["ExponentPushToken[a]"]);
    const r = await load(ENV, db)(req(ev()));
    pass(
      "S5 other Expo error does NOT delete the token",
      r.status === 200 && db.log.deleted === null,
    );
  }
  const neg = async (
    name,
    mk2,
    check = (r, calls) => r.status === 401 && calls === 0,
  ) => {
    fetchCalls = [];
    fetchImpl = async () => ok([]);
    const r = await mk2();
    pass(name, check(r, fetchCalls.length));
  };
  await neg("S6 NEG no secret header => 401, Expo not called", () =>
    load(ENV, mkdb(["ExponentPushToken[a]"]))(req(ev(), {})),
  );
  await neg("S7 NEG wrong secret => 401", () =>
    load(
      ENV,
      mkdb(["ExponentPushToken[a]"]),
    )(req(ev(), { "x-webhook-secret": "nope" })),
  );
  await neg(
    "S8 NEG secret not configured on server => 500, nothing sent",
    () =>
      load(
        { ...ENV, PUSH_WEBHOOK_SECRET: undefined },
        mkdb(["ExponentPushToken[a]"]),
      )(req(ev(), { "x-webhook-secret": "" })),
    (r, c) => r.status === 500 && c === 0,
  );
  await neg(
    "S9 NEG GET => 405",
    () => load(ENV, mkdb([]))(req(ev(), { "x-webhook-secret": SECRET }, "GET")),
    (r, c) => r.status === 405 && c === 0,
  );
  await neg(
    "S10 NEG UPDATE event ignored",
    () =>
      load(
        ENV,
        mkdb(["ExponentPushToken[a]"]),
      )(
        req(
          JSON.stringify({
            type: "UPDATE",
            table: "notifications",
            record: { recipient_id: "u1", title: "t", body: "b" },
          }),
        ),
      ),
    (r, c) => r.status === 200 && c === 0,
  );
  await neg(
    "S11 NEG other table ignored",
    () =>
      load(
        ENV,
        mkdb(["ExponentPushToken[a]"]),
      )(
        req(
          JSON.stringify({
            type: "INSERT",
            table: "payments",
            record: { recipient_id: "u1", title: "t", body: "b" },
          }),
        ),
      ),
    (r, c) => r.status === 200 && c === 0,
  );
  await neg(
    "S12 NEG record without recipient ignored",
    () =>
      load(
        ENV,
        mkdb(["ExponentPushToken[a]"]),
      )(req(ev({ recipient_id: undefined }))),
    (r, c) => r.status === 200 && c === 0,
  );
  await neg(
    "S13 NEG bad JSON => 400",
    () => load(ENV, mkdb([]))(req("{not json")),
    (r, c) => r.status === 400 && c === 0,
  );
  await neg(
    "S14 NEG token lookup fails => 500, nothing sent",
    () => load(ENV, mkdb([], true))(req(ev())),
    (r, c) => r.status === 500 && c === 0,
  );
  {
    fetchCalls = [];
    fetchImpl = async () => new Response("down", { status: 503 });
    const r = await load(ENV, mkdb(["ExponentPushToken[a]"]))(req(ev()));
    pass("S15 NEG Expo down => 502 (no crash)", r.status === 502);
  }
  {
    fetchCalls = [];
    fetchImpl = async () => {
      throw new Error("net");
    };
    const r = await load(ENV, mkdb(["ExponentPushToken[a]"]))(req(ev()));
    pass("S16 NEG network error => 502 (no crash)", r.status === 502);
  }
  console.log(res.filter(Boolean).length + "/" + res.length + " passed");
})();
