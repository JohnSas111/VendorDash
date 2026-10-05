// lib/floorMapPanel.ts
//
// What the organizer's Floor Map "Details" panel shows. Pure functions:
// they turn the stalls + bookings already loaded by the screen into a
// ready-to-display model, so the rules (what counts as paid, what a stall
// total is, which button to offer) live in one testable place.

import {
  formatDate,
  formatMoney,
  resolveStallDisplayStatus,
  type StallDisplayStatus,
} from "@/lib/organizerTheme";

export type PanelStall = {
  id: string;
  stall_number: string;
  is_active: boolean;
  price_per_day_cents: number;
};

export type PanelBooking = {
  id: string;
  stall_id: string;
  status: string; // pending | approved | paid | checked_in
  attending_days: string[]; // "friday" | "saturday" | "sunday"
  requested_at: string | null;
  payment_due_at: string | null;
  checked_in_at: string | null;
  paid_at: string | null;
  vendor_name: string; // business name (falls back to the person's name)
  owner_name: string;
  category: string | null;
  is_verified: boolean;
};

// Where a panel button goes. Written as full route paths so the type
// checker verifies they exist.
export type PanelTarget =
  | "/(organizer)/(tabs)/booking-requests"
  | "/(organizer)/(tabs)/check-in"
  | "/(organizer)/(tabs)/stalls";

export type PanelRow = { label: string; value: string };
export type PanelAction = { label: string; target: PanelTarget };
export type DayChip = { label: string; on: boolean };

export type OverviewModel = {
  kind: "overview";
  title: string;
  subtitle: string;
  metrics: { label: string; value: string }[];
  rows: PanelRow[];
  alert: string | null;
  action: PanelAction | null;
};

export type StallModel = {
  kind: "stall";
  status: StallDisplayStatus;
  statusLabel: string;
  title: string;
  vendor: {
    name: string;
    owner: string | null; // only when it adds information
    category: string | null;
    verified: boolean;
  } | null;
  days: DayChip[] | null;
  rows: PanelRow[];
  note: string | null;
  action: PanelAction | null;
};

export type PanelModel = OverviewModel | StallModel;

const BOOKINGS: PanelTarget = "/(organizer)/(tabs)/booking-requests";
const CHECK_IN: PanelTarget = "/(organizer)/(tabs)/check-in";
const STALLS: PanelTarget = "/(organizer)/(tabs)/stalls";

export const STATUS_LABEL: Record<StallDisplayStatus, string> = {
  available: "Available",
  reserved: "Reserved (unpaid)",
  booked: "Booked (paid)",
  inactive: "Inactive",
};

const DAYS: { key: string; label: string }[] = [
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

// Same rule the payment code uses: price per day x number of booked days.
export function stallTotalCents(
  pricePerDayCents: number,
  attendingDays: string[],
): number {
  return Math.max(0, pricePerDayCents) * attendingDays.length;
}

export function formatDateTime(
  iso: string | null | undefined,
  timeZone?: string,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function buildOverview(
  stalls: PanelStall[],
  bookingsByStall: Record<string, PanelBooking>,
  sessionLabel: string,
): OverviewModel {
  const counts: Record<StallDisplayStatus, number> = {
    available: 0,
    reserved: 0,
    booked: 0,
    inactive: 0,
  };
  const priceByStall = new Map(stalls.map((s) => [s.id, s]));
  for (const stall of stalls) {
    counts[
      resolveStallDisplayStatus(
        stall.is_active,
        bookingsByStall[stall.id]?.status ?? null,
      )
    ] += 1;
  }

  let paidCents = 0;
  let waitingCents = 0;
  let pending = 0;
  for (const b of Object.values(bookingsByStall)) {
    const stall = priceByStall.get(b.stall_id);
    const total = stall
      ? stallTotalCents(stall.price_per_day_cents, b.attending_days)
      : 0;
    if (b.status === "paid" || b.status === "checked_in") paidCents += total;
    else if (b.status === "approved") waitingCents += total;
    else if (b.status === "pending") pending += 1;
  }

  const total = stalls.length;
  return {
    kind: "overview",
    title: "Session overview",
    subtitle: sessionLabel,
    metrics: [
      { label: "Available", value: `${counts.available} of ${total}` },
      { label: "Reserved", value: String(counts.reserved) },
      { label: "Booked", value: String(counts.booked) },
      { label: "Inactive", value: String(counts.inactive) },
    ],
    rows: [
      { label: "Paid so far", value: formatMoney(paidCents) },
      { label: "Waiting for payment", value: formatMoney(waitingCents) },
    ],
    alert:
      pending > 0
        ? `${pending} request${pending === 1 ? " needs" : "s need"} your review`
        : null,
    action: pending > 0 ? { label: "Review requests", target: BOOKINGS } : null,
  };
}

export function buildStallPanel(
  stall: PanelStall,
  booking: PanelBooking | null | undefined,
  timeZone?: string,
): StallModel {
  const status = resolveStallDisplayStatus(
    stall.is_active,
    booking?.status ?? null,
  );
  const base = {
    kind: "stall" as const,
    status,
    statusLabel: STATUS_LABEL[status],
    title: `Stall ${stall.stall_number}`,
  };
  const price: PanelRow = {
    label: "Price per day",
    value: formatMoney(stall.price_per_day_cents),
  };

  if (status === "inactive") {
    return {
      ...base,
      vendor: null,
      days: null,
      rows: [price],
      note: "This stall is deactivated, so vendors can't book it.",
      action: { label: "Manage stalls", target: STALLS },
    };
  }

  if (status === "available" || !booking) {
    return {
      ...base,
      vendor: null,
      days: null,
      rows: [price],
      note: "No booking for this session yet.",
      action: { label: "Edit stall", target: STALLS },
    };
  }

  const total: PanelRow = {
    label: "Stall total",
    value: formatMoney(
      stallTotalCents(stall.price_per_day_cents, booking.attending_days),
    ),
  };
  const vendor = {
    name: booking.vendor_name,
    owner:
      booking.owner_name && booking.owner_name !== booking.vendor_name
        ? booking.owner_name
        : null,
    category: booking.category,
    verified: booking.is_verified,
  };
  const days = DAYS.map((d) => ({
    label: d.label,
    on: booking.attending_days.includes(d.key),
  }));

  let rows: PanelRow[];
  let action: PanelAction;
  switch (booking.status) {
    case "pending":
      rows = [
        { label: "Status", value: "Waiting for your approval" },
        {
          label: "Requested",
          value: booking.requested_at ? formatDate(booking.requested_at) : "—",
        },
        total,
      ];
      action = { label: "Review request", target: BOOKINGS };
      break;
    case "approved":
      rows = [
        { label: "Status", value: "Approved, waiting for payment" },
        {
          label: "Pay by",
          value: formatDateTime(booking.payment_due_at, timeZone),
        },
        total,
      ];
      action = { label: "Open bookings", target: BOOKINGS };
      break;
    case "checked_in":
      rows = [
        { label: "Paid", value: formatDateTime(booking.paid_at, timeZone) },
        total,
        {
          label: "Check-in",
          value: `Checked in ${formatDateTime(booking.checked_in_at, timeZone)}`,
        },
      ];
      action = { label: "Open check-in", target: CHECK_IN };
      break;
    default: // paid
      rows = [
        { label: "Paid", value: formatDateTime(booking.paid_at, timeZone) },
        total,
        { label: "Check-in", value: "Not yet" },
      ];
      action = { label: "Go to check-in", target: CHECK_IN };
  }

  return { ...base, vendor, days, rows, note: null, action };
}
