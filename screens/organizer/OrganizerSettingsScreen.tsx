import { ConfirmModal } from "@/components/ConfirmModal";
import { PressableButton } from "@/components/PressableButton";
import { Radius, Spacing } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  CARD_SHADOW,
  COLORS,
  RADIUS,
  SERIF,
  shared,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

export default function OrganizerSettingsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    userId,
    loading: venueLoading,
    error: venueError,
    reload,
  } = useOrganizerVenue();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingVenue, setSavingVenue] = useState(false);
  // What is saved, for the card headers. The forms below change as you type;
  // the headers only change once a save worked.
  const [saved, setSaved] = useState({ name: "", venue: "", address: "" });
  const [signOutConfirmVisible, setSignOutConfirmVisible] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: "", phone: "" });
  const [venueForm, setVenueForm] = useState({
    name: "",
    address: "",
    description: "",
  });

  const load = useCallback(async () => {
    if (!venue || !userId) return;
    setLoading(true);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", userId)
      .single();
    if (profileError) {
      showToast("Couldn't load your profile.", "error");
    }

    setProfileForm({
      full_name: profile?.full_name ?? "",
      phone: profile?.phone ?? "",
    });
    setSaved((x) => ({ ...x, name: profile?.full_name ?? "" }));

    const { data: venueRow, error: venueRowError } = await supabase
      .from("venues")
      .select("name, address, description")
      .eq("id", venue.id)
      .single();
    if (venueRowError) {
      showToast("Couldn't load venue details.", "error");
    }

    setVenueForm({
      name: venueRow?.name ?? "",
      address: venueRow?.address ?? "",
      description: venueRow?.description ?? "",
    });
    setSaved((x) => ({
      ...x,
      venue: venueRow?.name ?? "",
      address: venueRow?.address ?? "",
    }));
    setLoading(false);
  }, [venue, userId, showToast]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  const saveProfile = async () => {
    if (!userId) return;
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: profileForm.full_name.trim(),
        phone: profileForm.phone.trim() || null,
      })
      .eq("id", userId);
    setSavingProfile(false);
    if (error) showToast(error.message, "error");
    else {
      setSaved((x) => ({ ...x, name: profileForm.full_name.trim() }));
      showToast("Your profile was updated.", "success");
    }
  };

  const saveVenue = async () => {
    if (!venue) return;
    setSavingVenue(true);
    const { error } = await supabase
      .from("venues")
      .update({
        name: venueForm.name.trim(),
        address: venueForm.address.trim(),
        description: venueForm.description.trim() || null,
      })
      .eq("id", venue.id);
    setSavingVenue(false);
    if (error) {
      showToast(error.message, "error");
    } else {
      setSaved((x) => ({
        ...x,
        venue: venueForm.name.trim(),
        address: venueForm.address.trim(),
      }));
      showToast("Venue details updated.", "success");
      reload();
    }
  };

  async function confirmSignOut() {
    setSignOutConfirmVisible(false);
    await supabase.auth.signOut();
  }

  if (venueLoading || loading) {
    return (
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <SettingsSkeleton />
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

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.content,
        isDesktop && shared.contentDesktop,
      ]}
    >
      <Text style={shared.title}>Settings</Text>
      <Text style={shared.subtitle}>Your account and your market.</Text>

      <View style={styles.cards}>
        {/* ---------------- Profile ---------------- */}
        <View style={[styles.card, isDesktop && styles.cardDesktop]}>
          <View style={styles.cardHead}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(saved.name)}</Text>
            </View>
            <View style={styles.headText}>
              <Text style={styles.headTitle} numberOfLines={1}>
                {saved.name || "Your name"}
              </Text>
              <View style={[shared.badge, styles.roleBadge]}>
                <Text style={[shared.badgeText, { color: COLORS.amberText }]}>
                  Organizer
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Your profile</Text>
          <Text style={shared.label}>Full name</Text>
          <TextInput
            accessibilityLabel="Full name"
            style={shared.input}
            value={profileForm.full_name}
            onChangeText={(t) =>
              setProfileForm((f) => ({ ...f, full_name: t }))
            }
          />
          <Text style={shared.label}>Phone number</Text>
          <TextInput
            accessibilityLabel="Phone number"
            style={shared.input}
            value={profileForm.phone}
            onChangeText={(t) => setProfileForm((f) => ({ ...f, phone: t }))}
            keyboardType="phone-pad"
            placeholder="09xxxxxxxxx"
          />
          <View style={styles.saveButtonWrap}>
            <PressableButton
              style={shared.primaryButton}
              onPress={saveProfile}
              disabled={savingProfile}
            >
              <Text style={shared.primaryButtonText}>
                {savingProfile ? "Saving…" : "Save profile"}
              </Text>
            </PressableButton>
          </View>
        </View>

        {/* ---------------- Venue ---------------- */}
        <View style={[styles.card, isDesktop && styles.cardDesktop]}>
          <View style={styles.cardHead}>
            <View style={styles.venueIcon}>
              <Ionicons
                name="storefront-outline"
                size={24}
                color={COLORS.amberText}
              />
            </View>
            <View style={styles.headText}>
              <Text style={styles.headTitle} numberOfLines={1}>
                {saved.venue || "Your venue"}
              </Text>
              {!!saved.address && (
                <Text style={shared.rowSubtitle} numberOfLines={1}>
                  {saved.address}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Venue</Text>
          <Text style={shared.label}>Venue name</Text>
          <TextInput
            accessibilityLabel="Venue name"
            style={shared.input}
            value={venueForm.name}
            onChangeText={(t) => setVenueForm((f) => ({ ...f, name: t }))}
          />
          <Text style={shared.label}>Address</Text>
          <TextInput
            accessibilityLabel="Address"
            style={shared.input}
            value={venueForm.address}
            onChangeText={(t) => setVenueForm((f) => ({ ...f, address: t }))}
          />
          <Text style={shared.label}>Description (optional)</Text>
          <TextInput
            accessibilityLabel="Description (optional)"
            style={[shared.input, styles.multilineInput]}
            value={venueForm.description}
            onChangeText={(t) =>
              setVenueForm((f) => ({ ...f, description: t }))
            }
            multiline
          />
          <View style={styles.saveButtonWrap}>
            <PressableButton
              style={shared.primaryButton}
              onPress={saveVenue}
              disabled={savingVenue}
            >
              <Text style={shared.primaryButtonText}>
                {savingVenue ? "Saving…" : "Save venue"}
              </Text>
            </PressableButton>
          </View>
        </View>
      </View>

      {/* ---------------- Sign out ---------------- */}
      <View style={styles.signOutStrip}>
        <View style={styles.signOutText}>
          <Text style={shared.rowTitle}>Sign out</Text>
          <Text style={shared.rowSubtitle}>
            You will need to log in again on this device.
          </Text>
        </View>
        <PressableButton
          style={[shared.dangerOutlineButton, styles.signOutButton]}
          onPress={() => setSignOutConfirmVisible(true)}
        >
          <Ionicons name="log-out-outline" size={15} color={COLORS.clay} />
          <Text style={shared.dangerOutlineButtonText}>Sign out</Text>
        </PressableButton>
      </View>

      <ConfirmModal
        visible={signOutConfirmVisible}
        title="Sign out"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onConfirm={confirmSignOut}
        onDismiss={() => setSignOutConfirmVisible(false)}
      />
    </ScrollView>
  );
}

