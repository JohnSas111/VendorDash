import { Colors, Radius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ProfileInfo = {
  fullName: string;
  businessName: string;
  email: string;
  phone: string | null;
  category: string | null;
};

export default function SettingsScreen() {
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const insets = useSafeAreaInsets();

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        router.replace("/(auth)/login");
        return;
      }

      const [{ data: profile }, { data: vendorDetails }] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, phone")
          .eq("id", userId)
          .single(),
        supabase
          .from("vendor_details")
          .select("business_name, category")
          .eq("id", userId)
          .single(),
      ]);

      setInfo({
        fullName: profile?.full_name ?? "—",
        businessName: vendorDetails?.business_name ?? "—",
        email: userData.user.email ?? "—",
        phone: profile?.phone ?? null,
        category: vendorDetails?.category ?? null,
      });
      setLoading(false);
    }
    load();
  }, []);

  async function handleLogout() {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          await supabase.auth.signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  }

  if (loading || !info) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  const profileIncomplete = !info.phone || !info.category;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Full name</Text>
        <Text style={styles.value}>{info.fullName}</Text>

        <Text style={styles.label}>Business name</Text>
        <Text style={styles.value}>{info.businessName}</Text>

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{info.email}</Text>

        <Text style={styles.label}>Phone</Text>
        <Text style={styles.value}>{info.phone ?? "Not set"}</Text>

        <Text style={styles.label}>Category</Text>
        <Text style={styles.value}>{info.category ?? "Not set"}</Text>
      </View>

      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push("/(vendor)/complete-profile")}
      >
        <Text style={styles.rowText}>
          {profileIncomplete ? "Complete your profile" : "Edit profile"}
        </Text>
        {profileIncomplete && <View style={styles.dot} />}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.row}
        onPress={handleLogout}
        disabled={signingOut}
      >
        <Text style={[styles.rowText, styles.logoutText]}>
          {signingOut ? "Logging out..." : "Log out"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 20,
    paddingTop: 20,
  },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 16 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 16,
    marginBottom: 20,
  },
  label: { fontSize: 11, color: Colors.textMuted, marginTop: 10 },
  value: { fontSize: 14, fontWeight: "500", marginTop: 2 },
  row: {
    backgroundColor: Colors.white,
    borderRadius: Radius.sm,
    padding: 16,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowText: { fontSize: 14, fontWeight: "500" },
  logoutText: { color: Colors.booked },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.reserved,
  },
});
