import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  RefreshControl,
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

// One bookable market (a venue + its Friday–Sunday dates).
type MarketSession = {
  id: string;
  venueId: string;
  venueName: string;
  timezone: string;
  fridayDate: string;
  sundayDate: string;
};

// What the database tells us about a stall that is NOT free. It never says
// WHO holds it — only whether it is reserved/booked and whether it is yours.
type StallAvailability = {
  status: "reserved" | "booked";
  isMine: boolean;
};

type Status = "available" | "reserved" | "booked";

// Same statuses the database function create_booking accepts. If the
// organizer should only sell stalls once a market is "open", remove
// "upcoming" here AND in create_booking.
const BOOKABLE_SESSION_STATUSES = ["upcoming", "open"];

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
    label: "Reserved (pending)",
  },
  booked: { color: Colors.booked, icon: "lock-closed", label: "Booked" },
};

// Short word printed on the tile itself, so the state is readable BEFORE
// the vendor taps anything.
const TILE_WORD: Record<Status, string> = {
  available: "",
  reserved: "Reserved",
  booked: "Booked",
};

// How many stalls sit in a row before a walkway gap — makes the grid read
// as rows of stalls either side of an aisle, rather than a loose grid.
const STALLS_PER_ROW = 4;

const LOAD_ERROR_TEXT = "Couldn't load the floor map. Please try again.";

function two(n: number) {
  return String(n).padStart(2, "0");
}

// Today's date (YYYY-MM-DD) in the venue's own timezone. Falls back to the
// device date if the timezone name is not supported. This only hides markets
// that are clearly over; the database makes the final decision.
function todayIn(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  }
}

function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function sessionLabel(s: MarketSession): string {
  return `${formatShortDate(s.fridayDate)} – ${formatShortDate(s.sundayDate)}`;
}

// Markets a vendor can currently book: right status, not finished, and the
// booking deadline (if the organizer set one) has not passed.
async function fetchBookableSessions(): Promise<MarketSession[]> {
  // One day of slack, so a device with the wrong timezone cannot hide a
  // market that is still running. The exact check happens below.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoffDate = `${cutoff.getFullYear()}-${two(cutoff.getMonth() + 1)}-${two(cutoff.getDate())}`;

  const { data, error } = await supabase
    .from("market_sessions")
    .select(
      "id, venue_id, friday_date, sunday_date, status, booking_deadline, venues(name, timezone)",
    )
    .in("status", BOOKABLE_SESSION_STATUSES)
    .gte("sunday_date", cutoffDate)
    .order("friday_date", { ascending: true })
    .limit(20);
  if (error) throw error;

  const now = Date.now();
  const result: MarketSession[] = [];
  for (const row of (data ?? []) as any[]) {
    const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
    const timezone: string = venue?.timezone ?? "Asia/Manila";
    if (row.sunday_date < todayIn(timezone)) continue;
    if (row.booking_deadline && new Date(row.booking_deadline).getTime() <= now)
      continue;
    result.push({
      id: row.id,
      venueId: row.venue_id,
      venueName: venue?.name ?? "Market",
      timezone,
      fridayDate: row.friday_date,
      sundayDate: row.sunday_date,
    });
  }
  return result;
}

