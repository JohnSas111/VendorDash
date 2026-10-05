const ROOT = process.env.PROJECT_ROOT; if (!ROOT) { console.error("Set PROJECT_ROOT to the unzipped project folder (needs node_modules, run: npm ci --ignore-scripts)"); process.exit(1); }
const FN = ROOT + "/supabase/functions";
const ts = require(ROOT + "/node_modules/typescript");
const fs = require("fs"); const crypto = require("crypto"); const Module = require("module");

let results = []; const pass = (n, ok, extra="") => { results.push(ok); console.log((ok?"PASS":"FAIL")+" | "+n+(ok?"":"  <-- "+extra)); };

function load(file, env, mock) {
  const src = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "CommonJS", target: "ES2022" } }).outputText;
  let handler = null;
  const g = { Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } } };
  const m = new Module(file);
  m.require = (id) => { if (id === "jsr:@supabase/supabase-js@2") return { createClient: () => mock }; return require(id); };
  new Function("Deno","require","module","exports", js)(g.Deno, m.require, m, m.exports);
  return handler;
}

const SECRET = "whsk_test_secret_123", ENV = { PAYMONGO_WEBHOOK_SECRET: SECRET, PAYMONGO_SECRET_KEY: "sk_test_x", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "srv" };
const sign = (body, secret = SECRET, t = "1700000000", field = "te") => `t=${t},${field}=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}` + (field==="te" ? ",li=" : "");
const evt = (o={}) => JSON.stringify({ data: { attributes: { type: o.type ?? "source.chargeable", livemode: false, data: { id: o.id ?? "src_1", attributes: { amount: o.amount ?? 30400, currency: o.currency ?? "PHP" } } } } });
const req = (body, headers = {}, method = "POST") => new Request("http://f/x", { method, headers, body: method === "GET" ? undefined : body });

function mk(rpcImpl) { const calls = []; return { calls, auth: { getUser: async (t) => t === "good" ? { data: { user: { id: "vendor-1" } }, error: null } : { data: { user: null }, error: { message: "bad" } } }, rpc: async (n, a) => { calls.push([n, a]); return rpcImpl(n, a); } }; }
let fetchCalls = []; let fetchImpl;
global.fetch = async (url, opts) => { fetchCalls.push({ url, opts }); return fetchImpl(url, opts); };
const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rpcOk = (pre = "ok", apply = "paid") => (n) => ({ data: n === "payment_precheck" ? pre : apply, error: null });
const names = (m) => m.calls.map(c => c[0]).join(",");

