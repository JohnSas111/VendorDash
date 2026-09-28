import { PressableButton } from "@/components/PressableButton";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  RADIUS,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

type Row = {
  id: string;
  status: string;
  vendor_name: string;
  stall_number: string;
};

type ScanFeedback = { type: "success" | "error"; message: string } | null;

export default function CheckInScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();
  const { showToast } = useToast();

  const [mode, setMode] = useState<"table" | "scan">("table");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sessionLabel, setSessionLabel] = useState("No active session");
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(null);
  const lastScanRef = useRef<{ id: string; time: number } | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    const { data: sessions, error: sessionError } = await supabase
      .from("market_sessions")
      .select("id, friday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .in("status", ["open", "upcoming"])
      .order("status", { ascending: true })
      .order("friday_date", { ascending: true })
      .limit(1);
    if (sessionError) {
      showToast("Couldn't load the active session.", "error");
    }

    const session = sessions?.[0];
    if (!session) {
      setSessionLabel("No active session");
      setRows([]);
      setLoading(false);
      return;
    }
    setSessionLabel(
      `${formatDate(session.friday_date)} – ${formatDate(session.sunday_date)} (${session.status})`,
    );

    const { data, error: rowsError } = await supabase
      .from("bookings")
      .select(
        "id, status, profiles!bookings_vendor_id_fkey(full_name), stalls!inner(stall_number, venue_id)",
      )
      .eq("session_id", session.id)
      .eq("stalls.venue_id", venue.id)
      .in("status", ["paid", "checked_in"]);
    if (rowsError) {
      showToast("Couldn't load the check-in list.", "error");
    }

    setRows(
      (data ?? []).map((row: any) => ({
        id: row.id,
        status: row.status,
        vendor_name: row.profiles?.full_name ?? "Unknown vendor",
        stall_number: row.stalls?.stall_number ?? "—",
      })),
    );
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

  const setCheckedIn = async (id: string, checkedIn: boolean) => {
    setActingOnId(id);
    const { error } = await supabase
      .from("bookings")
      .update({ status: checkedIn ? "checked_in" : "paid" })
      .eq("id", id);
    setActingOnId(null);
    if (!error) load();
    return !error;
  };

  // CHANGED: the table's Check In / Undo button used to call
  // setCheckedIn() and ignore whether it worked — a failed update just
  // silently did nothing. The scan flow already had its own feedback
  // banner for this; the table flow had none, so it gets a toast here.
  const handleTableCheckIn = async (row: Row, checkedIn: boolean) => {
    const ok = await setCheckedIn(row.id, checkedIn);
    if (!ok) {
      showToast(`Couldn't update ${row.vendor_name}'s check-in.`, "error");
    }
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    const bookingId = data.trim();

    const now = Date.now();
    if (
      lastScanRef.current &&
      lastScanRef.current.id === bookingId &&
      now - lastScanRef.current.time < 3000
    ) {
      return;
    }
    lastScanRef.current = { id: bookingId, time: now };

    const match = rows.find((r) => r.id === bookingId);

    if (!match) {
      setScanFeedback({
        type: "error",
        message: "QR doesn't match a paid booking for this session.",
      });
      return;
    }
    if (match.status === "checked_in") {
      setScanFeedback({
        type: "error",
        message: `${match.vendor_name} (Stall ${match.stall_number}) is already checked in.`,
      });
      return;
    }

    const ok = await setCheckedIn(match.id, true);
    setScanFeedback(
      ok
        ? {
            type: "success",
            message: `Checked in: ${match.vendor_name} — Stall ${match.stall_number}`,
          }
        : {
            type: "error",
            message: "Scan matched, but the update failed. Try again.",
          },
    );
  };

  if (venueLoading) {
    return (
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <CheckInSkeleton />
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

  const filtered = rows.filter(
    (r) =>
      !search.trim() ||
      r.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
      r.stall_number.toLowerCase().includes(search.toLowerCase()),
  );
  const checkedInCount = rows.filter((r) => r.status === "checked_in").length;

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.content,
        isDesktop && shared.contentDesktop,
      ]}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={shared.title}>Check-In</Text>
          <Text style={shared.subtitle}>{sessionLabel}</Text>
        </View>
        <View style={styles.modeToggle}>
          <PressableButton
            style={[
              mode === "table" ? shared.primaryButton : shared.secondaryButton,
              styles.modeButton,
            ]}
            onPress={() => setMode("table")}
          >
            <Ionicons
              name="list"
              size={14}
              color={mode === "table" ? COLORS.white : COLORS.inkNavy}
            />
            <Text
              style={
                mode === "table"
                  ? shared.primaryButtonText
                  : shared.secondaryButtonText
              }
            >
              Table
            </Text>
          </PressableButton>
          <PressableButton
            style={[
              mode === "scan" ? shared.primaryButton : shared.secondaryButton,
              styles.modeButton,
            ]}
            onPress={() => {
              setScanFeedback(null);
              setMode("scan");
            }}
          >
            <Ionicons
              name="qr-code"
              size={14}
              color={mode === "scan" ? COLORS.white : COLORS.inkNavy}
            />
            <Text
              style={
                mode === "scan"
                  ? shared.primaryButtonText
                  : shared.secondaryButtonText
              }
            >
              Scan QR
            </Text>
          </PressableButton>
        </View>
      </View>

      <View style={styles.statRow}>
        <View style={[shared.card, styles.statCard]}>
          <Text style={styles.statValue}>{rows.length}</Text>
          <Text style={styles.statLabel}>Expected</Text>
        </View>
        <View style={[shared.card, styles.statCard]}>
          <Text style={[styles.statValue, { color: COLORS.tealText }]}>
            {checkedInCount}
          </Text>
          <Text style={styles.statLabel}>Checked in</Text>
        </View>
        <View style={[shared.card, styles.statCard]}>
          <Text style={[styles.statValue, { color: COLORS.amberText }]}>
            {rows.length - checkedInCount}
          </Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
      </View>

      {mode === "scan" ? (
        <View>
          {scanFeedback && (
            <View
              style={[
                shared.card,
                styles.scanFeedbackCard,
                scanFeedback.type === "success"
                  ? styles.scanFeedbackSuccess
                  : styles.scanFeedbackError,
              ]}
            >
              <Ionicons
                name={
                  scanFeedback.type === "success"
                    ? "checkmark-circle"
                    : "alert-circle"
                }
                size={16}
                color={
                  scanFeedback.type === "success" ? COLORS.teal : COLORS.clay
                }
              />
              <Text
                style={[
                  styles.scanFeedbackText,
                  {
                    color:
                      scanFeedback.type === "success"
                        ? COLORS.teal
                        : COLORS.clay,
                  },
                ]}
              >
                {scanFeedback.message}
              </Text>
            </View>
          )}

          {!permission ? (
            <View style={[styles.cameraFrame, styles.skeletonBlock]} />
          ) : !permission.granted ? (
            <View style={shared.emptyState}>
              <Ionicons name="camera-outline" size={26} color={COLORS.slate} />
              <Text style={[shared.emptyStateText, styles.cameraPromptText]}>
                Camera access is needed to scan QR codes.
              </Text>
              <PressableButton
                style={shared.primaryButton}
                onPress={requestPermission}
              >
                <Text style={shared.primaryButtonText}>
                  Grant camera access
                </Text>
              </PressableButton>
            </View>
          ) : (
            <View style={styles.cameraFrame}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={handleBarcodeScanned}
              />
            </View>
          )}
        </View>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Search vendor or stall"
            style={[shared.input, styles.searchInput]}
            placeholder="Search vendor or stall…"
            value={search}
            onChangeText={setSearch}
          />

          {loading ? (
            <ListSkeleton />
          ) : filtered.length === 0 ? (
            <View style={shared.emptyState}>
              <Ionicons name="people-outline" size={26} color={COLORS.slate} />
              <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
                Nobody paid &amp; waiting for this session yet.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {filtered.map((r) => {
                const { bg, fg } = statusColors(r.status);
                const isIn = r.status === "checked_in";
                return (
                  <View key={r.id} style={[shared.row, shared.rowDesktop]}>
                    <View>
                      <Text style={shared.rowTitle}>{r.vendor_name}</Text>
                      <Text style={shared.rowSubtitle}>
                        Stall {r.stall_number}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <View style={[shared.badge, { backgroundColor: bg }]}>
                        <Text style={[shared.badgeText, { color: fg }]}>
                          {r.status}
                        </Text>
                      </View>
                      <PressableButton
                        style={[
                          isIn ? shared.secondaryButton : shared.successButton,
                          styles.checkInButton,
                        ]}
                        disabled={actingOnId === r.id}
                        onPress={() => handleTableCheckIn(r, !isIn)}
                      >
                        <Ionicons
                          name={isIn ? "arrow-undo" : "checkmark"}
                          size={14}
                          color={isIn ? COLORS.inkNavy : COLORS.white}
                        />
                        <Text
                          style={
                            isIn
                              ? shared.secondaryButtonText
                              : shared.successButtonText
                          }
                        >
                          {isIn ? "Undo" : "Check In"}
                        </Text>
                      </PressableButton>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// Placeholder shown while the venue is resolving.
function CheckInSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: 120, height: 22, marginBottom: Spacing.sm },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 220, marginBottom: Spacing.lg }]}
      />
      <View style={styles.statRow}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[shared.card, styles.statCard, styles.skeletonBlock]}
          />
        ))}
      </View>
      <ListSkeleton />
    </View>
  );
}

