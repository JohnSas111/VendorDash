// lib/organizerTheme.ts
// Shared design tokens for the organizer web/mobile screens.
//
// UPDATED: now sources actual color values from constants/theme.ts —
// the same palette the vendor app already uses — instead of the
// separate navy/teal/clay palette from the original organizer Figma
// brief. Every exported name (COLORS.inkNavy, COLORS.teal, etc.) stays
// the same on purpose, so none of the organizer screens that already
// import COLORS.inkNavy/teal/clay/amber/slate/paper need to change —
// only the hex values behind those names changed. Spacing/Radius also
// now come from constants/theme.ts.

import { Colors, Radius } from "@/constants/theme";
import { StyleSheet } from "react-native";

export const COLORS = {
  inkNavy: Colors.text, // was '#16192B', now the app's actual text color
  paper: Colors.background, // was '#FAF8F4'
  white: Colors.white,
  amber: Colors.reserved, // was '#E8983A'
  teal: Colors.available, // was '#1F6E63'
  clay: Colors.booked, // was '#C1502E'
  slate: Colors.textMuted, // was '#5B6072'
  border: Colors.border, // was '#E7E3D8'
};

export const RADIUS = { sm: Radius.sm, md: Radius.md, lg: Radius.lg };

// Desktop = sidebar + tables, Mobile = bottom tabs + stacked cards
export const BREAKPOINT = 768;

// Common building blocks reused across organizer screens.
// fontFamily: 'serif' is a placeholder — swap once a real font is
// loaded via expo-font.
export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: 20, paddingBottom: 48 },
  contentDesktop: {
    padding: 40,
    maxWidth: 1080,
    alignSelf: "center",
    width: "100%",
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.paper,
    padding: 24,
  },
  title: {
    fontFamily: "serif",
    fontSize: 28,
    color: COLORS.inkNavy,
    marginBottom: 4,
  },
  subtitle: { fontSize: 15, color: COLORS.slate, marginBottom: 16 },
  errorText: { color: COLORS.clay, fontSize: 14 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  row: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 10,
  },
  rowDesktop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowTitle: { fontSize: 15, fontWeight: "600", color: COLORS.inkNavy },
  rowSubtitle: { fontSize: 13, color: COLORS.slate, marginTop: 2 },
  sectionHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.slate,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 28,
    marginBottom: 12,
  },
  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: { color: COLORS.slate, fontSize: 14 },
  primaryButton: {
    backgroundColor: COLORS.inkNavy,
    borderRadius: RADIUS.sm,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: COLORS.white, fontWeight: "600", fontSize: 14 },
  secondaryButton: {
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: COLORS.inkNavy,
    fontWeight: "600",
    fontSize: 14,
  },
  dangerOutlineButton: {
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.clay,
    borderRadius: RADIUS.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  dangerOutlineButtonText: {
    color: COLORS.clay,
    fontWeight: "600",
    fontSize: 13,
  },
  successButton: {
    backgroundColor: COLORS.teal,
    borderRadius: RADIUS.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  successButtonText: { color: COLORS.white, fontWeight: "600", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.inkNavy,
    backgroundColor: COLORS.white,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.slate,
    marginBottom: 6,
    marginTop: 12,
  },
  badge: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
});

export function formatDate(iso: string) {
  if (!iso) return "—";
  // Date-only strings ("YYYY-MM-DD") are parsed by JS's Date constructor
  // as UTC midnight, which can silently shift the displayed day
  // depending on the viewer's timezone. Parse the components manually
  // and build a local Date instead, so what's typed is what's shown.
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatMoney(cents: number) {
  return `₱${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

// status -> {bg, fg} for badges (bookings, stalls, sessions, payments)
export function statusColors(status: string): { bg: string; fg: string } {
  switch (status) {
    case "paid":
    case "approved":
    case "checked_in":
    case "open":
    case "available":
    case "verified":
      return { bg: "#E3F5EC", fg: COLORS.teal };
    case "rejected":
    case "cancelled":
    case "failed":
    case "unverified":
      return { bg: "#FBEAE8", fg: COLORS.clay };
    case "pending":
    case "processing":
    case "upcoming":
      return { bg: "#FDF1DF", fg: COLORS.amber };
    default:
      return { bg: COLORS.border, fg: COLORS.slate };
  }
}

// Dedicated colors for the Floor Map, matching the design system's
// stated intent (teal = available, clay = booked) rather than the
// generic "positive/negative" grouping statusColors() uses for badges
// elsewhere. Booked and available must NOT share a color here.
export type StallDisplayStatus =
  | "available"
  | "reserved"
  | "booked"
  | "inactive";

export function stallStatusColors(status: StallDisplayStatus): {
  bg: string;
  fg: string;
} {
  switch (status) {
    case "available":
      return { bg: "#E3F5EC", fg: COLORS.teal };
    case "reserved":
      return { bg: "#FDF1DF", fg: COLORS.amber };
    case "booked":
      return { bg: "#FBEAE8", fg: COLORS.clay };
    case "inactive":
    default:
      return { bg: COLORS.border, fg: COLORS.slate };
  }
}

// Collapses a stall's is_active flag + its booking's raw status
// (pending/approved/paid/checked_in/none) into one of the 4 floor-map
// buckets above.
export function resolveStallDisplayStatus(
  isActive: boolean,
  bookingStatus: string | null,
): StallDisplayStatus {
  if (!isActive) return "inactive";
  if (!bookingStatus) return "available";
  if (bookingStatus === "paid" || bookingStatus === "checked_in")
    return "booked";
  return "reserved"; // pending or approved — held, not yet paid
}
