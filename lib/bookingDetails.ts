// lib/bookingDetails.ts
//
// Pure logic for the organizer's "booking details" view: the Bookings screen
// and the Payments screen both turn one database row (a booking with its
// payments and refund requests) into the same BookingDetail, and everything
// the details panel shows (money breakdown, payment state, timeline) is
// worked out here. No React and no database calls, so it can be unit tested.

import { vendorDetails, vendorDisplay } from "@/lib/uxHelpers";

// "Oct 14, 8:42 PM" in the venue's time zone (the same function the Floor Map
// panel uses, so both screens show the same time).
export { formatDateTime } from "@/lib/floorMapPanel";

// Same flat fee the server adds to every payment (payment_quote: PHP 4.00).
export const SERVICE_FEE_CENTS = 400;

export type PaymentInfo = {
  id: string;
  amount_cents: number;
  status: string; // pending | processing | paid | failed | refunded
  paid_at: string | null;
  created_at: string | null;
  source_type: string | null; // gcash | paymaya
  reference: string | null; // PayMongo payment id
};

export type RefundInfo = {
  id: string;
  status: string; // requested | approved | rejected | refunded
  refund_amount_cents: number | null;
  refunded_at: string | null;
};

export type BookingDetail = {
  id: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  payment_due_at: string | null;
  attending_days: string[];
  vendor_id: string;
  vendor_name: string; // business name (falls back to the person's name)
  owner_name: string;
  phone: string | null;
  vendor_verified: boolean;
  stall_number: string;
  price_per_day_cents: number;
  timezone: string | null; // the venue's time zone, used to show times
  payments: PaymentInfo[];
  refunds: RefundInfo[];
};

// One query used by both screens. The embed names follow the real foreign
// keys: vendor_details links to profiles twice, so it must be named.
export const BOOKING_DETAIL_SELECT =
  "id, status, requested_at, decided_at, checked_in_at, completed_at, payment_due_at, attending_days, vendor_id, " +
  "profiles!bookings_vendor_id_fkey(full_name, phone, vendor_details!vendor_details_id_fkey(is_verified, business_name)), " +
  "stalls!inner(stall_number, venue_id, price_per_day_cents, venues(timezone)), " +
  "payments(id, amount_cents, status, paid_at, created_at, paymongo_source_type, paymongo_payment_id), " +
  "refund_requests(id, status, refund_amount_cents, refunded_at)";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Turns one raw row from BOOKING_DETAIL_SELECT into a BookingDetail. Missing
// or odd pieces fall back to safe values (never throws).
export function toBookingDetail(row: any): BookingDetail {
  const who = vendorDisplay(row?.profiles);
  const details = vendorDetails(row?.profiles);
  const phone = String(row?.profiles?.phone ?? "").trim();
  return {
    id: String(row?.id ?? ""),
    status: String(row?.status ?? ""),
    requested_at: row?.requested_at ?? "",
    decided_at: row?.decided_at ?? null,
    checked_in_at: row?.checked_in_at ?? null,
    completed_at: row?.completed_at ?? null,
    payment_due_at: row?.payment_due_at ?? null,
    attending_days: Array.isArray(row?.attending_days)
      ? row.attending_days
      : [],
    vendor_id: String(row?.vendor_id ?? ""),
    vendor_name: who.name,
    owner_name: who.owner,
    phone: phone || null,
    // Missing details count as NOT verified (safe default).
    vendor_verified: details?.is_verified === true,
    stall_number: row?.stalls?.stall_number ?? "—",
    price_per_day_cents: num(row?.stalls?.price_per_day_cents),
    timezone: row?.stalls?.venues?.timezone ?? null,
    payments: (Array.isArray(row?.payments) ? row.payments : []).map(
      (p: any): PaymentInfo => ({
        id: String(p?.id ?? ""),
        amount_cents: num(p?.amount_cents),
        status: String(p?.status ?? ""),
        paid_at: p?.paid_at ?? null,
        created_at: p?.created_at ?? null,
        source_type: p?.paymongo_source_type ?? null,
        reference: p?.paymongo_payment_id ?? null,
      }),
    ),
    refunds: (Array.isArray(row?.refund_requests)
      ? row.refund_requests
      : []
    ).map(
      (r: any): RefundInfo => ({
        id: String(r?.id ?? ""),
        status: String(r?.status ?? ""),
        refund_amount_cents:
          r?.refund_amount_cents == null ? null : num(r.refund_amount_cents),
        refunded_at: r?.refunded_at ?? null,
      }),
    ),
  };
}

