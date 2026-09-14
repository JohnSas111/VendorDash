import { StatusBadge } from "@/components/StatusBadge";
import { Colors, Radius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type BookingRow = {
  id: string;
  status: string;
  attending_days: string[];
  stalls: { stall_number: string } | null;
  market_sessions: {
    friday_date: string;
    sunday_date: string;
    booking_deadline: string | null;
  } | null;
  payments: { amount_cents: number }[] | null;
  sales_submissions: { id: string }[] | null;
};

function formatDateRange(friday: string, sunday: string) {
  const f = new Date(friday);
  const s = new Date(sunday);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${f.toLocaleDateString("en-US", opts)}-${s.getDate()}`;
}

function canCancel(booking: BookingRow): boolean {
  // Matches the bookings RLS policy: vendors may cancel while a booking is
  // still pending or approved — i.e. any time before it's actually paid.
  if (!["pending", "approved"].includes(booking.status)) return false;
  const deadline = booking.market_sessions?.booking_deadline;
  if (!deadline) return true;
  return new Date(deadline) > new Date();
}

export default function MyBookingsScreen() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const insets = useSafeAreaInsets();

  const loadData = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      router.replace("/(auth)/login");
      return;
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, status, attending_days, stalls(stall_number), market_sessions(friday_date, sunday_date, booking_deadline), payments(amount_cents), sales_submissions(id)",
      )
      .eq("vendor_id", userId)
      .order("requested_at", { ascending: false });

    if (!error && data) setBookings(data as unknown as BookingRow[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData().finally(() => setLoading(false));
    }, [loadData]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  async function handleCancel(booking: BookingRow) {
    Alert.alert(
      "Cancel booking?",
      "This will release the stall so other vendors can book it.",
      [
        { text: "Keep booking", style: "cancel" },
        {
          text: "Cancel booking",
          style: "destructive",
          onPress: async () => {
            setCancellingId(booking.id);
            const { error } = await supabase
              .from("bookings")
              .update({ status: "cancelled" })
              .eq("id", booking.id);
            setCancellingId(null);

            if (error) {
              Alert.alert("Could not cancel", error.message);
              return;
            }
            loadData();
          },
        },
      ],
    );
  }

  const today = new Date();
  const upcoming = bookings.filter(
    (b) =>
      b.market_sessions && new Date(b.market_sessions.sunday_date) >= today,
  );
  const history = bookings.filter(
    (b) =>
      !b.market_sessions || new Date(b.market_sessions.sunday_date) < today,
  );

  const totalSpent = bookings.reduce((sum, b) => {
    const paid = b.payments?.reduce((s, p) => s + p.amount_cents, 0) ?? 0;
    return sum + paid;
  }, 0);

  const thisWeekendStall = upcoming[0]?.stalls?.stall_number ?? "—";

  function handleSubmitSales(item: BookingRow) {
    const dateLabel = item.market_sessions
      ? formatDateRange(
          item.market_sessions.friday_date,
          item.market_sessions.sunday_date,
        )
      : "";
    router.push({
      pathname: "/(vendor)/sales-submission",
      params: {
        bookingId: item.id,
        stallNumber: item.stalls?.stall_number ?? "",
        dateLabel,
      },
    });
  }

  function renderUpcomingCard(item: BookingRow) {
    const dateLabel = item.market_sessions
      ? formatDateRange(
          item.market_sessions.friday_date,
          item.market_sessions.sunday_date,
        )
      : "Date unavailable";
    const showCancel = canCancel(item);

    return (
      <View key={item.id} style={styles.card}>
        <TouchableOpacity
          onPress={() =>
            router.push({
              pathname: "/(vendor)/booking-detail",
              params: { bookingId: item.id },
            })
          }
        >
          <View style={styles.cardRow}>
            <Text style={styles.cardTitle}>{dateLabel}</Text>
            <StatusBadge status={item.status} />
          </View>
          <Text style={styles.cardSubtitle}>
            Stall {item.stalls?.stall_number ?? "—"} · tap for QR check-in
          </Text>
        </TouchableOpacity>

        {showCancel && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => handleCancel(item)}
            disabled={cancellingId === item.id}
          >
            <Text style={styles.cancelButtonText}>
              {cancellingId === item.id ? "Cancelling..." : "Cancel booking"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function renderHistoryCard(item: BookingRow) {
    const dateLabel = item.market_sessions
      ? formatDateRange(
          item.market_sessions.friday_date,
          item.market_sessions.sunday_date,
        )
      : "Date unavailable";
    const daysLabel = item.attending_days
      ?.map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3))
      .join(", ");
    const hasSalesSubmission = (item.sales_submissions?.length ?? 0) > 0;
    const wasPaid = item.status === "paid" || item.status === "checked_in";

    return (
      <View style={styles.card} key={item.id}>
        <View style={styles.cardRow}>
          <View>
            <Text style={styles.cardTitle}>{dateLabel}</Text>
            <Text style={styles.cardSubtitle}>
              Stall {item.stalls?.stall_number ?? "—"} · {daysLabel}
            </Text>
          </View>
          <StatusBadge status={item.status} />
        </View>

        {wasPaid &&
          (hasSalesSubmission ? (
            <View style={styles.salesDoneRow}>
              <Text style={styles.salesDoneText}>✓ Sales submitted</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.salesButton}
              onPress={() => handleSubmitSales(item)}
            >
              <Text style={styles.salesButtonText}>Submit sales</Text>
            </TouchableOpacity>
          ))}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>My Bookings</Text>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>This weekend</Text>
          <Text style={styles.metricValue}>
            {upcoming.length > 0 ? `Stall ${thisWeekendStall}` : "None"}
          </Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Total spent</Text>
          <Text style={styles.metricValue}>
            ₱{(totalSpent / 100).toLocaleString()}
          </Text>
        </View>
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.sectionLabel}>Upcoming</Text>
            {upcoming.length === 0 && !loading && (
              <Text style={styles.emptyText}>No upcoming bookings.</Text>
            )}
            {upcoming.map(renderUpcomingCard)}

            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
              History
            </Text>
            {history.length === 0 && !loading && (
              <Text style={styles.emptyText}>No past bookings yet.</Text>
            )}
            {history.map(renderHistoryCard)}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 20,
    paddingTop: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 16,
  },
  metricsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  metricCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.sm,
    padding: 12,
  },
  metricLabel: { fontSize: 11, color: Colors.textMuted },
  metricValue: { fontSize: 16, fontWeight: "600", marginTop: 2 },
  sectionLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 6 },
  emptyText: { fontSize: 12, color: Colors.textMuted, marginBottom: 8 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 8,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitle: { fontSize: 13, fontWeight: "600" },
  cardSubtitle: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  salesButton: {
    marginTop: 10,
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    paddingVertical: 8,
    alignItems: "center",
  },
  salesButtonText: { fontSize: 12, fontWeight: "600", color: Colors.text },
  salesDoneRow: { marginTop: 10 },
  salesDoneText: { fontSize: 12, color: Colors.available, fontWeight: "600" },
  cancelButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.booked,
    borderRadius: Radius.sm,
    paddingVertical: 8,
    alignItems: "center",
  },
  cancelButtonText: { fontSize: 12, fontWeight: "600", color: Colors.booked },
});
