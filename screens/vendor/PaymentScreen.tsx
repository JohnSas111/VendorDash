import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SERVICE_FEE_CENTS = 400; // ₱4 flat

type PaymentMethod = "gcash" | "paymaya";

// UNCHANGED: payment status polling logic — not touched by this pass.
async function waitForPaymentStatus(
  bookingId: string,
  attempts = 6,
  delayMs = 2000,
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const { data } = await supabase
      .from("payments")
      .select("status")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (data?.status === "paid" || data?.status === "failed") {
      return data.status;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

export default function PaymentScreen() {
  const { bookingId, amount } = useLocalSearchParams<{
    bookingId: string;
    amount: string;
  }>();
  const [method, setMethod] = useState<PaymentMethod>("gcash");
  const [processing, setProcessing] = useState(false);
  const [checking, setChecking] = useState(false);

  const { showToast } = useToast();

  const stallTotal = amount ? parseInt(amount, 10) : 0;
  const total = stallTotal + SERVICE_FEE_CENTS;

  const insets = useSafeAreaInsets();

  // UNCHANGED control flow: invoke create-payment → open checkout →
  // poll status → route. Only the three Alert.alert() calls became
  // toasts — nothing about when they fire or what happens after changed.
  async function handlePay() {
    if (!bookingId) return;
    setProcessing(true);

    // The server works out the amount itself (price x days + fee). The total
    // shown above is only a preview and is NOT sent.
    const { data, error } = await supabase.functions.invoke("create-payment", {
      body: { bookingId, method },
    });

    if (error || !data?.checkoutUrl) {
      setProcessing(false);
      // data.error carries the server's reason (for example "The payment
      // deadline for this booking has passed."); error is a network failure.
      showToast(
        data?.error ??
          error?.message ??
          "Payment setup failed. Please try again.",
        "error",
      );
      return;
    }

    await WebBrowser.openBrowserAsync(data.checkoutUrl);
    setProcessing(false);

    setChecking(true);
    const status = await waitForPaymentStatus(bookingId);
    setChecking(false);

    if (status === "paid") {
      router.replace("/(vendor)/confirmation");
    } else if (status === "failed") {
      showToast("The payment did not go through. Please try again.", "error");
    } else {
      showToast(
        "Still confirming — check My Bookings in a moment if you already paid.",
        "info",
      );
      router.replace("/(vendor)/(tabs)/my-bookings");
    }
  }

  const methods: { key: PaymentMethod; label: string }[] = [
    { key: "gcash", label: "GCash" },
    { key: "paymaya", label: "Maya" },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.md }]}>
      <Text style={styles.title}>Payment</Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Stall booking</Text>
          <Text style={styles.summaryValue}>
            ₱{(stallTotal / 100).toLocaleString()}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Service fee</Text>
          <Text style={styles.summaryValue}>
            ₱{(SERVICE_FEE_CENTS / 100).toLocaleString()}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            ₱{(total / 100).toLocaleString()}
          </Text>
        </View>
      </View>

      <Text style={styles.label}>Pay with</Text>
      {methods.map((m) => {
        const selected = method === m.key;
        return (
          <TouchableOpacity
            key={m.key}
            style={[styles.methodBox, selected && styles.methodBoxSelected]}
            onPress={() => setMethod(m.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <Ionicons
              name="wallet-outline"
              size={18}
              color={selected ? Colors.info : Colors.textMuted}
            />
            <Text style={styles.methodText}>{m.label}</Text>
            <Ionicons
              name={selected ? "radio-button-on" : "radio-button-off"}
              size={18}
              color={selected ? Colors.info : Colors.border}
              style={styles.methodRadio}
            />
          </TouchableOpacity>
        );
      })}

      <View style={styles.buttonWrap}>
        <PrimaryButton
          label={
            checking
              ? "Confirming payment..."
              : `Pay ₱${(total / 100).toLocaleString()}`
          }
          onPress={handlePay}
          loading={processing || checking}
        />
      </View>
      <Text style={styles.note}>Test mode · PayMongo sandbox</Text>
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
    padding: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  title: {
    fontSize: Typography.md,
    fontWeight: "500",
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  summaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    ...Shadow.sm,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  summaryLabel: { fontSize: Typography.base, color: Colors.textMuted },
  summaryValue: { fontSize: Typography.base, color: Colors.textMuted },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: Spacing.xs,
  },
  totalLabel: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: Colors.text,
  },
  totalValue: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: Colors.text,
  },
  label: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  methodBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    minHeight: 44,
    backgroundColor: Colors.white,
  },
  methodBoxSelected: {
    borderColor: Colors.info,
    borderWidth: 2,
    backgroundColor: Colors.infoLight,
  },
  methodText: { fontSize: Typography.base, color: Colors.text, flex: 1 },
  methodRadio: { marginLeft: "auto" },
  buttonWrap: { marginTop: Spacing.sm },
  note: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
});
