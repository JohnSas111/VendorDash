import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Push notifications for the vendor phone.
//   registerForPush()    after login  -> asks permission, saves this phone's token
//   unregisterPush()     before logout -> removes this phone's token
// The database side is push_tokens + register/unregister_push_token().

const TOKEN_KEY = "vendordash.pushToken";

// Show the banner + sound when a push arrives while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(): Promise<void> {
  try {
    // Real Android/iOS phones only (not web, not emulators).
    if (Platform.OS === "web" || !Device.isDevice) return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "VendorDash",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return; // vendor said no — in-app list still works

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const { error } = await supabase.rpc("register_push_token", {
      p_token: token,
      p_platform: Platform.OS === "ios" ? "ios" : "android",
    });
    if (error) return;

    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Push is a bonus. Never let it break login or the home screen.
  }
}

// Call BEFORE supabase.auth.signOut() — the database needs the login to
// know whose token to remove.
export async function unregisterPush(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const { error } = await supabase.rpc("unregister_push_token", {
      p_token: token,
    });
    if (!error) await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // Never block logout. If this fails, the next person to sign in on this
    // phone takes the token over (register_push_token moves it).
  }
}
