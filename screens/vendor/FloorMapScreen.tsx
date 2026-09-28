import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ScrollView,
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

type Status = "available" | "reserved" | "booked";

// Color + icon per status, so status is never conveyed by color alone —
// a small glyph on the tile carries the same meaning for colorblind users.
const STATUS_STYLE: Record<
  Status,
  { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  available: {
    color: Colors.available,
    icon: "checkmark-circle",
    label: "Available",
  },
  reserved: {
    color: Colors.reserved,
    icon: "time",
    label: "Reserved (unpaid)",
  },
  booked: { color: Colors.booked, icon: "lock-closed", label: "Booked" },
};

// How many stalls sit in a row before a walkway gap — makes the grid read
// as rows of stalls either side of an aisle, rather than a loose grid.
const STALLS_PER_ROW = 4;

export default function FloorMapScreen() {
  const [marketName, setMarketName] = useState("Market");
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [stallBookings, setStallBookings] = useState<
    Record<string, StallBookingInfo>
  >({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedStallId, setSelectedStallId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: userData } = await supabase.auth.getUser();
        setCurrentUserId(userData.user?.id ?? null);

        // Free up any pending holds that have expired, so the map reflects
        // current availability rather than stale abandoned reservations.
        await supabase.rpc("expire_stale_bookings");

        const { data: session, error: sessionError } = await supabase
          .from("market_sessions")
          .select("id, venues(name)")
          .eq("status", "open")
          .order("friday_date", { ascending: true })
          .limit(1)
          .single();

        if (sessionError && sessionError.code !== "PGRST116") {
          // PGRST116 = no rows found, which is a valid "no open session"
          // state, not a failure — anything else is a real fetch error.
          throw sessionError;
        }
        if (session) {
          setSessionId(session.id);
          const venueName = (session as any).venues?.name;
          if (venueName) setMarketName(venueName);
        }

        const { data: stallData, error: stallError } = await supabase
          .from("stalls")
          .select("id, stall_number, size, price_per_day_cents, is_active")
          .eq("is_active", true)
          .order("stall_number", { ascending: true });
        if (stallError) throw stallError;
        if (stallData) setStalls(stallData);

        if (session) {
          const { data: bookingData, error: bookingError } = await supabase
            .from("bookings")
            .select("stall_id, status, vendor_id")
            .eq("session_id", session.id)
            .in("status", ["pending", "approved", "paid", "checked_in"]);
          if (bookingError) throw bookingError;

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
      } catch {
        setLoadError(
          "Couldn't load the floor map. Pull to refresh or try again.",
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function getStatus(stallId: string): Status {
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

  // Chunk the stalls into rows so we can drop a walkway gap between pairs
  // of rows, echoing an actual market aisle layout instead of one flat grid.
  const rows: Stall[][] = [];
  for (let i = 0; i < stalls.length; i += STALLS_PER_ROW) {
    rows.push(stalls.slice(i, i + STALLS_PER_ROW));
  }

  return (
    <View
      style={[styles.container, { paddingBottom: insets.bottom + Spacing.md }]}
    >
      <Text style={styles.title}>{marketName}</Text>
      <Text style={styles.subtitle}>Tap a stall to reserve</Text>

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
        <FloorMapSkeleton />
      ) : stalls.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="grid-outline" size={32} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No stalls available</Text>
          <Text style={styles.emptyText}>Check back closer to market day.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.floorPlan}>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex}>
              <View style={styles.stallRow}>
                {row.map((item) => {
                  const status = getStatus(item.id);
                  const style = STATUS_STYLE[status];
                  const isSelected = item.id === selectedStallId;
                  const selectable = isSelectable(item.id);
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.tile,
                        { backgroundColor: style.color },
                        isSelected && styles.tileSelected,
                        !selectable && styles.tileDisabled,
                      ]}
                      activeOpacity={0.75}
                      onPress={() => handleSelectStall(item)}
                      disabled={!selectable}
                      accessibilityRole="button"
                      accessibilityLabel={`Stall ${item.stall_number}, ${style.label}${isMine(item.id) ? ", yours" : ""}`}
                    >
                      <Ionicons
                        name={style.icon}
                        size={13}
                        color={Colors.white}
                      />
                      <Text style={styles.tileText}>{item.stall_number}</Text>
                      {status === "reserved" && isMine(item.id) && (
                        <Text style={styles.tileSubText}>Yours</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* Walkway between rows — gives the layout an actual aisle,
                  instead of a uniform grid of boxes. */}
              {rowIndex < rows.length - 1 && <View style={styles.aisle} />}
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.legendRow}>
        {(Object.keys(STATUS_STYLE) as Status[]).map((s) => {
          const style = STATUS_STYLE[s];
          return (
            <View key={s} style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: style.color }]}
              >
                <Ionicons name={style.icon} size={9} color={Colors.white} />
              </View>
              <Text style={styles.legendText}>{style.label}</Text>
            </View>
          );
        })}
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
          <PrimaryButton
            label={
              isMine(selectedStall.id)
                ? "Resume this reservation"
                : "Reserve this stall"
            }
            onPress={handleReserve}
          />
        </View>
      )}
    </View>
  );
}

// Placeholder grid shown while the initial fetch is in flight.
function FloorMapSkeleton() {
  return (
    <View style={styles.floorPlan}>
      {[0, 1, 2].map((rowIndex) => (
        <View key={rowIndex} style={styles.stallRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.tile, styles.skeletonTile]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  title: { fontSize: Typography.lg, fontWeight: "600", color: Colors.text },
  subtitle: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
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
  floorPlan: { paddingBottom: Spacing.md },
  stallRow: { flexDirection: "row", gap: Spacing.sm },
  aisle: { height: Spacing.lg },
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    ...Shadow.sm,
  },
  tileSelected: { borderWidth: 3, borderColor: Colors.text },
  tileDisabled: { opacity: 0.55 },
  tileText: { color: Colors.white, fontSize: Typography.xs, fontWeight: "600" },
  tileSubText: {
    color: Colors.white,
    fontSize: 8,
    fontWeight: "500",
  },
  skeletonTile: { backgroundColor: Colors.borderLight, shadowOpacity: 0 },
  emptyState: {
    alignItems: "center",
    paddingVertical: Spacing.xxxl,
    gap: Spacing.xs,
  },
  emptyTitle: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: Colors.text,
  },
  emptyText: { fontSize: Typography.base, color: Colors.textMuted },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  legendDot: {
    width: 16,
    height: 16,
    borderRadius: Radius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  legendText: { fontSize: Typography.xs, color: Colors.textMuted },
  selectedBar: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: Spacing.md,
    marginTop: Spacing.md,
  },
  selectedLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  selectedPrice: {
    fontSize: Typography.lg,
    fontWeight: "600",
    color: Colors.text,
    marginTop: 2,
    marginBottom: Spacing.sm,
  },
  selectedPriceUnit: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    fontWeight: "400",
  },
});
