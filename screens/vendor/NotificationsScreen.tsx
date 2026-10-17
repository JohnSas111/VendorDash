import { Pagination } from "@/components/organizer/Pagination";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { usePaging } from "@/hooks/usePaging";
import { CARD_SHADOW, COLORS, RADIUS, SERIF } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  type: string | null;
  is_read: boolean;
  created_at: string;
};

// Icon per known notification type — a generic bell for anything else.
const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  booking_approved: "checkmark-circle",
  booking_submitted: "time-outline",
  payment_confirmed: "card",
};

function iconFor(type: string | null) {
  return (type && TYPE_ICON[type]) || "notifications-outline";
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
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
      .from("notifications")
      .select("id, title, body, type, is_read, created_at")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false });

    // Previously `if (!error && data)` — a failed fetch left the list
    // empty/stale with no feedback. Now it shows an inline error banner.
    if (error) {
      setLoadError("Couldn't load notifications. Pull down to try again.");
      return;
    }
    if (data) setNotifications(data);
  }, []);

  useEffect(() => {
    // Wrapped in a local async function rather than calling loadData()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await loadData();
      setLoading(false);
    }
    run();
  }, [loadData]);

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    // Refresh the "now" snapshot too, so relative timestamps ("2h ago")
    // don't stay frozen at whenever the screen first loaded.
    setNow(Date.now());
    setRefreshing(false);
  }

  async function markAsRead(id: string) {
    // Optimistic update, reverted if the write fails — previously this
    // fired the update and never checked whether it worked.
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);

    if (error) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: false } : n)),
      );
      showToast("Couldn't mark that as read.", "error");
    }
  }

  function timeAgo(dateStr: string) {
    // Uses the `now` captured once at mount/refresh (see useState above)
    // rather than calling Date.now() here — this function runs during
    // render (inside renderItem), and Date.now() is an impure call the
    // project's lint rules flag when reachable from render.
    const diffMs = now - new Date(dateStr).getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // 10 notifications per page (same helpers as the organizer lists).
  const paging = usePaging(notifications, "notifications");
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notifications</Text>
      {!loading && notifications.length > 0 && (
        <Text style={styles.subtitle}>
          {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
        </Text>
      )}

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
        <NotificationsSkeleton />
      ) : (
        <FlatList
          data={paging.pageItems}
          contentContainerStyle={{ paddingTop: Spacing.lg }}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListFooterComponent={
            <Pagination
              page={paging.page}
              total={paging.total}
              noun="notifications"
              onPage={paging.setPage}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name="notifications-outline"
                  size={28}
                  color={Colors.warningText}
                />
              </View>
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptyText}>
                Updates about your bookings will show up here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => !item.is_read && markAsRead(item.id)}
            >
              <View
                style={[
                  styles.iconTile,
                  !item.is_read && styles.iconTileUnread,
                ]}
              >
                <Ionicons
                  name={iconFor(item.type)}
                  size={20}
                  color={item.is_read ? Colors.textMuted : Colors.warningText}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.cardRow}>
                  <Text
                    style={[
                      styles.cardTitle,
                      item.is_read && styles.cardTitleRead,
                    ]}
                  >
                    {item.title}
                  </Text>
                  {!item.is_read && <View style={styles.dot} />}
                </View>
                <Text style={styles.cardBody}>{item.body}</Text>
                <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

// Placeholder cards shown while notifications are loading.
function NotificationsSkeleton() {
  return (
    <View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.card, styles.skeletonCard]}>
          <View style={[styles.skeletonLine, { width: "40%" }]} />
          <View
            style={[
              styles.skeletonLine,
              { width: "70%", marginTop: Spacing.sm },
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
    paddingTop: Spacing.xl,
  },
  title: {
    fontFamily: SERIF,
    fontSize: 30,
    fontWeight: "400",
    color: Colors.text,
  },
  subtitle: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    marginTop: 2,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.dangerLight,
    borderRadius: RADIUS.sm,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  errorBannerText: {
    fontSize: Typography.sm,
    color: Colors.dangerText,
    flex: 1,
  },
  emptyState: {
    alignItems: "center",
    marginTop: Spacing.xxxl + Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.warningLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  emptyTitle: { fontFamily: SERIF, fontSize: 20, color: Colors.text },
  emptyText: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    ...CARD_SHADOW,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  iconTileUnread: { backgroundColor: Colors.warningLight },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitle: {
    fontSize: Typography.md,
    fontWeight: "700",
    color: Colors.text,
    flex: 1,
  },
  cardTitleRead: { fontWeight: "600" },
  cardBody: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  cardTime: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.reserved,
    marginLeft: Spacing.sm,
    marginTop: 4,
  },
  skeletonCard: { opacity: 0.6 },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
});
