import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  formatMoney,
  shared,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
  vendor_name: string;
  stall_number: string;
  gross_sales_cents: number;
  items_sold_count: number | null;
};

export default function SalesReportsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [vendorRows, setVendorRows] = useState<VendorSales[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    if (!venue) return;
    const { data } = await supabase
      .from("market_sessions")
      .select("id, friday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .order("friday_date", { ascending: false })
      .limit(12);
    setSessions(data ?? []);
    if (data && data.length > 0 && !selectedSessionId) {
      const completed = data.find((s) => s.status === "completed") ?? data[0];
      setSelectedSessionId(completed.id);
    }
  }, [venue, selectedSessionId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("sales_submissions")
        .select(
          "gross_sales_cents, items_sold_count, profiles!sales_submissions_vendor_id_fkey(full_name), bookings!inner(session_id, stalls(stall_number))",
        )
        .eq("bookings.session_id", selectedSessionId);

      setVendorRows(
        (data ?? []).map((row: any) => ({
          vendor_name: row.profiles?.full_name ?? "Unknown vendor",
          stall_number: row.bookings?.stalls?.stall_number ?? "—",
          gross_sales_cents: row.gross_sales_cents,
          items_sold_count: row.items_sold_count,
        })),
      );
      setLoading(false);
    })();
  }, [selectedSessionId]);

  if (venueLoading) {
    return (
      <View style={shared.centerFill}>
        <ActivityIndicator color={COLORS.inkNavy} />
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 16 }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          {sessions.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => setSelectedSessionId(s.id)}
              style={[
                shared.secondaryButton,
                selectedSessionId === s.id && {
                  backgroundColor: COLORS.inkNavy,
                },
              ]}
            >
              <Text
                style={[
                  shared.secondaryButtonText,
                  selectedSessionId === s.id && { color: COLORS.white },
                ]}
              >
                {formatDate(s.friday_date)}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={COLORS.inkNavy} />
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 12, marginBottom: 20 }}>
            <View style={[shared.card, { flex: 1 }]}>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "700",
                  color: COLORS.inkNavy,
                }}
              >
                {formatMoney(totalSales)}
              </Text>
              <Text style={{ fontSize: 12, color: COLORS.slate }}>
                Total gross sales
              </Text>
            </View>
            <View style={[shared.card, { flex: 1 }]}>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "700",
                  color: COLORS.inkNavy,
                }}
              >
                {totalItems}
              </Text>
              <Text style={{ fontSize: 12, color: COLORS.slate }}>
                Items sold
              </Text>
            </View>
            <View style={[shared.card, { flex: 1 }]}>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "700",
                  color: COLORS.inkNavy,
                }}
              >
                {vendorRows.length}
              </Text>
              <Text style={{ fontSize: 12, color: COLORS.slate }}>
                Vendors reporting
              </Text>
            </View>
          </View>

          {vendorRows.length === 0 ? (
            <View style={shared.emptyState}>
              <Text style={shared.emptyStateText}>
                No sales submitted for this session yet.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {vendorRows.map((r, i) => (
                <View key={i} style={[shared.row, shared.rowDesktop]}>
                  <View>
                    <Text style={shared.rowTitle}>{r.vendor_name}</Text>
                    <Text style={shared.rowSubtitle}>
                      Stall {r.stall_number}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={shared.rowTitle}>
                      {formatMoney(r.gross_sales_cents)}
                    </Text>
                    {r.items_sold_count != null && (
                      <Text style={shared.rowSubtitle}>
                        {r.items_sold_count} items
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
