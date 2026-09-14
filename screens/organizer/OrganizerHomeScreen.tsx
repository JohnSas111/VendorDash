import {
  BREAKPOINT,
  COLORS,
  formatDate,
  RADIUS,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type Session = {
  id: string;
  friday_date: string;
  sunday_date: string;
  status: "upcoming" | "open" | "closed" | "completed" | "cancelled";
};

type PendingBooking = {
  id: string;
  requested_at: string;
  vendor_name: string;
  stall_number: string;
};

type DashboardData = {
  venueName: string;
  activeStallCount: number;
  currentSession: Session | null;
  pendingBookings: PendingBooking[];
  pendingBookingCount: number;
  pendingVerificationCount: number;
  refundRequestCount: number;
};

// Where each stat card should take you when tapped.
const STAT_TARGETS: Record<string, string> = {
  "Active stalls": "/stalls",
  "Pending approvals": "/booking-requests",
  "Pending verifications": "/vendor-verification",
  "Refund requests": "/refund-requests",
};

export default function OrganizerHomeScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMsg(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const { data: venue, error: venueErr } = await supabase
        .from("venues")
        .select("id, name")
        .eq("organizer_id", user.id)
        .single();

      if (venueErr || !venue) {
        throw new Error(
          "No venue found for this organizer account. Create a venues row with organizer_id set to this user's id first.",
        );
      }

      const { count: stallCount } = await supabase
        .from("stalls")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venue.id)
        .eq("is_active", true);

      const { data: sessions } = await supabase
        .from("market_sessions")
        .select("id, friday_date, sunday_date, status")
        .eq("venue_id", venue.id)
        .in("status", ["upcoming", "open"])
        .order("friday_date", { ascending: true })
        .limit(1);

      const currentSession: Session | null = sessions?.[0] ?? null;

      const { data: pendingRows, count: pendingCount } = await supabase
        .from("bookings")
        .select(
          "id, requested_at, profiles!bookings_vendor_id_fkey(full_name), stalls!inner(stall_number, venue_id)",
          { count: "exact" },
        )
        .eq("status", "pending")
        .eq("stalls.venue_id", venue.id)
        .order("requested_at", { ascending: true })
        .limit(5);

      const pendingBookings: PendingBooking[] = (pendingRows ?? []).map(
        (row: any) => ({
          id: row.id,
          requested_at: row.requested_at,
          vendor_name: row.profiles?.full_name ?? "Unknown vendor",
          stall_number: row.stalls?.stall_number ?? "—",
        }),
      );

      const { count: verificationCount } = await supabase
        .from("vendor_details")
        .select("id", { count: "exact", head: true })
        .eq("is_verified", false);

      const { count: refundCount } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("refund_requested", true)
        .eq("status", "paid");

      setData({
        venueName: venue.name,
        activeStallCount: stallCount ?? 0,
        currentSession,
        pendingBookings,
        pendingBookingCount: pendingCount ?? 0,
        pendingVerificationCount: verificationCount ?? 0,
        refundRequestCount: refundCount ?? 0,
      });
    } catch (err: any) {
      setErrorMsg(err.message ?? "Something went wrong loading the dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleApprove = async (bookingId: string) => {
    setActingOnId(bookingId);
    const target = data?.pendingBookings.find((b) => b.id === bookingId);
    const paymentDeadline = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("bookings")
      .update({
        status: "approved",
        decided_at: new Date().toISOString(),
        reservation_expires_at: paymentDeadline,
      })
      .eq("id", bookingId);

    if (!error && target) {
      // We only have this booking's vendor_name here, not vendor_id —
      // the dashboard's summary query doesn't select it. Fetch it
      // just for the notification rather than widening the main
      // query for a field only needed on this one action.
      const { data: vendorRow } = await supabase
        .from("bookings")
        .select("vendor_id")
        .eq("id", bookingId)
        .single();
      if (vendorRow?.vendor_id) {
        await supabase.from("notifications").insert({
          recipient_id: vendorRow.vendor_id,
          title: "Booking approved!",
          body: `Stall ${target.stall_number} is approved — you have 15 minutes to pay before it expires.`,
          type: "booking_approved",
        });
      }
    }

    setActingOnId(null);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    load();
  };

  const handleReject = async (bookingId: string) => {
    setActingOnId(bookingId);
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", decided_at: new Date().toISOString() })
      .eq("id", bookingId);
    setActingOnId(null);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    load();
  };

  if (loading) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator color={COLORS.inkNavy} />
      </View>
    );
  }

  if (errorMsg && !data) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.errorText}>{errorMsg}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return null;

  const stats = [
    { label: "Active stalls", value: String(data.activeStallCount) },
    {
      label: "Pending approvals",
      value: String(data.pendingBookingCount),
      highlight: data.pendingBookingCount > 0,
    },
    {
      label: "Pending verifications",
      value: String(data.pendingVerificationCount),
      highlight: data.pendingVerificationCount > 0,
    },
    {
      label: "Refund requests",
      value: String(data.refundRequestCount),
      highlight: data.refundRequestCount > 0,
    },
  ];

  const sessionBadge = data.currentSession
    ? statusColors(data.currentSession.status)
    : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        isDesktop && styles.contentDesktop,
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.title}>Overview</Text>
      <Text style={styles.subtitle}>{data.venueName}</Text>

      {data.currentSession ? (
        <View style={styles.sessionRow}>
          <Text style={styles.sessionDates}>
            {formatDate(data.currentSession.friday_date)} –{" "}
            {formatDate(data.currentSession.sunday_date)}
          </Text>
          <View style={[shared.badge, { backgroundColor: sessionBadge!.bg }]}>
            <Text style={[shared.badgeText, { color: sessionBadge!.fg }]}>
              {data.currentSession.status}
            </Text>
          </View>
        </View>
      ) : (
        <Text style={styles.sessionDates}>No upcoming session scheduled</Text>
      )}

      {errorMsg && (
        <Text style={[styles.errorText, { marginTop: 12 }]}>{errorMsg}</Text>
      )}

      <View style={styles.quickActionsRow}>
        <Pressable
          style={shared.primaryButton}
          onPress={() => router.push("/sessions" as any)}
        >
          <Text style={shared.primaryButtonText}>+ Create session</Text>
        </Pressable>
        <Pressable
          style={shared.secondaryButton}
          onPress={() => router.push("/stalls" as any)}
        >
          <Text style={shared.secondaryButtonText}>+ Add stall</Text>
        </Pressable>
      </View>

      <View style={[styles.statGrid, isDesktop && styles.statGridDesktop]}>
        {stats.map((s) => (
          <Pressable
            key={s.label}
            onPress={() => router.push(STAT_TARGETS[s.label] as any)}
            style={[
              styles.statCard,
              isDesktop && styles.statCardDesktop,
              s.highlight && styles.statCardHighlight,
            ]}
          >
            <Text
              style={[styles.statValue, s.highlight && { color: COLORS.amber }]}
            >
              {s.value}
            </Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={shared.sectionHeading}>Needs attention</Text>

      {data.pendingBookings.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            No pending booking requests.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {data.pendingBookings.map((b) => (
            <View
              key={b.id}
              style={[styles.row, isDesktop && styles.rowDesktop]}
            >
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>{b.vendor_name}</Text>
                <Text style={styles.rowSubtitle}>
                  Stall {b.stall_number} · requested{" "}
                  {formatDate(b.requested_at)}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <Pressable
                  style={[styles.actionButton, styles.rejectButton]}
                  disabled={actingOnId === b.id}
                  onPress={() => handleReject(b.id)}
                >
                  <Text style={styles.rejectButtonText}>Reject</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionButton, styles.approveButton]}
                  disabled={actingOnId === b.id}
                  onPress={() => handleApprove(b.id)}
                >
                  <Text style={styles.approveButtonText}>Approve</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {data.pendingBookingCount > data.pendingBookings.length && (
        <Pressable onPress={() => router.push("/booking-requests" as any)}>
          <Text style={styles.moreLink}>
            + {data.pendingBookingCount - data.pendingBookings.length} more on
            Booking Requests →
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: 20, paddingBottom: 48 },
  contentDesktop: {
    padding: 40,
    maxWidth: 960,
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
  subtitle: { fontSize: 15, color: COLORS.slate, marginBottom: 2 },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  sessionDates: { fontSize: 13, color: COLORS.slate },
  errorText: { color: COLORS.clay, fontSize: 14 },
  retryButton: {
    marginTop: 12,
    backgroundColor: COLORS.inkNavy,
    borderRadius: RADIUS.sm,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryButtonText: { color: COLORS.white, fontWeight: "600" },

  quickActionsRow: { flexDirection: "row", gap: 10, marginTop: 20 },

  statGrid: { marginTop: 20, gap: 12 },
  statGridDesktop: { flexDirection: "row" },
  statCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  statCardDesktop: { flex: 1 },
  statCardHighlight: { borderColor: COLORS.amber },
  statValue: {
    fontSize: 26,
    fontWeight: "700",
    color: COLORS.inkNavy,
    marginBottom: 2,
  },
  statLabel: { fontSize: 13, color: COLORS.slate },

  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: { color: COLORS.slate, fontSize: 14 },

  list: { gap: 10 },
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
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: COLORS.inkNavy },
  rowSubtitle: { fontSize: 13, color: COLORS.slate, marginTop: 2 },
  rowActions: { flexDirection: "row", gap: 8 },
  actionButton: {
    borderRadius: RADIUS.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  rejectButton: {
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.clay,
  },
  rejectButtonText: { color: COLORS.clay, fontWeight: "600", fontSize: 13 },
  approveButton: { backgroundColor: COLORS.teal },
  approveButtonText: { color: COLORS.white, fontWeight: "600", fontSize: 13 },

  moreLink: {
    marginTop: 12,
    color: COLORS.inkNavy,
    fontSize: 13,
    fontWeight: "600",
  },
});
