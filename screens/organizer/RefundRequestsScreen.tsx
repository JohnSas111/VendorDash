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

import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import { confirmAsync, notify } from "@/lib/confirmDialog";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  formatMoney,
  RADIUS,
  shared,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
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

export default function RefundRequestsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();

  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RefundRow | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    const { data } = await supabase
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
  }, [venue]);

  useEffect(() => {
    load();
  }, [load]);

  const denyRequest = async (row: RefundRow) => {
    const confirmed = await confirmAsync(
      "Deny this refund request?",
      `${row.vendorName}'s booking stays paid and active — they'll just see the request was declined.`,
    );
    if (!confirmed) return;

    setProcessingId(row.bookingId);
    const { error } = await supabase
      .from("bookings")
      .update({ refund_requested: false, refund_reason: null })
      .eq("id", row.bookingId);
    setProcessingId(null);

    if (error) {
      notify("Error", error.message);
      return;
    }
    setSelected(null);
    load();
  };

  const confirmRefunded = async (row: RefundRow) => {
    const amountLabel =
      row.amountCents != null
        ? formatMoney(row.amountCents)
        : "an unknown amount";
    const confirmed = await confirmAsync(
      "Confirm refund",
      `Only confirm this AFTER you've processed the ${amountLabel} refund for ${row.vendorName} in the PayMongo dashboard (or manually, if there's no payment record). This just records it here.`,
    );
    if (!confirmed) return;

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
        notify("Error", err.message ?? "Could not reach process-refund.");
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
        notify("Error", error.message);
        setProcessingId(null);
        load();
        return;
      }
    }

    setProcessingId(null);
    setSelected(null);
    load();
  };

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
          <Text style={shared.emptyStateText}>No refund requests pending.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {rows.map((r) => (
            <Pressable
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
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 12,
                      color: COLORS.slate,
                      marginTop: 4,
                      fontStyle: "italic",
                    }}
                  >
                    "{r.reason}"
                  </Text>
                )}
              </View>
              <Text
                style={{
                  fontSize: 12,
                  color: COLORS.inkNavy,
                  fontWeight: "600",
                  marginTop: isDesktop ? 0 : 10,
                }}
              >
                View details →
              </Text>
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
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(22,25,43,0.4)",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          {selected && (
            <View style={[shared.card, { width: "100%", maxWidth: 440 }]}>
              <Text style={shared.rowTitle}>{selected.vendorName}</Text>
              <Text style={shared.rowSubtitle}>
                Stall {selected.stallNumber} · {selected.sessionLabel}
              </Text>
              <Text style={shared.rowSubtitle}>
                Attending: {selected.attendingDays.join(", ") || "—"}
              </Text>
              <Text
                style={[
                  shared.rowSubtitle,
                  { marginTop: 8, fontWeight: "700", color: COLORS.inkNavy },
                ]}
              >
                {selected.amountCents != null
                  ? formatMoney(selected.amountCents)
                  : "Amount unknown — no payment record found"}
              </Text>

              <View
                style={{
                  marginTop: 16,
                  padding: 12,
                  backgroundColor: COLORS.paper,
                  borderRadius: RADIUS.sm,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color: COLORS.slate,
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Reason
                </Text>
                <Text style={{ fontSize: 14, color: COLORS.inkNavy }}>
                  {selected.reason || "No reason given."}
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
                <Pressable
                  style={[
                    shared.dangerOutlineButton,
                    { flex: 1, alignItems: "center" },
                  ]}
                  disabled={processingId === selected.bookingId}
                  onPress={() => denyRequest(selected)}
                >
                  <Text style={shared.dangerOutlineButtonText}>Deny</Text>
                </Pressable>
                <Pressable
                  style={[
                    shared.successButton,
                    { flex: 1, alignItems: "center" },
                  ]}
                  disabled={processingId === selected.bookingId}
                  onPress={() => confirmRefunded(selected)}
                >
                  <Text style={shared.successButtonText}>
                    {processingId === selected.bookingId
                      ? "Processing…"
                      : "Confirm refunded"}
                  </Text>
                </Pressable>
              </View>

              <Pressable
                style={{ marginTop: 12, alignItems: "center" }}
                onPress={() => setSelected(null)}
              >
                <Text style={{ color: COLORS.slate, fontSize: 13 }}>Close</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}
