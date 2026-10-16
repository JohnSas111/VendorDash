// Usage: PROJECT_ROOT=/path/to/project node booking_details_test.js   (needs node_modules)
const fs = require("fs"),
  path = require("path");
const ROOT = process.env.PROJECT_ROOT;
const ts = require(ROOT + "/node_modules/typescript");
const cache = {};
const RN = new Proxy(
  {
    StyleSheet: { create: (o) => o, flatten: (o) => o, hairlineWidth: 1 },
    Platform: {
      OS: "web",
      select: (o) => o.web ?? o.default ?? Object.values(o)[0],
    },
    Dimensions: { get: () => ({ width: 1000, height: 800 }) },
  },
  { get: (t, k) => (k in t ? t[k] : undefined) },
);
function load(file) {
  if (cache[file]) return cache[file].exports;
  const src = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: "CommonJS", target: "ES2022", jsx: "react" },
  }).outputText;
  const m = { exports: {} };
  cache[file] = m;
  const req = (id) => {
    if (id === "react-native") return RN;
    if (id.startsWith("@/")) {
      const base = path.join(ROOT, id.slice(2));
      for (const e of [".ts", ".tsx", "/index.ts"])
        if (fs.existsSync(base + e)) return load(base + e);
    }
    return new Proxy({}, { get: () => () => null });
  };
  new Function("module", "exports", "require", js)(m, m.exports, req);
  return m.exports;
}
let n = 0,
  f = 0;
