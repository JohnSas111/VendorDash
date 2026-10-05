import { PressableButton } from "@/components/PressableButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  RADIUS,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { ownerPrefix, vendorDisplay } from "@/lib/uxHelpers";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
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
  vendor_name: string; // business name (falls back to the person's name)
  owner_name: string;
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
  const { showToast } = useToast();

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
          "id, requested_at, profiles!bookings_vendor_id_fkey(full_name, vendor_details!vendor_details_id_fkey(business_name)), stalls!inner(stall_number, venue_id)",
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
          vendor_name: vendorDisplay(row.profiles).name,
          owner_name: vendorDisplay(row.profiles).owner,
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
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Approval is enforced by the database function approve_booking: it checks
  // that this organizer owns the venue, the booking is still pending, the
  // vendor is verified, and it sets the payment deadline, notifies the vendor
  // and records the audit event in one transaction.
  const handleApprove = async (bookingId: string) => {
    setActingOnId(bookingId);

    const { error } = await supabase.rpc("approve_booking", {
      p_booking_id: bookingId,
    });

    setActingOnId(null);
    if (error) {
      // A failed approve/reject is a one-off action error, not a
      // "the whole dashboard is broken" state — a toast fits better here
      // than the persistent errorMsg banner (that's reserved for the
      // initial load failing).
      showToast(error.message || "Couldn't approve that booking.", "error");
      load();
      return;
    }
    showToast("Booking approved. The vendor has been notified.", "success");
    load();
  };

  // reject_booking moves pending -> rejected and notifies the vendor.
  const handleReject = async (bookingId: string) => {
    setActingOnId(bookingId);

    const { error } = await supabase.rpc("reject_booking", {
      p_booking_id: bookingId,
      p_reason: null,
    });

    setActingOnId(null);
    if (error) {
      showToast(error.message || "Couldn't reject that booking.", "error");
      load();
      return;
    }
    showToast("Booking rejected. The vendor has been notified.", "info");
    load();
  };

  if (loading) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          isDesktop && styles.contentDesktop,
        ]}
      >
        <DashboardSkeleton isDesktop={isDesktop} />
      </ScrollView>
    );
  }

  if (errorMsg && !data) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.errorText}>{errorMsg}</Text>
        <PressableButton style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </PressableButton>
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

      <View style={styles.quickActionsRow}>
        <View style={styles.quickActionButton}>
          <PrimaryButton
            label="+ Create session"
            onPress={() => router.push("/sessions" as any)}
          />
        </View>
        <View style={styles.quickActionButton}>
          <PrimaryButton
            label="+ Add stall"
            variant="secondary"
            onPress={() => router.push("/stalls" as any)}
          />
        </View>
      </View>

      <View style={[styles.statGrid, isDesktop && styles.statGridDesktop]}>
        {stats.map((s) => (
          <Pressable
            accessibilityRole="button"
            key={s.label}
            onPress={() => router.push(STAT_TARGETS[s.label] as any)}
            style={[
              styles.statCard,
              isDesktop && styles.statCardDesktop,
              s.highlight && styles.statCardHighlight,
            ]}
          >
            <Text
              style={[
                styles.statValue,
                s.highlight && { color: COLORS.amberText },
              ]}
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
          <Ionicons
            name="checkmark-done-circle-outline"
            size={28}
            color={COLORS.slate}
            style={{ marginBottom: Spacing.xs }}
          />
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
                  {ownerPrefix(b.vendor_name, b.owner_name)}Stall{" "}
                  {b.stall_number} · requested {formatDate(b.requested_at)}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <PressableButton
                  style={[styles.actionButton, styles.rejectButton]}
                  disabled={actingOnId === b.id}
                  onPress={() => handleReject(b.id)}
                >
                  <Ionicons name="close" size={14} color={COLORS.clay} />
                  <Text style={styles.rejectButtonText}>Reject</Text>
                </PressableButton>
                <PressableButton
                  style={[styles.actionButton, styles.approveButton]}
                  disabled={actingOnId === b.id}
                  onPress={() => handleApprove(b.id)}
                >
                  <Ionicons name="checkmark" size={14} color={COLORS.white} />
                  <Text style={styles.approveButtonText}>Approve</Text>
                </PressableButton>
              </View>
            </View>
          ))}
        </View>
      )}

      {data.pendingBookingCount > data.pendingBookings.length && (
        <Pressable
          accessibilityRole="link"
          style={styles.moreLinkRow}
          onPress={() => router.push("/booking-requests" as any)}
        >
          <Text style={styles.moreLink}>
            + {data.pendingBookingCount - data.pendingBookings.length} more on
            Booking Requests
          </Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.inkNavy} />
        </Pressable>
      )}
    </ScrollView>
  );
}

