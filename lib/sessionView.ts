// lib/sessionView.ts
//
// Pure helpers for the Sessions screen: which session is "next", the counts
// for the tiles, the filter chips and the "starts in 3 days" line. No React
// and no database.

export type SessionLike = {
  id: string;
  friday_date: string; // "YYYY-MM-DD"
  status: string;
};

export const SESSION_FILTERS = [
  "all",
  "upcoming",
  "open",
  "closed",
  "completed",
  "cancelled",
] as const;
export type SessionFilter = (typeof SESSION_FILTERS)[number];

export function filterSessions<T extends SessionLike>(
  list: readonly T[],
  filter: SessionFilter,
): T[] {
  return filter === "all" ? [...list] : list.filter((s) => s.status === filter);
}

export type SessionCounts = Record<Exclude<SessionFilter, "all">, number> & {
  all: number;
};

export function sessionCounts(list: readonly SessionLike[]): SessionCounts {
  const c: SessionCounts = {
    all: list.length,
    upcoming: 0,
    open: 0,
    closed: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const s of list) {
    if (s.status in c && s.status !== "all") {
      c[s.status as Exclude<SessionFilter, "all">] += 1;
    }
  }
  return c;
}

// The market to show first: the one running now or, if none, the soonest
// upcoming one. Finished, closed and cancelled sessions are never "next".
export function nextSession<T extends SessionLike>(
  list: readonly T[],
): T | null {
  const live = list.filter(
    (s) => s.status === "open" || s.status === "upcoming",
  );
  if (live.length === 0) return null;
  return [...live].sort((a, b) =>
    a.friday_date < b.friday_date ? -1 : a.friday_date > b.friday_date ? 1 : 0,
  )[0];
}

// "YYYY-MM-DD" as a local date (no time-zone shift).
export function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Whole days from today to the Friday (negative when it has passed).
export function daysUntil(iso: string, now: Date): number | null {
  const d = parseLocalDate(iso);
  if (!d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export function startsInLabel(
  status: string,
  fridayISO: string,
  now: Date,
): string {
  if (status === "open") return "taking bookings";
  const n = daysUntil(fridayISO, now);
  if (n === null) return "";
  if (n === 0) return "starts today";
  if (n === 1) return "starts tomorrow";
  if (n > 1) return `starts in ${n} days`;
  return "start date has passed";
}

// Past runs are drawn faded.
export function isPastSession(status: string): boolean {
  return status === "completed" || status === "cancelled";
}
