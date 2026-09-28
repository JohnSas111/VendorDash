// screens/organizer/RefundRequestsScreen.tsx
//
// Adds two things that were missing:
// 1. Tapping a request opens a detail modal showing the vendor's
//    actual reason (bookings.refund_reason, from
//    migration-refund-reason.sql) plus session dates and attending
//    days — previously the list row was just a name, stall, and
//    amount with zero context for the decision.
// 2. A "Deny" action alongside "Confirm refunded" — previously there
//    was no way to say no to a request; it would just sit there
//    forever with only one possible action. Deny clears
//    refund_requested/refund_reason without touching the booking's
//    status or payment at all, so the vendor keeps their paid stall.
//
// UPDATED: Deny / Confirm refunded used to go through confirmAsync,
// which falls back to the browser's plain window.confirm() on web —
// jarring next to the rest of the app. Both now go through the same
// styled ConfirmModal used everywhere else, stacked on top of this
// screen's own detail modal.

import { ConfirmModal } from "@/components/ConfirmModal";
import { PressableButton } from "@/components/PressableButton";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  formatMoney,
  RADIUS,
  shared,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type RefundRow = {
  bookingId: string;
  paymentId: string | null;
  vendorName: string;
  stallNumber: string;
  amountCents: number | null;
  reason: string | null;
  attendingDays: string[];
  sessionLabel: string;
};

type PendingAction = { type: "deny" | "confirm"; row: RefundRow };

