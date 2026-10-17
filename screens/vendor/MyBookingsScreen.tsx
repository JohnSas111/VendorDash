import { ConfirmModal } from "@/components/ConfirmModal";
import { Pagination } from "@/components/organizer/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { usePaging } from "@/hooks/usePaging";
import { CARD_SHADOW, COLORS, RADIUS, SERIF } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { formatDateRange, isUpcoming } from "@/lib/vendorBookings";
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
    venues: { timezone: string | null } | null;
  } | null;
  payments: { amount_cents: number; status: string }[] | null;
  sales_submissions: { id: string }[] | null;
  refund_requests: { status: string; created_at: string }[] | null;
};

// The newest refund request for a booking, as a short line for the card.
function refundNote(booking: BookingRow): string | null {
  const latest = [...(booking.refund_requests ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
  switch (latest?.status) {
    case "requested":
      return "Refund requested — waiting on the organizer.";
    case "approved":
      return "Refund approved — bring a valid ID to the organizer.";
    case "refunded":
      return "Refund paid out.";
    case "rejected":
      return "Refund request declined — open the booking to see why.";
    default:
      return null;
  }
}

// Short line under the date on an upcoming card. It used to say
// "tap for QR check-in" for every status, even before payment.
function upcomingHint(status: string): string {
  switch (status) {
    case "pending":
      return "waiting for organizer approval";
    case "approved":
      return "approved · tap to pay";
    case "paid":
      return "paid · tap for QR check-in";
    case "checked_in":
      return "checked in · tap for details";
    default:
      return "tap for details";
  }
}

function canCancel(booking: BookingRow): boolean {
  // Vendors may cancel while a booking is still pending or approved — i.e.
  // before it is paid. The database function cancel_booking enforces this
  // (plus "no payment in progress"); this only decides whether to show the
  // button.
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
        "id, status, attending_days, stalls(stall_number), market_sessions(friday_date, sunday_date, booking_deadline, venues(timezone)), payments(amount_cents, status), sales_submissions(id), refund_requests(status, created_at)",
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
    // cancel_booking checks that this is your own pending/approved
    // reservation and that no payment is in progress, then cancels it and
    // records the audit event.
    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: booking.id,
    });
    setCancellingId(null);

    if (error) {
      showToast(error.message || "Could not cancel booking.", "error");
      return;
    }
    showToast("Booking cancelled.", "success");
    loadData();
  }

  const upcoming = bookings.filter(isUpcoming);
  const history = bookings.filter((b) => !isUpcoming(b));

  // 10 cards per page in each section (same helpers as the organizer lists).
  const upcomingPaging = usePaging(upcoming, "upcoming");
  const historyPaging = usePaging(history, "history");

  // Only money that was actually paid counts. Pending, failed and refunded
  // payment rows used to be added in as well.
  const totalSpent = bookings.reduce((sum, b) => {
    const paid =
      b.payments
        ?.filter((p) => p.status === "paid")
        .reduce((s, p) => s + p.amount_cents, 0) ?? 0;
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

  // Small colored tile on each card, like Home: amber = waiting on someone,
  // green = paid and in play, grey = finished or closed.
  function cardIcon(status: string) {
    const green = status === "paid" || status === "checked_in";
    const amber = status === "pending" || status === "approved";
    return (
      <View
        style={[
          styles.cardIconTile,
          green && styles.cardIconGreen,
          amber && styles.cardIconAmber,
        ]}
      >
        <Ionicons
          name={
            green
              ? "checkmark-circle-outline"
              : amber
                ? "time-outline"
                : "receipt-outline"
          }
          size={22}
          color={
            green
              ? Colors.availableText
              : amber
                ? Colors.warningText
                : Colors.textMuted
          }
        />
      </View>
    );
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
            {cardIcon(item.status)}
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardTitle}>{dateLabel}</Text>
              <Text style={styles.cardSubtitle}>
                Stall {item.stalls?.stall_number ?? "—"} ·{" "}
                {upcomingHint(item.status)}
              </Text>
            </View>
            <StatusBadge status={item.status} />
          </View>
          {refundNote(item) && (
            <Text style={styles.refundNote}>{refundNote(item)}</Text>
          )}
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
    // The server only accepts sales for a COMPLETED booking (the organizer
    // marks it complete after the market). Paid / checked-in ones cannot
    // submit yet.
    const canSubmitSales = item.status === "completed";
    const note = refundNote(item);

    return (
      <View style={styles.card} key={item.id}>
        <View style={styles.cardRow}>
          {cardIcon(item.status)}
          <View style={styles.cardTitleWrap}>
            <Text style={styles.cardTitle}>{dateLabel}</Text>
            <Text style={styles.cardSubtitle}>
              Stall {item.stalls?.stall_number ?? "—"} · {daysLabel}
            </Text>
          </View>
          <StatusBadge status={item.status} />
        </View>

        {note && <Text style={styles.refundNote}>{note}</Text>}

        {item.status === "checked_in" && (
          <Text style={styles.waitNote}>
            Waiting for the organizer to mark this market complete. You can
            submit sales after that.
          </Text>
        )}
        {item.status === "paid" && (
          <Text style={styles.waitNote}>
            This market has ended and you did not check in.
          </Text>
        )}

        {canSubmitSales &&
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
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <Text style={styles.title}>My Bookings</Text>
        <View style={styles.metricsRow}>
          <View style={[styles.metricCard, styles.metricDark]}>
            <Text style={[styles.metricLabel, styles.metricLabelLight]}>
              This weekend
            </Text>
            <Text style={[styles.metricValue, styles.metricValueLight]}>
              {upcoming.length > 0 ? `Stall ${thisWeekendStall}` : "None"}
            </Text>
          </View>
          <View style={[styles.metricCard, styles.metricAmber]}>
            <Text style={styles.metricLabel}>Total spent</Text>
            <Text style={styles.metricValue}>
              ₱{(totalSpent / 100).toLocaleString()}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {loadError && (
          <View style={styles.errorBanner}>
            <Ionicons
              name="alert-circle-outline"
              size={16}
              color={Colors.dangerText}
            />
            <Text style={styles.errorBannerText}>{loadError}</Text>
          </View>
        )}

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
                {upcomingPaging.pageItems.map(renderUpcomingCard)}
                <Pagination
                  page={upcomingPaging.page}
                  total={upcomingPaging.total}
                  noun="bookings"
                  onPage={upcomingPaging.setPage}
                />

                <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>
                  History
                </Text>
                {history.length === 0 && (
                  <Text style={styles.emptyText}>No past bookings yet.</Text>
                )}
                {historyPaging.pageItems.map(renderHistoryCard)}
                <Pagination
                  page={historyPaging.page}
                  total={historyPaging.total}
                  noun="bookings"
                  onPage={historyPaging.setPage}
                />
              </View>
            }
          />
        )}
      </View>

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
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: COLORS.dark,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  body: { flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
  title: {
    fontFamily: SERIF,
    fontSize: 30,
    fontWeight: "400",
    color: Colors.white,
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
  errorBannerText: {
    fontSize: Typography.sm,
    color: Colors.dangerText,
    flex: 1,
  },
  metricsRow: { flexDirection: "row", gap: Spacing.sm },
  metricCard: {
    flex: 1,
    borderRadius: RADIUS.sm + 4,
    padding: Spacing.lg,
    minHeight: 84,
    justifyContent: "space-between",
  },
  metricDark: { backgroundColor: "#2B2B2B" },
  metricAmber: { backgroundColor: Colors.reserved },
  metricLabel: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.text,
  },
  metricLabelLight: { color: COLORS.onDark },
  metricValue: {
    fontFamily: SERIF,
    fontSize: 24,
    fontWeight: "400",
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  metricValueLight: { color: Colors.white },
  cardIconTile: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  cardIconAmber: { backgroundColor: Colors.warningLight },
  cardIconGreen: { backgroundColor: Colors.successLight },
  cardTitleWrap: { flex: 1, marginRight: Spacing.sm },
  sectionLabel: {
    fontFamily: SERIF,
    fontSize: 22,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  emptyText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    ...CARD_SHADOW,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  skeletonCard: { opacity: 0.6 },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
  cardRow: { flexDirection: "row", alignItems: "center" },
  cardTitle: {
    fontFamily: SERIF,
    fontSize: 18,
    color: Colors.text,
  },
  cardSubtitle: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    marginTop: 2,
  },
  refundNote: {
    fontSize: Typography.xs,
    color: Colors.warningText,
    marginTop: Spacing.xs,
  },
  waitNote: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
  salesButton: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    paddingVertical: Spacing.md,
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
    borderRadius: RADIUS.sm,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.booked,
  },
});
