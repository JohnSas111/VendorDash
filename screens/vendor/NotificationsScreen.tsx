import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notifications</Text>

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

      {loading ? (
        <NotificationsSkeleton />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons
                name="notifications-outline"
                size={28}
                color={Colors.textMuted}
              />
              <Text style={styles.emptyText}>No notifications yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.card, !item.is_read && styles.cardUnread]}
              activeOpacity={0.7}
              onPress={() => !item.is_read && markAsRead(item.id)}
            >
              <Ionicons
                name={iconFor(item.type)}
                size={18}
                color={item.is_read ? Colors.textMuted : Colors.info}
                style={styles.cardIcon}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
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
    fontSize: Typography.lg,
    fontWeight: "700",
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
  emptyState: {
    alignItems: "center",
    marginTop: Spacing.xxxl + Spacing.lg,
    gap: Spacing.xs,
  },
  emptyText: { fontSize: Typography.base, color: Colors.textMuted },
  card: {
    flexDirection: "row",
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  cardIcon: { marginTop: 2 },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: Colors.info },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitle: {
    fontSize: Typography.base,
    fontWeight: "600",
    color: Colors.text,
    flex: 1,
  },
  cardBody: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  cardTime: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.xs,
    backgroundColor: Colors.info,
    marginLeft: Spacing.sm,
  },
  skeletonCard: { opacity: 0.6 },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
});
