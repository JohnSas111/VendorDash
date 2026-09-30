// components/StatusBadge.tsx
//
// The colored "Pending / Approved / Paid" pill, used on both Vendor Home
// and My Bookings. Written once here instead of duplicated in both files.

import { Colors, Typography } from "@/constants/theme";
import { StyleSheet, Text, View } from "react-native";

// `fg` is picked per fill so the text passes WCAG AA (4.5:1): white on the
// amber/green/red/blue status fills is only 2.2-3.7:1, dark text is 4.7-8.1:1.
// Cancelled uses the darker muted grey, where white text is 5.3:1.
export const STATUS_STYLES: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  pending: { bg: Colors.reserved, fg: Colors.text, label: "Pending" },
  approved: { bg: Colors.available, fg: Colors.text, label: "Approved" },
  paid: { bg: Colors.available, fg: Colors.text, label: "Paid" },
  rejected: { bg: Colors.booked, fg: Colors.text, label: "Rejected" },
  cancelled: { bg: Colors.textMuted, fg: Colors.white, label: "Cancelled" },
  checked_in: { bg: Colors.info, fg: Colors.text, label: "Checked in" },
  // Market day finished (set by the organizer) - sales can now be submitted.
  completed: { bg: Colors.text, fg: Colors.white, label: "Completed" },
  // Reservation lapsed without payment.
  expired: { bg: Colors.textMuted, fg: Colors.white, label: "Expired" },
  // Paid but never checked in.
  no_show: { bg: Colors.booked, fg: Colors.text, label: "No-show" },
};

// An unrecognised status is shown as-is in a neutral pill. It used to fall
// back to "Pending", which silently mislabelled any newly added status.
function fallbackStyle(status: string) {
  const text = status.replace(/_/g, " ");
  return {
    bg: Colors.textMuted,
    fg: Colors.white,
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
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: {
    fontSize: Typography.xs,
  },
});
