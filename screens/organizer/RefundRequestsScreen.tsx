// screens/organizer/RefundRequestsScreen.tsx
//
// Manual refund workflow (no PayMongo refund API):
//   Requests         -> organizer rejects (comment required) or approves
//   Awaiting payout  -> vendor shows a valid ID at the organizer's desk,
//                       organizer hands over the money and records it here
//   History          -> rejected and completed refunds
//
// Every action goes through a server function (reject_refund, approve_refund,
// confirm_refund_paid), which checks venue ownership and the current status,
// writes the audit log and notifies the vendor.

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
  statusColors,
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
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

type RefundStatus = "requested" | "approved" | "rejected" | "refunded";

type RefundRow = {
  id: string;
  status: RefundStatus;
  vendorName: string;
  stallNumber: string;
  paidCents: number;
  reason: string;
  decisionComment: string | null;
  refundAmountCents: number | null;
  attendingDays: string[];
  sessionLabel: string;
  createdAt: string;
};

const TABS = [
  { key: "requested", label: "Requests", statuses: ["requested"] },
  { key: "approved", label: "Awaiting payout", statuses: ["approved"] },
  { key: "history", label: "History", statuses: ["rejected", "refunded"] },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const EMPTY_TEXT: Record<TabKey, string> = {
  requested: "No refund requests waiting for a decision.",
  approved: "No approved refunds waiting to be paid out.",
  history: "No completed or rejected refunds yet.",
};

export default function RefundRequestsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();
  const { showToast } = useToast();

  const [tab, setTab] = useState<TabKey>("requested");
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<RefundRow | null>(null);
  const [rejectFor, setRejectFor] = useState<RefundRow | null>(null);
  const [rejectText, setRejectText] = useState("");
  const [approveFor, setApproveFor] = useState<RefundRow | null>(null);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [idChecked, setIdChecked] = useState(false);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    const statuses = [...(TABS.find((t) => t.key === tab)?.statuses ?? [])];

    const { data, error } = await supabase
      .from("refund_requests")
      .select(
        `id, status, reason, decision_comment, refund_amount_cents, created_at,
         bookings!inner(
           attending_days,
           profiles!bookings_vendor_id_fkey(full_name),
           stalls!inner(stall_number, venue_id),
           market_sessions(friday_date, sunday_date),
           payments(amount_cents, status)
         )`,
      )
      .eq("bookings.stalls.venue_id", venue.id)
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      showToast("Couldn't load refund requests.", "error");
    }

    const parsed: RefundRow[] = (data ?? []).map((row: any) => {
      const booking = row.bookings;
      const session = booking?.market_sessions;
      const paidCents = (booking?.payments ?? [])
        .filter((p: any) => p.status === "paid" || p.status === "refunded")
        .reduce((sum: number, p: any) => sum + (p.amount_cents ?? 0), 0);
      return {
        id: row.id,
        status: row.status,
        vendorName: booking?.profiles?.full_name ?? "Unknown vendor",
        stallNumber: booking?.stalls?.stall_number ?? "—",
        paidCents,
        reason: row.reason,
        decisionComment: row.decision_comment,
        refundAmountCents: row.refund_amount_cents,
        attendingDays: booking?.attending_days ?? [],
        sessionLabel: session
          ? `${formatDate(session.friday_date)} – ${formatDate(session.sunday_date)}`
          : "Unknown session",
        createdAt: row.created_at,
      };
    });

    setRows(parsed);
    setLoading(false);
  }, [venue, tab, showToast]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  const openRow = (row: RefundRow) => {
    setPayoutAmount((row.paidCents / 100).toFixed(2));
    setIdChecked(false);
    setSelected(row);
  };

  // Rejecting needs a comment, so the detail modal is closed and a small
  // comment modal takes over (avoids stacking native modals on iOS).
  const startReject = (row: RefundRow) => {
    setSelected(null);
    setRejectText("");
    setRejectFor(row);
  };

  const startApprove = (row: RefundRow) => {
    setSelected(null);
    setApproveFor(row);
  };

  const runReject = async () => {
    if (!rejectFor) return;
    const comment = rejectText.trim();
    if (comment.length < 3) {
      showToast(
        "Add a comment (at least 3 characters) explaining why.",
        "error",
      );
      return;
    }
    const row = rejectFor;
    setRejectFor(null);
    setProcessingId(row.id);
    const { error } = await supabase.rpc("reject_refund", {
      p_request_id: row.id,
      p_comment: comment,
    });
    setProcessingId(null);
    if (error) {
      showToast(error.message || "Couldn't reject that request.", "error");
      load();
      return;
    }
    showToast("Refund request rejected. The vendor has been told why.", "info");
    load();
  };

  const runApprove = async () => {
    if (!approveFor) return;
    const row = approveFor;
    setApproveFor(null);
    setProcessingId(row.id);
    const { error } = await supabase.rpc("approve_refund", {
      p_request_id: row.id,
      p_note: null,
    });
    setProcessingId(null);
    if (error) {
      showToast(error.message || "Couldn't approve that request.", "error");
      load();
      return;
    }
    showToast(
      "Refund approved. The booking is cancelled and the stall is free again.",
      "success",
    );
    load();
  };

  const runPayout = async (row: RefundRow) => {
    const pesos = Number(payoutAmount.replace(/,/g, ""));
    if (!Number.isFinite(pesos) || pesos <= 0) {
      showToast("Enter the refund amount.", "error");
      return;
    }
    const cents = Math.round(pesos * 100);
    if (cents > row.paidCents) {
      showToast(
        `The refund can't be more than the amount paid (${formatMoney(row.paidCents)}).`,
        "error",
      );
      return;
    }
    if (!idChecked) {
      showToast("Confirm that you checked the vendor's valid ID.", "error");
      return;
    }
    setProcessingId(row.id);
    const { error } = await supabase.rpc("confirm_refund_paid", {
      p_request_id: row.id,
      p_amount_cents: cents,
      p_id_verified: true,
    });
    setProcessingId(null);
    if (error) {
      showToast(error.message || "Couldn't record the refund.", "error");
      load();
      return;
    }
    setSelected(null);
    showToast("Refund recorded as paid out.", "success");
    load();
  };

  if (venueError) {
    return (
      <View style={shared.centerFill}>
        <Text style={shared.errorText}>{venueError}</Text>
      </View>
    );
  }

  if (venueLoading) {
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
        Review each request. Approved refunds are paid manually at your desk
        after you check the vendor&apos;s valid ID.
      </Text>

      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <PressableButton
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[shared.secondaryButton, tab === t.key && styles.tabActive]}
          >
            <Text
              style={[
                shared.secondaryButtonText,
                tab === t.key && styles.tabActiveText,
              ]}
            >
              {t.label}
            </Text>
          </PressableButton>
        ))}
      </View>

      {loading ? (
        <RefundListSkeleton rowsOnly />
      ) : rows.length === 0 ? (
        <View style={shared.emptyState}>
          <Ionicons name="cash-outline" size={26} color={COLORS.slate} />
          <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
            {EMPTY_TEXT[tab]}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((r) => {
            const { bg, fg } = statusColors(
              r.status === "refunded" ? "paid" : r.status,
            );
            return (
              <Pressable
                accessibilityRole="button"
                key={r.id}
                onPress={() => openRow(r)}
                style={[shared.row, isDesktop && shared.rowDesktop]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={shared.rowTitle}>{r.vendorName}</Text>
                  <Text style={shared.rowSubtitle}>
                    Stall {r.stallNumber} · paid {formatMoney(r.paidCents)} ·
                    requested {formatDate(r.createdAt)}
                  </Text>
                  <Text numberOfLines={1} style={styles.reasonPreview}>
                    {`"${r.reason}"`}
                  </Text>
                  {tab === "history" && (
                    <View
                      style={[
                        shared.badge,
                        styles.statusBadge,
                        { backgroundColor: bg },
                      ]}
                    >
                      <Text style={[shared.badgeText, { color: fg }]}>
                        {r.status === "refunded"
                          ? `refunded ${formatMoney(r.refundAmountCents ?? 0)}`
                          : r.status}
                      </Text>
                    </View>
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
            );
          })}
        </View>
      )}

      {/* Detail modal: content depends on the request's status */}
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
                Paid: {formatMoney(selected.paidCents)}
              </Text>

              <View style={styles.infoBox}>
                <Text style={styles.infoLabel}>Vendor&apos;s reason</Text>
                <Text style={styles.infoText}>{selected.reason}</Text>
              </View>

              {selected.decisionComment && (
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>Your comment</Text>
                  <Text style={styles.infoText}>
                    {selected.decisionComment}
                  </Text>
                </View>
              )}

              {selected.status === "requested" && (
                <View style={styles.detailActions}>
                  <PressableButton
                    style={[
                      shared.dangerOutlineButton,
                      styles.detailActionButton,
                    ]}
                    disabled={processingId === selected.id}
                    onPress={() => startReject(selected)}
                  >
                    <Text style={shared.dangerOutlineButtonText}>Reject</Text>
                  </PressableButton>
                  <PressableButton
                    style={[shared.successButton, styles.detailActionButton]}
                    disabled={processingId === selected.id}
                    onPress={() => startApprove(selected)}
                  >
                    <Text style={shared.successButtonText}>Approve</Text>
                  </PressableButton>
                </View>
              )}

              {selected.status === "approved" && (
                <View style={{ marginTop: Spacing.lg }}>
                  <Text style={styles.infoLabel}>Refund amount (PHP)</Text>
                  <TextInput
                    accessibilityLabel="Refund amount in pesos"
                    style={[shared.input, { marginTop: Spacing.xs }]}
                    value={payoutAmount}
                    onChangeText={setPayoutAmount}
                    keyboardType="decimal-pad"
                  />
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: idChecked }}
                    onPress={() => setIdChecked((v) => !v)}
                    style={styles.checkRow}
                  >
                    <Ionicons
                      name={idChecked ? "checkbox" : "square-outline"}
                      size={22}
                      color={COLORS.inkNavy}
                    />
                    <Text style={styles.checkText}>
                      I checked the vendor&apos;s valid ID and handed over the
                      refund.
                    </Text>
                  </Pressable>
                  <PressableButton
                    style={[
                      shared.successButton,
                      styles.detailActionButton,
                      { marginTop: Spacing.md, opacity: idChecked ? 1 : 0.5 },
                    ]}
                    disabled={processingId === selected.id}
                    onPress={() => runPayout(selected)}
                  >
                    <Text style={shared.successButtonText}>
                      {processingId === selected.id
                        ? "Recording…"
                        : "Record refund paid"}
                    </Text>
                  </PressableButton>
                </View>
              )}

              {selected.status === "refunded" && (
                <Text style={styles.detailAmount}>
                  Refunded: {formatMoney(selected.refundAmountCents ?? 0)}
                </Text>
              )}

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

      {/* Reject: a comment is required (also enforced by the database) */}
      <Modal
        visible={!!rejectFor}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[shared.card, styles.detailCard]}>
            <Text style={shared.rowTitle}>Reject this refund request?</Text>
            <Text style={[shared.rowSubtitle, { marginVertical: Spacing.sm }]}>
              {rejectFor
                ? `${rejectFor.vendorName} will see your comment, and the booking stays paid.`
                : ""}
            </Text>
            <TextInput
              accessibilityLabel="Reason for rejecting"
              style={[shared.input, styles.commentInput]}
              placeholder="Why is this being rejected?"
              value={rejectText}
              onChangeText={setRejectText}
              multiline
              maxLength={500}
            />
            <View style={styles.detailActions}>
              <PressableButton
                style={[shared.secondaryButton, styles.detailActionButton]}
                onPress={() => setRejectFor(null)}
              >
                <Text style={shared.secondaryButtonText}>Go back</Text>
              </PressableButton>
              <PressableButton
                style={[shared.dangerOutlineButton, styles.detailActionButton]}
                onPress={runReject}
              >
                <Text style={shared.dangerOutlineButtonText}>Reject</Text>
              </PressableButton>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={!!approveFor}
        title="Approve this refund?"
        message={
          approveFor
            ? `${approveFor.vendorName}'s booking for stall ${approveFor.stallNumber} will be cancelled and the stall released. They must show a valid ID to you to receive the refund.`
            : ""
        }
        confirmLabel="Approve refund"
        cancelLabel="Go back"
        destructive={false}
        onConfirm={runApprove}
        onDismiss={() => setApproveFor(null)}
      />
    </ScrollView>
  );
}

