import { Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  RADIUS,
  resolveStallDisplayStatus,
  shared,
  StallDisplayStatus,
  stallStatusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type Stall = { id: string; stall_number: string; is_active: boolean };
type BookingInfo = {
  id: string;
  status: string;
  vendor_name: string;
  attending_days: string[];
};

// Icon per status, matching the vendor Floor Map — status is never
// conveyed by color alone.
const LEGEND: {
  status: StallDisplayStatus;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { status: "available", label: "Available", icon: "checkmark-circle" },
  { status: "reserved", label: "Reserved (unpaid)", icon: "time" },
  { status: "booked", label: "Booked (paid)", icon: "lock-closed" },
  { status: "inactive", label: "Inactive", icon: "remove-circle" },
];

// How many stalls sit in a row before a walkway gap.
const STALLS_PER_ROW = 6;

export default function OrganizerFloorMapScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();
  const { showToast } = useToast();

  const [stalls, setStalls] = useState<Stall[]>([]);
  const [bookingsByStall, setBookingsByStall] = useState<
    Record<string, BookingInfo>
  >({});
  const [sessionLabel, setSessionLabel] = useState("No upcoming session");
  const [loading, setLoading] = useState(true);
  const [selectedStallId, setSelectedStallId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    const { data: stallRows, error: stallError } = await supabase
      .from("stalls")
      .select("id, stall_number, is_active")
      .eq("venue_id", venue.id)
      .order("stall_number");
    if (stallError) {
      showToast("Couldn't load stalls for this venue.", "error");
    }
    setStalls(stallRows ?? []);

    const { data: sessions, error: sessionError } = await supabase
      .from("market_sessions")
      .select("id, friday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .in("status", ["upcoming", "open"])
      .order("friday_date", { ascending: true })
      .limit(1);
    if (sessionError) {
      showToast("Couldn't load the upcoming session.", "error");
    }

    const session = sessions?.[0];
    if (!session) {
      setSessionLabel("No upcoming session");
      setBookingsByStall({});
      setLoading(false);
      return;
    }
    setSessionLabel(
      `${formatDate(session.friday_date)} – ${formatDate(session.sunday_date)}`,
    );

    const { data: bookingRows, error: bookingError } = await supabase
      .from("bookings")
      .select(
        "id, stall_id, status, attending_days, profiles!bookings_vendor_id_fkey(full_name)",
      )
      .eq("session_id", session.id)
      .in("status", ["pending", "approved", "paid", "checked_in"]);
    if (bookingError) {
      showToast("Couldn't load bookings for this session.", "error");
    }

    const map: Record<string, BookingInfo> = {};
    (bookingRows ?? []).forEach((b: any) => {
      map[b.stall_id] = {
        id: b.id,
        status: b.status,
        vendor_name: b.profiles?.full_name ?? "Unknown vendor",
        attending_days: b.attending_days ?? [],
      };
    });
    setBookingsByStall(map);
    setLoading(false);
  }, [venue, showToast]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  if (venueLoading || loading) {
    return (
      <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
        <FloorMapSkeleton />
      </ScrollView>
    );
  }
  if (venueError) {
    return (
      <View style={shared.centerFill}>
        <Text style={shared.errorText}>{venueError}</Text>
      </View>
    );
  }

  const selected = selectedStallId ? bookingsByStall[selectedStallId] : null;
  const selectedStall = stalls.find((s) => s.id === selectedStallId);

  const rows: Stall[][] = [];
  for (let i = 0; i < stalls.length; i += STALLS_PER_ROW) {
    rows.push(stalls.slice(i, i + STALLS_PER_ROW));
  }

  return (
    <View style={{ flex: 1, flexDirection: isDesktop ? "row" : "column" }}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
        <Text style={shared.title}>Floor Map</Text>
        <Text style={shared.subtitle}>{sessionLabel} · read-only overview</Text>

        {stalls.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="grid-outline" size={28} color={COLORS.slate} />
            <Text style={styles.emptyStateText}>
              No stalls set up for this venue yet.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.legendRow}>
              {LEGEND.map((item) => {
                const { bg, fg } = stallStatusColors(item.status);
                return (
                  <View key={item.status} style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: bg, borderColor: fg },
                      ]}
                    >
                      <Ionicons name={item.icon} size={10} color={fg} />
                    </View>
                    <Text style={styles.legendText}>{item.label}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.floorPlan}>
              {rows.map((row, rowIndex) => (
                <View key={rowIndex}>
                  <View style={styles.stallRow}>
                    {row.map((stall) => {
                      const booking = bookingsByStall[stall.id];
                      const displayStatus = resolveStallDisplayStatus(
                        stall.is_active,
                        booking?.status ?? null,
                      );
                      const legendEntry = LEGEND.find(
                        (l) => l.status === displayStatus,
                      )!;
                      const { bg, fg, text } = stallStatusColors(displayStatus);
                      const isSelected = stall.id === selectedStallId;
                      return (
                        <Pressable
                          key={stall.id}
                          onPress={() => setSelectedStallId(stall.id)}
                          style={[
                            styles.tile,
                            { backgroundColor: bg, borderColor: fg },
                            isSelected && styles.tileSelected,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Stall ${stall.stall_number}, ${legendEntry.label}`}
                        >
                          <Ionicons
                            name={legendEntry.icon}
                            size={13}
                            color={fg}
                          />
                          <Text style={[styles.tileText, { color: text }]}>
                            {stall.stall_number}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {/* Walkway between rows — reads as an aisle rather than a
                      uniform grid of boxes. */}
                  {rowIndex < rows.length - 1 && <View style={styles.aisle} />}
                </View>
              ))}
            </View>
          </>
        )}

        {!isDesktop && selected && selectedStall && (
          <View style={[shared.card, styles.mobileDetailCard]}>
            <Text style={shared.rowTitle}>
              Stall {selectedStall.stall_number}
            </Text>
            <Text style={shared.rowSubtitle}>{selected.vendor_name}</Text>
            <Text style={shared.rowSubtitle}>
              Booking status: {selected.status}
            </Text>
            <Text style={shared.rowSubtitle}>
              Days: {selected.attending_days.join(", ") || "—"}
            </Text>
          </View>
        )}
      </ScrollView>

      {isDesktop && (
        <View style={styles.sidebar}>
          <Text style={[shared.sectionHeading, { marginTop: 0 }]}>Details</Text>
          {selectedStall ? (
            <View>
              <Text style={shared.rowTitle}>
                Stall {selectedStall.stall_number}
              </Text>
              {selected ? (
                <>
                  <Text style={shared.rowSubtitle}>{selected.vendor_name}</Text>
                  <Text style={shared.rowSubtitle}>
                    Booking status: {selected.status}
                  </Text>
                  <Text style={shared.rowSubtitle}>
                    Days: {selected.attending_days.join(", ") || "—"}
                  </Text>
                </>
              ) : (
                <Text style={shared.rowSubtitle}>
                  {selectedStall.is_active
                    ? "No booking this session."
                    : "Stall is deactivated."}
                </Text>
              )}
            </View>
          ) : (
            <Text style={shared.emptyStateText}>
              Tap a stall to see details.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// Placeholder grid shown while the venue/stalls/session fetch is in flight.
function FloorMapSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: 140, height: 22, marginBottom: Spacing.sm },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 200, marginBottom: Spacing.lg }]}
      />
      {[0, 1].map((rowIndex) => (
        <View key={rowIndex} style={styles.stallRow}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={[styles.tile, styles.skeletonTile]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  legendDot: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  legendText: { fontSize: Typography.sm, color: COLORS.slate },
  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: Spacing.xl,
    alignItems: "center",
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  emptyStateText: { color: COLORS.slate, fontSize: Typography.md },
  floorPlan: { gap: 0 },
  stallRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  aisle: { height: Spacing.lg },
  tile: {
    width: 84,
    height: 64,
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    gap: 2,
    ...Shadow.sm,
  },
  tileSelected: { borderWidth: 3, borderColor: COLORS.inkNavy },
  tileText: { fontWeight: "700", fontSize: Typography.sm },
  skeletonTile: { backgroundColor: COLORS.border, shadowOpacity: 0 },
  skeletonLine: {
    height: 12,
    borderRadius: Radius.xs,
    backgroundColor: COLORS.border,
  },
  mobileDetailCard: { marginTop: Spacing.xl },
  sidebar: {
    width: 280,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    padding: Spacing.xl,
    backgroundColor: COLORS.white,
  },
});
