import { ConfirmModal } from "@/components/ConfirmModal";
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
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
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
  const { showToast } = useToast();

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

  // Cancel confirmation
  const [pendingCancel, setPendingCancel] = useState<Session | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("market_sessions")
      .select("id, friday_date, saturday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .order("friday_date", { ascending: false });

    if (error) {
      showToast(error.message, "error");
      setSessions([]);
    } else {
      setSessions(data ?? []);
    }

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

  // ------------------------------------------------------------
  // CREATE SESSION
  // ------------------------------------------------------------

  const createSession = async () => {
    if (!venue) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fridayInput)) {
      showToast("Enter the Friday date as YYYY-MM-DD.", "error");
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
      showToast("Please enter a valid calendar date.", "error");
      return;
    }

    if (friday.getDay() !== 5) {
      showToast("The date you entered is not a Friday.", "error");
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
      showToast(duplicateCheckError.message, "error");
      return;
    }

    if (existing) {
      setCreating(false);
      showToast(
        `There's already a session starting ${formatDate(fridayISO)}.`,
        "error",
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
      showToast(error?.message ?? "Could not create session.", "error");
      return;
    }

    setFridayInput("");
    showToast("Session created.", "success");

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
      showToast("Enter the Friday date as YYYY-MM-DD.", "error");
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
      showToast("Please enter a valid calendar date.", "error");
      return;
    }

    // Friday = 5 in JavaScript Date.
    if (friday.getDay() !== 5) {
      showToast("The date you entered is not a Friday.", "error");
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
      showToast(duplicateCheckError.message, "error");
      return;
    }

    if (existing) {
      showToast(
        `There's already a session starting ${formatDate(fridayISO)}.`,
        "error",
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
      showToast(error.message, "error");
      return;
    }

    setEditingSession(null);
    setEditFridayInput("");

    await load();

    showToast("Session dates updated.", "success");
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
      showToast(error.message, "error");
      return;
    }

    await load();
  };

  // ------------------------------------------------------------
  // CANCEL SESSION
  // ------------------------------------------------------------

  const requestCancel = (session: Session) => {
    setPendingCancel(session);
  };

  const confirmCancel = async () => {
    const session = pendingCancel;
    if (!session) return;
    setPendingCancel(null);

    const { error } = await supabase
      .from("market_sessions")
      .update({
        status: "cancelled",
      })
      .eq("id", session.id);

    if (error) {
      showToast(error.message, "error");
      return;
    }

    showToast("Session cancelled.", "info");
    await load();
  };

  // ------------------------------------------------------------
  // LOADING / ERROR
  // ------------------------------------------------------------

  if (venueLoading || loading) {
    return (
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <SessionsSkeleton />
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
          accessibilityLabel="Friday date (YYYY-MM-DD)"
          style={shared.input}
          value={fridayInput}
          onChangeText={setFridayInput}
          placeholder="2026-09-18"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <PressableButton
          style={[shared.primaryButton, styles.createButton]}
          onPress={createSession}
          disabled={creating}
        >
          <Text style={shared.primaryButtonText}>
            {creating ? "Creating…" : "Create session"}
          </Text>
        </PressableButton>
      </View>

      {/* -------------------------------------------------- */}
      {/* RECURRING BOOKING MESSAGE */}
      {/* -------------------------------------------------- */}

      {recurringBanner && (
        <View style={[shared.card, styles.recurringBanner]}>
          <Ionicons name="repeat" size={16} color={COLORS.amber} />
          <Text style={styles.recurringBannerText}>{recurringBanner}</Text>
        </View>
      )}

      {/* -------------------------------------------------- */}
      {/* SESSION LIST */}
      {/* -------------------------------------------------- */}

      <Text style={shared.sectionHeading}>All sessions</Text>

      <View style={styles.list}>
        {sessions.length === 0 ? (
          <View style={shared.emptyState}>
            <Ionicons name="calendar-outline" size={26} color={COLORS.slate} />
            <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
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
                      styles.statusBadge,
                      { backgroundColor: bg },
                    ]}
                  >
                    <Text style={[shared.badgeText, { color: fg }]}>
                      {s.status}
                    </Text>
                  </View>
                </View>

                {/* ACTIONS */}
                <View
                  style={[
                    styles.rowActions,
                    !isDesktop && styles.rowActionsMobile,
                  ]}
                >
                  {canEdit && (
                    <PressableButton
                      style={[shared.secondaryButton, styles.actionButton]}
                      onPress={() => openEdit(s)}
                    >
                      <Ionicons
                        name="pencil"
                        size={14}
                        color={COLORS.inkNavy}
                      />
                      <Text style={shared.secondaryButtonText}>Edit</Text>
                    </PressableButton>
                  )}

                  {next && (
                    <PressableButton
                      style={[shared.successButton, styles.actionButton]}
                      onPress={() => advanceStatus(s)}
                    >
                      <Ionicons
                        name="arrow-forward-circle"
                        size={14}
                        color={COLORS.white}
                      />
                      <Text style={shared.successButtonText}>Mark {next}</Text>
                    </PressableButton>
                  )}

                  {s.status !== "cancelled" && s.status !== "completed" && (
                    <PressableButton
                      style={[shared.dangerOutlineButton, styles.actionButton]}
                      onPress={() => requestCancel(s)}
                    >
                      <Ionicons
                        name="close-circle-outline"
                        size={14}
                        color={COLORS.clay}
                      />
                      <Text style={shared.dangerOutlineButtonText}>Cancel</Text>
                    </PressableButton>
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
        <View style={styles.modalBackdrop}>
          <View style={[shared.card, styles.editCard]}>
            <Text style={shared.rowTitle}>Edit session</Text>

            <Text style={shared.label}>Friday date (YYYY-MM-DD)</Text>

            <TextInput
              accessibilityLabel="Friday date (YYYY-MM-DD)"
              style={shared.input}
              value={editFridayInput}
              onChangeText={setEditFridayInput}
              placeholder="2026-09-18"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.editHint}>
              Saturday and Sunday will be calculated automatically.
            </Text>

            <View style={styles.editActions}>
              <PressableButton
                style={[shared.secondaryButton, styles.editActionButton]}
                onPress={() => {
                  setEditingSession(null);
                  setEditFridayInput("");
                }}
              >
                <Text style={shared.secondaryButtonText}>Cancel</Text>
              </PressableButton>

              <PressableButton
                style={[shared.primaryButton, styles.editActionButton]}
                onPress={saveEdit}
                disabled={savingEdit}
              >
                <Text style={shared.primaryButtonText}>
                  {savingEdit ? "Saving…" : "Save"}
                </Text>
              </PressableButton>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={!!pendingCancel}
        title="Cancel session"
        message="This marks the session cancelled. Existing bookings are not auto-refunded."
        confirmLabel="Cancel session"
        cancelLabel="Go back"
        onConfirm={confirmCancel}
        onDismiss={() => setPendingCancel(null)}
      />
    </ScrollView>
  );
}

// Placeholder shown while sessions are loading.
function SessionsSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: 100, height: 22, marginBottom: Spacing.sm },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 220, marginBottom: Spacing.lg }]}
      />
      <View
        style={[
          shared.card,
          styles.skeletonBlock,
          { minHeight: 100, marginBottom: Spacing.lg },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 110, marginBottom: Spacing.sm }]}
      />
      <View style={styles.list}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[shared.row, styles.skeletonBlock, { minHeight: 64 }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  createButton: { marginTop: Spacing.md, alignSelf: "flex-start" },
  recurringBanner: {
    marginTop: Spacing.md,
    borderColor: COLORS.amber,
    backgroundColor: Colors.warningLight,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  recurringBannerText: {
    color: COLORS.inkNavy,
    fontSize: Typography.base,
    flex: 1,
  },
  list: { gap: Spacing.sm },
  statusBadge: { marginTop: Spacing.sm },
  rowActions: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "center",
    flexWrap: "wrap",
  },
  rowActionsMobile: { marginTop: Spacing.md },
  actionButton: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  editCard: { width: "100%", maxWidth: 420 },
  editHint: {
    marginTop: Spacing.sm,
    color: COLORS.slate,
    fontSize: Typography.base,
  },
  editActions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.xl },
  editActionButton: { flex: 1, alignItems: "center" },
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