// Placeholder rows shown while the request list is loading.
function RefundListSkeleton({ rowsOnly = false }: { rowsOnly?: boolean }) {
  return (
    <View>
      {!rowsOnly && (
        <>
          <View
            style={[
              styles.skeletonLine,
              { width: 170, height: 22, marginBottom: Spacing.sm },
            ]}
          />
          <View
            style={[
              styles.skeletonLine,
              { width: 260, marginBottom: Spacing.lg },
            ]}
          />
        </>
      )}
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
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  tabActive: { backgroundColor: COLORS.inkNavy },
  tabActiveText: { color: COLORS.white },
  reasonPreview: {
    fontSize: Typography.sm,
    color: COLORS.slate,
    marginTop: Spacing.xs,
    fontStyle: "italic",
  },
  statusBadge: { marginTop: Spacing.sm },
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
  infoBox: {
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: COLORS.paper,
    borderRadius: RADIUS.sm,
  },
  infoLabel: {
    fontSize: Typography.xs,
    fontWeight: "700",
    color: COLORS.slate,
    textTransform: "uppercase",
    marginBottom: Spacing.xs,
  },
  infoText: { fontSize: Typography.md, color: COLORS.inkNavy },
  detailActions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  detailActionButton: { flex: 1, alignItems: "center" },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  checkText: { flex: 1, fontSize: Typography.base, color: COLORS.inkNavy },
  commentInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  closeRow: {
    marginTop: Spacing.md,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  closeText: { color: COLORS.slate, fontSize: Typography.base },
});
