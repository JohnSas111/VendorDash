import { BookingDetailsPanel } from "@/components/organizer/BookingDetailsPanel";
import { Pagination } from "@/components/organizer/Pagination";
import { PressableButton } from "@/components/PressableButton";
import { Spacing } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import { usePaging } from "@/hooks/usePaging";
import {
  BOOKING_DETAIL_SELECT,
  type BookingDetail,
  daysShort,
  filterPaymentRows,
  formatDateTime,
  PAYMENT_FILTERS,
  PAYMENT_KIND_LABEL,
  type PaymentFilter,
  type PaymentKind,
  paymentRows,
  paymentTotals,
  toBookingDetail,
} from "@/lib/bookingDetails";
import {
  BREAKPOINT,
  CARD_SHADOW,
  COLORS,
  formatMoney,
  RADIUS,
  SERIF,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { ownerPrefix } from "@/lib/uxHelpers";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

// Colours of the little status badge on each payment row.
// Below this much room the list switches from a table to stacked cards.
const TABLE_MIN_WIDTH = 600;

const KIND_STATUS: Record<PaymentKind, string> = {
  paid: "paid",
  waiting: "pending",
  processing: "processing",
  failed: "failed",
  refunded: "cancelled",
};

export default function PaymentsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();
  const { showToast } = useToast();
  const router = useRouter();

  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [search, setSearch] = useState("");
  const [bookings, setBookings] = useState<BookingDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select(BOOKING_DETAIL_SELECT)
      .eq("stalls.venue_id", venue.id)
      .order("requested_at", { ascending: false })
      .limit(500);
    if (error) showToast("Couldn't load payments.", "error");
    setLoadError(!!error);
    setBookings(error ? [] : (data ?? []).map(toBookingDetail));
    setLoading(false);
  }, [venue, showToast]);

  useEffect(() => {
    // Wrapped in a local async function (react-hooks/set-state-in-effect).
    async function run() {
      await load();
    }
    run();
  }, [load]);

  const rows = useMemo(() => paymentRows(bookings), [bookings]);
  const totals = useMemo(() => paymentTotals(rows), [rows]);
  const shown = useMemo(
    () => filterPaymentRows(rows, filter, search),
    [rows, filter, search],
  );
  const paging = usePaging(shown, `${filter}|${search}`);
  const selected = bookings.find((b) => b.id === selectedId) ?? null;
  const goTo = (href: string) => router.push(href as any);
  // Room left for the list: the window minus the menu (248), the page padding
  // (80) and, while a row is open, the details panel (360).
  const listRoom = Math.min(width - 248 - (selected ? 360 : 0), 1080) - 80;
  const asTable = isDesktop && listRoom >= TABLE_MIN_WIDTH;
  // With the details panel open there is no room for "Paid with" (the panel shows it).
  const showWith = listRoom >= 760;

  if (venueLoading) {
    return (
      <View style={shared.centerFill}>
        <Text style={shared.subtitle}>Loading…</Text>
      </View>
    );
  }
  if (venueError) {
    return (
      <View style={shared.centerFill}>
        <Text style={shared.errorText}>{venueError}</Text>
      </View>
    );
  }

  const tiles = [
    {
      label: "Collected",
      tone: "green" as const,
      value: formatMoney(totals.collectedCents),
      note: `from ${totals.collectedCount} paid booking${totals.collectedCount === 1 ? "" : "s"}`,
    },
    {
      label: "Waiting for payment",
      tone: "amber" as const,
      value: formatMoney(totals.waitingCents),
      note: `${totals.waitingCount} approved booking${totals.waitingCount === 1 ? "" : "s"}`,
    },
    {
      label: "Refunded",
      tone: "white" as const,
      value: formatMoney(totals.refundedCents),
      note: `${totals.refundedCount} booking${totals.refundedCount === 1 ? "" : "s"}`,
    },
    {
      label: "Failed payments",
      tone: "white" as const,
      value: String(totals.failedCount),
      note: "vendor can try again",
    },
  ];

  return (
    <View style={{ flex: 1, flexDirection: isDesktop ? "row" : "column" }}>
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && styles.contentDesktop,
        ]}
      >
        <Text style={shared.title}>Payments</Text>
        <Text style={shared.subtitle}>
          Who paid, how much, and how. Tap a row for the full details.
        </Text>

        <View style={styles.tiles}>
          {tiles.map((t) => (
            <View key={t.label} style={[styles.tile, TILE_TONE[t.tone]]}>
              <Text
                style={[
                  styles.tileLabel,
                  t.tone === "white" && styles.tileMuted,
                ]}
              >
                {t.label}
              </Text>
              <Text style={styles.tileValue}>{t.value}</Text>
              <Text
                style={[
                  styles.tileNote,
                  t.tone === "white" && styles.tileMuted,
                ]}
              >
                {t.note}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.filterRow}>
          {PAYMENT_FILTERS.map((f) => (
            <PressableButton
              key={f}
              onPress={() => setFilter(f)}
              style={[shared.chip, filter === f && shared.chipActive]}
            >
              <Text
                style={[shared.chipText, filter === f && shared.chipTextActive]}
              >
                {f === "all" ? "All" : PAYMENT_KIND_LABEL[f]}
              </Text>
            </PressableButton>
          ))}
          <View style={styles.searchWrap}>
            <Ionicons
              name="search"
              size={16}
              color={COLORS.slate}
              style={styles.searchIcon}
            />
            <TextInput
              accessibilityLabel="Search vendor or stall"
              style={styles.searchInput}
              placeholder="Search business or vendor name"
              placeholderTextColor={COLORS.slate}
              value={search}
              onChangeText={setSearch}
            />
          </View>
        </View>

        {loading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[shared.row, styles.skeletonRow]} />
            ))}
          </View>
        ) : loadError ? (
          // A failed load is not the same as "no payments": say so.
          <View style={shared.emptyState}>
            <Ionicons
              name="cloud-offline-outline"
              size={26}
              color={COLORS.slate}
            />
            <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
              Couldn&apos;t load payments. Check your connection and refresh the
              page.
            </Text>
          </View>
        ) : shown.length === 0 ? (
          <View style={shared.emptyState}>
            <Ionicons name="card-outline" size={26} color={COLORS.slate} />
            <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
              {rows.length === 0
                ? "No payments yet. They appear here once a booking is approved."
                : "No payments match this filter."}
            </Text>
          </View>
        ) : (
          <View style={asTable ? styles.table : styles.list}>
            {asTable && (
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, styles.cBusiness]}>BUSINESS</Text>
                <Text style={[styles.th, styles.cStall]}>STALL AND DAYS</Text>
                <Text style={[styles.th, styles.cStatus]}>STATUS</Text>
                {showWith && (
                  <Text style={[styles.th, styles.cWith]}>PAID WITH</Text>
                )}
                <Text style={[styles.th, styles.cAmount]}>AMOUNT</Text>
                <Text style={[styles.th, styles.cOn]}>PAID ON</Text>
                <View style={styles.cArrow} />
              </View>
            )}
            {paging.pageItems.map(({ detail, summary }) => {
              const { bg, fg } = statusColors(KIND_STATUS[summary.kind]);
              const active = detail.id === selectedId;
              const zone = detail.timezone ?? undefined;
              const paidWith = summary.paidAt ? summary.method : "Not paid yet";
              const paidOn = summary.paidAt
                ? formatDateTime(summary.paidAt, zone)
                : summary.kind === "waiting" && detail.payment_due_at
                  ? `Due ${formatDateTime(detail.payment_due_at, zone)}`
                  : "—";
              const badge = (
                <View style={[shared.badge, { backgroundColor: bg }]}>
                  <Text style={[shared.badgeText, { color: fg }]}>
                    {PAYMENT_KIND_LABEL[summary.kind]}
                  </Text>
                </View>
              );
              return (
                <Pressable
                  key={detail.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${detail.vendor_name}, ${PAYMENT_KIND_LABEL[summary.kind]}, ${formatMoney(summary.amountCents)}. Show details`}
                  onPress={() => setSelectedId(active ? null : detail.id)}
                  style={
                    asTable
                      ? [styles.tr, styles.trBody, active && styles.trActive]
                      : [shared.row, active && styles.rowActive]
                  }
                >
                  {asTable ? (
                    <>
                      <View style={styles.cBusiness}>
                        <Text style={styles.cellStrong} numberOfLines={1}>
                          {detail.vendor_name}
                        </Text>
                        {ownerPrefix(detail.vendor_name, detail.owner_name) !==
                          "" && (
                          <Text style={styles.cellSub} numberOfLines={1}>
                            {detail.owner_name}
                          </Text>
                        )}
                      </View>
                      <Text style={[styles.cell, styles.cStall]}>
                        {detail.stall_number} ·{" "}
                        {daysShort(detail.attending_days)}
                      </Text>
                      <View style={styles.cStatus}>{badge}</View>
                      {showWith && (
                        <Text
                          style={[
                            styles.cell,
                            styles.cWith,
                            !summary.paidAt && styles.cellMuted,
                          ]}
                        >
                          {paidWith}
                        </Text>
                      )}
                      <Text style={[styles.cellStrong, styles.cAmount]}>
                        {formatMoney(summary.amountCents)}
                      </Text>
                      <Text style={[styles.cell, styles.cellMuted, styles.cOn]}>
                        {paidOn}
                      </Text>
                      <View style={styles.cArrow}>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={COLORS.slate}
                        />
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.cardTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={shared.rowTitle}>
                            {detail.vendor_name}
                          </Text>
                          <Text style={shared.rowSubtitle}>
                            {ownerPrefix(detail.vendor_name, detail.owner_name)}
                            Stall {detail.stall_number} ·{" "}
                            {daysShort(detail.attending_days)}
                          </Text>
                        </View>
                        <Text style={styles.amount}>
                          {formatMoney(summary.amountCents)}
                        </Text>
                      </View>
                      <View style={styles.cardBottom}>
                        {badge}
                        <Text style={styles.cellSub}>
                          {summary.paidAt
                            ? `${paidWith} · ${paidOn}`
                            : paidOn !== "—"
                              ? paidOn
                              : paidWith}
                        </Text>
                      </View>
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        <Pagination
          page={paging.page}
          total={paging.total}
          noun="payments"
          onPage={paging.setPage}
        />

        {!isDesktop && selected && (
          <View style={[shared.card, styles.mobileDetailCard]}>
            <BookingDetailsPanel
              detail={selected}
              onNavigate={goTo}
              onClose={() => setSelectedId(null)}
            />
          </View>
        )}
      </ScrollView>

      {isDesktop && selected && (
        <ScrollView style={styles.sidebar}>
          <Text style={[shared.sectionHeading, { marginTop: 0 }]}>Details</Text>
          <BookingDetailsPanel
            detail={selected}
            onNavigate={goTo}
            onClose={() => setSelectedId(null)}
          />
        </ScrollView>
      )}
    </View>
  );
}

const TILE_TONE = {
  green: { backgroundColor: COLORS.teal },
  amber: { backgroundColor: COLORS.amber },
  white: {
    backgroundColor: COLORS.white,
    ...CARD_SHADOW,
  },
} as const;

const styles = StyleSheet.create({
  contentDesktop: {
    padding: 40,
    maxWidth: 1080,
    alignSelf: "center",
    width: "100%",
  },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    borderRadius: 20,
    padding: 18,
    gap: 6,
  },
  // Ink text on the green and amber tiles (white on green is too faint).
  tileLabel: { fontSize: 13, fontWeight: "600", color: COLORS.inkNavy },
  tileValue: {
    fontFamily: SERIF,
    fontSize: 30,
    lineHeight: 34,
    color: COLORS.inkNavy,
  },
  tileNote: { fontSize: 12, color: COLORS.inkNavy },
  tileMuted: { color: COLORS.slate },
  filterRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: Spacing.xl,
    flexWrap: "wrap",
    alignItems: "center",
  },
  searchWrap: {
    position: "relative",
    justifyContent: "center",
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 200,
  },
  searchIcon: { position: "absolute", left: 14, zIndex: 1 },
  searchInput: {
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    paddingLeft: 38,
    paddingRight: 16,
    fontSize: 13,
    color: COLORS.inkNavy,
  },
  list: { gap: Spacing.sm },
  rowActive: { borderColor: COLORS.inkNavy },

  // Table (wide) layout: one white card, a header row, one row per payment.
  table: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    ...CARD_SHADOW,
    overflow: "hidden",
  },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  thead: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingVertical: 14,
  },
  th: { fontSize: 12, fontWeight: "700", color: COLORS.slate },
  trBody: { borderBottomWidth: 1, borderBottomColor: COLORS.hairline },
  trActive: { backgroundColor: COLORS.rowSelected },
  cBusiness: { flex: 2, minWidth: 0 },
  cStall: { flex: 1.5 },
  cStatus: { flex: 1, alignItems: "flex-start" },
  cWith: { flex: 1 },
  cAmount: { flex: 1 },
  cOn: { flex: 1.8 },
  cArrow: { width: 24, alignItems: "flex-end" },
  cell: { fontSize: 14, color: COLORS.inkNavy },
  cellStrong: { fontSize: 14, fontWeight: "700", color: COLORS.inkNavy },
  cellSub: { fontSize: 12, color: COLORS.slate },
  cellMuted: { color: COLORS.slate },

  // Card (narrow) layout.
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.md },
  cardBottom: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  amount: { fontSize: 15, fontWeight: "700", color: COLORS.inkNavy },

  mobileDetailCard: { marginTop: Spacing.xl },
  sidebar: {
    flexGrow: 0,
    flexShrink: 0,
    width: 360,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.hairline,
    padding: Spacing.xl,
    backgroundColor: COLORS.white,
  },
  skeletonRow: {
    backgroundColor: COLORS.border,
    borderColor: COLORS.border,
    shadowOpacity: 0,
    minHeight: 64,
  },
});
