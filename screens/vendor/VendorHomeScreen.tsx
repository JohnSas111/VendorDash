import { PrimaryButton } from "@/components/PrimaryButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  CARD_SHADOW,
  COLORS,
  RADIUS,
  SERIF,
  shared,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { formatDateRange, isUpcoming, payBefore } from "@/lib/vendorBookings";
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
  reservation_expires_at: string | null;
  stalls: { stall_number: string; price_per_day_cents: number } | null;
  market_sessions: {
    friday_date: string;
    sunday_date: string;
    venues: { name: string; timezone: string | null } | null;
  } | null;
};

// How many active bookings Home shows; "See all" opens My Bookings.
const HOME_LIMIT = 5;

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
        "id, status, attending_days, reservation_expires_at, stalls(stall_number, price_per_day_cents), market_sessions(friday_date, sunday_date, venues(name, timezone))",
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

  function handleBrowsePress() {
    if (!profileComplete) {
      router.push("/(vendor)/complete-profile");
      return;
    }
    router.push("/(vendor)/floor-map");
  }

  // Active = still in play and the market is not over (same rule as My Bookings).
  const active = bookings
    .filter(isUpcoming)
    .sort((x, y) =>
      (x.market_sessions?.friday_date ?? "").localeCompare(
        y.market_sessions?.friday_date ?? "",
      ),
    );
  const waitingCount = active.filter((b) => b.status === "approved").length;
  const paidCount = active.filter((b) => b.status === "paid").length;
  const shown = active.slice(0, HOME_LIMIT);
  const stat = (n: number) => (loading ? "–" : String(n));

  function handlePay(item: BookingRow) {
    if (!item.stalls) return;
    const amountCents =
      item.stalls.price_per_day_cents * item.attending_days.length;
    router.push({
      pathname: "/(vendor)/payment",
      params: {
        bookingId: item.id,
        amount: Math.round(amountCents).toString(),
      },
    });
  }

  function openBooking(item: BookingRow) {
    router.push({
      pathname: "/(vendor)/booking-detail",
      params: { bookingId: item.id },
    });
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {businessName || "Vendor"}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.bellButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
              color={Colors.white}
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

        <View style={styles.tiles}>
          <View style={[styles.tile, styles.tileDark]}>
            <Text style={[styles.tileNumber, styles.tileNumberLight]}>
              {stat(active.length)}
            </Text>
            <Text style={[styles.tileLabel, styles.tileLabelLight]}>
              Active bookings
            </Text>
          </View>
          <View style={[styles.tile, styles.tileAmber]}>
            <Text style={styles.tileNumber}>{stat(waitingCount)}</Text>
            <Text style={styles.tileLabel}>Waiting for payment</Text>
          </View>
          <View style={[styles.tile, styles.tileGreen]}>
            <Text style={styles.tileNumber}>{stat(paidCount)}</Text>
            <Text style={styles.tileLabel}>Paid and ready</Text>
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
              <Ionicons
                name="chevron-forward"
                size={14}
                color={Colors.warningText}
              />
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
                Until the organizer verifies it, reservation requests expire
                after 24 hours if not approved (72 hours once verified), and
                stalls can’t auto-renew.
              </Text>
            </View>
          </View>
        )}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>Your bookings</Text>
          {!loading && bookings.length > 0 && (
            <TouchableOpacity
              accessibilityRole="button"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => router.navigate("/(vendor)/(tabs)/my-bookings")}
            >
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <HomeSkeleton />
        ) : (
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            <FlatList
              data={shown}
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
                  <Text style={styles.emptyTitle}>No active bookings</Text>
                  <Text style={styles.emptyText}>
                    {profileComplete
                      ? "Reserve a stall for this weekend's market"
                      : "Complete your profile first, then reserve a stall"}
                  </Text>
                  <PrimaryButton
                    label={
                      profileComplete ? "Book a stall" : "Complete profile"
                    }
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
                const marketName =
                  item.market_sessions?.venues?.name ?? "Market";
                const daysLabel = item.attending_days
                  ?.map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3))
                  .join(", ");
                const deadline = payBefore(
                  item.reservation_expires_at,
                  item.market_sessions?.venues?.timezone,
                );
                const isPaid =
                  item.status === "paid" || item.status === "checked_in";
                const needsPayment = item.status === "approved";

                return (
                  <View style={styles.card}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      activeOpacity={0.7}
                      onPress={() => openBooking(item)}
                    >
                      <View style={styles.cardTop}>
                        <View
                          style={[
                            styles.cardIcon,
                            isPaid
                              ? styles.cardIconGreen
                              : styles.cardIconAmber,
                          ]}
                        >
                          <Ionicons
                            name={
                              isPaid
                                ? "checkmark-circle-outline"
                                : "location-outline"
                            }
                            size={22}
                            color={
                              isPaid ? Colors.availableText : Colors.warningText
                            }
                          />
                        </View>
                        <View style={styles.cardTitleWrap}>
                          <Text style={styles.cardTitle} numberOfLines={1}>
                            {marketName}
                          </Text>
                          <Text style={styles.cardSubtitle} numberOfLines={1}>
                            Stall {item.stalls?.stall_number ?? "—"} ·{" "}
                            {daysLabel || dateLabel}
                          </Text>
                        </View>
                        <StatusBadge status={item.status} />
                      </View>
                    </TouchableOpacity>

                    {needsPayment && (
                      <>
                        <View style={styles.noteRow}>
                          <Ionicons
                            name="time-outline"
                            size={16}
                            color={Colors.warningText}
                          />
                          <Text style={styles.noteAmber}>
                            {deadline
                              ? `Pay before ${deadline} to keep your stall`
                              : "Pay to keep your stall"}
                          </Text>
                        </View>
                        {item.stalls && (
                          <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.8}
                            style={styles.payButton}
                            onPress={() => handlePay(item)}
                          >
                            <Text style={styles.payButtonText}>Pay now</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}

                    {item.status === "pending" && (
                      <View style={styles.noteRow}>
                        <Ionicons
                          name="time-outline"
                          size={16}
                          color={Colors.warningText}
                        />
                        <Text style={styles.noteAmber}>
                          Waiting for the organizer to approve
                        </Text>
                      </View>
                    )}

                    {isPaid && (
                      <TouchableOpacity
                        accessibilityRole="button"
                        activeOpacity={0.7}
                        style={styles.qrRow}
                        onPress={() => openBooking(item)}
                      >
                        <Text style={styles.noteGreen}>
                          {item.status === "paid"
                            ? "Show your QR code at check-in"
                            : "You are checked in"}
                        </Text>
                        <Text style={styles.viewQr}>View QR</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }}
            />
          </Animated.View>
        )}

        {!loading && (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            style={styles.findButton}
            onPress={handleBrowsePress}
          >
            <Ionicons name="add" size={20} color={Colors.white} />
            <Text style={styles.findButtonText}>Find a stall</Text>
          </TouchableOpacity>
        )}
      </View>
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
  container: { flex: 1, backgroundColor: Colors.background },
  // Dark header with the three number tiles.
  header: {
    backgroundColor: COLORS.dark,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  headerText: { flex: 1, marginRight: Spacing.md },
  greeting: { fontSize: Typography.base, color: COLORS.onDark },
  name: {
    fontFamily: SERIF,
    fontSize: 30,
    fontWeight: "400",
    color: Colors.white,
  },
  bellButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#2B2B2B",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: Colors.reserved,
    borderRadius: Radius.lg,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: Colors.text, fontSize: 10, fontWeight: "700" },
  tiles: { flexDirection: "row", gap: Spacing.sm },
  tile: {
    flex: 1,
    borderRadius: RADIUS.sm + 4,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: 84,
    justifyContent: "space-between",
  },
  tileDark: { backgroundColor: "#2B2B2B" },
  tileAmber: { backgroundColor: Colors.reserved },
  tileGreen: { backgroundColor: Colors.available },
  tileNumber: {
    fontFamily: SERIF,
    fontSize: 26,
    fontWeight: "400",
    color: Colors.text,
  },
  tileNumberLight: { color: Colors.white },
  tileLabel: { fontSize: Typography.sm, fontWeight: "600", color: Colors.text },
  tileLabelLight: { color: COLORS.onDark },
  body: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.dangerLight,
    borderRadius: RADIUS.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  errorBannerText: {
    fontSize: Typography.sm,
    color: Colors.dangerText,
    flex: 1,
  },
  banner: {
    backgroundColor: Colors.warningLight,
    borderRadius: RADIUS.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bannerTitle: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.warningText,
    flex: 1,
    marginRight: Spacing.sm,
  },
  bannerActionRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  bannerAction: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.warningText,
  },
  verifyNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: Colors.warningLight,
    borderRadius: RADIUS.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
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
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: Spacing.md,
  },
  sectionLabel: { fontFamily: SERIF, fontSize: 22, color: Colors.text },
  seeAll: {
    fontSize: Typography.base,
    fontWeight: "700",
    color: Colors.warningText,
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
    backgroundColor: Colors.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    ...CARD_SHADOW,
  },
  skeletonCard: { opacity: 0.6 },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardIconAmber: { backgroundColor: Colors.warningLight },
  cardIconGreen: { backgroundColor: Colors.successLight },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontFamily: SERIF, fontSize: 18, color: Colors.text },
  cardSubtitle: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    marginTop: 2,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  noteAmber: { flex: 1, fontSize: Typography.base, color: Colors.warningText },
  noteGreen: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.availableText,
  },
  payButton: {
    ...shared.successButton,
    minHeight: 48,
    marginTop: Spacing.md,
  },
  payButtonText: { ...shared.successButtonText, fontSize: Typography.md },
  qrRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  viewQr: {
    fontSize: Typography.base,
    fontWeight: "700",
    color: Colors.availableText,
  },
  findButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.text,
    borderRadius: RADIUS.md,
    minHeight: 54,
    marginTop: Spacing.sm,
    ...CARD_SHADOW,
  },
  findButtonText: {
    color: Colors.white,
    fontSize: Typography.md,
    fontWeight: "700",
  },
});
