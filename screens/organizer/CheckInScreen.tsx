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
import {
  scanAlready,
  scanFailed,
  scanSuccess,
  scanUnknown,
  type ScanFeedback as ScanFeedbackModel,
} from "@/lib/scanFeedback";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { ownerPrefix, vendorDisplay } from "@/lib/uxHelpers";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
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
  vendor_name: string; // business name (falls back to the person's name)
  owner_name: string;
  stall_number: string;
  days: string[]; // booked days ("friday" | "saturday" | "sunday")
  // Checked in AND the vendor's last booked day has already ended. This is a
  // display hint only - complete_booking re-checks the time on the server.
  ready: boolean;
};

type SessionRow = {
  id: string;
  friday_date: string;
  saturday_date: string;
  sunday_date: string;
  end_time: string;
  status: string;
};

type ScanFeedback = ScanFeedbackModel | null;

// A short buzz so the organizer can tell the result without looking at the
// screen (phones only; nothing happens on the web).
function buzz(kind: "success" | "error") {
  if (Platform.OS === "web") return;
  Haptics.notificationAsync(
    kind === "success"
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Error,
  ).catch(() => {});
}

type ReasonModalState = { kind: "undo" | "early"; row: Row } | null;

// Converts a wall-clock date + time in an IANA timezone to a UTC timestamp.
// Returns null if the runtime can't do the conversion (then the row is simply
// treated as "not ready" and the server stays the authority).
function zonedToUtcMs(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): number | null {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm, ss] = timeStr.split(":").map(Number);
    const wall = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const offsetAt = (utc: number) => {
      const parts: Record<string, string> = {};
      fmt.formatToParts(new Date(utc)).forEach((part) => {
        parts[part.type] = part.value;
      });
      return (
        Date.UTC(
          Number(parts.year),
          Number(parts.month) - 1,
          Number(parts.day),
          Number(parts.hour),
          Number(parts.minute),
          Number(parts.second),
        ) - utc
      );
    };
    const guess = wall - offsetAt(wall);
    return wall - offsetAt(guess);
  } catch {
    return null;
  }
}

// End of the vendor's LAST booked day (that day's date + the session end time).
function lastDayEndMs(
  session: SessionRow,
  attendingDays: string[],
  timeZone: string,
): number | null {
  const date = attendingDays.includes("sunday")
    ? session.sunday_date
    : attendingDays.includes("saturday")
      ? session.saturday_date
      : attendingDays.includes("friday")
        ? session.friday_date
        : null;
  if (!date) return null;
  return zonedToUtcMs(date, session.end_time, timeZone);
}

