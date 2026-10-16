// lib/vendorBookings.ts
//
// Small pure helpers shared by the vendor Home and My Bookings screens.
// (isUpcoming / todayIn / formatDateRange used to live inside MyBookingsScreen.)

// A booking is "upcoming" only while it is still in play AND its market has
// not finished. Everything else (completed, cancelled, rejected, expired,
// no-show, or a market that is over) belongs in History.
export const ACTIVE_STATUSES = ["pending", "approved", "paid", "checked_in"];

function two(n: number) {
  return String(n).padStart(2, "0");
}

// Today's date (YYYY-MM-DD) in the venue's timezone (device date as a
// fallback). Dates are compared as plain text, so a market that is on today
// is never treated as already over.
export function todayIn(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  }
}

type HasSession = {
  status: string;
  market_sessions: {
    sunday_date: string;
    venues: { timezone: string | null } | null;
  } | null;
};

export function isUpcoming(booking: HasSession): boolean {
  if (!ACTIVE_STATUSES.includes(booking.status)) return false;
  const session = booking.market_sessions;
  if (!session) return false;
  const timezone = session.venues?.timezone ?? "Asia/Manila";
  return session.sunday_date >= todayIn(timezone);
}

// "2026-10-02" is read as a plain calendar date. new Date("2026-10-02") means
// midnight UTC, which shows the day before on a device behind UTC, and the old
// "Sep 29-4" label was ambiguous when a weekend crosses a month.
export function formatDateRange(friday: string, sunday: string) {
  const [fy, fm, fd] = friday.split("-").map(Number);
  const [sy, sm, sd] = sunday.split("-").map(Number);
  if (!fy || !fm || !fd || !sy || !sm || !sd) return `${friday} – ${sunday}`;
  const f = new Date(fy, fm - 1, fd);
  const s = new Date(sy, sm - 1, sd);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  // Same month: "Oct 2–4". Across months: "Sep 29 – Oct 4".
  if (fm === sm && fy === sy) {
    return `${f.toLocaleDateString("en-US", opts)}–${sd}`;
  }
  return `${f.toLocaleDateString("en-US", opts)} – ${s.toLocaleDateString("en-US", opts)}`;
}

// "Thu 9:00 PM" - when an approved reservation runs out, shown in the
// market's own timezone. Returns null when there is no (valid) deadline.
export function payBefore(
  iso: string | null | undefined,
  timeZone: string | null | undefined,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const make = (tz?: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
  let parts;
  try {
    parts = make(timeZone ?? undefined);
  } catch {
    parts = make(undefined); // unknown timezone name: use the device's
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}
