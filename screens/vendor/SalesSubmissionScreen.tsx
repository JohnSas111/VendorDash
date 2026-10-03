import { InputField } from "@/components/InputField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { pickAndUploadImage } from "@/lib/upload";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

// These limits mirror the database function submit_sales, which is the real
// gatekeeper. They are here only so the vendor gets a friendly message
// before sending.
const MAX_SALES_PESOS = 1_000_000;
const MAX_ITEMS = 1_000_000;
const MAX_NOTES_LENGTH = 1000;
// A submitted report can be edited for this long, then it is locked.
const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

type BookingInfo = {
  status: string;
  stallNumber: string;
  dateLabel: string;
};

function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Strict peso amount: digits with an optional 1–2 decimals. Commas, spaces
// and a leading ₱ are tolerated ("₱4,500.50"). Returns centavos, or null if
// the text is not a clean amount. (parseFloat used to accept "12abc" as 12
// and "1e3" as 1000.)
function parsePesosToCents(text: string): number | null {
  const cleaned = text.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  if (cents > MAX_SALES_PESOS * 100) return null;
  return cents;
}

// router.back() throws "GO_BACK was not handled" when the screen was opened
// directly (a pasted link, a browser refresh) and there is nothing to go
// back to. Fall back to the bookings tab.
function goBackSafely() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(vendor)/my-bookings");
  }
}

