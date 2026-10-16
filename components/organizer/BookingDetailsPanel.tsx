// components/organizer/BookingDetailsPanel.tsx
//
// The "who booked and how did they pay" panel, shared by the Bookings and
// Payments screens. Everything it shows is worked out in lib/bookingDetails.ts.

import { PressableButton } from "@/components/PressableButton";
import { Spacing } from "@/constants/theme";
import {
  type BookingDetail,
  bookingStatusLabel,
  breakdown,
  daysShort,
  formatDateTime,
  PAYMENT_KIND_LABEL,
  paymentSummary,
  refundSummary,
  shortRef,
  timeline,
} from "@/lib/bookingDetails";
import {
  COLORS,
  formatMoney,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  detail: BookingDetail;
  onNavigate: (href: string) => void;
  onClose?: () => void;
};

export function BookingDetailsPanel({ detail, onNavigate, onClose }: Props) {
  const { bg, fg } = statusColors(detail.status);
  const money = breakdown(detail);
  const pay = paymentSummary(detail);
  const refund = refundSummary(detail);
  const steps = timeline(detail);
  const [showHistory, setShowHistory] = useState(false);
  const showOwner =
    detail.owner_name && detail.owner_name !== detail.vendor_name;

  return (
    <View style={styles.wrap}>
      {onClose && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the booking details"
          onPress={onClose}
          style={styles.back}
        >
          <Ionicons name="close" size={14} color={COLORS.slate} />
          <Text style={styles.backText}>Close</Text>
        </Pressable>
      )}

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={shared.rowTitle}>{detail.vendor_name}</Text>
          {showOwner && (
            <Text style={shared.rowSubtitle}>{detail.owner_name}</Text>
          )}
        </View>
        <View style={[shared.badge, { backgroundColor: bg }]}>
          <Text style={[shared.badgeText, { color: fg }]}>
            {bookingStatusLabel(detail.status)}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.verify,
          {
            backgroundColor: detail.vendor_verified
              ? COLORS.tintGreen
              : COLORS.tintAmber,
          },
        ]}
      >
        <Ionicons
          name={detail.vendor_verified ? "shield-checkmark" : "time"}
          size={12}
          color={detail.vendor_verified ? COLORS.tealText : COLORS.amberText}
        />
        <Text
          style={[
            styles.verifyText,
            {
              color: detail.vendor_verified
                ? COLORS.tealText
                : COLORS.amberText,
            },
          ]}
        >
          {detail.vendor_verified ? "Verified" : "Not verified yet"}
        </Text>
      </View>

      <Section title="Booking">
        <Row label="Stall" value={detail.stall_number} />
        <Row label="Days" value={daysShort(detail.attending_days) || "—"} />
        <Row label="Phone" value={detail.phone ?? "Not given"} />
      </Section>

      <Section title="Payment">
        {money.totalCents > 0 ? (
          <>
            <Row
              label={
                money.perDayCents != null
                  ? `Stall ${detail.stall_number}: ${formatMoney(money.perDayCents)} × ${money.days} day${money.days === 1 ? "" : "s"}`
                  : `Stall ${detail.stall_number}`
              }
              value={formatMoney(money.stallCents)}
            />
            <Row label="Service fee" value={formatMoney(money.feeCents)} />
            <View style={styles.divider} />
            <Row
              strong
              label={money.isActual ? "Total paid" : "Total to pay"}
              value={formatMoney(money.totalCents)}
            />
          </>
        ) : (
          <Text style={shared.rowSubtitle}>
            This stall has no price set, so there is no amount to show.
          </Text>
        )}
        {pay ? (
          <>
            <Row label="Status" value={PAYMENT_KIND_LABEL[pay.kind]} />
            {(pay.kind === "paid" || pay.kind === "refunded") && (
              <>
                <Row label="Paid with" value={pay.method} />
                <Row
                  label="Paid on"
                  value={formatDateTime(
                    pay.paidAt,
                    detail.timezone ?? undefined,
                  )}
                />
              </>
            )}
            {pay.kind === "waiting" && detail.payment_due_at && (
              <Row
                label="Pay by"
                value={formatDateTime(
                  detail.payment_due_at,
                  detail.timezone ?? undefined,
                )}
              />
            )}
            {pay.reference && (
              <Row label="Reference" value={shortRef(pay.reference)} />
            )}
          </>
        ) : (
          <Text style={shared.rowSubtitle}>No payment yet.</Text>
        )}
      </Section>

      {refund && (
        <Section title="Refund">
          <Row label="Status" value={refund.label} />
          {refund.amountCents != null && (
            <Row label="Amount" value={formatMoney(refund.amountCents)} />
          )}
        </Section>
      )}

      {/* The timeline is secondary, so it stays closed until asked for. */}
      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showHistory }}
          accessibilityLabel={
            showHistory
              ? "Hide the booking history"
              : "Show the booking history"
          }
          onPress={() => setShowHistory((v) => !v)}
          style={styles.historyToggle}
        >
          <Text style={styles.sectionLabel}>History</Text>
          <Ionicons
            name={showHistory ? "chevron-up" : "chevron-down"}
            size={14}
            color={COLORS.slate}
          />
        </Pressable>
        {showHistory &&
          steps.map((s) => (
            <View key={s.key} style={styles.step}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: s.done ? COLORS.teal : COLORS.border },
                ]}
              />
              <Text style={[styles.stepLabel, !s.done && styles.stepLater]}>
                {s.label}
              </Text>
              <Text style={styles.stepTime}>
                {s.at
                  ? formatDateTime(s.at, detail.timezone ?? undefined)
                  : s.done
                    ? ""
                    : "Not yet"}
              </Text>
            </View>
          ))}
      </View>

      {(detail.status === "paid" || detail.status === "checked_in") && (
        <PressableButton
          style={[shared.primaryButton, styles.action]}
          onPress={() => onNavigate("/check-in")}
        >
          <Text style={shared.primaryButtonText}>Go to Check-In</Text>
        </PressableButton>
      )}
      {(refund || pay?.kind === "paid") && (
        <PressableButton
          style={[shared.secondaryButton, styles.action]}
          onPress={() => onNavigate("/refund-requests")}
        >
          <Text style={shared.secondaryButtonText}>Open Refunds</Text>
        </PressableButton>
      )}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
  },
  backText: { fontSize: 12, color: COLORS.slate },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.md },
  verify: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  verifyText: { fontSize: 12, fontWeight: "600" },
  section: { gap: Spacing.sm },
  historyToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 32,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.slate,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  rowLabel: { fontSize: 13, color: COLORS.slate, flexShrink: 1 },
  rowValue: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.inkNavy,
    flexShrink: 1,
    textAlign: "right",
  },
  rowStrong: { fontSize: 15, fontWeight: "700", color: COLORS.inkNavy },
  divider: { height: 1, backgroundColor: COLORS.hairline },
  step: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  stepLabel: { flex: 1, fontSize: 13, color: COLORS.inkNavy },
  stepLater: { color: COLORS.slate },
  stepTime: { fontSize: 12, color: COLORS.slate },
  action: { alignSelf: "stretch" },
});