// Placeholder shown while the dashboard's first load is in flight,
// replacing the old lone centered ActivityIndicator.
function DashboardSkeleton({ isDesktop }: { isDesktop: boolean }) {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: 160, height: 26, marginBottom: Spacing.sm },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 120, marginBottom: Spacing.lg }]}
      />
      <View style={[styles.statGrid, isDesktop && styles.statGridDesktop]}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.statCard,
              isDesktop && styles.statCardDesktop,
              styles.skeletonCard,
            ]}
          />
        ))}
      </View>
      <View
        style={[
          styles.skeletonLine,
          { width: 140, marginTop: Spacing.xxl, marginBottom: Spacing.md },
        ]}
      />
      <View style={[styles.row, styles.skeletonCard]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: Spacing.xl, paddingBottom: Spacing.xxxl + Spacing.lg },
  contentDesktop: {
    padding: Spacing.xxxl + Spacing.lg,
    maxWidth: 960,
    alignSelf: "center",
    width: "100%",
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.paper,
    padding: Spacing.xxl,
  },
  title: {
    fontFamily: "serif",
    fontSize: Typography.xxxl - 4,
    color: COLORS.inkNavy,
    marginBottom: Spacing.xs,
  },
  subtitle: { fontSize: Typography.md, color: COLORS.slate, marginBottom: 2 },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: 2,
  },
  sessionDates: { fontSize: Typography.base, color: COLORS.slate },
  errorText: { color: COLORS.clayText, fontSize: Typography.md },
  retryButton: {
    marginTop: Spacing.md,
    backgroundColor: COLORS.inkNavy,
    borderRadius: RADIUS.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: { color: COLORS.white, fontWeight: "600" },

  quickActionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  quickActionButton: { flex: 1 },

  statGrid: { marginTop: Spacing.xl, gap: Spacing.md },
  statGridDesktop: { flexDirection: "row" },
  statCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: Spacing.lg,
    ...Shadow.sm,
  },
  skeletonCard: {
    backgroundColor: COLORS.border,
    shadowOpacity: 0,
    minHeight: 64,
  },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: COLORS.border,
  },
  statCardDesktop: { flex: 1 },
  statCardHighlight: { borderColor: COLORS.amber },
  statValue: {
    fontSize: Typography.xxl + 2,
    fontWeight: "700",
    color: COLORS.inkNavy,
    marginBottom: 2,
  },
  statLabel: { fontSize: Typography.base, color: COLORS.slate },

  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: Spacing.xl,
    alignItems: "center",
    ...Shadow.sm,
  },
  emptyStateText: { color: COLORS.slate, fontSize: Typography.md },

  list: { gap: Spacing.sm },
  row: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  rowDesktop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowInfo: { flex: 1 },
  rowTitle: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: COLORS.inkNavy,
  },
  rowSubtitle: { fontSize: Typography.base, color: COLORS.slate, marginTop: 2 },
  rowActions: { flexDirection: "row", gap: Spacing.sm },
  actionButton: {
    borderRadius: RADIUS.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  rejectButton: {
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.clay,
  },
  rejectButtonText: {
    color: COLORS.clayText,
    fontWeight: "600",
    fontSize: Typography.base,
  },
  approveButton: { backgroundColor: COLORS.teal },
  approveButtonText: {
    color: COLORS.inkNavy,
    fontWeight: "600",
    fontSize: Typography.base,
  },

  moreLinkRow: {
    marginTop: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minHeight: 44,
  },
  moreLink: {
    color: COLORS.inkNavy,
    fontSize: Typography.base,
    fontWeight: "600",
  },
});
