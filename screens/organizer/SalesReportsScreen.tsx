import { PressableButton } from "@/components/PressableButton";
import { Spacing, Typography } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  formatMoney,
  RADIUS,
  shared,
} from "@/lib/organizerTheme";
import { openSignedImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { ownerPrefix, vendorDisplay } from "@/lib/uxHelpers";
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

type Session = {
  id: string;
  friday_date: string;
  sunday_date: string;
  status: string;
};
type VendorSales = {
  vendor_name: string; // business name (falls back to the person's name)
  owner_name: string;
  stall_number: string;
  gross_sales_cents: number;
  items_sold_count: number | null;
  receipt_path: string | null;
};

export default function SalesReportsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();
  const { showToast } = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [vendorRows, setVendorRows] = useState<VendorSales[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    if (!venue) return;
    const { data, error } = await supabase
      .from("market_sessions")
      .select("id, friday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .order("friday_date", { ascending: false })
      .limit(12);
    if (error) {
      showToast("Couldn't load sessions.", "error");
    }
    setSessions(data ?? []);
    if (data && data.length > 0 && !selectedSessionId) {
      const completed = data.find((s) => s.status === "completed") ?? data[0];
      setSelectedSessionId(completed.id);
    }
    // BUGFIX: previously, with zero sessions, `loading` was never set to
    // false (the vendorRows effect below returns early without touching
    // it) — the screen just showed a spinner forever. This flag lets the
    // render below distinguish "still resolving sessions" from
    // "resolved, and there are none" instead of trusting `loading` alone.
    setSessionsLoaded(true);
    if (!data || data.length === 0) {
      setLoading(false);
    }
  }, [venue, selectedSessionId, showToast]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling
    // loadSessions() directly — calling a useCallback'd function that
    // setStates straight in the effect body trips
    // react-hooks/set-state-in-effect.
    async function run() {
      await loadSessions();
    }
    run();
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("sales_submissions")
        .select(
          "gross_sales_cents, items_sold_count, receipt_photo_url, profiles!sales_submissions_vendor_id_fkey(full_name, vendor_details!vendor_details_id_fkey(business_name)), bookings!inner(session_id, stalls(stall_number))",
        )
        .eq("bookings.session_id", selectedSessionId);
      if (error) {
        showToast("Couldn't load sales for this session.", "error");
      }

      setVendorRows(
        (data ?? []).map((row: any) => ({
          vendor_name: vendorDisplay(row.profiles).name,
          owner_name: vendorDisplay(row.profiles).owner,
          stall_number: row.bookings?.stalls?.stall_number ?? "—",
          gross_sales_cents: row.gross_sales_cents,
          items_sold_count: row.items_sold_count,
          receipt_path: row.receipt_photo_url ?? null,
        })),
      );
      setLoading(false);
    })();
  }, [selectedSessionId, showToast]);

  if (venueLoading) {
    return (
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <ReportsSkeleton />
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

  const totalSales = vendorRows.reduce(
    (sum, r) => sum + r.gross_sales_cents,
    0,
  );
  const totalItems = vendorRows.reduce(
    (sum, r) => sum + (r.items_sold_count ?? 0),
    0,
  );

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.content,
        isDesktop && shared.contentDesktop,
      ]}
    >
      <Text style={shared.title}>Sales Reports</Text>
      <Text style={shared.subtitle}>
        Vendor-submitted gross sales per session.
      </Text>

      {sessionsLoaded && sessions.length === 0 ? (
        <View style={[shared.emptyState, styles.emptyStateSpacing]}>
          <Ionicons name="bar-chart-outline" size={26} color={COLORS.slate} />
          <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
            No sessions yet — reports will show up once a session has run.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.sessionPicker}
          >
            <View style={styles.sessionPickerRow}>
              {sessions.map((s) => (
                <PressableButton
                  key={s.id}
                  onPress={() => setSelectedSessionId(s.id)}
                  style={[
                    shared.secondaryButton,
                    selectedSessionId === s.id && styles.sessionChipActive,
                  ]}
                >
                  <Text
                    style={[
                      shared.secondaryButtonText,
                      selectedSessionId === s.id &&
                        styles.sessionChipActiveText,
                    ]}
                  >
                    {formatDate(s.friday_date)}
                  </Text>
                </PressableButton>
              ))}
            </View>
          </ScrollView>

          {loading ? (
            <ReportRowsSkeleton />
          ) : (
            <>
              <View style={styles.statRow}>
                <View style={[shared.card, styles.statCard]}>
                  <Text style={styles.statValue}>
                    {formatMoney(totalSales)}
                  </Text>
                  <Text style={styles.statLabel}>Total gross sales</Text>
                </View>
                <View style={[shared.card, styles.statCard]}>
                  <Text style={styles.statValue}>{totalItems}</Text>
                  <Text style={styles.statLabel}>Items sold</Text>
                </View>
                <View style={[shared.card, styles.statCard]}>
                  <Text style={styles.statValue}>{vendorRows.length}</Text>
                  <Text style={styles.statLabel}>Vendors reporting</Text>
                </View>
              </View>

              {vendorRows.length === 0 ? (
                <View style={shared.emptyState}>
                  <Ionicons
                    name="receipt-outline"
                    size={26}
                    color={COLORS.slate}
                  />
                  <Text
                    style={[shared.emptyStateText, { marginTop: Spacing.xs }]}
                  >
                    No sales submitted for this session yet.
                  </Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {vendorRows.map((r, i) => (
                    <View key={i} style={[shared.row, shared.rowDesktop]}>
                      <View>
                        <Text style={shared.rowTitle}>{r.vendor_name}</Text>
                        <Text style={shared.rowSubtitle}>
                          {ownerPrefix(r.vendor_name, r.owner_name)}Stall{" "}
                          {r.stall_number}
                        </Text>
                      </View>
                      <View style={styles.salesCol}>
                        <Text style={shared.rowTitle}>
                          {formatMoney(r.gross_sales_cents)}
                        </Text>
                        {r.items_sold_count != null && (
                          <Text style={shared.rowSubtitle}>
                            {r.items_sold_count} items
                          </Text>
                        )}
                        {r.receipt_path && (
                          <Pressable
                            accessibilityRole="link"
                            style={styles.receiptLink}
                            onPress={async () => {
                              const ok = await openSignedImage(
                                "sales-receipts",
                                r.receipt_path!,
                              );
                              if (!ok) {
                                showToast(
                                  "Couldn't open that receipt.",
                                  "error",
                                );
                              }
                            }}
                          >
                            <Ionicons
                              name="receipt-outline"
                              size={13}
                              color={COLORS.inkNavy}
                            />
                            <Text style={styles.receiptLinkText}>
                              View receipt
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

// Placeholder shown while the venue is resolving.
function ReportsSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: 140, height: 22, marginBottom: Spacing.sm },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 220, marginBottom: Spacing.lg }]}
      />
      <ReportRowsSkeleton />
    </View>
  );
}

// Placeholder shown while a session's sales rows are loading.
function ReportRowsSkeleton() {
  return (
    <View>
      <View style={styles.statRow}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[shared.card, styles.statCard, styles.skeletonBlock]}
          />
        ))}
      </View>
      <View style={styles.list}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={[shared.row, styles.skeletonBlock, { minHeight: 56 }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  receiptLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    marginTop: 4,
  },
  receiptLinkText: {
    color: COLORS.inkNavy,
    fontSize: Typography.sm,
    textDecorationLine: "underline",
  },
  emptyStateSpacing: { marginTop: Spacing.lg },
  sessionPicker: { marginBottom: Spacing.lg },
  sessionPickerRow: { flexDirection: "row", gap: Spacing.sm },
  sessionChipActive: { backgroundColor: COLORS.inkNavy },
  sessionChipActiveText: { color: COLORS.white },
  statRow: { flexDirection: "row", gap: Spacing.md, marginBottom: Spacing.xl },
  statCard: { flex: 1 },
  statValue: {
    fontSize: Typography.xxl - 2,
    fontWeight: "700",
    color: COLORS.inkNavy,
  },
  statLabel: { fontSize: Typography.sm, color: COLORS.slate },
  list: { gap: Spacing.sm },
  salesCol: { alignItems: "flex-end" },
  skeletonBlock: {
    backgroundColor: COLORS.border,
    borderColor: COLORS.border,
    shadowOpacity: 0,
  },
  skeletonLine: {
    height: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
  },
});