// Default session: the open one, else the next upcoming one, else the most
// recent closed one (closed sessions still need their vendors completed).
function pickDefaultSession(list: SessionRow[]): SessionRow | null {
  const oldestFirst = [...list].reverse();
  return (
    oldestFirst.find((x) => x.status === "open") ??
    oldestFirst.find((x) => x.status === "upcoming") ??
    list.find((x) => x.status === "closed") ??
    null
  );
}

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
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [pickedSessionId, setPickedSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<SessionRow | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reasonModal, setReasonModal] = useState<ReasonModalState>(null);
  const [reasonText, setReasonText] = useState("");

  const [permission, requestPermission] = useCameraPermissions();
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(null);
  const lastScanRef = useRef<{ id: string; time: number } | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    const { data: sessionRows, error: sessionError } = await supabase
      .from("market_sessions")
      .select("id, friday_date, saturday_date, sunday_date, end_time, status")
      .eq("venue_id", venue.id)
      .in("status", ["open", "upcoming", "closed"])
      .order("friday_date", { ascending: false })
      .limit(6);
    if (sessionError) {
      showToast("Couldn't load the active session.", "error");
    }

    const list = (sessionRows ?? []) as SessionRow[];
    setSessions(list);

    const session =
      list.find((x) => x.id === pickedSessionId) ?? pickDefaultSession(list);
    setCurrentSession(session);

    if (!session) {
      setSessionLabel("No active session");
      setRows([]);
      setLoading(false);
      return;
    }
    setSessionLabel(
      `${formatDate(session.friday_date)} – ${formatDate(session.sunday_date)} (${session.status})`,
    );

    const { data: venueRow } = await supabase
      .from("venues")
      .select("timezone")
      .eq("id", venue.id)
      .single();
    const timeZone = venueRow?.timezone ?? "Asia/Manila";

    const { data, error: rowsError } = await supabase
      .from("bookings")
      .select(
        "id, status, attending_days, profiles!bookings_vendor_id_fkey(full_name, vendor_details!vendor_details_id_fkey(business_name)), stalls!inner(stall_number, venue_id)",
      )
      .eq("session_id", session.id)
      .eq("stalls.venue_id", venue.id)
      .in("status", ["paid", "checked_in", "completed"]);
    if (rowsError) {
      showToast("Couldn't load the check-in list.", "error");
    }

    const nowMs = Date.now();
    setRows(
      (data ?? []).map((row: any) => {
        const endMs = lastDayEndMs(session, row.attending_days ?? [], timeZone);
        return {
          id: row.id,
          status: row.status,
          vendor_name: vendorDisplay(row.profiles).name,
          owner_name: vendorDisplay(row.profiles).owner,
          stall_number: row.stalls?.stall_number ?? "—",
          days: row.attending_days ?? [],
          ready:
            row.status === "checked_in" && endMs !== null && nowMs >= endMs,
        };
      }),
    );
    setLoading(false);
  }, [venue, pickedSessionId, showToast]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  // Check-in is enforced by check_in_booking: organizer owns the venue, the
  // booking is paid, and it is one of the vendor's booked days within the
  // opening window. Returns an error message, or null on success.
  const runCheckIn = async (id: string): Promise<string | null> => {
    setActingOnId(id);
    const { error } = await supabase.rpc("check_in_booking", {
      p_booking_id: id,
    });
    setActingOnId(null);
    if (error) return error.message || "Check-in failed.";
    await load();
    return null;
  };

  const handleTableCheckIn = async (row: Row) => {
    const message = await runCheckIn(row.id);
    if (message) showToast(message, "error");
  };

  // complete_booking only accepts checked-in bookings, and only after the
  // vendor's last booked day has ended (unless completed early with a reason).
  const handleComplete = async (row: Row) => {
    if (!row.ready) {
      setReasonText("");
      setReasonModal({ kind: "early", row });
      return;
    }
    setActingOnId(row.id);
    const { error } = await supabase.rpc("complete_booking", {
      p_booking_id: row.id,
      p_early: false,
      p_note: null,
    });
    setActingOnId(null);
    if (error) {
      showToast(error.message || "Couldn't complete that vendor.", "error");
      load();
      return;
    }
    showToast(
      `${row.vendor_name} completed. They can now submit sales.`,
      "success",
    );
    load();
  };

  const handleCompleteAllReady = async () => {
    if (!currentSession) return;
    setBulkBusy(true);
    const { data, error } = await supabase.rpc("complete_ready_bookings", {
      p_session_id: currentSession.id,
    });
    setBulkBusy(false);
    if (error) {
      showToast(error.message || "Couldn't complete the vendors.", "error");
      load();
      return;
    }
    const n = typeof data === "number" ? data : 0;
    showToast(
      n === 1
        ? "1 vendor completed. They can now submit sales."
        : `${n} vendors completed. They can now submit sales.`,
      "success",
    );
    load();
  };

  const openUndo = (row: Row) => {
    setReasonText("");
    setReasonModal({ kind: "undo", row });
  };

  const closeReason = () => {
    setReasonModal(null);
    setReasonText("");
  };

  const submitReason = async () => {
    if (!reasonModal) return;
    const note = reasonText.trim();
    if (note.length < 3) {
      showToast("Add a short reason (at least 3 characters).", "error");
      return;
    }
    const { kind, row } = reasonModal;
    closeReason();
    setActingOnId(row.id);
    const { error } =
      kind === "undo"
        ? await supabase.rpc("undo_check_in", {
            p_booking_id: row.id,
            p_reason: note,
          })
        : await supabase.rpc("complete_booking", {
            p_booking_id: row.id,
            p_early: true,
            p_note: note,
          });
    setActingOnId(null);
    if (error) {
      showToast(error.message || "That didn't go through.", "error");
      load();
      return;
    }
    showToast(
      kind === "undo"
        ? "Check-in undone."
        : `${row.vendor_name} completed. They can now submit sales.`,
      kind === "undo" ? "info" : "success",
    );
    load();
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
      setScanFeedback(scanUnknown());
      buzz("error");
      return;
    }
    if (match.status === "checked_in" || match.status === "completed") {
      setScanFeedback(scanAlready(match, match.status));
      buzz("error");
      return;
    }

    const message = await runCheckIn(match.id);
    if (message) {
      setScanFeedback(scanFailed(match, message));
      buzz("error");
    } else {
      setScanFeedback(scanSuccess(match));
      buzz("success");
    }
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
      r.owner_name.toLowerCase().includes(search.toLowerCase()) ||
      r.stall_number.toLowerCase().includes(search.toLowerCase()),
  );
  const checkedInCount = rows.filter(
    (r) => r.status === "checked_in" || r.status === "completed",
  ).length;
  const waitingCount = rows.filter((r) => r.status === "paid").length;
  const readyCount = rows.filter((r) => r.ready).length;

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

      {sessions.length > 1 && (
        <View style={styles.sessionChips}>
          {sessions.map((x) => {
            const active = x.id === currentSession?.id;
            return (
              <PressableButton
                key={x.id}
                onPress={() => setPickedSessionId(x.id)}
                style={[shared.secondaryButton, active && styles.chipActive]}
              >
                <Text
                  style={[
                    shared.secondaryButtonText,
                    active && styles.chipActiveText,
                  ]}
                >
                  {formatDate(x.friday_date)} · {x.status}
                </Text>
              </PressableButton>
            );
          })}
        </View>
      )}

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
            {waitingCount}
          </Text>
          <Text style={styles.statLabel}>Not in yet</Text>
        </View>
      </View>

      {readyCount > 0 && (
        <View style={[shared.card, styles.readyCard]}>
          <Text style={styles.readyText}>
            {readyCount === 1
              ? "1 vendor is ready to complete."
              : `${readyCount} vendors are ready to complete.`}
          </Text>
          <PressableButton
            style={[shared.successButton, styles.checkInButton]}
            disabled={bulkBusy}
            onPress={handleCompleteAllReady}
          >
            <Ionicons name="checkmark-done" size={14} color={COLORS.white} />
            <Text style={shared.successButtonText}>
              {bulkBusy ? "Completing…" : "Complete all ready"}
            </Text>
          </PressableButton>
        </View>
      )}

      {mode === "scan" ? (
        <View>
          {isDesktop && (
            <Text style={[shared.rowSubtitle, styles.scanTip]}>
              Scanning works best on your phone. On a laptop, use the Table view
              and search for the vendor.
            </Text>
          )}

          {scanFeedback && (
            <View
              accessibilityLiveRegion="polite"
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
                size={28}
                color={
                  scanFeedback.type === "success" ? COLORS.teal : COLORS.clay
                }
              />
              <View style={styles.scanFeedbackBody}>
                <Text
                  style={[
                    styles.scanFeedbackTitle,
                    {
                      color:
                        scanFeedback.type === "success"
                          ? COLORS.teal
                          : COLORS.clay,
                    },
                  ]}
                >
                  {scanFeedback.title}
                </Text>
                {scanFeedback.name && (
                  <Text style={styles.scanFeedbackName}>
                    {scanFeedback.name}
                  </Text>
                )}
                <Text style={styles.scanFeedbackDetail}>
                  {scanFeedback.detail}
                </Text>
              </View>
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
                No paid vendors for this session yet.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {filtered.map((r) => {
                const { bg, fg } = statusColors(r.status);
                return (
                  <View key={r.id} style={[shared.row, shared.rowDesktop]}>
                    <View>
                      <Text style={shared.rowTitle}>{r.vendor_name}</Text>
                      <Text style={shared.rowSubtitle}>
                        {ownerPrefix(r.vendor_name, r.owner_name)}Stall{" "}
                        {r.stall_number}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <View style={[shared.badge, { backgroundColor: bg }]}>
                        <Text style={[shared.badgeText, { color: fg }]}>
                          {r.status}
                        </Text>
                      </View>
                      {r.status === "paid" && (
                        <PressableButton
                          style={[shared.successButton, styles.checkInButton]}
                          disabled={actingOnId === r.id}
                          onPress={() => handleTableCheckIn(r)}
                        >
                          <Ionicons
                            name="checkmark"
                            size={14}
                            color={COLORS.white}
                          />
                          <Text style={shared.successButtonText}>Check In</Text>
                        </PressableButton>
                      )}
                      {r.status === "checked_in" && (
                        <>
                          <PressableButton
                            style={[
                              shared.secondaryButton,
                              styles.checkInButton,
                            ]}
                            disabled={actingOnId === r.id}
                            onPress={() => openUndo(r)}
                          >
                            <Ionicons
                              name="arrow-undo"
                              size={14}
                              color={COLORS.inkNavy}
                            />
                            <Text style={shared.secondaryButtonText}>Undo</Text>
                          </PressableButton>
                          <PressableButton
                            style={[
                              r.ready
                                ? shared.successButton
                                : shared.secondaryButton,
                              styles.checkInButton,
                            ]}
                            disabled={actingOnId === r.id}
                            onPress={() => handleComplete(r)}
                          >
                            <Ionicons
                              name="checkmark-done"
                              size={14}
                              color={r.ready ? COLORS.white : COLORS.inkNavy}
                            />
                            <Text
                              style={
                                r.ready
                                  ? shared.successButtonText
                                  : shared.secondaryButtonText
                              }
                            >
                              {r.ready ? "Complete" : "Complete early"}
                            </Text>
                          </PressableButton>
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
      <Modal
        visible={reasonModal !== null}
        transparent
        animationType="fade"
        onRequestClose={closeReason}
      >
        <View style={styles.modalBackdrop}>
          <View style={[shared.card, styles.modalCard]}>
            <Text style={shared.rowTitle}>
              {reasonModal?.kind === "undo"
                ? "Undo check-in"
                : "Complete before closing"}
            </Text>
            <Text style={[shared.rowSubtitle, styles.modalBody]}>
              {reasonModal?.kind === "undo"
                ? `${reasonModal.row.vendor_name} (Stall ${reasonModal.row.stall_number}) will go back to paid. Your reason is saved in the audit log.`
                : reasonModal
                  ? `${reasonModal.row.vendor_name}'s booked days haven't ended yet. Completing now lets them submit sales straight away. Add a reason (for example: left early). It is saved in the audit log.`
                  : ""}
            </Text>
            <TextInput
              accessibilityLabel="Reason"
              style={[shared.input, styles.modalInput]}
              placeholder="Reason…"
              value={reasonText}
              onChangeText={setReasonText}
              multiline
              maxLength={300}
            />
            <View style={styles.modalActions}>
              <PressableButton
                style={shared.secondaryButton}
                onPress={closeReason}
              >
                <Text style={shared.secondaryButtonText}>Cancel</Text>
              </PressableButton>
              <PressableButton
                style={shared.successButton}
                onPress={submitReason}
              >
                <Text style={shared.successButtonText}>Confirm</Text>
              </PressableButton>
            </View>
          </View>
        </View>
      </Modal>
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
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  scanFeedbackSuccess: {
    borderColor: COLORS.teal,
    backgroundColor: Colors.successLight,
  },
  scanFeedbackError: {
    borderColor: COLORS.clay,
    backgroundColor: Colors.dangerLight,
  },
  scanFeedbackBody: { flex: 1, gap: 2 },
  scanFeedbackTitle: {
    fontSize: Typography.sm,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  scanFeedbackName: {
    fontSize: Typography.xl,
    fontWeight: "700",
    color: COLORS.inkNavy,
  },
  scanFeedbackDetail: { fontSize: Typography.base, color: COLORS.slate },
  scanTip: { marginBottom: Spacing.md },
  cameraFrame: {
    borderRadius: RADIUS.md,
    overflow: "hidden",
    height: 420,
    maxWidth: 480,
  },
  cameraPromptText: { marginBottom: Spacing.md, marginTop: Spacing.xs },
  searchInput: { marginBottom: Spacing.lg },
  list: { gap: Spacing.sm },
  rowRight: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    alignItems: "center",
  },
  sessionChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  chipActive: { backgroundColor: COLORS.inkNavy },
  chipActiveText: { color: COLORS.white },
  readyCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  readyText: {
    flex: 1,
    fontSize: Typography.base,
    fontWeight: "600",
    color: COLORS.inkNavy,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalCard: { width: "100%", maxWidth: 420 },
  modalBody: { marginVertical: Spacing.sm },
  modalInput: {
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: Spacing.md,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
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
