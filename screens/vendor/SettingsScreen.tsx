import { ConfirmModal } from "@/components/ConfirmModal";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { CARD_SHADOW, COLORS, RADIUS, SERIF } from "@/lib/organizerTheme";
import { unregisterPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ScrollView,
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

const FIELDS: {
  key: keyof ProfileInfo;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "fullName", label: "Full name", icon: "person-outline" },
  { key: "businessName", label: "Business name", icon: "storefront-outline" },
  { key: "email", label: "Email", icon: "mail-outline" },
  { key: "phone", label: "Phone", icon: "call-outline" },
  { key: "category", label: "Category", icon: "pricetag-outline" },
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
    await unregisterPush(); // before signOut: needs the login
    await supabase.auth.signOut();
    router.replace("/(auth)/login");
  }

  if (loading || !info) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
          <View style={styles.skeletonAvatar} />
        </View>
        <View style={styles.body}>
          <SettingsSkeleton />
        </View>
      </View>
    );
  }

  const profileIncomplete = !info.phone || !info.category;
  const initial = (
    info.businessName !== "—" ? info.businessName : info.fullName
  )
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <Text style={styles.headerLabel}>Settings</Text>
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial || "V"}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.headerName} numberOfLines={1}>
              {info.businessName}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {info.fullName}
              {info.category ? ` · ${info.category}` : ""}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {profileIncomplete && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.banner}
            onPress={() => router.push("/(vendor)/complete-profile")}
          >
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={Colors.warningText}
            />
            <Text style={styles.bannerText}>
              Finish your profile to book stalls
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.warningText}
            />
          </TouchableOpacity>
        )}

        <Text style={styles.sectionLabel}>Your details</Text>
        <View style={styles.card}>
          {FIELDS.map((field, i) => (
            <View
              key={field.key}
              style={[styles.fieldRow, i > 0 && styles.fieldRowBorder]}
            >
              <View style={styles.iconTile}>
                <Ionicons
                  name={field.icon}
                  size={18}
                  color={Colors.warningText}
                />
              </View>
              <View style={styles.fieldText}>
                <Text style={styles.label}>{field.label}</Text>
                <Text style={styles.value} numberOfLines={1}>
                  {info[field.key] ?? "Not set"}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Account</Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.row}
          activeOpacity={0.7}
          onPress={() => router.push("/(vendor)/complete-profile")}
        >
          <View style={styles.iconTile}>
            <Ionicons
              name="create-outline"
              size={18}
              color={Colors.warningText}
            />
          </View>
          <Text style={styles.rowText}>
            {profileIncomplete ? "Complete your profile" : "Edit profile"}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.row}
          activeOpacity={0.7}
          onPress={handleLogoutPress}
          disabled={signingOut}
        >
          <View style={[styles.iconTile, styles.iconTileDanger]}>
            <Ionicons
              name="log-out-outline"
              size={18}
              color={Colors.dangerText}
            />
          </View>
          <Text style={[styles.rowText, styles.logoutText]}>
            {signingOut ? "Logging out..." : "Log out"}
          </Text>
        </TouchableOpacity>
      </ScrollView>

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
      <View style={[styles.card, styles.skeletonCard, { height: 200 }]} />
      <View style={[styles.row, styles.skeletonCard]} />
      <View style={[styles.row, styles.skeletonCard]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: COLORS.dark,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  headerLabel: {
    fontSize: Typography.base,
    color: COLORS.onDark,
    marginBottom: Spacing.md,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.lg },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.reserved,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: SERIF, fontSize: 28, color: Colors.text },
  headerText: { flex: 1 },
  headerName: {
    fontFamily: SERIF,
    fontSize: 28,
    fontWeight: "400",
    color: Colors.white,
  },
  headerSub: {
    fontSize: Typography.base,
    color: COLORS.onDark,
    marginTop: 2,
  },
  skeletonAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#2B2B2B",
  },
  body: { padding: Spacing.xl, paddingBottom: Spacing.xxxl },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.warningLight,
    borderRadius: RADIUS.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  bannerText: {
    flex: 1,
    fontSize: Typography.base,
    fontWeight: "600",
    color: Colors.warningText,
  },
  sectionLabel: {
    fontFamily: SERIF,
    fontSize: 20,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    ...CARD_SHADOW,
  },
  skeletonCard: { opacity: 0.6 },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  fieldRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  fieldText: { flex: 1 },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.warningLight,
    alignItems: "center",
    justifyContent: "center",
  },
  iconTileDanger: { backgroundColor: Colors.dangerLight },
  label: { fontSize: Typography.sm, color: Colors.textMuted },
  value: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: Colors.text,
    marginTop: 2,
  },
  row: {
    backgroundColor: Colors.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    ...CARD_SHADOW,
  },
  rowText: {
    flex: 1,
    fontSize: Typography.md,
    fontWeight: "600",
    color: Colors.text,
  },
  logoutText: { color: Colors.dangerText },
});
