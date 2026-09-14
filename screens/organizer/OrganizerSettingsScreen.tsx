import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import { BREAKPOINT, COLORS, shared } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: "", phone: "" });
  const [venueForm, setVenueForm] = useState({
    name: "",
    address: "",
    description: "",
  });

  const load = useCallback(async () => {
    if (!venue || !userId) return;
    setLoading(true);

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", userId)
      .single();

    setProfileForm({
      full_name: profile?.full_name ?? "",
      phone: profile?.phone ?? "",
    });

    const { data: venueRow } = await supabase
      .from("venues")
      .select("name, address, description")
      .eq("id", venue.id)
      .single();

    setVenueForm({
      name: venueRow?.name ?? "",
      address: venueRow?.address ?? "",
      description: venueRow?.description ?? "",
    });
    setLoading(false);
  }, [venue, userId]);

  useEffect(() => {
    load();
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
    if (error) Alert.alert("Error", error.message);
    else Alert.alert("Saved", "Your profile was updated.");
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
    if (error) Alert.alert("Error", error.message);
    else {
      Alert.alert("Saved", "Venue details updated.");
      reload();
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
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
      <Text style={shared.title}>Settings</Text>

      <Text style={shared.sectionHeading}>Your profile</Text>
      <View style={shared.card}>
        <Text style={shared.label}>Full name</Text>
        <TextInput
          style={shared.input}
          value={profileForm.full_name}
          onChangeText={(t) => setProfileForm((f) => ({ ...f, full_name: t }))}
        />
        <Text style={shared.label}>Phone number</Text>
        <TextInput
          style={shared.input}
          value={profileForm.phone}
          onChangeText={(t) => setProfileForm((f) => ({ ...f, phone: t }))}
          keyboardType="phone-pad"
          placeholder="09xxxxxxxxx"
        />
        <Pressable
          style={[
            shared.primaryButton,
            { marginTop: 16, alignSelf: "flex-start" },
          ]}
          onPress={saveProfile}
          disabled={saving}
        >
          <Text style={shared.primaryButtonText}>
            {saving ? "Saving…" : "Save profile"}
          </Text>
        </Pressable>
      </View>

      <Text style={shared.sectionHeading}>Venue</Text>
      <View style={shared.card}>
        <Text style={shared.label}>Venue name</Text>
        <TextInput
          style={shared.input}
          value={venueForm.name}
          onChangeText={(t) => setVenueForm((f) => ({ ...f, name: t }))}
        />
        <Text style={shared.label}>Address</Text>
        <TextInput
          style={shared.input}
          value={venueForm.address}
          onChangeText={(t) => setVenueForm((f) => ({ ...f, address: t }))}
        />
        <Text style={shared.label}>Description (optional)</Text>
        <TextInput
          style={[shared.input, { minHeight: 80, textAlignVertical: "top" }]}
          value={venueForm.description}
          onChangeText={(t) => setVenueForm((f) => ({ ...f, description: t }))}
          multiline
        />
        <Pressable
          style={[
            shared.primaryButton,
            { marginTop: 16, alignSelf: "flex-start" },
          ]}
          onPress={saveVenue}
          disabled={saving}
        >
          <Text style={shared.primaryButtonText}>
            {saving ? "Saving…" : "Save venue"}
          </Text>
        </Pressable>
      </View>

      <Pressable
        style={[
          shared.dangerOutlineButton,
          { marginTop: 28, alignSelf: "flex-start" },
        ]}
        onPress={signOut}
      >
        <Text style={shared.dangerOutlineButtonText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
