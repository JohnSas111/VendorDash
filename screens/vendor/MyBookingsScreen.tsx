import { ConfirmModal } from "@/components/ConfirmModal";
import { StatusBadge } from "@/components/StatusBadge";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
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
  const [pendingCancel, setPendingCancel] = useState<BookingRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const loadData = useCallback(async () => {
    setLoadError(null);
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

    // Previously `if (!error && data)` — a failed fetch left the list
    // empty/stale with no feedback. Now it surfaces an inline error banner.
    if (error) {
      setLoadError("Couldn't load your bookings. Pull down to try again.");
      return;
    }
    if (data) setBookings(data as unknown as BookingRow[]);
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

  function handleCancel(booking: BookingRow) {
    setPendingCancel(booking);
  }

  async function confirmCancel() {
    const booking = pendingCancel;
    if (!booking) return;
    setPendingCancel(null);
    setCancellingId(booking.id);
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id);
    setCancellingId(null);

    if (error) {
      showToast(error.message || "Could not cancel booking.", "error");
      return;
    }
    showToast("Booking cancelled.", "success");
    loadData();
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
          accessibilityRole="button"
          activeOpacity={0.7}
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
            accessibilityRole="button"
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
              <Ionicons
                name="checkmark-circle"
                size={14}
                color={Colors.available}
              />
              <Text style={styles.salesDoneText}>Sales submitted</Text>
            </View>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
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
    <View style={[styles.container, { paddingTop: insets.top + Spacing.md }]}>
      <Text style={styles.title}>My Bookings</Text>

      {loadError && (
        <View style={styles.errorBanner}>
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={Colors.booked}
          />
          <Text style={styles.errorBannerText}>{loadError}</Text>
        </View>
      )}

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

      {loading ? (
        <BookingsSkeleton />
      ) : (
        <FlatList
          data={[]}
          renderItem={null}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListHeaderComponent={
            <View>
              <Text style={styles.sectionLabel}>Upcoming</Text>
              {upcoming.length === 0 && (
                <Text style={styles.emptyText}>No upcoming bookings.</Text>
              )}
              {upcoming.map(renderUpcomingCard)}

              <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>
                History
              </Text>
              {history.length === 0 && (
                <Text style={styles.emptyText}>No past bookings yet.</Text>
              )}
              {history.map(renderHistoryCard)}
            </View>
          }
        />
      )}

      <ConfirmModal
        visible={!!pendingCancel}
        title="Cancel booking?"
        message="This will release the stall so other vendors can book it."
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        onConfirm={confirmCancel}
        onDismiss={() => setPendingCancel(null)}
      />
    </View>
  );
}

// Placeholder shown while the initial fetch is in flight.
function BookingsSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: "30%", marginBottom: Spacing.sm },
        ]}
      />
      {[0, 1].map((i) => (
        <View key={i} style={[styles.card, styles.skeletonCard]}>
          <View style={[styles.skeletonLine, { width: "40%" }]} />
          <View
            style={[
              styles.skeletonLine,
              { width: "65%", marginTop: Spacing.sm },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.xl,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: "bold",
    textAlign: "center",
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.dangerLight,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  errorBannerText: { fontSize: Typography.sm, color: Colors.booked, flex: 1 },
  metricsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  metricCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  metricLabel: { fontSize: Typography.xs, color: Colors.textMuted },
  metricValue: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  sectionLabel: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  skeletonCard: { opacity: 0.6 },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitle: {
    fontSize: Typography.base,
    fontWeight: "600",
    color: Colors.text,
  },
  cardSubtitle: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  salesButton: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  salesButtonText: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.text,
  },
  salesDoneRow: {
    marginTop: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  salesDoneText: {
    fontSize: Typography.sm,
    color: Colors.available,
    fontWeight: "600",
  },
  cancelButton: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.booked,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.booked,
  },
});
