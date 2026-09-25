import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import { confirmAsync, notify } from "@/lib/confirmDialog";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

type Session = {
  id: string;
  friday_date: string;
  saturday_date: string;
  sunday_date: string;
  status: string;
};

const NEXT_STATUS: Record<string, string | null> = {
  upcoming: "open",
  open: "closed",
  closed: "completed",
  completed: null,
  cancelled: null,
};

// Local-date-safe "YYYY-MM-DD" formatter.
// Uses local year/month/day instead of UTC conversion.
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

export default function SessionScheduleScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;

  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [fridayInput, setFridayInput] = useState("");
  const [creating, setCreating] = useState(false);

  // Recurring booking message
  const [recurringBanner, setRecurringBanner] = useState<string | null>(null);

  // Edit form
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editFridayInput, setEditFridayInput] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    if (!venue) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("market_sessions")
      .select("id, friday_date, saturday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .order("friday_date", { ascending: false });

    if (error) {
      notify("Error", error.message);
      setSessions([]);
    } else {
      setSessions(data ?? []);
    }

    setLoading(false);
  }, [venue]);

  useEffect(() => {
    load();
  }, [load]);

  // ------------------------------------------------------------
  // CREATE SESSION
  // ------------------------------------------------------------

  const createSession = async () => {
    if (!venue) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fridayInput)) {
      notify("Invalid date", "Enter the Friday date as YYYY-MM-DD.");
      return;
    }

    // Parse typed date as local year/month/day.
    const [fy, fm, fd] = fridayInput.split("-").map(Number);

    const friday = new Date(fy, fm - 1, fd);
    const saturday = new Date(fy, fm - 1, fd + 1);
    const sunday = new Date(fy, fm - 1, fd + 2);

    // Make sure the entered date is actually Friday.
    if (
      friday.getFullYear() !== fy ||
      friday.getMonth() !== fm - 1 ||
      friday.getDate() !== fd
    ) {
      notify("Invalid date", "Please enter a valid calendar date.");
      return;
    }

    if (friday.getDay() !== 5) {
      notify("Invalid Friday", "The date you entered is not a Friday.");
      return;
    }

    const fridayISO = toISODate(friday);

    setCreating(true);
    setRecurringBanner(null);

    // Prevent duplicate sessions for the same venue and Friday.
    const { data: existing, error: duplicateCheckError } = await supabase
      .from("market_sessions")
      .select("id")
      .eq("venue_id", venue.id)
      .eq("friday_date", fridayISO)
      .maybeSingle();

    if (duplicateCheckError) {
      setCreating(false);

      notify("Error", duplicateCheckError.message);

      return;
    }

    if (existing) {
      setCreating(false);

      notify(
        "Session already exists",
        `There's already a session starting ${formatDate(fridayISO)}.`,
      );

      return;
    }

    const { data: newSession, error } = await supabase
      .from("market_sessions")
      .insert({
        venue_id: venue.id,
        friday_date: fridayISO,
        saturday_date: toISODate(saturday),
        sunday_date: toISODate(sunday),
      })
      .select("id")
      .single();

    setCreating(false);

    if (error || !newSession) {
      notify("Error", error?.message ?? "Could not create session.");

      return;
    }

    setFridayInput("");

    await load();

    // Check whether recurring-booking logic created
    // pending bookings for this session.
    const { count } = await supabase
      .from("bookings")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("session_id", newSession.id)
      .eq("status", "pending");

    if ((count ?? 0) > 0) {
      setRecurringBanner(
        `${count} recurring vendor${
          count === 1 ? "" : "s"
        } auto-reserved a stall for this session (24h to pay before it expires).`,
      );
    }
  };

  // ------------------------------------------------------------
  // EDIT SESSION
  // ------------------------------------------------------------

  const openEdit = (session: Session) => {
    setEditingSession(session);
    setEditFridayInput(session.friday_date);
  };

  const saveEdit = async () => {
    if (!editingSession || !venue) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(editFridayInput)) {
      notify("Invalid date", "Enter the Friday date as YYYY-MM-DD.");
      return;
    }

    const [fy, fm, fd] = editFridayInput.split("-").map(Number);

    const friday = new Date(fy, fm - 1, fd);

    const saturday = new Date(fy, fm - 1, fd + 1);

    const sunday = new Date(fy, fm - 1, fd + 2);

    // Check that the date actually exists.
    if (
      friday.getFullYear() !== fy ||
      friday.getMonth() !== fm - 1 ||
      friday.getDate() !== fd
    ) {
      notify("Invalid date", "Please enter a valid calendar date.");
      return;
    }

    // Friday = 5 in JavaScript Date.
    if (friday.getDay() !== 5) {
      notify("Invalid Friday", "The date you entered is not a Friday.");
      return;
    }

    const fridayISO = toISODate(friday);
    const saturdayISO = toISODate(saturday);
    const sundayISO = toISODate(sunday);

    // Check for another session using the same Friday.
    const { data: existing, error: duplicateCheckError } = await supabase
      .from("market_sessions")
      .select("id")
      .eq("venue_id", venue.id)
      .eq("friday_date", fridayISO)
      .neq("id", editingSession.id)
      .maybeSingle();

    if (duplicateCheckError) {
      notify("Error", duplicateCheckError.message);
      return;
    }

    if (existing) {
      notify(
        "Session already exists",
        `There's already a session starting ${formatDate(fridayISO)}.`,
      );
      return;
    }

    setSavingEdit(true);

    const { error } = await supabase
      .from("market_sessions")
      .update({
        friday_date: fridayISO,
        saturday_date: saturdayISO,
        sunday_date: sundayISO,
      })
      .eq("id", editingSession.id);

    setSavingEdit(false);

    if (error) {
      notify("Error", error.message);
      return;
    }

    setEditingSession(null);
    setEditFridayInput("");

    await load();

    notify("Session updated", "The market session dates have been updated.");
  };

  // ------------------------------------------------------------
  // ADVANCE SESSION STATUS
  // ------------------------------------------------------------

  const advanceStatus = async (session: Session) => {
    const next = NEXT_STATUS[session.status];

    if (!next) return;

    const { error } = await supabase
      .from("market_sessions")
      .update({
        status: next,
      })
      .eq("id", session.id);

    if (error) {
      notify("Error", error.message);
      return;
    }

    await load();
  };

  // ------------------------------------------------------------
  // CANCEL SESSION
  // ------------------------------------------------------------

  const cancelSession = async (session: Session) => {
    const confirmed = await confirmAsync(
      "Cancel session",
      "This marks the session cancelled. Existing bookings are not auto-refunded.",
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("market_sessions")
      .update({
        status: "cancelled",
      })
      .eq("id", session.id);

    if (error) {
      notify("Error", error.message);
      return;
    }

    await load();
  };

  // ------------------------------------------------------------
  // LOADING / ERROR
  // ------------------------------------------------------------

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

  // ------------------------------------------------------------
  // SCREEN
  // ------------------------------------------------------------

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.content,
        isDesktop && shared.contentDesktop,
      ]}
    >
      <Text style={shared.title}>Sessions</Text>

      <Text style={shared.subtitle}>
        One row per Friday–Sunday weekend run.
      </Text>

      {/* -------------------------------------------------- */}
      {/* CREATE SESSION */}
      {/* -------------------------------------------------- */}

      <View style={shared.card}>
        <Text style={shared.label}>Friday date (YYYY-MM-DD)</Text>

        <TextInput
          style={shared.input}
          value={fridayInput}
          onChangeText={setFridayInput}
          placeholder="2026-09-18"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable
          style={[
            shared.primaryButton,
            {
              marginTop: 14,
              alignSelf: "flex-start",
            },
          ]}
          onPress={createSession}
          disabled={creating}
        >
          <Text style={shared.primaryButtonText}>
            {creating ? "Creating…" : "Create session"}
          </Text>
        </Pressable>
      </View>

      {/* -------------------------------------------------- */}
      {/* RECURRING BOOKING MESSAGE */}
      {/* -------------------------------------------------- */}

      {recurringBanner && (
        <View
          style={[
            shared.card,
            {
              marginTop: 12,
              borderColor: COLORS.amber,
              backgroundColor: "#FDF1DF",
            },
          ]}
        >
          <Text
            style={{
              color: COLORS.inkNavy,
              fontSize: 13,
            }}
          >
            {recurringBanner}
          </Text>
        </View>
      )}

      {/* -------------------------------------------------- */}
      {/* SESSION LIST */}
      {/* -------------------------------------------------- */}

      <Text style={shared.sectionHeading}>All sessions</Text>

      <View style={{ gap: 10 }}>
        {sessions.length === 0 ? (
          <View style={shared.card}>
            <Text
              style={{
                color: COLORS.slate,
                fontSize: 13,
              }}
            >
              No market sessions yet.
            </Text>
          </View>
        ) : (
          sessions.map((s) => {
            const { bg, fg } = statusColors(s.status);

            const next = NEXT_STATUS[s.status];

            const canEdit = s.status === "upcoming";

            return (
              <View
                key={s.id}
                style={[shared.row, isDesktop && shared.rowDesktop]}
              >
                {/* SESSION INFO */}
                <View style={{ flex: 1 }}>
                  <Text style={shared.rowTitle}>
                    {formatDate(s.friday_date)} – {formatDate(s.sunday_date)}
                  </Text>

                  <View
                    style={[
                      shared.badge,
                      {
                        backgroundColor: bg,
                        marginTop: 6,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        shared.badgeText,
                        {
                          color: fg,
                        },
                      ]}
                    >
                      {s.status}
                    </Text>
                  </View>
                </View>

                {/* ACTIONS */}
                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    marginTop: isDesktop ? 0 : 10,
                    alignItems: "center",
                  }}
                >
                  {canEdit && (
                    <Pressable
                      style={shared.secondaryButton}
                      onPress={() => openEdit(s)}
                    >
                      <Text style={shared.secondaryButtonText}>Edit</Text>
                    </Pressable>
                  )}

                  {next && (
                    <Pressable
                      style={shared.successButton}
                      onPress={() => advanceStatus(s)}
                    >
                      <Text style={shared.successButtonText}>Mark {next}</Text>
                    </Pressable>
                  )}

                  {s.status !== "cancelled" && s.status !== "completed" && (
                    <Pressable
                      style={shared.dangerOutlineButton}
                      onPress={() => cancelSession(s)}
                    >
                      <Text style={shared.dangerOutlineButtonText}>Cancel</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* -------------------------------------------------- */}
      {/* EDIT SESSION MODAL */}
      {/* -------------------------------------------------- */}

      <Modal
        visible={!!editingSession}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingSession(null)}
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
          <View
            style={[
              shared.card,
              {
                width: "100%",
                maxWidth: 420,
              },
            ]}
          >
            <Text style={shared.rowTitle}>Edit session</Text>

            <Text style={shared.label}>Friday date (YYYY-MM-DD)</Text>

            <TextInput
              style={shared.input}
              value={editFridayInput}
              onChangeText={setEditFridayInput}
              placeholder="2026-09-18"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text
              style={{
                marginTop: 10,
                color: COLORS.slate,
                fontSize: 13,
              }}
            >
              Saturday and Sunday will be calculated automatically.
            </Text>

            <View
              style={{
                flexDirection: "row",
                gap: 10,
                marginTop: 20,
              }}
            >
              <Pressable
                style={[
                  shared.secondaryButton,
                  {
                    flex: 1,
                    alignItems: "center",
                  },
                ]}
                onPress={() => {
                  setEditingSession(null);
                  setEditFridayInput("");
                }}
              >
                <Text style={shared.secondaryButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[
                  shared.primaryButton,
                  {
                    flex: 1,
                    alignItems: "center",
                  },
                ]}
                onPress={saveEdit}
                disabled={savingEdit}
              >
                <Text style={shared.primaryButtonText}>
                  {savingEdit ? "Saving…" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
