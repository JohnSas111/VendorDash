import { PrimaryButton } from "@/components/PrimaryButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Animated,
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
    venues: { name: string } | null;
  } | null;
};

// Computes "Good morning / afternoon / evening" from the current hour
// instead of the string that used to be hardcoded to "Good evening".
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function VendorHomeScreen() {
  const [businessName, setBusinessName] = useState("");
  const [profileComplete, setProfileComplete] = useState(true);
  // Defaults to true so the "not verified" notice never flashes while loading.
  const [isVerified, setIsVerified] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  // useState's lazy initializer (not useRef().current) — reading a ref's
  // .current during render trips the react-hooks/refs rule; a stable value
  // pulled from state doesn't.
  const [fadeAnim] = useState(() => new Animated.Value(0));

  const loadData = useCallback(async () => {
    setLoadError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      router.replace("/(auth)/login");
      return;
    }

    // maybeSingle(): a missing row is "profile not finished yet" (no error),
    // while a real failure (network, permissions) comes back as an error.
    const [profileRes, detailsRes, notifRes] = await Promise.all([
      supabase.from("profiles").select("phone").eq("id", userId).maybeSingle(),
      supabase
        .from("vendor_details")
        .select("business_name, category, is_verified")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .eq("is_read", false),
    ]);

    // If the account data failed to load, keep what we already show. It used
    // to be treated as "profile incomplete", which wrongly told the vendor to
    // finish setup and sent "Browse markets" to the profile screen.
    const accountFailed = Boolean(profileRes.error || detailsRes.error);
    if (!accountFailed) {
      const vendorDetails = detailsRes.data;
      if (vendorDetails) setBusinessName(vendorDetails.business_name);
      setProfileComplete(
        Boolean(profileRes.data?.phone && vendorDetails?.category),
      );
      setIsVerified(vendorDetails?.is_verified === true);
    }
    if (!notifRes.error) setUnreadCount(notifRes.count ?? 0);

    const { data: bookingData, error } = await supabase
      .from("bookings")
      .select(
        "id, status, attending_days, stalls(stall_number), market_sessions(friday_date, sunday_date, venues(name))",
      )
      .eq("vendor_id", userId)
      .order("requested_at", { ascending: false });

    // Previously `if (!error && bookingData)` — a failed fetch just left the
    // list empty/stale with no feedback. Now a failure surfaces an inline,
    // dismissible error banner instead of failing silently.
    if (error) {
      setLoadError("Couldn't load your bookings. Pull down to try again.");
      return;
    }
    if (bookingData) setBookings(bookingData as unknown as BookingRow[]);
    if (accountFailed) {
      setLoadError(
        "Couldn't load your account details. Pull down to try again.",
      );
    }
  }, []);

  // Re-fetch every time this screen becomes focused — e.g. navigating back
  // from Payment after a successful booking — not just on first mount.
  useFocusEffect(
    useCallback(() => {
      loadData().finally(() => setLoading(false));
    }, [loadData]),
  );

  // Fade the content in once the first load finishes, instead of it
  // popping in abruptly.
  useFocusEffect(
    useCallback(() => {
      if (!loading) {
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }).start();
      }
    }, [loading, fadeAnim]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  // "2026-10-02" is read as a plain calendar date. new Date("2026-10-02")
  // means midnight UTC, which shows the day before on a device behind UTC.
  function formatDateRange(friday: string, sunday: string) {
    const [fy, fm, fd] = friday.split("-").map(Number);
    const [sy, sm, sd] = sunday.split("-").map(Number);
    if (!fy || !fm || !fd || !sy || !sm || !sd) return `${friday} – ${sunday}`;
    const f = new Date(fy, fm - 1, fd);
    const s = new Date(sy, sm - 1, sd);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    // Same month: "Oct 2–4". Across months: "Oct 30 – Nov 1".
    if (fm === sm && fy === sy) {
      return `${f.toLocaleDateString("en-US", opts)}–${sd}`;
    }
    return `${f.toLocaleDateString("en-US", opts)} – ${s.toLocaleDateString("en-US", opts)}`;
  }

  function handleBrowsePress() {
    if (!profileComplete) {
      router.push("/(vendor)/complete-profile");
      return;
    }
    router.push("/(vendor)/floor-map");
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.md }]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>{getGreeting()}</Text>
          <Text style={styles.name}>{businessName || "Vendor"}</Text>
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={styles.iconButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => router.push("/(vendor)/notifications")}
            accessibilityRole="button"
            accessibilityLabel={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
          >
            <Ionicons
              name="notifications-outline"
              size={22}
              color={Colors.text}
            />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

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

      {!loading && !profileComplete && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.banner}
          onPress={() => router.push("/(vendor)/complete-profile")}
        >
          <Text style={styles.bannerTitle}>
            Complete your profile to browse stalls
          </Text>
          <View style={styles.bannerActionRow}>
            <Text style={styles.bannerAction}>Finish setup</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.info} />
          </View>
        </TouchableOpacity>
      )}

      {!loading && profileComplete && !isVerified && (
        <View style={styles.verifyNotice}>
          <Ionicons
            name="shield-outline"
            size={16}
            color={Colors.warningText}
          />
          <View style={styles.verifyTextWrap}>
            <Text style={styles.verifyTitle}>
              Your business isn’t verified yet
            </Text>
            <Text style={styles.verifyText}>
              Until the organizer verifies it, reservation requests expire after
              24 hours if not approved (72 hours once verified), and stalls
              can’t auto-renew.
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionLabel}>Your bookings</Text>

      {loading ? (
        <HomeSkeleton />
      ) : (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <FlatList
            data={bookings}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons
                  name="storefront-outline"
                  size={32}
                  color={Colors.textMuted}
                  style={{ marginBottom: Spacing.sm }}
                />
                <Text style={styles.emptyTitle}>No bookings yet</Text>
                <Text style={styles.emptyText}>
                  {profileComplete
                    ? "Reserve a stall for this weekend's market"
                    : "Complete your profile first, then reserve a stall"}
                </Text>
                <PrimaryButton
                  label={profileComplete ? "Book a stall" : "Complete profile"}
                  onPress={handleBrowsePress}
                />
              </View>
            }
            renderItem={({ item }) => {
              const dateLabel = item.market_sessions
                ? formatDateRange(
                    item.market_sessions.friday_date,
                    item.market_sessions.sunday_date,
                  )
                : "Date unavailable";
              const marketName = item.market_sessions?.venues?.name ?? "Market";

              return (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.card}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push({
                      pathname: "/(vendor)/booking-detail",
                      params: { bookingId: item.id },
                    })
                  }
                >
                  <View style={styles.cardRow}>
                    <Text style={styles.cardTitle}>{marketName}</Text>
                    <StatusBadge status={item.status} />
                  </View>
                  <Text style={styles.cardSubtitle}>
                    {dateLabel} · Stall {item.stalls?.stall_number ?? "—"} · tap
                    for details
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </Animated.View>
      )}

      {!loading && (
        <View style={{ marginTop: Spacing.md }}>
          <PrimaryButton label="Browse markets" onPress={handleBrowsePress} />
        </View>
      )}
    </View>
  );
}

