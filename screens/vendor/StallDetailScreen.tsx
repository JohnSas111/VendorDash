import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Stall = {
  id: string;
  stall_number: string;
  size: string | null;
  price_per_day_cents: number;
};

const DAYS = ["friday", "saturday", "sunday"] as const;
type Day = (typeof DAYS)[number];

// Reserving only starts an approval request. How long the request is held
// (24h for unverified vendors, 72h for verified ones) and every booking rule
// (verification, one stall per market, open-request limits) are enforced by
// the database function create_booking - not by this screen.

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
  const { showToast } = useToast();

  useEffect(() => {
    async function load() {
      if (!stallId || !sessionId) return;

      // Lapsed holds are released by a scheduled job on the server, and the
      // availability check below already ignores holds that have run out.

      const { data: stallData, error: stallError } = await supabase
        .from("stalls")
        .select("id, stall_number, size, price_per_day_cents")
        .eq("id", stallId)
        .single();

      if (stallError || !stallData) {
        showToast("Couldn't load that stall.", "error");
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
        // Vendors get one stall per market, so any live booking for this
        // session (on this stall or another) goes to that booking instead.
        const { data: existing } = await supabase
          .from("bookings")
          .select("id, stall_id")
          .eq("vendor_id", userId)
          .eq("session_id", sessionId)
          .not("status", "in", "(cancelled,rejected,expired)")
          .maybeSingle();

        if (existing) {
          if (existing.stall_id !== stallId) {
            showToast(
              "You already have a stall for this market. Cancel it first if you want to switch.",
              "info",
            );
          }
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
  }, [stallId, sessionId, showToast]);

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
      showToast("Select which days you'll attend before continuing.", "error");
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

    // create_booking checks that you're allowed to book (profile/permit,
    // one stall per market, open-request limit, stall and session are valid),
    // sets the hold, notifies you and records the audit event.
    const { data: bookingId, error } = await supabase.rpc("create_booking", {
      p_stall_id: stall.id,
      p_session_id: sessionId,
      p_attending_days: selectedDays,
      p_is_recurring: isRecurring,
    });

    if (error || !bookingId) {
      setSubmitting(false);
      showToast(error?.message || "Booking failed.", "error");
      // 23505 = the stall was taken a moment ago: back to the map to pick another.
      if (error?.code === "23505") {
        router.replace("/(vendor)/floor-map");
      }
      return;
    }

    setSubmitting(false);

    // CHANGED: used to push straight to Payment with the amount. Now
    // goes to the booking's own detail screen, which shows "waiting
    // for approval" until the organizer acts — Payment isn't reachable
    // until then.
    router.push({
      pathname: "/(vendor)/booking-detail",
      params: { bookingId: bookingId as string },
    });
  }

  if (loading || !stall) {
    return (
      <View style={styles.container}>
        <StallDetailSkeleton />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { paddingBottom: insets.bottom + Spacing.md }]}
    >
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
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={day}
              key={day}
              style={[styles.dayBox, selected && styles.dayBoxSelected]}
              onPress={() => toggleDay(day)}
              activeOpacity={0.7}
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

// Placeholder shown while the stall is loading, replacing the old plain
// "Loading stall..." text.
function StallDetailSkeleton() {
  return (
    <View>
      <View style={[styles.header, styles.skeletonHeader]} />
      <View
        style={[
          styles.skeletonLine,
          { width: "50%", marginBottom: Spacing.sm },
        ]}
      />
      <View style={styles.dayRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dayBox, styles.skeletonBox]} />
        ))}
      </View>
      <View style={[styles.toggleRow, styles.skeletonBox]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    backgroundColor: Colors.background,
    padding: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  header: {
    backgroundColor: Colors.available,
    borderRadius: Radius.md,
    padding: Spacing.xl,
    alignItems: "center",
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  skeletonHeader: {
    backgroundColor: Colors.borderLight,
    shadowOpacity: 0,
    height: 88,
  },
  skeletonBox: { backgroundColor: Colors.borderLight },
  skeletonLine: {
    height: 12,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
  headerTitle: {
    color: Colors.white,
    fontSize: Typography.md,
    fontWeight: "600",
  },
  headerSubtitle: {
    color: Colors.white,
    fontSize: Typography.sm,
    marginTop: Spacing.xs,
  },
  label: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  dayRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.lg },
  dayBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    alignItems: "center",
    backgroundColor: Colors.white,
  },
  dayBoxSelected: {
    borderColor: Colors.info,
    borderWidth: 2,
    backgroundColor: Colors.infoLight,
  },
  dayText: { fontSize: Typography.base, fontWeight: "500", color: Colors.text },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    backgroundColor: Colors.white,
  },
  toggleLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  footer: {
    marginTop: "auto",
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: Spacing.lg,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  totalLabel: { fontSize: Typography.base, color: Colors.textMuted },
  totalValue: {
    fontSize: Typography.xl,
    fontWeight: "600",
    color: Colors.text,
  },
});
