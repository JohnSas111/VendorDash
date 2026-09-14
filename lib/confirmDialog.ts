// lib/confirmDialog.ts
//
// React Native's Alert.alert(title, message, buttons) — the
// multi-button confirm-style dialog — doesn't render anything on web
// via react-native-web. It just silently no-ops, which is why a
// button wired to it looks "unclickable" even though the press is
// registering fine. This wraps window.confirm/window.alert on web and
// Alert.alert on native behind two small async-friendly helpers, used
// across the organizer screens instead of calling Alert.alert directly.

import { Alert, Platform } from "react-native";

// Yes/no confirmation. Resolves true if the user confirmed.
export function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

// Simple one-button notice (errors, confirmations with no choice to make).
export function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}