const t = (name, ok, x = "") => {
  n++;
  if (!ok) f++;
  console.log(
    (ok ? "PASS" : "FAIL") +
      " | " +
      name +
      (ok ? "" : "  <-- " + JSON.stringify(x)),
  );
};
const B = load(ROOT + "/lib/bookingDetails.ts");
const J = (x) => JSON.stringify(x);
const pay = (o) => ({
  id: "p" + Math.random(),
  amount_cents: 2000,
  status: "paid",
  paid_at: "2026-10-14T12:42:00Z",
  created_at: "2026-10-14T12:40:00Z",
  source_type: "gcash",
  reference: "pay_8f3a1c9d2e41c21d",
  ...o,
});
const bk = (o = {}) => ({
  id: "b1",
  status: "paid",
  requested_at: "2026-10-13T10:10:00Z",
  decided_at: "2026-10-13T11:02:00Z",
  checked_in_at: null,
  completed_at: null,
  payment_due_at: "2026-10-14T11:02:00Z",
  attending_days: ["saturday", "friday"],
  vendor_id: "v1",
  vendor_name: "Seafoods",
  owner_name: "John Doe",
  phone: "0917",
  vendor_verified: true,
  stall_number: "A4",
  price_per_day_cents: 800,
  payments: [pay()],
  refunds: [],
  ...o,
});
// ---- labels
t(
  "L01 days in week order, whatever the stored order",
  B.daysShort(["sunday", "friday"]) === "Fri, Sun" &&
    B.daysShort(["saturday", "friday", "sunday"]) === "Fri, Sat, Sun",
);
t(
  "L02 no days -> empty text, null-safe",
  B.daysShort([]) === "" && B.daysShort(null) === "",
);
t(
  "L03 day count is distinct",
  B.dayCount(["friday", "friday", "saturday"]) === 2 && B.dayCount(null) === 0,
);
t(
  "L04 method names",
  B.methodLabel("gcash") === "GCash" &&
    B.methodLabel("paymaya") === "Maya" &&
    B.methodLabel(null) === "—" &&
    B.methodLabel("other") === "other",
);
t(
  "L05 long reference is shortened, short one is kept",
  B.shortRef("pay_8f3a1c9d2e41c21d") === "pay_8f3a…c21d" &&
    B.shortRef("pay_1") === "pay_1" &&
    B.shortRef(null) === "",
);
t(
  "L06 booking status labels",
  B.bookingStatusLabel("checked_in") === "Checked in" &&
    B.bookingStatusLabel("no_show") === "No-show" &&
    B.bookingStatusLabel("approved") === "Approved",
);
t(
  "L07 date-time: bad input is a dash, good input has the month",
  B.formatDateTime("nonsense") === "—" &&
    B.formatDateTime(null) === "—" &&
    /Oct/.test(B.formatDateTime("2026-10-14T12:42:00Z")),
);
t(
  "L08 times are shown in the VENUE time zone (12:42 UTC = 8:42 PM in Manila), bad zone does not crash",
  /8:42 PM/.test(B.formatDateTime("2026-10-14T12:42:00Z", "Asia/Manila")) &&
    /12:42 PM/.test(B.formatDateTime("2026-10-14T12:42:00Z", "UTC")) &&
    typeof B.formatDateTime("2026-10-14T12:42:00Z", "Not/AZone") === "string",
);
// ---- which payment counts
t(
  "P01 paid beats an older failed try",
  B.pickPayment([
    pay({
      status: "failed",
      paid_at: null,
      created_at: "2026-10-14T10:00:00Z",
    }),
    pay({ status: "paid" }),
  ]).status === "paid",
);
t(
  "P02 processing beats pending beats failed",
  B.pickPayment([
    pay({ status: "failed" }),
    pay({ status: "pending" }),
    pay({ status: "processing" }),
  ]).status === "processing" &&
    B.pickPayment([pay({ status: "failed" }), pay({ status: "pending" })])
      .status === "pending",
);
t(
  "P03 two paid: the newest wins",
  B.pickPayment([
    pay({ id: "old", paid_at: "2026-10-10T00:00:00Z" }),
    pay({ id: "new", paid_at: "2026-10-14T00:00:00Z" }),
  ]).id === "new",
);
t(
  "P04 no payments -> null",
  B.pickPayment([]) === null && B.pickPayment(null) === null,
);
// ---- money breakdown
const unpaid = bk({ status: "approved", payments: [] });
const b1 = B.breakdown(unpaid);
t(
  "M01 unpaid: 8.00 x 2 days = 16.00 + 4.00 fee = 20.00 (same rule as payment_quote)",
  b1.stallCents === 1600 &&
    b1.feeCents === 400 &&
    b1.totalCents === 2000 &&
    b1.perDayCents === 800 &&
    b1.isActual === false,
  b1,
);
const b2 = B.breakdown(bk());
t(
  "M02 paid: uses the amount really charged",
  b2.totalCents === 2000 && b2.stallCents === 1600 && b2.isActual === true,
  b2,
);
const b3 = B.breakdown(bk({ payments: [pay({ amount_cents: 1000 })] }));
t(
  "M03 price changed after payment: the charged amount wins (10.00 -> stall 6.00)",
  b3.totalCents === 1000 && b3.stallCents === 600 && b3.perDayCents === 300,
  b3,
);
t(
  "M04 stall part that does not split evenly has no per-day price",
  B.breakdown(bk({ payments: [pay({ amount_cents: 1101 })] })).perDayCents ===
    null,
);
const b5 = B.breakdown(
  bk({ status: "approved", payments: [], price_per_day_cents: 0 }),
);
t(
  "M05 no price and no payment -> all zero, never a lone fee",
  b5.totalCents === 0 && b5.feeCents === 0 && b5.stallCents === 0,
  b5,
);
const b6 = B.breakdown(bk({ payments: [pay({ amount_cents: 300 })] }));
t(
  "M06 tiny payment below the fee: no negative stall amount",
  b6.stallCents === 0 && b6.feeCents === 300 && b6.totalCents === 300,
  b6,
);
t(
  "M07 one day: 1 day price",
  B.breakdown(
    bk({ status: "approved", payments: [], attending_days: ["sunday"] }),
  ).totalCents === 1200,
);
// ---- payment state
const S = (o) => B.paymentSummary(bk(o));
t(
  "S01 paid: amount, method, paid date, reference",
  (() => {
    const s = S({});
    return (
      s.kind === "paid" &&
      s.amountCents === 2000 &&
      s.method === "GCash" &&
      s.paidAt === "2026-10-14T12:42:00Z" &&
      s.reference === "pay_8f3a1c9d2e41c21d"
    );
  })(),
);
t(
  "S02 refunded payment",
  S({ payments: [pay({ status: "refunded" })] }).kind === "refunded",
);
t(
  "S03 processing / failed / pending payment",
  S({
    status: "approved",
    payments: [pay({ status: "processing", paid_at: null })],
  }).kind === "processing" &&
    S({
      status: "approved",
      payments: [pay({ status: "failed", paid_at: null })],
    }).kind === "failed" &&
    S({
      status: "approved",
      payments: [pay({ status: "pending", paid_at: null })],
    }).kind === "waiting",
);
t(
  "S04 approved with no payment: waiting, expected total 20.00, no date",
  (() => {
    const s = S({ status: "approved", payments: [] });
    return (
      s.kind === "waiting" &&
      s.amountCents === 2000 &&
      s.paidAt === null &&
      s.method === "—"
    );
  })(),
);
t(
  "S05 pending / rejected / cancelled / expired with no payment: no money",
  S({ status: "pending", payments: [] }) === null &&
    S({ status: "rejected", payments: [] }) === null &&
    S({ status: "cancelled", payments: [] }) === null &&
    S({ status: "expired", payments: [] }) === null,
);
t(
  "S06 unpaid attempt has no paid date even if a stray value exists",
  S({
    status: "approved",
    payments: [pay({ status: "failed", paid_at: "2026-10-14T12:42:00Z" })],
  }).paidAt === null,
);
// ---- row money line
t(
  "R01 paid row line",
  J(B.rowMoneyNote(bk())) === J({ amountCents: 2000, note: "paid with GCash" }),
);
t(
  "R02 waiting / refunded / failed / processing wording",
  B.rowMoneyNote(bk({ status: "approved", payments: [] })).note ===
    "waiting for payment" &&
    B.rowMoneyNote(bk({ payments: [pay({ status: "refunded" })] })).note ===
      "refunded" &&
    B.rowMoneyNote(
      bk({ status: "approved", payments: [pay({ status: "failed" })] }),
    ).note === "payment failed" &&
    B.rowMoneyNote(
      bk({ status: "approved", payments: [pay({ status: "processing" })] }),
    ).note === "payment processing",
);
t(
  "R03 pending request shows the expected total, clearly not paid",
  J(B.rowMoneyNote(bk({ status: "pending", payments: [] }))) ===
    J({ amountCents: 2000, note: "if approved, not paid yet" }),
);
t(
  "R04 rejected: no line; pending with no price: no line",
  B.rowMoneyNote(bk({ status: "rejected", payments: [] })) === null &&
    B.rowMoneyNote(
      bk({ status: "pending", payments: [], price_per_day_cents: 0 }),
    ) === null,
);
// ---- refunds
const rf = (status, amt = null) => ({
  id: "r" + status,
  status,
  refund_amount_cents: amt,
  refunded_at: status === "refunded" ? "2026-10-15T01:00:00Z" : null,
});
t("F01 no refund -> null", B.refundSummary(bk()) === null);
t(
  "F02 an open request beats a finished one",
  B.refundSummary(bk({ refunds: [rf("refunded", 2000), rf("requested")] }))
    .status === "requested",
);
t(
  "F03 labels",
  B.refundSummary(bk({ refunds: [rf("requested")] })).label ===
    "Refund requested" &&
    B.refundSummary(bk({ refunds: [rf("approved")] })).label ===
      "Refund approved, waiting for payout" &&
    B.refundSummary(bk({ refunds: [rf("rejected")] })).label ===
      "Refund declined" &&
    B.refundSummary(bk({ refunds: [rf("refunded", 2000)] })).amountCents ===
      2000,
);
// ---- timeline
const T = (o) =>
  B.timeline(bk(o))
    .map((s) => s.key + (s.done ? "+" : "-"))
    .join(" ");
