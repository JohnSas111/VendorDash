// PATH: app/(vendor)/_layout.tsx  (replace the file at exactly this path)
import { Colors } from "@/constants/theme";
import { registerForPush } from "@/lib/push";
import * as Notifications from "expo-notifications";
import { Stack, router } from "expo-router";
import { useEffect } from "react";

// Remember which tapped push was already handled, so signing out and back in
// doesn't replay an old tap.
let handledPushId: string | null = null;

export default function VendorLayout() {
  // Save this phone's push token once the vendor area opens (after login).
  useEffect(() => {
    registerForPush();
  }, []);

  // Tapping a push (app closed, in background, or open) opens Notifications.
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    if (
      lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    )
      return;
    const id = lastResponse.notification.request.identifier;
    if (handledPushId === id) return;
    handledPushId = id;
    router.push("/(vendor)/notifications");
  }, [lastResponse]);

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: "",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.background },
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
      }}
    >
      {/* The tab bar itself — Home / My Bookings / Settings */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

      <Stack.Screen name="floor-map" />
      <Stack.Screen name="stall-detail" />
      <Stack.Screen name="payment" />
      <Stack.Screen
        name="confirmation"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen name="complete-profile" />
      <Stack.Screen name="sales-submission" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="booking-detail" />
    </Stack>
  );
}
