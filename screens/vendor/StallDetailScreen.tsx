import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  StyleSheet,
  Switch,
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
};

const DAYS = ["friday", "saturday", "sunday"] as const;
type Day = (typeof DAYS)[number];

// CHANGED: this used to be the payment window (15 min), set the
// moment a vendor reserved, going straight to Payment after. Now
// reserving just starts a longer APPROVAL window — the organizer
// needs to approve first. The real 15-minute payment window only
// starts once that happens (set by the organizer's Approve action,
// not here — see BookingRequestsScreen.tsx / OrganizerHomeScreen.tsx).
const APPROVAL_WINDOW_HOURS = 24;

export default function StallDetailScreen() {
  const { stallId, sessionId } = useLocalSearchParams<{
    stallId: string;
    sessionId: string;
  }>();
  const [stall, setStall] = useState<Stall | null>(null);
  const [selectedDays, setSelectedDays] = useState<Day[]>(["friday"]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const insets = useSafeAreaInsets();

  useEffect(() => {
    async function load() {
      if (!stallId || !sessionId) return;

      // Free up any holds that expired since they were created, so we're
      // checking availability against accurate, current data.
      await supabase.rpc("expire_stale_bookings");

      const { data: stallData } = await supabase
        .from("stalls")
        .select("id, stall_number, size, price_per_day_cents")
        .eq("id", stallId)
        .single();

      if (!stallData) {
        setLoading(false);
        return;
      }
      setStall(stallData);

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (userId) {
        // Does this vendor already have a live hold/approval on this exact
        // stall for this session? If so, don't let them create a second
        // one — send them to wherever that existing one actually is:
        // still waiting on approval, or already cleared to pay.
        const { data: existing } = await supabase
          .from("bookings")
          .select("id, status")
          .eq("vendor_id", userId)
          .eq("stall_id", stallId)
          .eq("session_id", sessionId)
          .in("status", ["pending", "approved"])
          .maybeSingle();

        if (existing) {
          // CHANGED: used to always jump to Payment regardless of
          // status. Now only an already-approved booking goes to
          // Payment — a still-pending one goes to the booking detail
          // screen, which shows the "waiting for approval" state.
          router.replace({
            pathname: "/(vendor)/booking-detail",
            params: { bookingId: existing.id },
          });
          return;
        }
      }

      setLoading(false);
    }
    load();
  }, [stallId, sessionId]);

  function toggleDay(day: Day) {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  const total = stall
    ? (stall.price_per_day_cents * selectedDays.length) / 100
    : 0;

  async function handleContinue() {
    if (!stall || !sessionId || selectedDays.length === 0) {
      Alert.alert(
        "Pick at least one day",
        "Select which days you'll attend before continuing.",
      );
      return;
    }

    setSubmitting(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setSubmitting(false);
      router.replace("/(auth)/login");
      return;
    }

    // Sweep right before attempting the insert too — closes the gap where
    // someone else's stale hold expired between this screen loading and
    // the vendor pressing Continue.
    await supabase.rpc("expire_stale_bookings");

    const reservationExpiresAt = new Date(
      Date.now() + APPROVAL_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        vendor_id: userId,
        stall_id: stall.id,
        session_id: sessionId,
        attending_days: selectedDays,
        is_recurring: isRecurring,
        status: "pending",
        reservation_expires_at: reservationExpiresAt,
      })
      .select("id")
      .single();

    if (error) {
      setSubmitting(false);
      if (error.code === "23505") {
        Alert.alert(
          "Stall no longer available",
          "Someone else just booked this stall. Please pick a different one.",
        );
        router.replace("/(vendor)/floor-map");
      } else {
        Alert.alert("Booking failed", error.message);
      }
      return;
    }

    // Let the vendor know their request went in — shows up in Notifications.
    await supabase.from("notifications").insert({
      recipient_id: userId,
      title: "Booking request submitted",
      body: `Your request for stall ${stall.stall_number} is pending organizer approval.`,
      type: "booking_submitted",
    });

    setSubmitting(false);

    // CHANGED: used to push straight to Payment with the amount. Now
    // goes to the booking's own detail screen, which shows "waiting
    // for approval" until the organizer acts — Payment isn't reachable
    // until then.
    router.push({
      pathname: "/(vendor)/booking-detail",
      params: { bookingId: booking.id },
    });
  }

  if (loading || !stall) {
    return (
      <View style={styles.container}>
        <Text>Loading stall...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Stall {stall.stall_number}</Text>
        <Text style={styles.headerSubtitle}>
          {stall.size ?? "Standard stall"}
        </Text>
      </View>

      <Text style={styles.label}>Which days will you attend?</Text>
      <View style={styles.dayRow}>
        {DAYS.map((day) => {
          const selected = selectedDays.includes(day);
          return (
            <TouchableOpacity
              key={day}
              style={[styles.dayBox, selected && styles.dayBoxSelected]}
              onPress={() => toggleDay(day)}
            >
              <Text style={styles.dayText}>
                {day.charAt(0).toUpperCase() + day.slice(1, 3)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Keep this stall every week</Text>
        <Switch value={isRecurring} onValueChange={setIsRecurring} />
      </View>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            Total ({selectedDays.length} days)
          </Text>
          <Text style={styles.totalValue}>₱{total.toLocaleString()}</Text>
        </View>
        <PrimaryButton
          label={submitting ? "Submitting..." : "Request this stall"}
          onPress={handleContinue}
          loading={submitting}
        />
      </View>
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
  header: {
    backgroundColor: Colors.available,
    borderRadius: Radius.md,
    padding: 20,
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: { color: Colors.white, fontSize: 16, fontWeight: "600" },
  headerSubtitle: { color: Colors.white, fontSize: 12, marginTop: 4 },
  label: { fontSize: 12, color: Colors.textMuted, marginBottom: 8 },
  dayRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  dayBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingVertical: 12,
    alignItems: "center",
  },
  dayBoxSelected: {
    borderColor: Colors.info,
    borderWidth: 2,
    backgroundColor: Colors.infoLight,
  },
  dayText: { fontSize: 13, fontWeight: "500" },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    padding: 12,
    marginBottom: 20,
  },
  toggleLabel: { fontSize: 12, color: Colors.textMuted },
  footer: {
    marginTop: "auto",
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 14,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  totalLabel: { fontSize: 13, color: Colors.textMuted },
  totalValue: { fontSize: 18, fontWeight: "600" },
});