export default function SalesSubmissionScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { showToast } = useToast();

  const [checkingExisting, setCheckingExisting] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  // What the database says about this booking. The screen trusts this, not
  // the link it was opened from.
  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [lockedUntilPassed, setLockedUntilPassed] = useState(false);

  const [grossSales, setGrossSales] = useState("");
  const [itemsSold, setItemsSold] = useState("");
  const [notes, setNotes] = useState("");
  // Storage path of the attached receipt, e.g. "<bookingId>/receipt-123.jpg".
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
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
      // Only your own bookings are readable, so a booking that is not yours
      // simply comes back empty.
      const { data: bookingRow, error: bookingError } = await supabase
        .from("bookings")
        .select(
          "status, stalls(stall_number), market_sessions(friday_date, sunday_date)",
        )
        .eq("id", bookingId)
        .maybeSingle();

      if (bookingError) {
        showToast("Couldn't load this booking.", "error");
      }
      if (bookingRow) {
        const row = bookingRow as any;
        const stall = Array.isArray(row.stalls) ? row.stalls[0] : row.stalls;
        const session = Array.isArray(row.market_sessions)
          ? row.market_sessions[0]
          : row.market_sessions;
        setBooking({
          status: row.status,
          stallNumber: stall?.stall_number ?? "—",
          dateLabel: session
            ? `${formatShortDate(session.friday_date)} – ${formatShortDate(session.sunday_date)}`
            : "",
        });
      }

      const { data, error } = await supabase
        .from("sales_submissions")
        .select(
          "gross_sales_cents, items_sold_count, notes, receipt_photo_url, submitted_at",
        )
        .eq("booking_id", bookingId)
        .maybeSingle();

      // A genuine fetch error (vs. simply "no existing submission yet",
      // which maybeSingle() returns as data: null with no error).
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
        setReceiptPath(data.receipt_photo_url);
        // After 48 hours the database refuses edits, so say so up front.
        if (
          data.submitted_at &&
          Date.now() - new Date(data.submitted_at).getTime() > EDIT_WINDOW_MS
        ) {
          setLockedUntilPassed(true);
        }
      }
      setCheckingExisting(false);
    }
    loadExisting();
  }, [bookingId, showToast]);

  async function handleUploadReceipt() {
    if (!bookingId) return;
    setUploading(true);
    try {
      // A new file name each time, so replacing a receipt only ever adds a
      // file and never needs permission to overwrite one. The folder must be
      // the booking id: submit_sales rejects any other path.
      // upsert: false because the bucket only allows adding files, not
      // overwriting them (see lib/upload.ts).
      const path = await pickAndUploadImage(
        "sales-receipts",
        `${bookingId}/receipt-${Date.now()}`,
        { upsert: false },
      );
      if (path) setReceiptPath(path);
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

    const grossCents = parsePesosToCents(grossSales);
    if (grossCents === null) {
      showToast(
        `Enter a valid amount in pesos (up to ₱${MAX_SALES_PESOS.toLocaleString()}).`,
        "error",
      );
      return;
    }

    const itemsText = itemsSold.trim();
    let itemsCount: number | null = null;
    if (itemsText !== "") {
      if (!/^\d+$/.test(itemsText) || parseInt(itemsText, 10) > MAX_ITEMS) {
        showToast("Items sold must be a whole number.", "error");
        return;
      }
      itemsCount = parseInt(itemsText, 10);
    }

    const cleanNotes = notes.trim();
    if (cleanNotes.length > MAX_NOTES_LENGTH) {
      showToast(
        `Notes are too long (${MAX_NOTES_LENGTH} characters max).`,
        "error",
      );
      return;
    }

    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setLoading(false);
      router.replace("/(auth)/login");
      return;
    }

    // submit_sales checks that this is your own COMPLETED booking, that the
    // amounts are sane, that the receipt belongs to this booking, and that a
    // report is not edited after 48 hours. It also records the audit event.
    const { error } = await supabase.rpc("submit_sales", {
      p_booking_id: bookingId,
      p_gross_sales_cents: grossCents,
      p_items_sold: itemsCount,
      p_notes: cleanNotes === "" ? null : cleanNotes,
      p_receipt_path: receiptPath,
    });

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
    goBackSafely();
  }

  if (checkingExisting) {
    return (
      <View style={styles.container}>
        <SubmissionSkeleton />
      </View>
    );
  }

  // Not your booking, or it does not exist.
  if (!booking) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Booking not found</Text>
        <Text style={styles.subtitle}>
          We couldn’t find this booking in your account.
        </Text>
        <PrimaryButton label="Go back" onPress={goBackSafely} />
      </View>
    );
  }

  // Sales can only be reported after the organizer marks the booking
  // complete. Better to say so now than after the form is filled in.
  if (booking.status !== "completed") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Sales not open yet</Text>
        <Text style={styles.subtitle}>
          Stall {booking.stallNumber} · {booking.dateLabel}
        </Text>
        <Text style={styles.blockedText}>
          You can submit your sales after the organizer has completed your
          market day.
        </Text>
        <PrimaryButton label="Go back" onPress={goBackSafely} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {isEditing ? "Update your sales" : "Submit your sales"}
      </Text>
      <Text style={styles.subtitle}>
        Stall {booking.stallNumber} · {booking.dateLabel}
      </Text>
      {lockedUntilPassed && (
        <View style={styles.editingNoteRow}>
          <Ionicons name="lock-closed" size={14} color={Colors.warningText} />
          <Text style={styles.lockedNote}>
            This report was submitted more than 48 hours ago and can no longer
            be edited.
          </Text>
        </View>
      )}
      {isEditing && !lockedUntilPassed && (
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
        maxLength={MAX_NOTES_LENGTH}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity
        accessibilityRole="button"
        style={styles.uploadBox}
        onPress={handleUploadReceipt}
        disabled={uploading || lockedUntilPassed}
      >
        {receiptPath ? (
          <View style={styles.uploadedRow}>
            <Ionicons
              name="checkmark-circle"
              size={28}
              color={Colors.available}
              style={styles.receiptCheck}
            />
            <Text style={styles.uploadedText}>
              {uploading ? "Uploading…" : "Receipt attached · tap to replace"}
            </Text>
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
        disabled={lockedUntilPassed}
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
  receiptCheck: { marginBottom: Spacing.sm },
  blockedText: {
    fontSize: Typography.base,
    color: Colors.text,
    marginBottom: Spacing.xl,
  },
  lockedNote: { fontSize: Typography.sm, color: Colors.warningText, flex: 1 },
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
