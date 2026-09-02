import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SERVICE_FEE_CENTS = 400; // ₱4 flat

type PaymentMethod = "gcash" | "paymaya";

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

  const stallTotal = amount ? parseInt(amount, 10) : 0;
  const total = stallTotal + SERVICE_FEE_CENTS;

  const insets = useSafeAreaInsets();

  async function handlePay() {
    if (!bookingId) return;
    setProcessing(true);

    const { data, error } = await supabase.functions.invoke("create-payment", {
      body: { bookingId, amountCents: total, method },
    });

    if (error || !data?.checkoutUrl) {
      setProcessing(false);
      Alert.alert(
        "Payment setup failed",
        error?.message ?? "Please try again.",
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
      Alert.alert(
        "Payment failed",
        "The payment did not go through. Please try again.",
      );
    } else {
      Alert.alert(
        "Still confirming",
        "We haven't received confirmation yet. If you completed the payment, check My Bookings in a moment — it may just be catching up.",
      );
      router.replace("/(vendor)/my-bookings");
    }
  }

  const methods: { key: PaymentMethod; label: string }[] = [
    { key: "gcash", label: "GCash" },
    { key: "paymaya", label: "Maya" },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
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
      {methods.map((m) => (
        <TouchableOpacity
          key={m.key}
          style={[
            styles.methodBox,
            method === m.key && styles.methodBoxSelected,
          ]}
          onPress={() => setMethod(m.key)}
        >
          <Text style={styles.methodText}>{m.label}</Text>
        </TouchableOpacity>
      ))}

      <PrimaryButton
        label={
          checking
            ? "Confirming payment..."
            : `Pay ₱${(total / 100).toLocaleString()}`
        }
        onPress={handlePay}
        loading={processing || checking}
      />
      <Text style={styles.note}>Test mode · PayMongo sandbox</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 20,
    paddingTop: 20,
  },
  title: { fontSize: 16, fontWeight: "500", marginBottom: 16 },
  summaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  summaryLabel: { fontSize: 13, color: Colors.textMuted },
  summaryValue: { fontSize: 13, color: Colors.textMuted },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 6,
  },
  totalLabel: { fontSize: 14, fontWeight: "600" },
  totalValue: { fontSize: 14, fontWeight: "600" },
  label: { fontSize: 12, color: Colors.textMuted, marginBottom: 8 },
  methodBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    padding: 12,
    marginBottom: 8,
  },
  methodBoxSelected: {
    borderColor: Colors.info,
    borderWidth: 2,
    backgroundColor: Colors.infoLight,
  },
  methodText: { fontSize: 13 },
  note: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 8,
  },
});
