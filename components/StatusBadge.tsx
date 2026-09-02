// components/StatusBadge.tsx
//
// The colored "Pending / Approved / Paid" pill, used on both Vendor Home
// and My Bookings. Written once here instead of duplicated in both files.

import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';

export const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  pending: { bg: Colors.reserved, label: 'Pending' },
  approved: { bg: Colors.available, label: 'Approved' },
  paid: { bg: Colors.available, label: 'Paid' },
  rejected: { bg: Colors.booked, label: 'Rejected' },
  cancelled: { bg: Colors.textMuted, label: 'Cancelled' },
  checked_in: { bg: Colors.info, label: 'Checked in' },
};

export function StatusBadge({ status }: { status: string }) {
  const info = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <View style={[styles.badge, { backgroundColor: info.bg }]}>
      <Text style={styles.text}>{info.label}</Text>
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
    color: Colors.white,
    fontSize: 11,
  },
});
