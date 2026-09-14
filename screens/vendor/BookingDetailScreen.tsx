import { StatusBadge } from "@/components/StatusBadge";
import { Colors, Radius } from "@/constants/theme";
import { confirmAsync, notify } from "@/lib/confirmDialog";
import { supabase } from "@/lib/supabase";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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

export default function BookingDetailScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingRecurring, setSavingRecurring] = useState(false);
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    async function load() {
      if (!bookingId) return;
      const { data } = await supabase
        .from("bookings")
        .select(
          "id, status, attending_days, is_recurring, refund_requested, refund_reason, stalls(stall_number, price_per_day_cents), market_sessions(friday_date, sunday_date)",
        )
        .eq("id", bookingId)
        .single();
      setBooking(data as unknown as BookingDetail);
      setLoading(false);
    }
    load();
  }, [bookingId]);

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
      notify("Could not update", error?.message ?? "Please try again.");
    }
  }

  function handleRequestRefund() {
    setRefundReason("");
    setRefundModalOpen(true);
  }

  async function submitRefundRequest() {
    if (!booking) return;

    if (refundReason.trim().length < 3) {
      notify(
        "Tell us why",
        "Please add a short reason so the organizer knows what happened.",
      );
      return;
    }

    setRequestingRefund(true);
    const { data: updated, error } = await supabase
      .from("bookings")
      .update({ refund_requested: true, refund_reason: refundReason.trim() })
      .eq("id", booking.id)
      .select();
    setRequestingRefund(false);

    if (error) {
      notify("Couldn't send request", error.message);
      return;
    }
    if (!updated || updated.length === 0) {
      notify(
        "Couldn't send request",
        "The update didn't go through — this usually means a permissions rule is blocking it. Nothing was saved.",
      );
      return;
    }

    setBooking({
      ...booking,
      refund_requested: true,
      refund_reason: refundReason.trim(),
    });
    setRefundModalOpen(false);
    notify(
      "Refund requested",
      "The organizer has been notified and will process it manually.",
    );
  }

  async function handleCancelReservation() {
    if (!booking) return;

    const confirmed = await confirmAsync(
      "Cancel this reservation?",
      "This frees up the stall for someone else. You haven't paid yet, so there's nothing to refund.",
    );
    if (!confirmed) return;

    setCancelling(true);
    const { data: updated, error } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id)
      .select();
    setCancelling(false);

    if (error) {
      notify("Couldn't cancel", error.message);
      return;
    }
    if (!updated || updated.length === 0) {
      notify(
        "Couldn't cancel",
        "The update didn't go through — this usually means a permissions rule is blocking it. Nothing was saved.",
      );
      return;
    }

    notify("Reservation cancelled", "The stall is now available again.");
    router.back();
  }

  // NEW: takes the vendor from "approved" straight into Payment, now
  // that reserving no longer goes there automatically.
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

  if (loading || !booking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  const dateLabel = booking.market_sessions
    ? `${new Date(booking.market_sessions.friday_date).toLocaleDateString(
        "en-US",
        {
          month: "short",
          day: "numeric",
        },
      )}–${new Date(booking.market_sessions.sunday_date).getDate()}`
    : "Date unavailable";

  const isCheckedIn = booking.status === "checked_in";
  const canShowQR = booking.status === "paid" || isCheckedIn;
  const canToggleRecurring =
    booking.status === "paid" || booking.status === "checked_in";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Stall {booking.stalls?.stall_number ?? "—"}
      </Text>
      <Text style={styles.subtitle}>{dateLabel}</Text>
      <View style={styles.badgeWrap}>
        <StatusBadge status={booking.status} />
      </View>

      {/* NEW: three-way status card, replacing the old paid/not-paid
          split — pending vs approved now need genuinely different
          messaging and actions, not just "no QR yet." */}
      {booking.status === "pending" && (
        <View style={styles.pendingCard}>
          <Text style={styles.pendingText}>
            Waiting on the organizer to approve this reservation. You'll be
            notified once they do — you'll then have 15 minutes to pay before it
            expires.
          </Text>
        </View>
      )}

      {booking.status === "approved" && (
        <View style={styles.approvedCard}>
          <Text style={styles.approvedText}>
            You're approved! Pay now to lock in this stall.
          </Text>
          <Pressable style={styles.payButton} onPress={handleContinueToPayment}>
            <Text style={styles.payButtonText}>Continue to payment</Text>
          </Pressable>
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
          onPress={handleCancelReservation}
          disabled={cancelling}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelButtonText}>
            {cancelling ? "Cancelling…" : "Cancel reservation"}
          </Text>
        </Pressable>
      )}

      {booking.status === "paid" && (
        <View style={styles.refundCard}>
          {booking.refund_requested ? (
            <Text style={styles.refundPendingText}>
              Refund requested — waiting on the organizer to process it.
            </Text>
          ) : (
            <Pressable
              onPress={handleRequestRefund}
              style={styles.refundButton}
            >
              <Text style={styles.refundButtonText}>Request a refund</Text>
            </Pressable>
          )}
        </View>
      )}

      <Modal
        visible={refundModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRefundModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Request a refund</Text>
            <Text style={styles.modalHint}>
              The organizer will review this and process your refund manually —
              this doesn't cancel your stall automatically.
            </Text>
            <Text style={styles.modalLabel}>Reason</Text>
            <TextInput
              style={styles.modalInput}
              value={refundReason}
              onChangeText={setRefundReason}
              placeholder="e.g. Can't make it this weekend, family emergency"
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setRefundModalOpen(false)}
                disabled={requestingRefund}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalSubmitButton}
                onPress={submitRefundRequest}
                disabled={requestingRefund}
              >
                <Text style={styles.modalSubmitButtonText}>
                  {requestingRefund ? "Sending…" : "Submit request"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 24,
    paddingTop: 20,
    alignItems: "center",
  },
  title: { fontSize: 20, fontWeight: "bold" },
  subtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  badgeWrap: { marginTop: 10, marginBottom: 24 },
  qrCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
  },
  qrDimmed: { opacity: 0.4 },
  qrHint: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 12,
    textAlign: "center",
  },
  pendingCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 20,
    marginBottom: 20,
    width: "100%",
  },
  pendingText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },
  approvedCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 20,
    marginBottom: 20,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.available,
  },
  approvedText: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 14,
    textAlign: "center",
  },
  payButton: {
    backgroundColor: Colors.available,
    borderRadius: Radius.sm,
    paddingVertical: 14,
    width: "100%",
    alignItems: "center",
  },
  payButtonText: { color: Colors.white, fontWeight: "700", fontSize: 14 },
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    width: "100%",
  },
  infoLabel: { fontSize: 11, color: Colors.textMuted },
  infoValue: { fontSize: 14, fontWeight: "500", marginTop: 2 },
  recurringCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    width: "100%",
    marginTop: 12,
  },
  recurringTextWrap: { flex: 1, marginRight: 12 },
  recurringLabel: { fontSize: 13, fontWeight: "500" },
  recurringHint: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  refundCard: { width: "100%", marginTop: 12, alignItems: "center" },
  refundButton: {
    borderWidth: 1,
    borderColor: Colors.booked,
    borderRadius: Radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 20,
    width: "100%",
    alignItems: "center",
  },
  refundButtonText: { color: Colors.booked, fontWeight: "600", fontSize: 13 },
  refundPendingText: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: Colors.textMuted,
    borderRadius: Radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 20,
    width: "100%",
    alignItems: "center",
    marginTop: 12,
  },
  cancelButtonText: {
    color: Colors.textMuted,
    fontWeight: "600",
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: "700", marginBottom: 6 },
  modalHint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 16,
    lineHeight: 17,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textMuted,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  modalActions: { flexDirection: "row", gap: 10 },
  modalCancelButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCancelButtonText: {
    fontWeight: "600",
    fontSize: 13,
    color: Colors.text,
  },
  modalSubmitButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: Radius.sm,
    backgroundColor: Colors.text,
  },
  modalSubmitButtonText: {
    fontWeight: "600",
    fontSize: 13,
    color: Colors.white,
  },
});
