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

// Local-date-safe "YYYY-MM-DD" formatter — no UTC conversion, so it
// can't shift the day depending on the organizer's timezone.
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
  const [fridayInput, setFridayInput] = useState(""); // YYYY-MM-DD
  const [creating, setCreating] = useState(false);
  const [recurringBanner, setRecurringBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);
    const { data } = await supabase
      .from("market_sessions")
      .select("id, friday_date, saturday_date, sunday_date, status")
      .eq("venue_id", venue.id)
      .order("friday_date", { ascending: false });
    setSessions(data ?? []);
    setLoading(false);
  }, [venue]);

  useEffect(() => {
    load();
  }, [load]);

  const createSession = async () => {
    if (!venue) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fridayInput)) {
      notify("Invalid date", "Enter the Friday date as YYYY-MM-DD.");
      return;
    }

    // Parse the typed string as plain local y/m/d — not through a
    // UTC-interpreting Date constructor — so no timezone shift sneaks in.
    const [fy, fm, fd] = fridayInput.split("-").map(Number);
    const friday = new Date(fy, fm - 1, fd);
    const saturday = new Date(fy, fm - 1, fd + 1);
    const sunday = new Date(fy, fm - 1, fd + 2);

    const fridayISO = toISODate(friday);

    setCreating(true);
    setRecurringBanner(null);

    // Duplicate check. NOTE: this is a client-side check, so it's still
    // possible (though unlikely) for two simultaneous creates to race
    // past it. For full protection, also run in Supabase SQL editor:
    //   alter table market_sessions
    //     add constraint uq_session_venue_friday unique (venue_id, friday_date);
    const { data: existing } = await supabase
      .from("market_sessions")
      .select("id")
      .eq("venue_id", venue.id)
      .eq("friday_date", fridayISO)
      .maybeSingle();

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

    // Check whether the recurring-booking trigger auto-created holds.
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", newSession.id)
      .eq("status", "pending");

    if ((count ?? 0) > 0) {
      setRecurringBanner(
        `${count} recurring vendor${count === 1 ? "" : "s"} auto-reserved a stall for this session (24h to pay before it expires).`,
      );
    }
  };

  const advanceStatus = async (session: Session) => {
    const next = NEXT_STATUS[session.status];
    if (!next) return;
    const { error } = await supabase
      .from("market_sessions")
      .update({ status: next })
      .eq("id", session.id);
    if (error) notify("Error", error.message);
    load();
  };

  const cancelSession = async (session: Session) => {
    const confirmed = await confirmAsync(
      "Cancel session",
      "This marks the session cancelled. Existing bookings are not auto-refunded.",
    );
    if (!confirmed) return;

    const { error } = await supabase
      .from("market_sessions")
      .update({ status: "cancelled" })
      .eq("id", session.id);
    if (error) notify("Error", error.message);
    load();
  };

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

      <View style={shared.card}>
        <Text style={shared.label}>Friday date (YYYY-MM-DD)</Text>
        <TextInput
          style={shared.input}
          value={fridayInput}
          onChangeText={setFridayInput}
          placeholder="2026-09-11"
        />
        <Pressable
          style={[
            shared.primaryButton,
            { marginTop: 14, alignSelf: "flex-start" },
          ]}
          onPress={createSession}
          disabled={creating}
        >
          <Text style={shared.primaryButtonText}>
            {creating ? "Creating…" : "Create session"}
          </Text>
        </Pressable>
      </View>

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
          <Text style={{ color: COLORS.inkNavy, fontSize: 13 }}>
            {recurringBanner}
          </Text>
        </View>
      )}

      <Text style={shared.sectionHeading}>All sessions</Text>
      <View style={{ gap: 10 }}>
        {sessions.map((s) => {
          const { bg, fg } = statusColors(s.status);
          const next = NEXT_STATUS[s.status];
          return (
            <View
              key={s.id}
              style={[shared.row, isDesktop && shared.rowDesktop]}
            >
              <View>
                <Text style={shared.rowTitle}>
                  {formatDate(s.friday_date)} – {formatDate(s.sunday_date)}
                </Text>
                <View
                  style={[shared.badge, { backgroundColor: bg, marginTop: 6 }]}
                >
                  <Text style={[shared.badgeText, { color: fg }]}>
                    {s.status}
                  </Text>
                </View>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  marginTop: isDesktop ? 0 : 10,
                }}
              >
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
        })}
      </View>
    </ScrollView>
  );
}
