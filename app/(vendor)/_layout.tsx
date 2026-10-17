// PATH: app/(vendor)/_layout.tsx  (replace the file at exactly this path)
import { Colors } from "@/constants/theme";
import { registerForPush } from "@/lib/push";
import * as Notifications from "expo-notifications";
import { Stack, router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

// Remember which tapped push was already handled, so signing out and back in
// doesn't replay an old tap.
let handledPushId: string | null = null;

// Tapping a push (app closed, in background, or open) opens Notifications.
// Its own component so it is only mounted on phones: the notification hook
// does not exist on web and crashed the whole web app.
function PushTapHandler() {
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
  return null;
}

export default function VendorLayout() {
  // Save this phone's push token once the vendor area opens (after login).
  useEffect(() => {
    registerForPush();
  }, []);

  return (
    <>
      {Platform.OS !== "web" && <PushTapHandler />}
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
        <Stack.Screen
          name="stall-detail"
          options={{ headerTitle: "Stall details" }}
        />
        <Stack.Screen name="payment" />
        <Stack.Screen
          name="confirmation"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="complete-profile" />
        <Stack.Screen name="sales-submission" />
        <Stack.Screen name="notifications" />
        <Stack.Screen
          name="booking-detail"
          options={{ headerTitle: "Booking" }}
        />
      </Stack>
    </>
  );
}
