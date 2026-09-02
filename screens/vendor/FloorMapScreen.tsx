import { Colors, Radius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Stall = {
  id: string;
  stall_number: string;
  size: string | null;
  price_per_day_cents: number;
  is_active: boolean;
};

type StallBookingInfo = {
  status: "reserved" | "booked";
  vendorId: string;
};

const STATUS_COLOR: Record<string, string> = {
  available: Colors.available,
  reserved: Colors.reserved,
  booked: Colors.booked,
};

export default function FloorMapScreen() {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [stallBookings, setStallBookings] = useState<
    Record<string, StallBookingInfo>
  >({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedStallId, setSelectedStallId] = useState<string | null>(null);

  const insets = useSafeAreaInsets();

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      setCurrentUserId(userData.user?.id ?? null);

      // Free up any pending holds that have expired, so the map reflects
      // current availability rather than stale abandoned reservations.
      await supabase.rpc("expire_stale_bookings");

      const { data: session } = await supabase
        .from("market_sessions")
        .select("id")
        .eq("status", "open")
        .order("friday_date", { ascending: true })
        .limit(1)
        .single();
      if (session) setSessionId(session.id);

      const { data: stallData } = await supabase
        .from("stalls")
        .select("id, stall_number, size, price_per_day_cents, is_active")
        .eq("is_active", true)
        .order("stall_number", { ascending: true });
      if (stallData) setStalls(stallData);

      if (session) {
        const { data: bookingData } = await supabase
          .from("bookings")
          .select("stall_id, status, vendor_id")
          .eq("session_id", session.id)
          .in("status", ["pending", "approved", "paid", "checked_in"]);

        if (bookingData) {
          const map: Record<string, StallBookingInfo> = {};
          bookingData.forEach((b: any) => {
            map[b.stall_id] = {
              status: b.status === "pending" ? "reserved" : "booked",
              vendorId: b.vendor_id,
            };
          });
          setStallBookings(map);
        }
      }
    }
    load();
  }, []);

  function getStatus(stallId: string): "available" | "reserved" | "booked" {
    const info = stallBookings[stallId];
    if (!info) return "available";
    return info.status;
  }

  function isMine(stallId: string): boolean {
    const info = stallBookings[stallId];
    return !!info && !!currentUserId && info.vendorId === currentUserId;
  }

  function isSelectable(stallId: string): boolean {
    const status = getStatus(stallId);
    if (status === "available") return true;
    if (status === "reserved" && isMine(stallId)) return true;
    return false;
  }

  function handleSelectStall(stall: Stall) {
    if (!isSelectable(stall.id)) return;
    setSelectedStallId(stall.id);
  }

  function handleReserve() {
    if (!selectedStallId || !sessionId) return;
    router.push({
      pathname: "/(vendor)/stall-detail",
      params: { stallId: selectedStallId, sessionId },
    });
  }

  const selectedStall = stalls.find((s) => s.id === selectedStallId);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
      <Text style={styles.title}>Poblacion night market</Text>
      <Text style={styles.subtitle}>Tap a stall to reserve</Text>

      <FlatList
        data={stalls}
        keyExtractor={(item) => item.id}
        numColumns={4}
        renderItem={({ item }) => {
          const status = getStatus(item.id);
          const isSelected = item.id === selectedStallId;
          const selectable = isSelectable(item.id);
          return (
            <TouchableOpacity
              style={[
                styles.tile,
                { backgroundColor: STATUS_COLOR[status] },
                isSelected && styles.tileSelected,
                !selectable && styles.tileDisabled,
              ]}
              onPress={() => handleSelectStall(item)}
              disabled={!selectable}
            >
              <Text style={styles.tileText}>{item.stall_number}</Text>
              {status === "reserved" && isMine(item.id) && (
                <Text style={styles.tileSubText}>Yours</Text>
              )}
            </TouchableOpacity>
          );
        }}
      />

      <View style={styles.legendRow}>
        {(["available", "reserved", "booked"] as const).map((s) => (
          <View key={s} style={styles.legendItem}>
            <View
              style={[styles.legendDot, { backgroundColor: STATUS_COLOR[s] }]}
            />
            <Text style={styles.legendText}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </View>
        ))}
      </View>

      {selectedStall && (
        <View style={styles.selectedBar}>
          <Text style={styles.selectedLabel}>
            Selected: stall {selectedStall.stall_number}
          </Text>
          <Text style={styles.selectedPrice}>
            ₱{(selectedStall.price_per_day_cents / 100).toFixed(0)}{" "}
            <Text style={styles.selectedPriceUnit}>
              / {selectedStall.size ?? "stall"}
            </Text>
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleReserve}>
            <Text style={styles.buttonText}>
              {isMine(selectedStall.id)
                ? "Resume this reservation"
                : "Reserve this stall"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 16,
    paddingTop: 20,
  },
  title: { fontSize: 16, fontWeight: "500" },
  subtitle: { fontSize: 12, color: Colors.textMuted, marginBottom: 14 },
  tile: {
    flex: 1,
    aspectRatio: 1,
    margin: 4,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tileSelected: { borderWidth: 3, borderColor: Colors.text },
  tileDisabled: { opacity: 0.55 },
  tileText: { color: Colors.white, fontSize: 11, fontWeight: "600" },
  tileSubText: {
    color: Colors.white,
    fontSize: 8,
    marginTop: 2,
    fontWeight: "500",
  },
  legendRow: { flexDirection: "row", gap: 14, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { fontSize: 11, color: Colors.textMuted },
  selectedBar: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 12,
    marginTop: 12,
  },
  selectedLabel: { fontSize: 12, color: Colors.textMuted },
  selectedPrice: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 2,
    marginBottom: 8,
  },
  selectedPriceUnit: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "400",
  },
  button: {
    backgroundColor: Colors.text,
    borderRadius: Radius.sm,
    padding: 14,
    alignItems: "center",
  },
  buttonText: { color: Colors.white, fontSize: 14, fontWeight: "600" },
});
