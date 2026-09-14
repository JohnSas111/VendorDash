import { COLORS, shared } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { Redirect, Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

export default function OrganizerLayout() {
  const [checking, setChecking] = useState(true);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setSignedIn(false);
        setChecking(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      setIsOrganizer(profile?.role === "organizer");
      setChecking(false);
    })();
  }, []);

  if (checking) {
    return (
      <View style={shared.centerFill}>
        <ActivityIndicator color={COLORS.inkNavy} />
      </View>
    );
  }

  if (!signedIn) return <Redirect href="/login" />;
  if (!isOrganizer) return <Redirect href="/(vendor)/(tabs)/home" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
