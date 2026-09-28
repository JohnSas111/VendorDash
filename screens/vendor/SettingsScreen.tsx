import { ConfirmModal } from "@/components/ConfirmModal";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ProfileInfo = {
  fullName: string;
  businessName: string;
  email: string;
  phone: string | null;
  category: string | null;
};

const FIELDS: { key: keyof ProfileInfo; label: string }[] = [
  { key: "fullName", label: "Full name" },
  { key: "businessName", label: "Business name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "category", label: "Category" },
];

export default function SettingsScreen() {
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);

  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  useFocusEffect(
    useCallback(() => {
      async function load() {
        setLoading(true);

        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;

        if (!user) {
          router.replace("/(auth)/login");
          return;
        }

        const [
          { data: profile, error: profileError },
          { data: vendorDetails, error: vendorError },
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select("full_name, phone")
            .eq("id", user.id)
            .single(),
          supabase
            .from("vendor_details")
            .select("business_name, category")
            .eq("id", user.id)
            .single(),
        ]);

        // Previously these errors were never checked — the screen would
        // just quietly show "—" for every field. Now a failed fetch at
        // least tells the vendor something didn't load.
        if (profileError || vendorError) {
          showToast("Some profile details couldn't be loaded.", "error");
        }

        setInfo({
          fullName: profile?.full_name ?? "—",
          businessName: vendorDetails?.business_name ?? "—",
          email: user.email ?? "—",
          phone: profile?.phone ?? null,
          category: vendorDetails?.category ?? null,
        });

        setLoading(false);
      }

      load();
    }, [showToast]),
  );

  function handleLogoutPress() {
    setLogoutConfirmVisible(true);
  }

  async function confirmLogout() {
    setLogoutConfirmVisible(false);
    setSigningOut(true);
    await supabase.auth.signOut();
    router.replace("/(auth)/login");
  }

  if (loading || !info) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + Spacing.md }]}>
        <SettingsSkeleton />
      </View>
    );
  }

  const profileIncomplete = !info.phone || !info.category;

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.md }]}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        {FIELDS.map((field) => (
          <View key={field.key}>
            <Text style={styles.label}>{field.label}</Text>
            <Text style={styles.value}>{info[field.key] ?? "Not set"}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => router.push("/(vendor)/complete-profile")}
      >
        <Text style={styles.rowText}>
          {profileIncomplete ? "Complete your profile" : "Edit profile"}
        </Text>
        <View style={styles.rowRight}>
          {profileIncomplete && <View style={styles.dot} />}
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        style={styles.row}
        activeOpacity={0.7}
        onPress={handleLogoutPress}
        disabled={signingOut}
      >
        <Text style={[styles.rowText, styles.logoutText]}>
          {signingOut ? "Logging out..." : "Log out"}
        </Text>
        <Ionicons name="log-out-outline" size={18} color={Colors.booked} />
      </TouchableOpacity>

      <ConfirmModal
        visible={logoutConfirmVisible}
        title="Log out"
        message="Are you sure you want to log out?"
        confirmLabel="Log out"
        cancelLabel="Stay logged in"
        onConfirm={confirmLogout}
        onDismiss={() => setLogoutConfirmVisible(false)}
      />
    </View>
  );
}

// Placeholder shown while the profile is loading, replacing the old lone
// ActivityIndicator.
function SettingsSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: "30%", height: 18, marginBottom: Spacing.lg },
        ]}
      />
      <View style={[styles.card, styles.skeletonCard]}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.skeletonLine,
              { width: "55%", marginTop: i === 0 ? 0 : Spacing.md },
            ]}
          />
        ))}
      </View>
      <View style={[styles.row, styles.skeletonCard]} />
      <View style={[styles.row, styles.skeletonCard]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.xl,
  },
  title: {
    fontSize: Typography.lg,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  skeletonCard: { backgroundColor: Colors.borderLight, shadowOpacity: 0 },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.xs,
    backgroundColor: Colors.borderLight,
  },
  label: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: Spacing.md,
  },
  value: {
    fontSize: Typography.md,
    fontWeight: "500",
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  row: {
    backgroundColor: Colors.white,
    borderRadius: Radius.sm,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...Shadow.sm,
  },
  rowText: { fontSize: Typography.md, fontWeight: "500", color: Colors.text },
  rowRight: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  logoutText: { color: Colors.booked },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.xs,
    backgroundColor: Colors.reserved,
  },
});
