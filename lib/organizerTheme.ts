// lib/organizerTheme.ts
// Shared design tokens for the organizer web/mobile screens.
//
// "Warm market" look: cream page, white soft-shadow cards, a dark sidebar
// and amber / green accents. Every exported name (COLORS.inkNavy, COLORS.teal,
// shared.card, ...) is unchanged on purpose, so all organizer screens pick up
// the new look from here. Only the organizer website uses this file, so
// changing it needs no new phone app build.

import { Colors } from "@/constants/theme";
import { Platform, StyleSheet } from "react-native";

export const COLORS = {
  inkNavy: Colors.text, // main text and dark buttons
  paper: "#FAF5EC", // warm cream page background
  white: Colors.white,
  amber: Colors.reserved,
  teal: Colors.available,
  clay: Colors.booked,
  // Text-safe variants: use these (not teal/clay/amber) for text on light
  // backgrounds; teal/clay/amber stay for fills, borders and icons.
  tealText: Colors.availableText,
  clayText: Colors.dangerText,
  amberText: Colors.warningText,
  slate: Colors.textMuted,
  border: "#EADFCB", // warm outline (inputs, chips)
  hairline: "#F0E7D6", // very light dividers and card edges
  dark: "#1A1A1A", // sidebar and dark tiles
  onDark: Colors.onDarkMuted, // muted text on the dark sidebar
  rowSelected: "#FDF8EE", // selected table row
  tintAmber: Colors.warningLight,
  tintRed: Colors.dangerLight,
  tintGreen: Colors.successLight,
};

export const RADIUS = { sm: 12, md: 18, lg: 22 };

// Soft warm shadow used by cards (matches the mockup).
export const CARD_SHADOW = {
  shadowColor: "#3C2800",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 10,
  elevation: 2,
};

// Georgia on the web (what the mockup uses); the system serif on phones.
export const SERIF = Platform.select({
  web: "Georgia, 'Times New Roman', serif",
  default: "serif",
}) as string;

// Desktop = sidebar + tables, Mobile = bottom tabs + stacked cards
export const BREAKPOINT = 768;

// Common building blocks reused across organizer screens.
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
    fontFamily: SERIF,
    fontSize: 34,
    fontWeight: "400",
    color: COLORS.inkNavy,
    marginBottom: 4,
  },
  subtitle: { fontSize: 15, color: COLORS.slate, marginBottom: 16 },
  errorText: { color: COLORS.clayText, fontSize: 14 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    padding: 20,
    ...CARD_SHADOW,
  },
  row: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    padding: 14,
    gap: 10,
    ...CARD_SHADOW,
  },
  rowDesktop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowTitle: { fontSize: 15, fontWeight: "700", color: COLORS.inkNavy },
  rowSubtitle: { fontSize: 13, color: COLORS.slate, marginTop: 2 },
  sectionHeading: {
    fontFamily: SERIF,
    fontSize: 21,
    fontWeight: "400",
    color: COLORS.inkNavy,
    marginTop: 28,
    marginBottom: 12,
  },
  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    padding: 24,
    alignItems: "center",
    ...CARD_SHADOW,
  },
  emptyStateText: { color: COLORS.slate, fontSize: 14 },
  primaryButton: {
    backgroundColor: COLORS.inkNavy,
    borderRadius: RADIUS.sm,
    paddingVertical: 10,
    paddingHorizontal: 18,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { color: COLORS.white, fontWeight: "700", fontSize: 14 },
  secondaryButton: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    paddingVertical: 10,
    paddingHorizontal: 18,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: COLORS.inkNavy,
    fontWeight: "600",
    fontSize: 14,
  },
  dangerOutlineButton: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.clay,
    borderRadius: RADIUS.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerOutlineButtonText: {
    color: COLORS.clayText,
    fontWeight: "600",
    fontSize: 13,
  },
  successButton: {
    backgroundColor: COLORS.teal,
    borderRadius: RADIUS.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  successButtonText: { color: COLORS.inkNavy, fontWeight: "700", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
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
  badgeText: { fontSize: 12, fontWeight: "700" },
  // Round filter buttons ("All / Paid / Waiting ...").
  chip: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: COLORS.dark, borderColor: COLORS.dark },
  chipText: { fontSize: 13, fontWeight: "600", color: COLORS.inkNavy },
  chipTextActive: { color: COLORS.white, fontWeight: "700" },
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
      return { bg: Colors.successLight, fg: COLORS.tealText };
    case "rejected":
    case "cancelled":
    case "failed":
    case "unverified":
      return { bg: Colors.dangerLight, fg: COLORS.clayText };
    case "pending":
    case "processing":
    case "upcoming":
      return { bg: Colors.warningLight, fg: COLORS.amberText };
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
  fg: string; // border + icon
  text: string; // label text (AA contrast)
} {
  switch (status) {
    case "available":
      return {
        bg: Colors.successLight,
        fg: COLORS.teal,
        text: COLORS.tealText,
      };
    case "reserved":
      return {
        bg: Colors.warningLight,
        fg: COLORS.amber,
        text: COLORS.amberText,
      };
    case "booked":
      return { bg: Colors.dangerLight, fg: COLORS.clay, text: COLORS.clayText };
    case "inactive":
    default:
      return { bg: COLORS.border, fg: COLORS.slate, text: COLORS.slate };
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