// ---------------------------------------------------------------- labels

const DAY_ORDER = [
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

// "Fri, Sat" in week order, whatever order the days were stored in.
export function daysShort(days: string[] | null | undefined): string {
  const set = new Set((days ?? []).map((d) => String(d).toLowerCase()));
  return DAY_ORDER.filter((d) => set.has(d.key))
    .map((d) => d.label)
    .join(", ");
}

// Number of different days (the server prices per distinct day).
export function dayCount(days: string[] | null | undefined): number {
  return new Set((days ?? []).map((d) => String(d).toLowerCase())).size;
}

export function methodLabel(source: string | null | undefined): string {
  switch ((source ?? "").toLowerCase()) {
    case "gcash":
      return "GCash";
    case "paymaya":
      return "Maya";
    case "":
      return "—";
    default:
      return String(source);
  }
}

export function bookingStatusLabel(status: string): string {
  switch (status) {
    case "checked_in":
      return "Checked in";
    case "no_show":
      return "No-show";
    case "":
      return "—";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

// Shortens a long payment reference: "pay_8f3a1c9d2e41c21d" -> "pay_8f3a…c21d".
export function shortRef(ref: string | null | undefined): string {
  const r = String(ref ?? "");
  return r.length > 16 ? `${r.slice(0, 8)}…${r.slice(-4)}` : r;
}

// ----------------------------------------------------------------- money

// The payment that matters for a booking. A booking can have several (a
// failed try, then a paid one): paid / refunded beat processing, which beats
// pending, which beats failed; ties go to the newest.
export function pickPayment(payments: PaymentInfo[]): PaymentInfo | null {
  const rank = (s: string) =>
    s === "paid" || s === "refunded"
      ? 4
      : s === "processing"
        ? 3
        : s === "pending"
          ? 2
          : 1;
  const when = (p: PaymentInfo) =>
    Date.parse(p.paid_at ?? p.created_at ?? "") || 0;
  const sorted = [...(payments ?? [])].sort(
    (a, b) => rank(b.status) - rank(a.status) || when(b) - when(a),
  );
  return sorted[0] ?? null;
}

export type Breakdown = {
  days: number;
  perDayCents: number | null; // null when the stall part does not divide evenly
  stallCents: number;
  feeCents: number;
  totalCents: number;
  isActual: boolean; // true = what was really charged, false = expected price
};

// Paid (or refunded): the real amount charged; the fee is the flat fee and
// the rest is the stall. Otherwise: the price the vendor would be charged
// (price per day x days + fee), the same rule as payment_quote.
export function breakdown(d: BookingDetail): Breakdown {
  const days = dayCount(d.attending_days);
  const pay = pickPayment(d.payments);
  const charged = pay && (pay.status === "paid" || pay.status === "refunded");
  if (charged) {
    const stall = Math.max(0, pay.amount_cents - SERVICE_FEE_CENTS);
    return {
      days,
      perDayCents: days > 0 && stall % days === 0 ? stall / days : null,
      stallCents: stall,
      feeCents: Math.min(SERVICE_FEE_CENTS, pay.amount_cents),
      totalCents: pay.amount_cents,
      isActual: true,
    };
  }
  const stall = Math.max(0, d.price_per_day_cents) * days;
  if (stall === 0) {
    return {
      days,
      perDayCents: null,
      stallCents: 0,
      feeCents: 0,
      totalCents: 0,
      isActual: false,
    };
  }
  return {
    days,
    perDayCents: Math.max(0, d.price_per_day_cents),
    stallCents: stall,
    feeCents: SERVICE_FEE_CENTS,
    totalCents: stall + SERVICE_FEE_CENTS,
    isActual: false,
  };
}

export type PaymentKind =
  | "paid"
  | "waiting"
  | "processing"
  | "failed"
  | "refunded";

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  paid: "Paid",
  waiting: "Waiting",
  processing: "Processing",
  failed: "Failed",
  refunded: "Refunded",
};

export type PaymentSummary = {
  kind: PaymentKind;
  amountCents: number;
  paidAt: string | null;
  method: string; // "GCash" / "Maya" / "—"
  reference: string | null;
};

// How this booking stands on money, or null when money is not part of it
// (pending, rejected, cancelled or expired with no payment).
export function paymentSummary(d: BookingDetail): PaymentSummary | null {
  const pay = pickPayment(d.payments);
  if (pay) {
    const kind: PaymentKind =
      pay.status === "paid"
        ? "paid"
        : pay.status === "refunded"
          ? "refunded"
          : pay.status === "processing"
            ? "processing"
            : pay.status === "failed"
              ? "failed"
              : "waiting";
    return {
      kind,
      amountCents: pay.amount_cents,
      paidAt: kind === "paid" || kind === "refunded" ? pay.paid_at : null,
      method: methodLabel(pay.source_type),
      reference: pay.reference,
    };
  }
  if (d.status === "approved") {
    return {
      kind: "waiting",
      amountCents: breakdown(d).totalCents,
      paidAt: null,
      method: "—",
      reference: null,
    };
  }
  return null;
}

// One short line for a Bookings row: the amount and how it stands.
export function rowMoneyNote(
  d: BookingDetail,
): { amountCents: number; note: string } | null {
  const s = paymentSummary(d);
  if (s) {
    const note =
      s.kind === "paid"
        ? `paid with ${s.method}`
        : s.kind === "refunded"
          ? "refunded"
          : s.kind === "processing"
            ? "payment processing"
            : s.kind === "failed"
              ? "payment failed"
              : "waiting for payment";
    return { amountCents: s.amountCents, note };
  }
  if (d.status === "pending") {
    const b = breakdown(d);
    return b.totalCents > 0
      ? { amountCents: b.totalCents, note: "if approved, not paid yet" }
      : null;
  }
  return null;
}

// ---------------------------------------------------------------- refunds

export type RefundSummary = {
  status: string;
  label: string;
  amountCents: number | null;
};

// The refund that matters: one still open beats a finished one.
export function refundSummary(d: BookingDetail): RefundSummary | null {
  const rank = (s: string) =>
    s === "requested" || s === "approved" ? 3 : s === "refunded" ? 2 : 1;
  const r = [...(d.refunds ?? [])].sort(
    (a, b) => rank(b.status) - rank(a.status),
  )[0];
  if (!r) return null;
  const label =
    r.status === "requested"
      ? "Refund requested"
      : r.status === "approved"
        ? "Refund approved, waiting for payout"
        : r.status === "refunded"
          ? "Refunded"
          : "Refund declined";
  return { status: r.status, label, amountCents: r.refund_amount_cents };
}

// ------------------------------------------------------------- timeline

export type TimelineStep = {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
};

const AFTER_APPROVAL = [
  "approved",
  "paid",
  "checked_in",
  "completed",
  "no_show",
];
const AFTER_PAYMENT = ["paid", "checked_in", "completed", "no_show"];

// What happened to the booking, in order. A normal booking shows every step
// (the ones still ahead are "not done"); a rejected, cancelled, expired or
// no-show booking stops at the point it ended.
export function timeline(d: BookingDetail): TimelineStep[] {
  const steps: TimelineStep[] = [
    {
      key: "requested",
      label: "Requested",
      at: d.requested_at || null,
      done: true,
    },
  ];
  if (d.status === "rejected") {
    steps.push({
      key: "rejected",
      label: "Rejected",
      at: d.decided_at,
      done: true,
    });
    return steps;
  }
  const s = paymentSummary(d);
  const paidAt =
    s && (s.kind === "paid" || s.kind === "refunded") ? s.paidAt : null;
  steps.push({
    key: "approved",
    label: "Approved",
    at: d.decided_at,
    done: !!d.decided_at || AFTER_APPROVAL.includes(d.status),
  });
  steps.push({
    key: "paid",
    label: "Paid",
    at: paidAt,
    done: !!paidAt || AFTER_PAYMENT.includes(d.status),
  });
  steps.push({
    key: "checked_in",
    label: "Checked in",
    at: d.checked_in_at,
    done: !!d.checked_in_at || ["checked_in", "completed"].includes(d.status),
  });
  steps.push({
    key: "completed",
    label: "Completed",
    at: d.completed_at,
    done: !!d.completed_at || d.status === "completed",
  });

  const ended: Record<string, string> = {
    cancelled: "Cancelled",
    expired: "Expired",
    no_show: "No-show",
  };
  const refunded = d.refunds.find((r) => r.status === "refunded");
  if (ended[d.status] || refunded) {
    while (steps.length > 1 && !steps[steps.length - 1].done) steps.pop();
    if (ended[d.status]) {
      steps.push({
        key: d.status,
        label: ended[d.status],
        at: null,
        done: true,
      });
    }
    if (refunded) {
      steps.push({
        key: "refunded",
        label: "Refunded",
        at: refunded.refunded_at,
        done: true,
      });
    }
  }
  return steps;
}

// ----------------------------------------------------- Bookings filters

export const BOOKING_FILTERS = [
  "pending",
  "approved",
  "paid",
  "done",
  "rejected",
  "cancelled",
  "all",
] as const;
export type BookingFilter = (typeof BOOKING_FILTERS)[number];

// Which booking statuses a filter chip shows; null = every status.
export function statusesForFilter(f: BookingFilter): string[] | null {
  switch (f) {
    case "all":
      return null;
    case "done":
      return ["checked_in", "completed"];
    default:
      return [f];
  }
}

// -------------------------------------------------------- Payments page

export type PaymentFilter = "all" | PaymentKind;
export const PAYMENT_FILTERS: PaymentFilter[] = [
  "all",
  "paid",
  "waiting",
  "processing",
  "refunded",
  "failed",
];

export type PaymentRow = { detail: BookingDetail; summary: PaymentSummary };

// Every booking that has money attached, newest first.
export function paymentRows(list: BookingDetail[]): PaymentRow[] {
  const rows: PaymentRow[] = [];
  for (const detail of list ?? []) {
    const summary = paymentSummary(detail);
    if (summary) rows.push({ detail, summary });
  }
  const when = (r: PaymentRow) =>
    Date.parse(r.summary.paidAt ?? r.detail.requested_at ?? "") || 0;
  return rows.sort((a, b) => when(b) - when(a));
}

export function filterPaymentRows(
  rows: PaymentRow[],
  filter: PaymentFilter,
  search: string,
): PaymentRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (filter === "all" || r.summary.kind === filter) &&
      (!q ||
        r.detail.vendor_name.toLowerCase().includes(q) ||
        r.detail.owner_name.toLowerCase().includes(q) ||
        r.detail.stall_number.toLowerCase().includes(q)),
  );
}

export type PaymentTotals = {
  collectedCents: number;
  collectedCount: number;
  waitingCents: number;
  waitingCount: number;
  refundedCents: number;
  refundedCount: number;
  failedCount: number;
};

// The four tiles on the Payments page. Collected = money kept (paid only);
// refunded money is not counted as collected.
export function paymentTotals(rows: PaymentRow[]): PaymentTotals {
  const t: PaymentTotals = {
    collectedCents: 0,
    collectedCount: 0,
    waitingCents: 0,
    waitingCount: 0,
    refundedCents: 0,
    refundedCount: 0,
    failedCount: 0,
  };
  for (const { detail, summary } of rows ?? []) {
    switch (summary.kind) {
      case "paid":
        t.collectedCents += summary.amountCents;
        t.collectedCount += 1;
        break;
      case "waiting":
        t.waitingCents += summary.amountCents;
        t.waitingCount += 1;
        break;
      case "refunded": {
        const paidOut = detail.refunds.find((r) => r.status === "refunded");
        t.refundedCents += paidOut?.refund_amount_cents ?? summary.amountCents;
        t.refundedCount += 1;
        break;
      }
      case "failed":
        t.failedCount += 1;
        break;
    }
  }
  return t;
}
