import { ConfirmModal } from "@/components/ConfirmModal";
import { KeyboardAvoider } from "@/components/KeyboardScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { goBackSafely } from "@/lib/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

type BookingDetail = {
  id: string;
  status: string;
  attending_days: string[];
  is_recurring: boolean;
  refund_requested: boolean;
  refund_reason: string | null;
  stalls: { stall_number: string; price_per_day_cents: number } | null;
  market_sessions: { friday_date: string; sunday_date: string } | null;
};

// Latest refund request for this booking (refund_requests table).
type RefundInfo = {
  status: "requested" | "rejected" | "approved" | "refunded";
  reason: string;
  decision_comment: string | null;
  refund_amount_cents: number | null;
};

function pesos(cents: number) {
  return `₱${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// "2026-10-02" is read as a plain calendar date. new Date("2026-10-02") means
// midnight UTC, which shows the day before on a device behind UTC, and a
// weekend that crosses a month needs both month names.
function formatDateRange(friday: string, sunday: string) {
  const [fy, fm, fd] = friday.split("-").map(Number);
  const [sy, sm, sd] = sunday.split("-").map(Number);
  if (!fy || !fm || !fd || !sy || !sm || !sd) return `${friday} – ${sunday}`;
  const f = new Date(fy, fm - 1, fd);
  const s = new Date(sy, sm - 1, sd);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (fm === sm && fy === sy) {
    return `${f.toLocaleDateString("en-US", opts)}–${sd}`;
  }
  return `${f.toLocaleDateString("en-US", opts)} – ${s.toLocaleDateString("en-US", opts)}`;
}

export default function BookingDetailScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { showToast } = useToast();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [refund, setRefund] = useState<RefundInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingRecurring, setSavingRecurring] = useState(false);
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false);

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoadError(null);
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, status, attending_days, is_recurring, refund_requested, refund_reason, stalls(stall_number, price_per_day_cents), market_sessions(friday_date, sunday_date)",
      )
      .eq("id", bookingId)
      .single();

    // BUGFIX: this fetch never checked `error` at all — on failure,
    // `booking` stayed null, and since the render below returns the
    // loading spinner whenever `!booking`, the screen showed an
    // infinite spinner instead of an error state.
    if (error || !data) {
      setLoadError("Couldn't load this booking.");
      setLoading(false);
      return;
    }
    setBooking(data as unknown as BookingDetail);

    // Latest refund request, if any (vendors can only read their own).
    const { data: refundRows } = await supabase
      .from("refund_requests")
      .select("status, reason, decision_comment, refund_amount_cents")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1);
    setRefund((refundRows?.[0] as RefundInfo | undefined) ?? null);

    setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  async function handleToggleRecurring(next: boolean) {
    if (!booking) return;

    // Optimistic update, reverted if the call fails.
    setBooking({ ...booking, is_recurring: next });
    setSavingRecurring(true);

    const { data, error } = await supabase.functions.invoke(
      "toggle-recurring",
      {
        body: { bookingId: booking.id, isRecurring: next },
      },
    );

    setSavingRecurring(false);

    if (error || !data?.success) {
      setBooking({ ...booking, is_recurring: !next });
      // The function explains refusals in data.error (e.g. "available once the
      // organizer has verified your business"); `error` is a network/server failure.
      showToast(
        data?.error ??
          error?.message ??
          "Couldn't update that. Please try again.",
        "error",
      );
    }
  }

  function handleRequestRefund() {
    setRefundReason("");
    setRefundModalOpen(true);
  }

  async function submitRefundRequest() {
    if (!booking) return;

    if (refundReason.trim().length < 3) {
      showToast(
        "Add a short reason so the organizer knows what happened.",
        "error",
      );
      return;
    }

    // request_refund checks that this is your paid booking, that nothing is
    // already open, and records the request for the organizer.
    setRequestingRefund(true);
    const { error } = await supabase.rpc("request_refund", {
      p_booking_id: booking.id,
      p_reason: refundReason.trim(),
    });
    setRequestingRefund(false);

    if (error) {
      showToast(error.message || "Couldn't send the request.", "error");
      return;
    }

    setRefundModalOpen(false);
    showToast(
      "Refund requested — the organizer will review it and let you know.",
      "success",
    );
    await load();
  }

  function handleCancelReservation() {
    setCancelConfirmVisible(true);
  }

  async function confirmCancelReservation() {
    if (!booking) return;
    setCancelConfirmVisible(false);

    // cancel_booking only accepts your own pending/approved reservation and
    // refuses while a payment for it is in progress.
    setCancelling(true);
    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: booking.id,
    });
    setCancelling(false);

    if (error) {
      showToast(error.message || "Couldn't cancel that reservation.", "error");
      return;
    }

    showToast(
      "Reservation cancelled — the stall is available again.",
      "success",
    );
    goBackSafely("/(vendor)/(tabs)/my-bookings");
  }

  // Takes the vendor from "approved" straight into Payment, now that
  // reserving no longer goes there automatically.
  function handleContinueToPayment() {
    if (!booking || !booking.stalls) return;
    const amountCents =
      booking.stalls.price_per_day_cents * booking.attending_days.length;
    router.push({
      pathname: "/(vendor)/payment",
      params: {
        bookingId: booking.id,
        amount: Math.round(amountCents).toString(),
      },
    });
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <BookingDetailSkeleton />
      </View>
    );
  }

  if (loadError || !booking) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <Ionicons name="alert-circle-outline" size={28} color={Colors.booked} />
        <Text style={styles.errorText}>
          {loadError ?? "Booking not found."}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => goBackSafely("/(vendor)/(tabs)/my-bookings")}
          style={styles.backLink}
        >
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const dateLabel = booking.market_sessions
    ? formatDateRange(
        booking.market_sessions.friday_date,
        booking.market_sessions.sunday_date,
      )
    : "Date unavailable";

  const isCheckedIn = booking.status === "checked_in";
  const canShowQR = booking.status === "paid" || isCheckedIn;
  // Auto-renew can be turned on for a confirmed booking (paid / checked in /
  // completed). It can be turned OFF on any live booking too, so an
  // auto-requested (pending/approved) booking can be stopped from here.
  const canToggleRecurring =
    ["paid", "checked_in", "completed"].includes(booking.status) ||
    (["pending", "approved"].includes(booking.status) && booking.is_recurring);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Stall {booking.stalls?.stall_number ?? "—"}
      </Text>
      <Text style={styles.subtitle}>{dateLabel}</Text>
      <View style={styles.badgeWrap}>
        <StatusBadge status={booking.status} />
      </View>

      {/* Three-way status card — pending vs approved need genuinely
          different messaging and actions, not just "no QR yet." */}
      {booking.status === "pending" && (
        <View style={styles.pendingCard}>
          <Ionicons name="time-outline" size={20} color={Colors.textMuted} />
          <Text style={styles.pendingText}>
            Waiting on the organizer to approve this reservation. You’ll be
            notified once they do — you’ll then have up to 24 hours to pay
            before it expires.
          </Text>
        </View>
      )}

      {booking.status === "approved" && (
        <View style={styles.approvedCard}>
          <Ionicons
            name="checkmark-circle"
            size={22}
            color={Colors.available}
          />
          <Text style={styles.approvedText}>
            You’re approved! Pay now to lock in this stall.
          </Text>
          <PrimaryButton
            label="Continue to payment"
            onPress={handleContinueToPayment}
          />
        </View>
      )}

      {canShowQR && (
        <View style={styles.qrCard}>
          <View style={isCheckedIn ? styles.qrDimmed : undefined}>
            <QRCode value={booking.id} size={200} />
          </View>
          <Text style={styles.qrHint}>
            {isCheckedIn
              ? "You're checked in — no need to show this again"
              : "Show this to the organizer at check-in"}
          </Text>
        </View>
      )}

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Attending</Text>
        <Text style={styles.infoValue}>
          {booking.attending_days
            ?.map((d) => d.charAt(0).toUpperCase() + d.slice(1))
            .join(", ")}
        </Text>
      </View>

      {canToggleRecurring && (
        <View style={styles.recurringCard}>
          <View style={styles.recurringTextWrap}>
            <Text style={styles.recurringLabel}>
              Keep this stall every week
            </Text>
            <Text style={styles.recurringHint}>
              {booking.is_recurring
                ? "We'll auto-reserve this stall for you each week. Turn off any time."
                : "Turn this on to auto-reserve this stall next week."}
            </Text>
          </View>
          <Switch
            value={booking.is_recurring}
            onValueChange={handleToggleRecurring}
            disabled={savingRecurring}
          />
        </View>
      )}

      {(booking.status === "pending" || booking.status === "approved") && (
        <Pressable
          accessibilityRole="button"
          onPress={handleCancelReservation}
          disabled={cancelling}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelButtonText}>
            {cancelling ? "Cancelling…" : "Cancel reservation"}
          </Text>
        </Pressable>
      )}

      {refund?.status === "requested" && (
        <View style={[styles.pendingCard, { marginTop: Spacing.md }]}>
          <Ionicons name="time-outline" size={20} color={Colors.textMuted} />
          <Text style={styles.pendingText}>
            Refund requested — waiting on the organizer’s decision.
          </Text>
        </View>
      )}

      {refund?.status === "approved" && (
        <View style={[styles.approvedCard, { marginTop: Spacing.md }]}>
          <Ionicons
            name="checkmark-circle"
            size={22}
            color={Colors.available}
          />
          <Text style={styles.approvedText}>
            Your refund was approved. Please bring a valid ID to the organizer
            to receive it.
          </Text>
        </View>
      )}

      {refund?.status === "refunded" && (
        <View style={[styles.pendingCard, { marginTop: Spacing.md }]}>
          <Ionicons
            name="checkmark-done-outline"
            size={20}
            color={Colors.textMuted}
          />
          <Text style={styles.pendingText}>
            Your refund
            {refund.refund_amount_cents != null
              ? ` of ${pesos(refund.refund_amount_cents)}`
              : ""}{" "}
            was paid out.
          </Text>
        </View>
      )}

      {booking.status === "paid" &&
        (!refund || refund.status === "rejected") && (
          <View style={styles.refundCard}>
            {refund?.status === "rejected" && (
              <Text style={styles.refundDeclinedText}>
                Your last refund request was declined
                {refund.decision_comment ? `: ${refund.decision_comment}` : "."}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={handleRequestRefund}
              style={styles.refundButton}
            >
              <Text style={styles.refundButtonText}>
                {refund?.status === "rejected"
                  ? "Request a refund again"
                  : "Request a refund"}
              </Text>
            </Pressable>
          </View>
        )}

      <Modal
        visible={refundModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRefundModalOpen(false)}
      >
        <KeyboardAvoider style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Request a refund</Text>
            <Text style={styles.modalHint}>
              The organizer will review your request. If it’s approved, your
              booking is cancelled and you collect the refund in person by
              showing a valid ID.
            </Text>
            <Text style={styles.modalLabel}>Reason</Text>
            <TextInput
              accessibilityLabel="Refund reason"
              style={styles.modalInput}
              value={refundReason}
              onChangeText={setRefundReason}
              placeholder="e.g. Can't make it this weekend, family emergency"
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setRefundModalOpen(false)}
                  disabled={requestingRefund}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={requestingRefund ? "Sending…" : "Submit request"}
                  onPress={submitRefundRequest}
                  disabled={requestingRefund}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoider>
      </Modal>

      <ConfirmModal
        visible={cancelConfirmVisible}
        title="Cancel this reservation?"
        message="This frees up the stall for someone else. You haven't paid yet, so there's nothing to refund."
        confirmLabel="Cancel reservation"
        cancelLabel="Keep it"
        onConfirm={confirmCancelReservation}
        onDismiss={() => setCancelConfirmVisible(false)}
      />
    </View>
  );
}

// Placeholder shown while the booking is loading.
function BookingDetailSkeleton() {
  return (
    <View style={{ width: "100%", alignItems: "center" }}>
      <View
        style={[
          styles.skeletonLine,
          { width: 140, height: 20, marginTop: Spacing.md },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 90, marginTop: Spacing.sm }]}
      />
      <View
        style={[
          styles.skeletonLine,
          {
            width: 70,
            height: 20,
            borderRadius: 10,
            marginTop: Spacing.md,
            marginBottom: Spacing.xxl,
          },
        ]}
      />
      <View style={[styles.qrCard, styles.skeletonBlock, { height: 260 }]} />
      <View
        style={[
          styles.infoCard,
          styles.skeletonBlock,
          { height: 56, marginTop: Spacing.lg },
        ]}
      />
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
    padding: Spacing.xxl,
    paddingTop: Spacing.xl,
    alignItems: "center",
  },
  centerFill: { justifyContent: "center", gap: Spacing.sm },
  errorText: {
    fontSize: Typography.md,
    color: Colors.textMuted,
    textAlign: "center",
  },
  backLink: { marginTop: Spacing.sm, minHeight: 44, justifyContent: "center" },
  backLinkText: {
    color: Colors.text,
    fontWeight: "600",
    fontSize: Typography.base,
  },
  title: { fontSize: Typography.xl, fontWeight: "bold", color: Colors.text },
  subtitle: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: 2 },
  badgeWrap: { marginTop: Spacing.sm, marginBottom: Spacing.xxl },
  qrCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.xxl,
    alignItems: "center",
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  qrDimmed: { opacity: 0.4 },
  qrHint: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: Spacing.md,
    textAlign: "center",
  },
  pendingCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    width: "100%",
    alignItems: "center",
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  pendingText: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },
  approvedCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.available,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  approvedText: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: Colors.text,
    textAlign: "center",
  },
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    width: "100%",
    ...Shadow.sm,
  },
  infoLabel: { fontSize: Typography.xs, color: Colors.textMuted },
  infoValue: {
    fontSize: Typography.md,
    fontWeight: "500",
    color: Colors.text,
    marginTop: 2,
  },
  recurringCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    width: "100%",
    marginTop: Spacing.md,
    ...Shadow.sm,
  },
  recurringTextWrap: { flex: 1, marginRight: Spacing.md },
  recurringLabel: {
    fontSize: Typography.base,
    fontWeight: "500",
    color: Colors.text,
  },
  recurringHint: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  refundCard: { width: "100%", marginTop: Spacing.md, alignItems: "center" },
  refundButton: {
    borderWidth: 1,
    borderColor: Colors.booked,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    width: "100%",
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  refundButtonText: {
    color: Colors.booked,
    fontWeight: "600",
    fontSize: Typography.base,
  },
  refundPendingText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: "center",
  },
  refundDeclinedText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.md,
    lineHeight: 17,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: Colors.textMuted,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    width: "100%",
    alignItems: "center",
    marginTop: Spacing.md,
    minHeight: 44,
    justifyContent: "center",
  },
  cancelButtonText: {
    color: Colors.textMuted,
    fontWeight: "600",
    fontSize: Typography.base,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.xl,
    ...Shadow.md,
  },
  modalTitle: {
    fontSize: Typography.lg,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  modalHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.lg,
    lineHeight: 17,
  },
  modalLabel: {
    fontSize: Typography.sm,
    fontWeight: "600",
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    fontSize: Typography.md,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: Spacing.lg,
  },
  modalActions: { flexDirection: "row", gap: Spacing.sm },
  skeletonBlock: { backgroundColor: Colors.borderLight, shadowOpacity: 0 },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
});
