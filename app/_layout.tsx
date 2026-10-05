import { supabase } from "@/lib/supabase";
import { ToastProvider } from "@/lib/toast";
import { Session } from "@supabase/supabase-js";
import { Slot, router, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      // Not logged in, trying to view a protected screen — send to login
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      // Logged in, but sitting on an auth screen — send to home
      router.replace("/(vendor)/(tabs)/home");
    }
  }, [session, segments, loading]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ToastProvider>
      <Slot />
    </ToastProvider>
  );
}
