import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

const PAYMENT_WINDOW_MINUTES = 15;

type BookingRow = {
  id: string;
  status: string;
  requested_at: string;
  attending_days: string[];
  vendor_id: string;
  vendor_name: string;
  stall_number: string;
};

const FILTERS = ["pending", "approved", "cancelled", "all"] as const;
type Filter = (typeof FILTERS)[number];

export default function BookingRequestsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();

  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    let query = supabase
      .from("bookings")
      .select(
        "id, status, requested_at, attending_days, vendor_id, profiles!bookings_vendor_id_fkey(full_name), stalls!inner(stall_number, venue_id)",
      )
      .eq("stalls.venue_id", venue.id)
      .order("requested_at", { ascending: false });

    if (filter !== "all") query = query.eq("status", filter);

    const { data } = await query;
    setRows(
      (data ?? []).map((row: any) => ({
        id: row.id,
        status: row.status,
        requested_at: row.requested_at,
        attending_days: row.attending_days ?? [],
        vendor_id: row.vendor_id,
        vendor_name: row.profiles?.full_name ?? "Unknown vendor",
        stall_number: row.stalls?.stall_number ?? "—",
      })),
    );
    setLoading(false);
  }, [venue, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (booking: BookingRow) => {
    setActingOnId(booking.id);

    const paymentDeadline = new Date(
      Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000,
    ).toISOString();

    const { error } = await supabase
      .from("bookings")
      .update({
        status: "approved",
        decided_at: new Date().toISOString(),
        reservation_expires_at: paymentDeadline,
      })
      .eq("id", booking.id);

    if (!error) {
      await supabase.from("notifications").insert({
        recipient_id: booking.vendor_id,
        title: "Booking approved!",
        body: `Stall ${booking.stall_number} is approved — you have ${PAYMENT_WINDOW_MINUTES} minutes to pay before it expires.`,
        type: "booking_approved",
      });
    }

    setActingOnId(null);
    if (!error) load();
  };

  const reject = async (bookingId: string) => {
    setActingOnId(bookingId);
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", decided_at: new Date().toISOString() })
      .eq("id", bookingId);
    setActingOnId(null);
    if (!error) load();
  };

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

  const filtered = rows.filter(
    (r) =>
      !search.trim() ||
      r.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
      r.stall_number.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.content,
        isDesktop && shared.contentDesktop,
      ]}
    >
      <Text style={shared.title}>Booking Requests</Text>
      <Text style={shared.subtitle}>
        Approving starts a {PAYMENT_WINDOW_MINUTES}-minute countdown for the
        vendor to pay.
      </Text>

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              shared.secondaryButton,
              filter === f && { backgroundColor: COLORS.inkNavy },
            ]}
          >
            <Text
              style={[
                shared.secondaryButtonText,
                filter === f && { color: COLORS.white },
              ]}
            >
              {f}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        style={[shared.input, { marginBottom: 16 }]}
        placeholder="Search vendor or stall…"
        value={search}
        onChangeText={setSearch}
      />

      {loading ? (
        <ActivityIndicator color={COLORS.inkNavy} />
      ) : filtered.length === 0 ? (
        <View style={shared.emptyState}>
          <Text style={shared.emptyStateText}>
            No bookings match this filter.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {filtered.map((b) => {
            const { bg, fg } = statusColors(b.status);
            return (
              <View
                key={b.id}
                style={[shared.row, isDesktop && shared.rowDesktop]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={shared.rowTitle}>{b.vendor_name}</Text>
                  <Text style={shared.rowSubtitle}>
                    Stall {b.stall_number} ·{" "}
                    {b.attending_days.join(", ") || "no days set"} · requested{" "}
                    {formatDate(b.requested_at)}
                  </Text>
                  <View
                    style={[
                      shared.badge,
                      { backgroundColor: bg, marginTop: 6 },
                    ]}
                  >
                    <Text style={[shared.badgeText, { color: fg }]}>
                      {b.status}
                    </Text>
                  </View>
                </View>
                {b.status === "pending" && (
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      marginTop: isDesktop ? 0 : 10,
                    }}
                  >
                    <Pressable
                      style={shared.dangerOutlineButton}
                      disabled={actingOnId === b.id}
                      onPress={() => reject(b.id)}
                    >
                      <Text style={shared.dangerOutlineButtonText}>Reject</Text>
                    </Pressable>
                    <Pressable
                      style={shared.successButton}
                      disabled={actingOnId === b.id}
                      onPress={() => approve(b)}
                    >
                      <Text style={shared.successButtonText}>Approve</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
