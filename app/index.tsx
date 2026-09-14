// app/index.tsx
//
// Resolves the "Unmatched Route" at bare localhost:8081 — expo-router
// needs something at the literal root path. This checks auth state
// and role, then sends the user to the right place:
//   not signed in       -> /login
//   signed in, organizer -> /(organizer)/(tabs)/overview
//   signed in, vendor    -> /(vendor)/(tabs)/home

import { COLORS, shared } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

export default function Index() {
  const [checking, setChecking] = useState(true);
  const [destination, setDestination] = useState<string>("/login");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setDestination("/login");
        setChecking(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      setDestination(
        profile?.role === "organizer"
          ? "/(organizer)/(tabs)/overview"
          : "/(vendor)/(tabs)/home",
      );
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

  return <Redirect href={destination as any} />;
}
