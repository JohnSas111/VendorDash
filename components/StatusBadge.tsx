// components/StatusBadge.tsx
//
// The "Pending / Approved / Paid" pill, used on Vendor Home, My Bookings and
// Booking Detail. Soft tinted fill + dark text of the same colour family (the
// same look as the organizer's status pills). Every pair passes WCAG AA.

import { Colors, Typography } from "@/constants/theme";
import { StyleSheet, Text, View } from "react-native";

const AMBER = { bg: Colors.warningLight, fg: Colors.warningText };
const GREEN = { bg: Colors.successLight, fg: Colors.availableText };
const RED = { bg: Colors.dangerLight, fg: Colors.dangerText };
const NEUTRAL = { bg: Colors.borderLight, fg: "#4F4F4F" };

export const STATUS_STYLES: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  // Waiting on someone: the organizer to approve, or the vendor to pay.
  pending: { ...AMBER, label: "Pending" },
  approved: { ...AMBER, label: "Approved" },
  // Paid and in play.
  paid: { ...GREEN, label: "Paid" },
  checked_in: { ...GREEN, label: "Checked in" },
  // Market day finished (set by the organizer) - sales can now be submitted.
  completed: { ...NEUTRAL, label: "Completed" },
  // Closed without a market day.
  cancelled: { ...NEUTRAL, label: "Cancelled" },
  // Reservation lapsed without payment.
  expired: { ...NEUTRAL, label: "Expired" },
  rejected: { ...RED, label: "Rejected" },
  // Paid but never checked in.
  no_show: { ...RED, label: "No-show" },
};

// An unrecognised status is shown as-is in a neutral pill. It used to fall
// back to "Pending", which silently mislabelled any newly added status.
function fallbackStyle(status: string) {
  const text = status.replace(/_/g, " ");
  return {
    ...NEUTRAL,
    label: text.charAt(0).toUpperCase() + text.slice(1),
  };
}

export function StatusBadge({ status }: { status: string }) {
  const info = STATUS_STYLES[status] ?? fallbackStyle(status);
  return (
    <View style={[styles.badge, { backgroundColor: info.bg }]}>
      <Text style={[styles.text, { color: info.fg }]}>{info.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  text: {
    fontSize: Typography.sm,
    fontWeight: "700",
  },
});
