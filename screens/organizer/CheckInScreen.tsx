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
import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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

    const { data: sessions } = await supabase
      .from("market_sessions")
      .select("id, friday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .in("status", ["open", "upcoming"])
      .order("status", { ascending: true })
      .order("friday_date", { ascending: true })
      .limit(1);

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

    const { data } = await supabase
      .from("bookings")
      .select(
        "id, status, profiles!bookings_vendor_id_fkey(full_name), stalls!inner(stall_number, venue_id)",
      )
      .eq("session_id", session.id)
      .eq("stalls.venue_id", venue.id)
      .in("status", ["paid", "checked_in"]);

    setRows(
      (data ?? []).map((row: any) => ({
        id: row.id,
        status: row.status,
        vendor_name: row.profiles?.full_name ?? "Unknown vendor",
        stall_number: row.stalls?.stall_number ?? "—",
      })),
    );
    setLoading(false);
  }, [venue]);

  useEffect(() => {
    load();
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
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <View>
          <Text style={shared.title}>Check-In</Text>
          <Text style={shared.subtitle}>{sessionLabel}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            style={
              mode === "table" ? shared.primaryButton : shared.secondaryButton
            }
            onPress={() => setMode("table")}
          >
            <Text
              style={
                mode === "table"
                  ? shared.primaryButtonText
                  : shared.secondaryButtonText
              }
            >
              Table
            </Text>
          </Pressable>
          <Pressable
            style={
              mode === "scan" ? shared.primaryButton : shared.secondaryButton
            }
            onPress={() => {
              setScanFeedback(null);
              setMode("scan");
            }}
          >
            <Text
              style={
                mode === "scan"
                  ? shared.primaryButtonText
                  : shared.secondaryButtonText
              }
            >
              Scan QR
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: 12,
          marginTop: 16,
          marginBottom: 16,
        }}
      >
        <View style={[shared.card, { flex: 1 }]}>
          <Text
            style={{ fontSize: 22, fontWeight: "700", color: COLORS.inkNavy }}
          >
            {rows.length}
          </Text>
          <Text style={{ fontSize: 12, color: COLORS.slate }}>Expected</Text>
        </View>
        <View style={[shared.card, { flex: 1 }]}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.teal }}>
            {checkedInCount}
          </Text>
          <Text style={{ fontSize: 12, color: COLORS.slate }}>Checked in</Text>
        </View>
        <View style={[shared.card, { flex: 1 }]}>
          <Text
            style={{ fontSize: 22, fontWeight: "700", color: COLORS.amber }}
          >
            {rows.length - checkedInCount}
          </Text>
          <Text style={{ fontSize: 12, color: COLORS.slate }}>Pending</Text>
        </View>
      </View>

      {mode === "scan" ? (
        <View>
          {scanFeedback && (
            <View
              style={[
                shared.card,
                {
                  marginBottom: 12,
                  borderColor:
                    scanFeedback.type === "success" ? COLORS.teal : COLORS.clay,
                  backgroundColor:
                    scanFeedback.type === "success" ? "#E3F5EC" : "#FBEAE8",
                },
              ]}
            >
              <Text
                style={{
                  color:
                    scanFeedback.type === "success" ? COLORS.teal : COLORS.clay,
                  fontWeight: "600",
                }}
              >
                {scanFeedback.message}
              </Text>
            </View>
          )}

          {!permission ? (
            <ActivityIndicator color={COLORS.inkNavy} />
          ) : !permission.granted ? (
            <View style={shared.emptyState}>
              <Text style={[shared.emptyStateText, { marginBottom: 12 }]}>
                Camera access is needed to scan QR codes.
              </Text>
              <Pressable
                style={shared.primaryButton}
                onPress={requestPermission}
              >
                <Text style={shared.primaryButtonText}>
                  Grant camera access
                </Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={{
                borderRadius: RADIUS.md,
                overflow: "hidden",
                height: 420,
                maxWidth: 480,
              }}
            >
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
            style={[shared.input, { marginBottom: 16 }]}
            placeholder="Search vendor or stall…"
            value={search}
            onChangeText={setSearch}
          />

          {loading ? (
            <ActivityIndicator color={COLORS.inkNavy} />
          ) : filtered.length === 0 ? (
            <View style={shared.emptyState}>
              <Text style={shared.emptyStateText}>
                Nobody paid & waiting for this session yet.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
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
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <View style={[shared.badge, { backgroundColor: bg }]}>
                        <Text style={[shared.badgeText, { color: fg }]}>
                          {r.status}
                        </Text>
                      </View>
                      <Pressable
                        style={
                          isIn ? shared.secondaryButton : shared.successButton
                        }
                        disabled={actingOnId === r.id}
                        onPress={() => setCheckedIn(r.id, !isIn)}
                      >
                        <Text
                          style={
                            isIn
                              ? shared.secondaryButtonText
                              : shared.successButtonText
                          }
                        >
                          {isIn ? "Undo" : "Check In"}
                        </Text>
                      </Pressable>
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