t(
  "T01 paid booking: first three done, check-in and complete still ahead",
  T({}) === "requested+ approved+ paid+ checked_in- completed-",
  T({}),
);
t(
  "T02 pending booking: only the request is done",
  T({ status: "pending", decided_at: null, payments: [] }) ===
    "requested+ approved- paid- checked_in- completed-",
);
t(
  "T03 approved, not paid yet",
  T({ status: "approved", payments: [] }) ===
    "requested+ approved+ paid- checked_in- completed-",
);
t(
  "T04 rejected stops there",
  T({ status: "rejected", payments: [] }) === "requested+ rejected+",
);
t(
  "T05 cancelled before paying: no empty steps after it",
  T({ status: "cancelled", payments: [] }) ===
    "requested+ approved+ cancelled+",
  T({ status: "cancelled", payments: [] }),
);
t(
  "T06 no-show: paid, then no-show",
  T({ status: "no_show" }) === "requested+ approved+ paid+ no_show+",
);
t(
  "T07 completed: everything done",
  T({
    status: "completed",
    checked_in_at: "2026-10-16T10:00:00Z",
    completed_at: "2026-10-18T10:00:00Z",
  }) === "requested+ approved+ paid+ checked_in+ completed+",
);
t(
  "T08 refunded booking ends with a Refunded step that has its date",
  (() => {
    const s = B.timeline(
      bk({
        status: "cancelled",
        payments: [pay({ status: "refunded" })],
        refunds: [rf("refunded", 2000)],
      }),
    );
    const last = s[s.length - 1];
    return last.key === "refunded" && last.at === "2026-10-15T01:00:00Z";
  })(),
);
t(
  "T09 expired before approval",
  T({ status: "expired", decided_at: null, payments: [] }) ===
    "requested+ expired+",
);
t(
  "T10 paid step carries the payment time",
  B.timeline(bk()).find((s) => s.key === "paid").at === "2026-10-14T12:42:00Z",
);
// ---- Bookings filters
t(
  "Q01 filters map to statuses",
  J(B.statusesForFilter("done")) === J(["checked_in", "completed"]) &&
    B.statusesForFilter("all") === null &&
    J(B.statusesForFilter("pending")) === J(["pending"]),
);
t(
  "Q02 'paid' and 'done' chips exist; the old chips are kept",
  ["pending", "approved", "paid", "done", "rejected", "cancelled", "all"].every(
    (x) => B.BOOKING_FILTERS.includes(x),
  ) && B.BOOKING_FILTERS.length === 7,
);
// ---- raw row -> BookingDetail
const raw = {
  id: "x1",
  status: "paid",
  requested_at: "2026-10-13T10:10:00Z",
  decided_at: null,
  attending_days: ["friday"],
  vendor_id: "v9",
  profiles: {
    full_name: "Johnny",
    phone: "  0917 000 0000 ",
    vendor_details: [{ business_name: "Fisheatery", is_verified: true }],
  },
  stalls: { stall_number: "A6", venue_id: "ven", price_per_day_cents: 1200 },
  payments: [
    {
      id: "p1",
      amount_cents: 1600,
      status: "paid",
      paid_at: "2026-10-14T00:00:00Z",
      created_at: null,
      paymongo_source_type: "paymaya",
      paymongo_payment_id: "pay_abc",
    },
  ],
  refund_requests: [
    {
      id: "r1",
      status: "requested",
      refund_amount_cents: null,
      refunded_at: null,
    },
  ],
};
const d = B.toBookingDetail(raw);
t(
  "D01 maps vendor, phone (trimmed), stall, price",
  d.vendor_name === "Fisheatery" &&
    d.owner_name === "Johnny" &&
    d.phone === "0917 000 0000" &&
    d.vendor_verified === true &&
    d.stall_number === "A6" &&
    d.price_per_day_cents === 1200,
  d,
);
t(
  "D02 maps payment and refund fields",
  d.payments[0].source_type === "paymaya" &&
    d.payments[0].reference === "pay_abc" &&
    d.payments[0].amount_cents === 1600 &&
    d.refunds[0].status === "requested" &&
    d.refunds[0].refund_amount_cents === null,
  d,
);
t(
  "D03 blank phone -> null; missing details -> not verified",
  B.toBookingDetail({ ...raw, profiles: { full_name: "A", phone: "  " } })
    .phone === null &&
    B.toBookingDetail({ ...raw, profiles: { full_name: "A" } })
      .vendor_verified === false,
);
t(
  "D04 missing pieces never crash (empty row, null row)",
  (() => {
    const e = B.toBookingDetail({});
    const n = B.toBookingDetail(null);
    return (
      e.payments.length === 0 &&
      e.refunds.length === 0 &&
      e.stall_number === "—" &&
      n.vendor_name === "Unknown vendor" &&
      n.price_per_day_cents === 0
    );
  })(),
);
t(
  "D07 venue time zone is read from the stall's venue; missing -> null",
  B.toBookingDetail({
    ...raw,
    stalls: { ...raw.stalls, venues: { timezone: "Asia/Manila" } },
  }).timezone === "Asia/Manila" && B.toBookingDetail(raw).timezone === null,
);
t(
  "D05 junk numbers become 0 (no NaN on screen)",
  B.toBookingDetail({
    ...raw,
    stalls: { price_per_day_cents: "abc" },
    payments: [{ amount_cents: null }],
  }).price_per_day_cents === 0 &&
    B.toBookingDetail({ ...raw, payments: [{ amount_cents: null }] })
      .payments[0].amount_cents === 0,
);
t(
  "D06 the query asks for every table the panel needs (real foreign-key names)",
  [
    "bookings_vendor_id_fkey",
    "vendor_details!vendor_details_id_fkey",
    "stalls!inner",
    "price_per_day_cents",
    "payments(",
    "paymongo_payment_id",
    "refund_requests(",
    "phone",
    "venues(timezone)",
  ].every((x) => B.BOOKING_DETAIL_SELECT.includes(x)),
);
// ---- Payments page
const list = [
  bk({ id: "a", vendor_name: "Seafoods", stall_number: "A4" }),
  bk({
    id: "b",
    vendor_name: "Fisheatery",
    owner_name: "Johnny",
    stall_number: "A6",
    payments: [pay({ amount_cents: 2800, paid_at: "2026-10-13T09:40:00Z" })],
  }),
  bk({
    id: "c",
    vendor_name: "Craft",
    owner_name: "Rick",
    stall_number: "A2",
    status: "approved",
    payments: [],
  }),
  bk({
    id: "d",
    vendor_name: "Food",
    owner_name: "Micky",
    stall_number: "A7",
    status: "cancelled",
    payments: [pay({ status: "refunded", amount_cents: 2000 })],
    refunds: [rf("refunded", 1500)],
  }),
  bk({
    id: "e",
    vendor_name: "Foods",
    owner_name: "Mick",
    stall_number: "A9",
    status: "approved",
    payments: [pay({ status: "failed", paid_at: null, amount_cents: 1200 })],
  }),
  bk({ id: "f", vendor_name: "Brewy", status: "pending", payments: [] }),
  bk({ id: "g", vendor_name: "Nope", status: "rejected", payments: [] }),
];
const rows = B.paymentRows(list);
t(
  "G01 only bookings with money are listed (pending and rejected are not)",
  J(rows.map((r) => r.detail.id).sort()) === J(["a", "b", "c", "d", "e"]),
  rows.map((r) => r.detail.id),
);
t(
  "G02 newest first (by paid date, else request date)",
  rows[0].detail.id === "a" ||
    rows[0].detail.id === "c" ||
    rows[0].detail.id === "e",
);
const tot = B.paymentTotals(rows);
t(
  "G03 collected = paid only (20.00 + 28.00), not the refunded one",
  tot.collectedCents === 4800 && tot.collectedCount === 2,
  tot,
);
t(
  "G04 waiting = expected 20.00 for the approved booking without payment",
  tot.waitingCents === 2000 && tot.waitingCount === 1,
  tot,
);
t(
  "G05 refunded uses the refund amount (15.00), not the payment (20.00)",
  tot.refundedCents === 1500 && tot.refundedCount === 1,
  tot,
);
t("G06 failed counted", tot.failedCount === 1, tot);
t(
  "G07 empty list -> all zero",
  J(B.paymentTotals([])) ===
    J({
      collectedCents: 0,
      collectedCount: 0,
      waitingCents: 0,
      waitingCount: 0,
      refundedCents: 0,
      refundedCount: 0,
      failedCount: 0,
    }),
);
t(
  "G08 filter by kind",
  B.filterPaymentRows(rows, "paid", "").length === 2 &&
    B.filterPaymentRows(rows, "waiting", "").length === 1 &&
    B.filterPaymentRows(rows, "refunded", "").length === 1 &&
    B.filterPaymentRows(rows, "failed", "").length === 1 &&
    B.filterPaymentRows(rows, "all", "").length === 5,
);
t(
  "G09 search by business, person or stall (any case)",
  B.filterPaymentRows(rows, "all", "SEAF").length === 1 &&
    B.filterPaymentRows(rows, "all", "rick").length === 1 &&
    B.filterPaymentRows(rows, "all", "a6").length === 1 &&
    B.filterPaymentRows(rows, "all", "zzz").length === 0,
);
t(
  "G10 filter and search together",
  B.filterPaymentRows(rows, "paid", "fish").length === 1 &&
    B.filterPaymentRows(rows, "failed", "fish").length === 0,
);
t(
  "G11 payment filters list",
  B.PAYMENT_FILTERS[0] === "all" &&
    B.PAYMENT_FILTERS.length === 6 &&
    B.PAYMENT_KIND_LABEL.waiting === "Waiting",
);
console.log(`\n${n - f}/${n} passed` + (f ? ` — ${f} FAILED` : ""));