// Placeholder cards shown while the initial fetch is in flight, so the
// screen never shows a blank gap or a lone spinner.
function HomeSkeleton() {
  return (
    <View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.card, styles.skeletonCard]}>
          <View style={[styles.skeletonLine, { width: "50%" }]} />
          <View
            style={[
              styles.skeletonLine,
              { width: "75%", marginTop: Spacing.sm },
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.md,
  },
  greeting: { fontSize: Typography.xs, color: Colors.textMuted },
  name: { fontSize: Typography.md, fontWeight: "500", color: Colors.text },
  headerIcons: { flexDirection: "row", gap: Spacing.md },
  iconButton: {
    position: "relative",
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: Colors.booked,
    borderRadius: Radius.sm,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: Colors.white, fontSize: 9, fontWeight: "700" },
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
  banner: {
    backgroundColor: Colors.infoLight,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bannerTitle: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.info,
    flex: 1,
    marginRight: Spacing.sm,
  },
  bannerActionRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  bannerAction: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.info,
  },
  verifyNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: Colors.warningLight,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  verifyTextWrap: { flex: 1 },
  verifyTitle: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.warningText,
  },
  verifyText: {
    fontSize: Typography.xs,
    color: Colors.warningText,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: Spacing.xxxl + Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  emptyText: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  card: {
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
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
    fontWeight: "500",
    color: Colors.text,
  },
  cardSubtitle: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
});
