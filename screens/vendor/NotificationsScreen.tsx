import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Colors, Radius } from '@/constants/theme';

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  type: string | null;
  is_read: boolean;
  created_at: string;
};

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      router.replace('/(auth)/login');
      return;
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, body, type, is_read, created_at')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) setNotifications(data);
  }, []);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  async function markAsRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  }

  function timeAgo(dateStr: string) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notifications</Text>

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          !loading ? <Text style={styles.emptyText}>No notifications yet.</Text> : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.is_read && styles.cardUnread]}
            onPress={() => !item.is_read && markAsRead(item.id)}
          >
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {!item.is_read && <View style={styles.dot} />}
            </View>
            <Text style={styles.cardBody}>{item.body}</Text>
            <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: 20, paddingTop: 20 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, marginBottom: 8 },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: Colors.info },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 13, fontWeight: '600', flex: 1 },
  cardBody: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  cardTime: { fontSize: 10, color: Colors.textMuted, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.info, marginLeft: 8 },
});