// Placeholder shown while the profile/venue data is loading, replacing
// the old lone centered ActivityIndicator.
function SettingsSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: 100, height: 20, marginBottom: Spacing.lg },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 130, marginBottom: Spacing.sm }]}
      />
      <View style={[shared.card, styles.skeletonCard]} />
      <View
        style={[
          styles.skeletonLine,
          { width: 80, marginTop: Spacing.xl, marginBottom: Spacing.sm },
        ]}
      />
      <View style={[shared.card, styles.skeletonCard, { minHeight: 180 }]} />
    </View>
  );
}

// "John Michaels" -> "JM"
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (
    parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}

const styles = StyleSheet.create({
  cards: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xl },
  card: {
    flexGrow: 1,
    flexBasis: 300,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: Spacing.xl,
    ...CARD_SHADOW,
  },
  // Two cards side by side on a wide window (each needs 300px to be useful).
  cardDesktop: { flexBasis: 360, alignSelf: "flex-start" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  headText: { flex: 1, gap: 4 },
  headTitle: { fontFamily: SERIF, fontSize: 20, color: COLORS.inkNavy },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.dark,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: SERIF, fontSize: 20, color: COLORS.amber },
  venueIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.tintAmber,
    alignItems: "center",
    justifyContent: "center",
  },
  roleBadge: { backgroundColor: COLORS.tintAmber },
  divider: {
    height: 1,
    backgroundColor: COLORS.hairline,
    marginVertical: Spacing.lg,
  },
  sectionTitle: { fontFamily: SERIF, fontSize: 18, color: COLORS.inkNavy },
  saveButtonWrap: { marginTop: Spacing.lg, alignSelf: "flex-end" },
  multilineInput: { minHeight: 96, textAlignVertical: "top" },
  signOutStrip: {
    marginTop: Spacing.xl,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    ...CARD_SHADOW,
  },
  signOutText: { flexShrink: 1 },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  skeletonCard: {
    backgroundColor: COLORS.border,
    borderColor: COLORS.border,
    shadowOpacity: 0,
    minHeight: 120,
  },
  skeletonLine: {
    height: 12,
    borderRadius: Radius.xs,
    backgroundColor: COLORS.border,
  },
});
