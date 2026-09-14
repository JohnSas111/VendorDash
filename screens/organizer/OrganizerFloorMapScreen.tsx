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
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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

const LEGEND: { status: StallDisplayStatus; label: string }[] = [
  { status: "available", label: "Available" },
  { status: "reserved", label: "Reserved (unpaid)" },
  { status: "booked", label: "Booked (paid)" },
  { status: "inactive", label: "Inactive" },
];

export default function OrganizerFloorMapScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();

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

    const { data: stallRows } = await supabase
      .from("stalls")
      .select("id, stall_number, is_active")
      .eq("venue_id", venue.id)
      .order("stall_number");
    setStalls(stallRows ?? []);

    const { data: sessions } = await supabase
      .from("market_sessions")
      .select("id, friday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .in("status", ["upcoming", "open"])
      .order("friday_date", { ascending: true })
      .limit(1);

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

    const { data: bookingRows } = await supabase
      .from("bookings")
      .select(
        "id, stall_id, status, attending_days, profiles!bookings_vendor_id_fkey(full_name)",
      )
      .eq("session_id", session.id)
      .in("status", ["pending", "approved", "paid", "checked_in"]);

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
  }, [venue]);

  useEffect(() => {
    load();
  }, [load]);

  if (venueLoading || loading) {
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

  const selected = selectedStallId ? bookingsByStall[selectedStallId] : null;
  const selectedStall = stalls.find((s) => s.id === selectedStallId);

  return (
    <View style={{ flex: 1, flexDirection: isDesktop ? "row" : "column" }}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
        <Text style={shared.title}>Floor Map</Text>
        <Text style={shared.subtitle}>{sessionLabel} · read-only overview</Text>

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 16,
            marginBottom: 16,
          }}
        >
          {LEGEND.map((item) => {
            const { bg, fg } = stallStatusColors(item.status);
            return (
              <View
                key={item.status}
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    backgroundColor: bg,
                    borderWidth: 1,
                    borderColor: fg,
                  }}
                />
                <Text style={{ fontSize: 12, color: COLORS.slate }}>
                  {item.label}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {stalls.map((stall) => {
            const booking = bookingsByStall[stall.id];
            const displayStatus = resolveStallDisplayStatus(
              stall.is_active,
              booking?.status ?? null,
            );
            const { bg, fg } = stallStatusColors(displayStatus);
            const selectedStyle =
              stall.id === selectedStallId
                ? { borderColor: COLORS.inkNavy, borderWidth: 2 }
                : {};
            return (
              <Pressable
                key={stall.id}
                onPress={() => setSelectedStallId(stall.id)}
                style={[
                  {
                    width: 84,
                    height: 64,
                    borderRadius: RADIUS.sm,
                    backgroundColor: bg,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: fg,
                  },
                  selectedStyle,
                ]}
              >
                <Text style={{ fontWeight: "700", color: fg }}>
                  {stall.stall_number}
                </Text>
                <Text style={{ fontSize: 10, color: fg }}>{displayStatus}</Text>
              </Pressable>
            );
          })}
        </View>

        {!isDesktop && selected && selectedStall && (
          <View style={[shared.card, { marginTop: 20 }]}>
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
        <View
          style={{
            width: 280,
            borderLeftWidth: 1,
            borderLeftColor: COLORS.border,
            padding: 20,
            backgroundColor: COLORS.white,
          }}
        >
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
