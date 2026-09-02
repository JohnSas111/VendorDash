import { StatusBadge } from "@/components/StatusBadge";
import { Colors, Radius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
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
  market_sessions: { friday_date: string; sunday_date: string } | null;
};

export default function VendorHomeScreen() {
  const [businessName, setBusinessName] = useState("");
  const [profileComplete, setProfileComplete] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const insets = useSafeAreaInsets();

  const loadData = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      router.replace("/(auth)/login");
      return;
    }

    const [{ data: profile }, { data: vendorDetails }, { count }] =
      await Promise.all([
        supabase.from("profiles").select("phone").eq("id", userId).single(),
        supabase
          .from("vendor_details")
          .select("business_name, category")
          .eq("id", userId)
          .single(),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", userId)
          .eq("is_read", false),
      ]);

    if (vendorDetails) setBusinessName(vendorDetails.business_name);
    setProfileComplete(Boolean(profile?.phone && vendorDetails?.category));
    setUnreadCount(count ?? 0);

    const { data: bookingData, error } = await supabase
      .from("bookings")
      .select(
        "id, status, attending_days, stalls(stall_number), market_sessions(friday_date, sunday_date)",
      )
      .eq("vendor_id", userId)
      .order("requested_at", { ascending: false });

    if (!error && bookingData)
      setBookings(bookingData as unknown as BookingRow[]);
  }, []);

  // Re-fetch every time this screen becomes focused — e.g. navigating back
  // from Payment after a successful booking — not just on first mount.
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

  function formatDateRange(friday: string, sunday: string) {
    const f = new Date(friday);
    const s = new Date(sunday);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${f.toLocaleDateString("en-US", opts)}–${s.getDate()}`;
  }

  function handleBrowsePress() {
    if (!profileComplete) {
      router.push("/(vendor)/complete-profile");
      return;
    }
    router.push("/(vendor)/floor-map");
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Good evening</Text>
          <Text style={styles.name}>{businessName || "Vendor"}</Text>
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => router.push("/(vendor)/notifications")}
          >
            <Text style={styles.icon}>🔔</Text>
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

      {!loading && !profileComplete && (
        <TouchableOpacity
          style={styles.banner}
          onPress={() => router.push("/(vendor)/complete-profile")}
        >
          <Text style={styles.bannerTitle}>
            Complete your profile to browse stalls
          </Text>
          <Text style={styles.bannerAction}>Finish setup →</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionLabel}>Your bookings</Text>

      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No bookings yet</Text>
              <Text style={styles.emptyText}>
                {profileComplete
                  ? "Reserve a stall for this weekend's market"
                  : "Complete your profile first, then reserve a stall"}
              </Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={handleBrowsePress}
              >
                <Text style={styles.emptyButtonText}>
                  {profileComplete ? "Book a stall" : "Complete profile"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const dateLabel = item.market_sessions
            ? formatDateRange(
                item.market_sessions.friday_date,
                item.market_sessions.sunday_date,
              )
            : "Date unavailable";

          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: "/(vendor)/booking-detail",
                  params: { bookingId: item.id },
                })
              }
            >
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>Poblacion night market</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.cardSubtitle}>
                {dateLabel} · Stall {item.stalls?.stall_number ?? "—"} · tap for
                details
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity style={styles.button} onPress={handleBrowsePress}>
        <Text style={styles.buttonText}>Browse markets</Text>
      </TouchableOpacity>
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  greeting: { fontSize: 11, color: Colors.textMuted },
  name: { fontSize: 15, fontWeight: "500" },
  headerIcons: { flexDirection: "row", gap: 14 },
  iconButton: { position: "relative" },
  icon: { fontSize: 20, color: Colors.textMuted },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    backgroundColor: Colors.booked,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: Colors.white, fontSize: 9, fontWeight: "700" },
  banner: {
    backgroundColor: Colors.infoLight,
    borderRadius: Radius.sm,
    padding: 12,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bannerTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.info,
    flex: 1,
    marginRight: 8,
  },
  bannerAction: { fontSize: 12, fontWeight: "600", color: Colors.info },
  sectionLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 8 },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyTitle: { fontSize: 15, fontWeight: "600", marginBottom: 4 },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: Colors.text,
    borderRadius: Radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  emptyButtonText: { color: Colors.white, fontSize: 14, fontWeight: "600" },
  card: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 10,
    backgroundColor: Colors.white,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitle: { fontSize: 13, fontWeight: "500" },
  cardSubtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  button: {
    backgroundColor: Colors.text,
    borderRadius: Radius.sm,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  buttonText: { color: Colors.white, fontSize: 14, fontWeight: "600" },
});