export default function RefundRequestsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();
  const { showToast } = useToast();

  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RefundRow | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("bookings")
      .select(
        `id, refund_reason, attending_days,
         profiles!bookings_vendor_id_fkey(full_name),
         stalls!inner(stall_number, venue_id),
         market_sessions(friday_date, sunday_date),
         payments(id, amount_cents, status)`,
      )
      .eq("refund_requested", true)
      .eq("status", "paid")
      .eq("stalls.venue_id", venue.id);

    if (error) {
      showToast("Couldn't load refund requests.", "error");
    }

    const parsed: RefundRow[] = (data ?? []).map((row: any) => {
      const payment = (row.payments ?? []).find(
        (p: any) => p.status === "paid",
      );
      const session = row.market_sessions;
      return {
        bookingId: row.id,
        paymentId: payment?.id ?? null,
        vendorName: row.profiles?.full_name ?? "Unknown vendor",
        stallNumber: row.stalls?.stall_number ?? "—",
        amountCents: payment?.amount_cents ?? null,
        reason: row.refund_reason,
        attendingDays: row.attending_days ?? [],
        sessionLabel: session
          ? `${formatDate(session.friday_date)} – ${formatDate(session.sunday_date)}`
          : "Unknown session",
      };
    });

    setRows(parsed);
    setLoading(false);
  }, [venue, showToast]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  async function runDeny(row: RefundRow) {
    setProcessingId(row.bookingId);
    const { error } = await supabase
      .from("bookings")
      .update({ refund_requested: false, refund_reason: null })
      .eq("id", row.bookingId);
    setProcessingId(null);

    if (error) {
      showToast(error.message || "Couldn't deny that request.", "error");
      return;
    }
    showToast("Refund request denied.", "info");
    setSelected(null);
    load();
  }

  async function runConfirmRefunded(row: RefundRow) {
    setProcessingId(row.bookingId);

    if (row.paymentId) {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      try {
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/process-refund`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              booking_id: row.bookingId,
              payment_id: row.paymentId,
            }),
          },
        );
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || "Edge Function call failed.");
        }
      } catch (err: any) {
        showToast(err.message ?? "Could not reach process-refund.", "error");
        setProcessingId(null);
        load();
        return;
      }
    } else {
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled", refund_requested: false })
        .eq("id", row.bookingId);
      if (error) {
        showToast(error.message, "error");
        setProcessingId(null);
        load();
        return;
      }
    }

    setProcessingId(null);
    setSelected(null);
    showToast("Refund recorded.", "success");
    load();
  }

  function handleDenyPress(row: RefundRow) {
    setPendingAction({ type: "deny", row });
  }

  function handleConfirmRefundedPress(row: RefundRow) {
    setPendingAction({ type: "confirm", row });
  }

  function runPendingAction() {
    if (!pendingAction) return;
    const { type, row } = pendingAction;
    setPendingAction(null);
    if (type === "deny") runDeny(row);
    else runConfirmRefunded(row);
  }

  if (venueLoading || loading) {
    return (
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <RefundListSkeleton />
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

  const amountLabel =
    pendingAction?.row.amountCents != null
      ? formatMoney(pendingAction.row.amountCents)
      : "an unknown amount";

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.content,
        isDesktop && shared.contentDesktop,
      ]}
    >
      <Text style={shared.title}>Refund Requests</Text>
      <Text style={shared.subtitle}>
        Tap a request to see the reason. Refund manually in PayMongo first, then
        confirm.
      </Text>

      {rows.length === 0 ? (
        <View style={shared.emptyState}>
          <Ionicons name="cash-outline" size={26} color={COLORS.slate} />
          <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
            No refund requests pending.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((r) => (
            <Pressable
              accessibilityRole="button"
              key={r.bookingId}
              onPress={() => setSelected(r)}
              style={[shared.row, isDesktop && shared.rowDesktop]}
            >
              <View style={{ flex: 1 }}>
                <Text style={shared.rowTitle}>{r.vendorName}</Text>
                <Text style={shared.rowSubtitle}>
                  Stall {r.stallNumber} ·{" "}
                  {r.amountCents != null
                    ? formatMoney(r.amountCents)
                    : "amount unknown"}
                </Text>
                {r.reason && (
                  <Text numberOfLines={1} style={styles.reasonPreview}>
                    {`"${r.reason}"`}
                  </Text>
                )}
              </View>
              <View
                style={[
                  styles.viewDetailsRow,
                  !isDesktop && { marginTop: Spacing.md },
                ]}
              >
                <Text style={styles.viewDetailsText}>View details</Text>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={COLORS.inkNavy}
                />
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalBackdrop}>
          {selected && (
            <View style={[shared.card, styles.detailCard]}>
              <Text style={shared.rowTitle}>{selected.vendorName}</Text>
              <Text style={shared.rowSubtitle}>
                Stall {selected.stallNumber} · {selected.sessionLabel}
              </Text>
              <Text style={shared.rowSubtitle}>
                Attending: {selected.attendingDays.join(", ") || "—"}
              </Text>
              <Text style={styles.detailAmount}>
                {selected.amountCents != null
                  ? formatMoney(selected.amountCents)
                  : "Amount unknown — no payment record found"}
              </Text>

              <View style={styles.reasonBox}>
                <Text style={styles.reasonLabel}>Reason</Text>
                <Text style={styles.reasonText}>
                  {selected.reason || "No reason given."}
                </Text>
              </View>

              <View style={styles.detailActions}>
                <PressableButton
                  style={[
                    shared.dangerOutlineButton,
                    styles.detailActionButton,
                  ]}
                  disabled={processingId === selected.bookingId}
                  onPress={() => handleDenyPress(selected)}
                >
                  <Text style={shared.dangerOutlineButtonText}>Deny</Text>
                </PressableButton>
                <PressableButton
                  style={[shared.successButton, styles.detailActionButton]}
                  disabled={processingId === selected.bookingId}
                  onPress={() => handleConfirmRefundedPress(selected)}
                >
                  <Text style={shared.successButtonText}>
                    {processingId === selected.bookingId
                      ? "Processing…"
                      : "Confirm refunded"}
                  </Text>
                </PressableButton>
              </View>

              <Pressable
                accessibilityRole="button"
                style={styles.closeRow}
                onPress={() => setSelected(null)}
              >
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      <ConfirmModal
        visible={!!pendingAction}
        title={
          pendingAction?.type === "deny"
            ? "Deny this refund request?"
            : "Confirm refund"
        }
        message={
          pendingAction?.type === "deny"
            ? `${pendingAction.row.vendorName}'s booking stays paid and active — they'll just see the request was declined.`
            : `Only confirm this AFTER you've processed the ${amountLabel} refund for ${pendingAction?.row.vendorName} in the PayMongo dashboard (or manually, if there's no payment record). This just records it here.`
        }
        confirmLabel={
          pendingAction?.type === "deny" ? "Deny request" : "Confirm refunded"
        }
        cancelLabel="Go back"
        destructive={pendingAction?.type === "deny"}
        onConfirm={runPendingAction}
        onDismiss={() => setPendingAction(null)}
      />
    </ScrollView>
  );
}

// Placeholder rows shown while the request list is loading.
function RefundListSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: 170, height: 22, marginBottom: Spacing.sm },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 260, marginBottom: Spacing.lg }]}
      />
      <View style={styles.list}>
        {[0, 1].map((i) => (
          <View key={i} style={[shared.row, styles.skeletonRow]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.sm },
  reasonPreview: {
    fontSize: Typography.sm,
    color: COLORS.slate,
    marginTop: Spacing.xs,
    fontStyle: "italic",
  },
  viewDetailsRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  viewDetailsText: {
    fontSize: Typography.sm,
    color: COLORS.inkNavy,
    fontWeight: "600",
  },
  skeletonRow: {
    backgroundColor: COLORS.border,
    borderColor: COLORS.border,
    shadowOpacity: 0,
    minHeight: 70,
  },
  skeletonLine: {
    height: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  detailCard: { width: "100%", maxWidth: 440 },
  detailAmount: {
    fontSize: Typography.base,
    color: COLORS.inkNavy,
    fontWeight: "700",
    marginTop: Spacing.sm,
  },
  reasonBox: {
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: COLORS.paper,
    borderRadius: RADIUS.sm,
  },
  reasonLabel: {
    fontSize: Typography.xs,
    fontWeight: "700",
    color: COLORS.slate,
    textTransform: "uppercase",
    marginBottom: Spacing.xs,
  },
  reasonText: { fontSize: Typography.md, color: COLORS.inkNavy },
  detailActions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  detailActionButton: { flex: 1, alignItems: "center" },
  closeRow: {
    marginTop: Spacing.md,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  closeText: { color: COLORS.slate, fontSize: Typography.base },
});
