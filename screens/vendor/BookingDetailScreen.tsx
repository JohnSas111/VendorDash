import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '@/lib/supabase';
import { StatusBadge } from '@/components/StatusBadge';
import { Colors, Radius } from '@/constants/theme';

type BookingDetail = {
  id: string;
  status: string;
  attending_days: string[];
  stalls: { stall_number: string } | null;
  market_sessions: { friday_date: string; sunday_date: string } | null;
};

export default function BookingDetailScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!bookingId) return;
      const { data } = await supabase
        .from('bookings')
        .select('id, status, attending_days, stalls(stall_number), market_sessions(friday_date, sunday_date)')
        .eq('id', bookingId)
        .single();
      setBooking(data as unknown as BookingDetail);
      setLoading(false);
    }
    load();
  }, [bookingId]);

  if (loading || !booking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  const dateLabel = booking.market_sessions
    ? `${new Date(booking.market_sessions.friday_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })}–${new Date(booking.market_sessions.sunday_date).getDate()}`
    : 'Date unavailable';

  const canCheckIn = booking.status === 'paid' || booking.status === 'approved';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Stall {booking.stalls?.stall_number ?? '—'}</Text>
      <Text style={styles.subtitle}>{dateLabel}</Text>
      <View style={styles.badgeWrap}>
        <StatusBadge status={booking.status} />
      </View>

      {canCheckIn ? (
        <View style={styles.qrCard}>
          <QRCode value={booking.id} size={200} />
          <Text style={styles.qrHint}>Show this to the organizer at check-in</Text>
        </View>
      ) : (
        <View style={styles.pendingCard}>
          <Text style={styles.pendingText}>
            Your QR check-in code will appear here once this booking is approved and paid.
          </Text>
        </View>
      )}

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Attending</Text>
        <Text style={styles.infoValue}>
          {booking.attending_days?.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: 24, paddingTop: 20, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold' },
  subtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  badgeWrap: { marginTop: 10, marginBottom: 24 },
  qrCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  qrHint: { fontSize: 11, color: Colors.textMuted, marginTop: 12, textAlign: 'center' },
  pendingCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 24,
    marginBottom: 20,
  },
  pendingText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  infoCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, width: '100%' },
  infoLabel: { fontSize: 11, color: Colors.textMuted },
  infoValue: { fontSize: 14, fontWeight: '500', marginTop: 2 },
});
