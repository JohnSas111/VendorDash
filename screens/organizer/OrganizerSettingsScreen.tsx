import { ConfirmModal } from "@/components/ConfirmModal";
import { PressableButton } from "@/components/PressableButton";
import { Radius, Spacing } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import { BREAKPOINT, COLORS, shared } from "@/lib/organizerTheme";
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
  const [saving, setSaving] = useState(false);
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
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: profileForm.full_name.trim(),
        phone: profileForm.phone.trim() || null,
      })
      .eq("id", userId);
    setSaving(false);
    if (error) showToast(error.message, "error");
    else showToast("Your profile was updated.", "success");
  };

  const saveVenue = async () => {
    if (!venue) return;
    setSaving(true);
    const { error } = await supabase
      .from("venues")
      .update({
        name: venueForm.name.trim(),
        address: venueForm.address.trim(),
        description: venueForm.description.trim() || null,
      })
      .eq("id", venue.id);
    setSaving(false);
    if (error) {
      showToast(error.message, "error");
    } else {
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

      <Text style={shared.sectionHeading}>Your profile</Text>
      <View style={shared.card}>
        <Text style={shared.label}>Full name</Text>
        <TextInput
          accessibilityLabel="Full name"
          style={shared.input}
          value={profileForm.full_name}
          onChangeText={(t) => setProfileForm((f) => ({ ...f, full_name: t }))}
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
            disabled={saving}
          >
            <Text style={shared.primaryButtonText}>
              {saving ? "Saving…" : "Save profile"}
            </Text>
          </PressableButton>
        </View>
      </View>

      <Text style={shared.sectionHeading}>Venue</Text>
      <View style={shared.card}>
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
          onChangeText={(t) => setVenueForm((f) => ({ ...f, description: t }))}
          multiline
        />
        <View style={styles.saveButtonWrap}>
          <PressableButton
            style={shared.primaryButton}
            onPress={saveVenue}
            disabled={saving}
          >
            <Text style={shared.primaryButtonText}>
              {saving ? "Saving…" : "Save venue"}
            </Text>
          </PressableButton>
        </View>
      </View>

      <View style={styles.signOutWrap}>
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

const styles = StyleSheet.create({
  saveButtonWrap: { marginTop: Spacing.lg, alignSelf: "flex-start" },
  multilineInput: { minHeight: 80, textAlignVertical: "top" },
  signOutWrap: { marginTop: Spacing.xxl, alignSelf: "flex-start" },
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