// Placeholder rows shown while the check-in list is loading.
function ListSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[shared.row, styles.skeletonBlock, { minHeight: 60 }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  modeToggle: { flexDirection: "row", gap: Spacing.sm },
  modeButton: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  statRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  statCard: { flex: 1 },
  statValue: {
    fontSize: Typography.xxl - 2,
    fontWeight: "700",
    color: COLORS.inkNavy,
  },
  statLabel: { fontSize: Typography.sm, color: COLORS.slate },
  scanFeedbackCard: {
    marginBottom: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  scanFeedbackSuccess: {
    borderColor: COLORS.teal,
    backgroundColor: Colors.successLight,
  },
  scanFeedbackError: {
    borderColor: COLORS.clay,
    backgroundColor: Colors.dangerLight,
  },
  scanFeedbackText: { fontWeight: "600", fontSize: Typography.base, flex: 1 },
  cameraFrame: {
    borderRadius: RADIUS.md,
    overflow: "hidden",
    height: 420,
    maxWidth: 480,
  },
  cameraPromptText: { marginBottom: Spacing.md, marginTop: Spacing.xs },
  searchInput: { marginBottom: Spacing.lg },
  list: { gap: Spacing.sm },
  rowRight: { flexDirection: "row", gap: Spacing.md, alignItems: "center" },
  checkInButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  skeletonBlock: {
    backgroundColor: COLORS.border,
    borderColor: COLORS.border,
    shadowOpacity: 0,
  },
  skeletonLine: {
    height: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
  },
});
