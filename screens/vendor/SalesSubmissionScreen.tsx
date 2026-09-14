import { InputField } from "@/components/InputField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { pickAndUploadImage } from "@/lib/upload";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export default function SalesSubmissionScreen() {
  const { bookingId, stallNumber, dateLabel } = useLocalSearchParams<{
    bookingId: string;
    stallNumber?: string;
    dateLabel?: string;
  }>();

  const [checkingExisting, setCheckingExisting] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  const [grossSales, setGrossSales] = useState("");
  const [itemsSold, setItemsSold] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  // FIX: was possible to submit sales more than once for the same
  // booking, silently double-counting totals in the organizer's Sales
  // Reports. Now checks for an existing submission first and, if
  // found, pre-fills the form and switches to update mode.
  useEffect(() => {
    async function loadExisting() {
      if (!bookingId) {
        setCheckingExisting(false);
        return;
      }
      const { data } = await supabase
        .from("sales_submissions")
        .select("gross_sales_cents, items_sold_count, notes, receipt_photo_url")
        .eq("booking_id", bookingId)
        .maybeSingle();

      if (data) {
        setIsEditing(true);
        setGrossSales(String(data.gross_sales_cents / 100));
        setItemsSold(
          data.items_sold_count != null ? String(data.items_sold_count) : "",
        );
        setNotes(data.notes ?? "");
        setReceiptUrl(data.receipt_photo_url);
      }
      setCheckingExisting(false);
    }
    loadExisting();
  }, [bookingId]);

  async function handleUploadReceipt() {
    if (!bookingId) return;
    setUploading(true);
    try {
      const url = await pickAndUploadImage(
        "sales-receipts",
        `${bookingId}/receipt`,
      );
      if (url) setReceiptUrl(url);
    } catch (err) {
      Alert.alert(
        "Upload failed",
        err instanceof Error ? err.message : "Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (!bookingId) return;

    const grossSalesNum = parseFloat(grossSales);
    if (!grossSales || isNaN(grossSalesNum) || grossSalesNum < 0) {
      Alert.alert("Missing info", "Please enter a valid gross sales amount.");
      return;
    }

    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setLoading(false);
      router.replace("/(auth)/login");
      return;
    }

    // upsert on booking_id (requires migration-sales-submission-unique.sql)
    // so resubmitting updates the same row instead of creating a second one.
    const { error } = await supabase.from("sales_submissions").upsert(
      {
        booking_id: bookingId,
        vendor_id: userId,
        gross_sales_cents: Math.round(grossSalesNum * 100),
        items_sold_count: itemsSold ? parseInt(itemsSold, 10) : null,
        notes: notes || null,
        receipt_photo_url: receiptUrl,
      },
      { onConflict: "booking_id" },
    );

    setLoading(false);

    if (error) {
      Alert.alert("Submission failed", error.message);
      return;
    }

    Alert.alert(
      isEditing ? "Updated!" : "Thanks!",
      "Your sales report has been saved.",
    );
    router.back();
  }

  if (checkingExisting) {
    return (
      <View style={[styles.container, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {isEditing ? "Update your sales" : "Submit your sales"}
      </Text>
      {stallNumber && dateLabel && (
        <Text style={styles.subtitle}>
          Stall {stallNumber} · {dateLabel}
        </Text>
      )}
      {isEditing && (
        <Text style={styles.editingNote}>
          You've already submitted for this booking — editing will update it.
        </Text>
      )}

      <Text style={styles.label}>Gross sales (₱)</Text>
      <InputField
        placeholder="e.g. 4500"
        value={grossSales}
        onChangeText={setGrossSales}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Items sold (optional)</Text>
      <InputField
        placeholder="e.g. 62"
        value={itemsSold}
        onChangeText={setItemsSold}
        keyboardType="number-pad"
      />

      <Text style={styles.label}>Notes (optional)</Text>
      <InputField
        placeholder="Anything worth mentioning about this weekend"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity
        style={styles.uploadBox}
        onPress={handleUploadReceipt}
        disabled={uploading}
      >
        {receiptUrl ? (
          <View style={styles.uploadedRow}>
            <Image source={{ uri: receiptUrl }} style={styles.thumbnail} />
            <Text style={styles.uploadedText}>Tap to replace</Text>
          </View>
        ) : (
          <Text style={styles.uploadText}>
            {uploading ? "Uploading..." : "+ Attach receipt photo (optional)"}
          </Text>
        )}
      </TouchableOpacity>

      <PrimaryButton
        label={loading ? "Saving..." : isEditing ? "Update" : "Submit"}
        onPress={handleSubmit}
        loading={loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 24,
    paddingTop: 20,
  },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  subtitle: { fontSize: 12, color: Colors.textMuted, marginBottom: 8 },
  editingNote: { fontSize: 12, color: Colors.info, marginBottom: 16 },
  label: { fontSize: 12, color: Colors.textMuted, marginBottom: 6 },
  uploadBox: {
    borderWidth: 1,
    borderColor: Colors.textMuted,
    borderStyle: "dashed",
    borderRadius: Radius.sm,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
  },
  uploadText: { color: Colors.textMuted, fontSize: 12 },
  uploadedRow: { alignItems: "center" },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: Radius.sm,
    marginBottom: 8,
  },
  uploadedText: { color: Colors.info, fontSize: 12, fontWeight: "600" },
});
