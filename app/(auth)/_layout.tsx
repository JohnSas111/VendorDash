// PATH: app/(auth)/_layout.tsx  (replace the file at exactly this path)
import { Colors } from "@/constants/theme";
import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="complete-profile" />
    </Stack>
  );
}
