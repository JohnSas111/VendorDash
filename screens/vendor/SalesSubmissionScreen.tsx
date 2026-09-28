import { InputField } from "@/components/InputField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { pickAndUploadImage } from "@/lib/upload";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function SalesSubmissionScreen() {
  const { bookingId, stallNumber, dateLabel } = useLocalSearchParams<{
    bookingId: string;
    stallNumber?: string;
    dateLabel?: string;
  }>();
  const { showToast } = useToast();

  const [checkingExisting, setCheckingExisting] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  const [grossSales, setGrossSales] = useState("");
  const [itemsSold, setItemsSold] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  // FIX (pre-existing, unrelated to this pass): was possible to submit
  // sales more than once for the same booking, silently double-counting
  // totals in the organizer's Sales Reports. Checks for an existing
  // submission first and, if found, pre-fills the form and switches to
  // update mode.
  useEffect(() => {
    async function loadExisting() {
      if (!bookingId) {
        setCheckingExisting(false);
        return;
      }
      const { data, error } = await supabase
        .from("sales_submissions")
        .select("gross_sales_cents, items_sold_count, notes, receipt_photo_url")
        .eq("booking_id", bookingId)
        .maybeSingle();

      // Previously unchecked — a genuine fetch error (vs. simply "no
      // existing submission yet", which maybeSingle() returns as
      // data: null with no error) would fail silently.
      if (error) {
        showToast("Couldn't check for an existing submission.", "error");
      }

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
  }, [bookingId, showToast]);

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
      showToast(
        err instanceof Error ? err.message : "Upload failed. Please try again.",
        "error",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (!bookingId) return;

    const grossSalesNum = parseFloat(grossSales);
    if (!grossSales || isNaN(grossSalesNum) || grossSalesNum < 0) {
      showToast("Enter a valid gross sales amount.", "error");
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
      showToast(error.message, "error");
      return;
    }

    showToast(
      isEditing
        ? "Sales report updated."
        : "Thanks! Your sales report has been saved.",
      "success",
    );
    router.back();
  }

  if (checkingExisting) {
    return (
      <View style={styles.container}>
        <SubmissionSkeleton />
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
        <View style={styles.editingNoteRow}>
          <Ionicons name="information-circle" size={14} color={Colors.info} />
          <Text style={styles.editingNote}>
            You’ve already submitted for this booking — editing will update it.
          </Text>
        </View>
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
        accessibilityRole="button"
        style={styles.uploadBox}
        onPress={handleUploadReceipt}
        disabled={uploading}
      >
        {receiptUrl ? (
          <View style={styles.uploadedRow}>
            <Image
              accessibilityLabel="Uploaded receipt preview"
              source={{ uri: receiptUrl }}
              style={styles.thumbnail}
            />
            <Text style={styles.uploadedText}>Tap to replace</Text>
          </View>
        ) : (
          <View style={styles.uploadPrompt}>
            <Ionicons
              name="receipt-outline"
              size={22}
              color={Colors.textMuted}
            />
            <Text style={styles.uploadText}>
              {uploading ? "Uploading…" : "Attach receipt photo (optional)"}
            </Text>
          </View>
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

// Placeholder shown while checking for an existing submission,
// replacing the old centered ActivityIndicator.
function SubmissionSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: "55%", height: 18, marginBottom: Spacing.sm },
        ]}
      />
      <View
        style={[
          styles.skeletonLine,
          { width: "35%", marginBottom: Spacing.xl },
        ]}
      />
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skeletonInput} />
      ))}
      <View style={[styles.uploadBox, styles.skeletonUpload]} />
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
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: "bold",
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  editingNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  editingNote: { fontSize: Typography.sm, color: Colors.info, flex: 1 },
  label: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  uploadBox: {
    borderWidth: 1,
    borderColor: Colors.textMuted,
    borderStyle: "dashed",
    borderRadius: Radius.sm,
    padding: Spacing.xxl,
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  uploadPrompt: { alignItems: "center", gap: Spacing.xs },
  uploadText: { color: Colors.textMuted, fontSize: Typography.sm },
  uploadedRow: { alignItems: "center" },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: Radius.sm,
    marginBottom: Spacing.sm,
  },
  uploadedText: {
    color: Colors.info,
    fontSize: Typography.sm,
    fontWeight: "600",
  },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
  skeletonInput: {
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.borderLight,
    marginBottom: Spacing.md,
  },
  skeletonUpload: {
    backgroundColor: Colors.borderLight,
    borderColor: Colors.borderLight,
  },
});