export default function FloorMapScreen() {
  const [sessions, setSessions] = useState<MarketSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [availability, setAvailability] = useState<
    Record<string, StallAvailability>
  >({});
  const [selectedStallId, setSelectedStallId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();

  // Every load gets a number. If a newer load starts (vendor switches market,
  // pulls to refresh, comes back to the screen), the older one is ignored
  // when it finishes, so slow answers can never overwrite fresh ones.
  const requestRef = useRef(0);
  // Remembers the chosen market between reloads (without re-creating callbacks).
  const sessionIdRef = useRef<string | null>(null);

  // Loads the stalls of ONE market's venue plus who holds what. Throws on any
  // error: we would rather show "couldn't load" than a map where every stall
  // wrongly looks free.
  const loadSessionData = useCallback(
    async (session: MarketSession, requestId: number) => {
      const [stallRes, availRes] = await Promise.all([
        supabase
          .from("stalls")
          .select("id, stall_number, size, price_per_day_cents, is_active")
          .eq("venue_id", session.venueId)
          .eq("is_active", true),
        supabase.rpc("stall_availability", { p_session_id: session.id }),
      ]);
      if (stallRes.error) throw stallRes.error;
      if (availRes.error) throw availRes.error;
      if (requestId !== requestRef.current) return;

      const map: Record<string, StallAvailability> = {};
      for (const row of (availRes.data ?? []) as {
        stall_id: string;
        availability: string;
        is_mine: boolean;
      }[]) {
        map[row.stall_id] = {
          // Anything that is not clearly "reserved" is treated as booked.
          status: row.availability === "reserved" ? "reserved" : "booked",
          isMine: row.is_mine === true,
        };
      }

      const sorted = [...((stallRes.data ?? []) as Stall[])].sort((a, b) =>
        a.stall_number.localeCompare(b.stall_number, undefined, {
          numeric: true,
        }),
      );
      setStalls(sorted);
      setAvailability(map);
      setLoadError(null);
    },
    [],
  );

  const showFailure = useCallback((requestId: number) => {
    if (requestId !== requestRef.current) return;
    setStalls([]);
    setAvailability({});
    setLoadError(LOAD_ERROR_TEXT);
  }, []);

  const loadAll = useCallback(async () => {
    const requestId = ++requestRef.current;
    try {
      // Release lapsed holds so they are cleaned up in the database too.
      // (stall_availability already ignores lapsed holds either way.)
      await supabase.rpc("expire_stale_bookings");

      const list = await fetchBookableSessions();
      if (requestId !== requestRef.current) return;
      setSessions(list);

      // Keep the market the vendor was looking at, else the earliest one.
      const chosen =
        list.find((s) => s.id === sessionIdRef.current) ?? list[0] ?? null;
      sessionIdRef.current = chosen?.id ?? null;
      setSessionId(chosen?.id ?? null);

      if (!chosen) {
        setStalls([]);
        setAvailability({});
        setLoadError(null);
        return;
      }
      await loadSessionData(chosen, requestId);
    } catch {
      showFailure(requestId);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [loadSessionData, showFailure]);

  // Reload every time the screen comes into view, so coming back from
  // "Reserve" shows the stall as reserved/yours without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      async function run() {
        await loadAll();
      }
      run();
    }, [loadAll]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }

  async function handleSelectSession(session: MarketSession) {
    if (session.id === sessionId) return;
    const requestId = ++requestRef.current;
    sessionIdRef.current = session.id;
    setSessionId(session.id);
    setSelectedStallId(null);
    setLoading(true);
    try {
      await loadSessionData(session, requestId);
    } catch {
      showFailure(requestId);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  function getStatus(stallId: string): Status {
    return availability[stallId]?.status ?? "available";
  }

  function isMine(stallId: string): boolean {
    return availability[stallId]?.isMine === true;
  }

  // Free stalls can be reserved. Your own stall (in any state) can be opened
  // to see your booking. Everything else is shown but not tappable.
  // This is only a convenience: create_booking in the database is what
  // actually refuses a stall that is taken.
  function isSelectable(stallId: string): boolean {
    return getStatus(stallId) === "available" || isMine(stallId);
  }

  function handleSelectStall(stall: Stall) {
    if (!isSelectable(stall.id)) return;
    setSelectedStallId(stall.id);
  }

  function handleReserve() {
    if (!selectedStall || !sessionId) return;
    // For your own stall this opens stall-detail, which sends you straight
    // to your existing booking instead of creating a second one.
    router.push({
      pathname: "/(vendor)/stall-detail",
      params: { stallId: selectedStall.id, sessionId },
    });
  }

  const activeSession = sessions.find((s) => s.id === sessionId) ?? null;
  const marketName = activeSession?.venueName ?? "Market";
  const selectedStall =
    stalls.find((s) => s.id === selectedStallId && isSelectable(s.id)) ?? null;
  const myStall = stalls.find((s) => isMine(s.id)) ?? null;

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
      <Text style={styles.subtitle}>
        {activeSession
          ? `${sessionLabel(activeSession)} · Tap an available stall to reserve`
          : "Tap an available stall to reserve"}
      </Text>

      {sessions.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {sessions.map((s) => {
            const active = s.id === sessionId;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => handleSelectSession(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${s.venueName}, ${sessionLabel(s)}`}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {s.venueName} · {sessionLabel(s)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {loadError && (
        <View style={styles.errorBanner}>
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={Colors.booked}
          />
          <Text style={styles.errorBannerText}>{loadError}</Text>
          <TouchableOpacity
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel="Try loading the floor map again"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      {myStall && !loadError && (
        <View style={styles.infoBanner}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={Colors.info}
          />
          <Text style={styles.infoBannerText}>
            You already have stall {myStall.stall_number} in this market. Tap it
            to view your booking.
          </Text>
        </View>
      )}

      {loading ? (
        <FloorMapSkeleton />
      ) : loadError ? null : !activeSession ? (
        <View style={styles.emptyState}>
          <Ionicons
            name="calendar-outline"
            size={32}
            color={Colors.textMuted}
          />
          <Text style={styles.emptyTitle}>No market open for booking</Text>
          <Text style={styles.emptyText}>
            Check back when the organizer opens the next market.
          </Text>
        </View>
      ) : stalls.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="grid-outline" size={32} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No stalls available</Text>
          <Text style={styles.emptyText}>Check back closer to market day.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.floorPlan}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {rows.map((row, rowIndex) => (
            <View key={rowIndex}>
              <View style={styles.stallRow}>
                {row.map((item) => {
                  const status = getStatus(item.id);
                  const style = STATUS_STYLE[status];
                  const mine = isMine(item.id);
                  const isSelected = item.id === selectedStall?.id;
                  const selectable = isSelectable(item.id);
                  const word = mine ? "Yours" : TILE_WORD[status];
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
                      accessibilityLabel={`Stall ${item.stall_number}, ${style.label}${mine ? ", yours" : ""}`}
                    >
                      <Ionicons
                        name={style.icon}
                        size={13}
                        color={Colors.white}
                      />
                      <Text style={styles.tileText}>{item.stall_number}</Text>
                      {word !== "" && (
                        <Text style={styles.tileSubText}>{word}</Text>
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
            {isMine(selectedStall.id)
              ? `Your stall: ${selectedStall.stall_number}`
              : `Selected: stall ${selectedStall.stall_number}`}
          </Text>
          <Text style={styles.selectedPrice}>
            ₱{(selectedStall.price_per_day_cents / 100).toFixed(0)}{" "}
            <Text style={styles.selectedPriceUnit}>
              per day{selectedStall.size ? ` · ${selectedStall.size}` : ""}
            </Text>
          </Text>
          <PrimaryButton
            label={
              isMine(selectedStall.id)
                ? "View my booking"
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
  chipScroll: { flexGrow: 0, marginBottom: Spacing.md },
  chipRow: { gap: Spacing.sm },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  chipText: { fontSize: Typography.sm, color: Colors.text },
  chipTextActive: { color: Colors.white, fontWeight: "600" },
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
  retryText: {
    fontSize: Typography.sm,
    color: Colors.dangerText,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.infoLight,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  infoBannerText: { fontSize: Typography.sm, color: Colors.text, flex: 1 },
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
  // Taken stalls are dimmed a little, but still readable (the word on the
  // tile — "Booked" / "Reserved" — must stay legible).
  tileDisabled: { opacity: 0.75 },
  tileText: { color: Colors.white, fontSize: Typography.xs, fontWeight: "600" },
  tileSubText: {
    color: Colors.white,
    fontSize: 9,
    fontWeight: "600",
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