(async () => {
console.log("===== WEBHOOK =====");
{ // W1 happy path
  const m = mk(rpcOk()); const h = load(FN + "/paymongo-webhook/index.ts", ENV, m);
  fetchCalls = []; fetchImpl = async () => resp(200, { data: { id: "pay_9", attributes: { status: "paid", amount: 30400 } } });
  const body = evt(); const r = await h(req(body, { "Paymongo-Signature": sign(body) })); const j = await r.json();
  pass("W1 valid signed event: precheck -> charge -> apply(paid)", r.status===200 && names(m)==="payment_precheck,payment_apply_result" && j.result==="paid");
  pass("W1b charge uses the event amount and an idempotency key", fetchCalls.length===1 && JSON.parse(fetchCalls[0].opts.body).data.attributes.amount===30400 && fetchCalls[0].opts.headers["Idempotency-Key"]==="vendordash-charge-src_1");
  pass("W1c apply receives PayMongo payment id + amount", m.calls[1][1].p_paymongo_payment_id==="pay_9" && m.calls[1][1].p_amount_cents===30400 && m.calls[1][1].p_outcome==="paid");
}
const attack = async (name, body, header, method="POST", env=ENV) => {
  const m = mk(rpcOk()); const h = load(FN + "/paymongo-webhook/index.ts", env, m);
  fetchCalls = []; fetchImpl = async () => resp(200, {});
  const r = await h(req(body, header===undefined?{}:{ "Paymongo-Signature": header }, method));
  return { r, m, untouched: m.calls.length===0 && fetchCalls.length===0 };
};
{ const b=evt(); const x=await attack("", b, undefined); pass("W2 NEG no signature header => 401, nothing touched", x.r.status===401 && x.untouched); }
{ const b=evt(); const x=await attack("", b, sign(evt({amount:1}))); pass("W3 NEG body altered after signing (amount 30400 -> 1) => 401", x.r.status===401 && x.untouched); }
{ const b=evt(); const x=await attack("", b, sign(b,"whsk_WRONG")); pass("W4 NEG signed with the wrong secret => 401", x.r.status===401 && x.untouched); }
{ const b=evt(); const x=await attack("", b, "t=1700000000,te=zzzz,li="); pass("W5 NEG non-hex signature => 401", x.r.status===401 && x.untouched); }
{ const b=evt(); const x=await attack("", b, sign(b).replace(/^t=\d+,/,"")); pass("W6 NEG header without timestamp => 401", x.r.status===401 && x.untouched); }
{ const b=evt(); const x=await attack("", b, "t=1700000000,te=,li="); pass("W7 NEG empty signatures => 401", x.r.status===401 && x.untouched); }
{ const b=evt(); const good=sign(b); const x=await attack("", b, good.replace(/t=\d+/, "t=1700000001")); pass("W8 NEG timestamp changed after signing => 401", x.r.status===401 && x.untouched); }
{ const b=evt(); const x=await attack("", b, sign(b,SECRET,"1700000000","li")); pass("W9 live-mode signature (li) also accepted when valid", x.r.status===200); }
{ const b=evt(); const x=await attack("", b, sign(b), "GET"); pass("W10 NEG GET request => 405", x.r.status===405 && x.untouched); }
{ const b=evt(); const x=await attack("", b, sign(b), "POST", {...ENV, PAYMONGO_WEBHOOK_SECRET: undefined}); pass("W11 NEG secret not configured => refuses everything (500), nothing touched", x.r.status===500 && x.untouched); }
{ const b=evt({type:"payment.paid"}); const x=await attack("", b, sign(b)); pass("W12 signed but other event type => 200 ignored, no DB/charge", x.r.status===200 && x.untouched); }
{ const b=evt({currency:"USD"}); const x=await attack("", b, sign(b)); pass("W13 non-PHP currency ignored", x.r.status===200 && x.untouched); }
for (const pre of ["already_paid","unknown_source","not_open","amount_mismatch","booking_not_payable"]) {
  const m = mk(rpcOk(pre)); const h = load(FN + "/paymongo-webhook/index.ts", ENV, m); fetchCalls=[]; fetchImpl=async()=>resp(200,{});
  const b=evt(); const r=await h(req(b,{ "Paymongo-Signature": sign(b) }));
  pass(`W14 precheck='${pre}' => NO charge, 200 (no retry storm), no apply`, r.status===200 && fetchCalls.length===0 && names(m)==="payment_precheck");
}
{ const m = mk(rpcOk()); const h = load(FN + "/paymongo-webhook/index.ts", ENV, m); fetchCalls=[]; fetchImpl=async()=>resp(503,{});
  const b=evt(); const r=await h(req(b,{ "Paymongo-Signature": sign(b) })); pass("W15 PayMongo 503 => 500 so PayMongo retries; result NOT recorded", r.status===500 && names(m)==="payment_precheck"); }
{ const m = mk(rpcOk()); const h = load(FN + "/paymongo-webhook/index.ts", ENV, m); fetchCalls=[]; fetchImpl=async()=>resp(200,{data:{id:"pay_p",attributes:{status:"pending",amount:30400}}});
  const b=evt(); const r=await h(req(b,{ "Paymongo-Signature": sign(b) })); pass("W16 charge still pending => 500 (retry), not marked failed", r.status===500 && names(m)==="payment_precheck"); }
{ const m = mk(rpcOk()); const h = load(FN + "/paymongo-webhook/index.ts", ENV, m); fetchCalls=[]; fetchImpl=async()=>resp(400,{errors:[{detail:"source already used"}]});
  const b=evt(); const r=await h(req(b,{ "Paymongo-Signature": sign(b) })); pass("W17 PayMongo 400 => recorded as failed", r.status===200 && m.calls[1] && m.calls[1][1].p_outcome==="failed" && m.calls[1][1].p_paymongo_payment_id===null); }
{ const m = mk((n)=> n==="payment_precheck"?{data:"ok",error:null}:{data:null,error:{message:"db down"}}); const h = load(FN + "/paymongo-webhook/index.ts", ENV, m); fetchCalls=[]; fetchImpl=async()=>resp(200,{data:{id:"pay_1",attributes:{status:"paid",amount:30400}}});
  const b=evt(); const r=await h(req(b,{ "Paymongo-Signature": sign(b) })); pass("W18 DB error while recording => 500 (PayMongo retries; DB + idempotency key make that safe)", r.status===500); }
{ const m = mk(()=>{ throw new Error("SECRET INTERNAL stack trace"); }); const h = load(FN + "/paymongo-webhook/index.ts", ENV, m);
  const b=evt(); const r=await h(req(b,{ "Paymongo-Signature": sign(b) })); const t=await r.text(); pass("W19 unexpected exception => 500 and NO internal details in response", r.status===500 && !t.includes("SECRET INTERNAL")); }
{ const m = mk(rpcOk()); const h = load(FN + "/paymongo-webhook/index.ts", ENV, m); fetchCalls=[]; fetchImpl=async()=>resp(200,{data:{id:"pay_9",attributes:{status:"paid",amount:30400}}});
  const b=evt(); const hd={ "Paymongo-Signature": sign(b) }; await h(req(b,hd)); await h(req(b,hd));
  pass("W20 same signed event delivered twice => handled both times (DB makes the 2nd a no-op)", names(m).split(",").filter(x=>x==="payment_precheck").length===2); }

console.log("\n===== CREATE-PAYMENT =====");
const CP = FN + "/create-payment/index.ts";
const rq = (body, token="good") => new Request("http://f/x", { method:"POST", headers: token? { Authorization: "Bearer "+token, "Content-Type":"application/json" } : {"Content-Type":"application/json"}, body: typeof body==="string"?body:JSON.stringify(body) });
const quoteRow = [{ amount_cents: 30400, stall_total_cents: 30000, fee_cents: 400, days: 3 }];
const src = (id="src_77") => resp(200, { data: { id, attributes: { redirect: { checkout_url: "https://pm/checkout/"+id } } } });
{ const m=mk((n)=>({data:n==="payment_quote"?quoteRow:null,error:null})); const h=load(CP,ENV,m); fetchCalls=[]; fetchImpl=async()=>src();
  const r=await h(rq({bookingId:"b1",method:"gcash",amountCents:1,vendorId:"someone-else"})); const j=await r.json();
  pass("C1 happy path returns checkout URL + server amount", r.status===200 && j.checkoutUrl==="https://pm/checkout/src_77" && j.amountCents===30400 && j.days===3);
  pass("C1b PayMongo is asked for the SERVER amount (client's amountCents:1 ignored)", JSON.parse(fetchCalls[0].opts.body).data.attributes.amount===30400);
  pass("C1c quote uses the LOGGED-IN user, not a vendorId from the body", m.calls[0][1].p_vendor_id==="vendor-1" && m.calls[0][1].p_booking_id==="b1");
  pass("C1d source registered with the same amount", names(m)==="payment_quote,payment_register" && m.calls[1][1].p_amount_cents===30400 && m.calls[1][1].p_source_id==="src_77");
}
{ const m=mk(()=>({data:null,error:null})); const h=load(CP,ENV,m); const r=await h(rq({bookingId:"b1",method:"gcash"},null)); pass("C2 NEG no login => 401, nothing touched", r.status===401 && m.calls.length===0); }
{ const m=mk(()=>({data:null,error:null})); const h=load(CP,ENV,m); fetchCalls=[]; const r=await h(rq({bookingId:"b1",method:"gcash"},"forged")); pass("C3 NEG invalid token => 401, nothing touched", r.status===401 && m.calls.length===0 && fetchCalls.length===0); }
{ const m=mk(()=>({data:null,error:null})); const h=load(CP,ENV,m); const r=await h(rq({bookingId:"b1",method:"bitcoin"})); pass("C4 NEG invalid method => 400", r.status===400 && m.calls.length===0); }
{ const m=mk(()=>({data:null,error:null})); const h=load(CP,ENV,m); const r=await h(rq({bookingId:{$ne:1},method:"gcash"})); pass("C5 NEG bookingId not a string => 400", r.status===400 && m.calls.length===0); }
{ const m=mk(()=>({data:null,error:null})); const h=load(CP,ENV,m); const r=await h(rq("not json")); pass("C6 NEG malformed JSON => 400", r.status===400); }
{ const m=mk(()=>({data:null,error:{code:"P0001",message:"This booking is not ready for payment."}})); const h=load(CP,ENV,m); fetchCalls=[]; const r=await h(rq({bookingId:"b1",method:"gcash"})); const j=await r.json();
  pass("C7 NEG booking not approved => readable message, NO PayMongo call", j.error==="This booking is not ready for payment." && fetchCalls.length===0 && names(m)==="payment_quote"); }
{ const m=mk(()=>({data:null,error:{code:"P0001",message:"Booking not found."}})); const h=load(CP,ENV,m); fetchCalls=[]; const r=await h(rq({bookingId:"someone-elses",method:"gcash"})); const j=await r.json();
  pass("C8 NEG someone else's booking => 'Booking not found.', NO PayMongo call", j.error==="Booking not found." && fetchCalls.length===0); }
{ const m=mk(()=>({data:null,error:{code:"XX000",message:"relation public.secret_table does not exist"}})); const h=load(CP,ENV,m); const r=await h(rq({bookingId:"b1",method:"gcash"})); const t=await r.text();
  pass("C9 NEG internal DB error is NOT shown to the app", !t.includes("secret_table") && t.includes("couldn't start")); }
{ const m=mk((n)=>({data:n==="payment_quote"?quoteRow:null,error:null})); const h=load(CP,ENV,m); fetchCalls=[]; fetchImpl=async()=>resp(400,{errors:[{detail:"Amount below minimum, key sk_test_LEAK"}]});
  const r=await h(rq({bookingId:"b1",method:"gcash"})); const t=await r.text(); pass("C10 NEG PayMongo's raw error is NOT passed to the app; nothing registered", !t.includes("LEAK") && !t.includes("minimum") && names(m)==="payment_quote"); }
{ const m=mk((n)=>({data:n==="payment_quote"?quoteRow:null,error:null})); const h=load(CP,ENV,m); fetchImpl=async()=>{ throw new Error("network down"); };
  const r=await h(rq({bookingId:"b1",method:"gcash"})); const j=await r.json(); pass("C11 PayMongo unreachable => friendly message, nothing registered", /not responding/.test(j.error) && names(m)==="payment_quote"); }
{ const m=mk((n)=>({data:n==="payment_quote"?quoteRow:null,error:n==="payment_register"?{code:"P0001",message:"This booking is not ready for payment."}:null})); const h=load(CP,ENV,m); fetchImpl=async()=>src();
  const r=await h(rq({bookingId:"b1",method:"paymaya"})); const j=await r.json(); pass("C12 booking changed during checkout setup => readable message, no URL returned", j.error==="This booking is not ready for payment." && !j.checkoutUrl); }
{ const h=load(CP,{...ENV,PAYMONGO_SECRET_KEY:undefined},mk(()=>({data:null,error:null}))); const r=await h(rq({bookingId:"b1",method:"gcash"})); pass("C13 NEG missing configuration => 500, nothing done", r.status===500); }

const failed = results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} passed`+(failed?` — ${failed} FAILED`:""));
})();
