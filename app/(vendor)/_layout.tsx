import { Stack } from "expo-router";

export default function VendorLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: "",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: "#F5F5F5" },
        headerTintColor: "#1A1A1A",
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
