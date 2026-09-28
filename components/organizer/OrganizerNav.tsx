import { ConfirmModal } from "@/components/ConfirmModal";
import { Spacing } from "@/constants/theme";
import { BREAKPOINT, COLORS, RADIUS } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type NavItem = { name: string; label: string };

const OVERVIEW: NavItem = { name: "overview", label: "Overview" };

const GROUPS: { section: string; items: NavItem[] }[] = [
  {
    section: "Operations",
    items: [
      { name: "floor-map", label: "Floor Map" },
      { name: "stalls", label: "Stalls" },
      { name: "sessions", label: "Sessions" },
    ],
  },
  {
    section: "Requests",
    items: [
      { name: "booking-requests", label: "Bookings" },
      { name: "vendor-verification", label: "Verification" },
      { name: "refund-requests", label: "Refunds" },
    ],
  },
  {
    section: "Live",
    items: [{ name: "check-in", label: "Check-In" }],
  },
  {
    section: "Insights",
    items: [{ name: "sales-reports", label: "Reports" }],
  },
  {
    section: "Account",
    items: [{ name: "organizer-settings", label: "Settings" }],
  },
];

const ALL_ITEMS: NavItem[] = [OVERVIEW, ...GROUPS.flatMap((g) => g.items)];

export default function OrganizerNav() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const router = useRouter();
  const pathname = usePathname(); // e.g. "/overview"
  const [signOutConfirmVisible, setSignOutConfirmVisible] = useState(false);

  const isActive = (name: string) => pathname === `/${name}`;
  const go = (name: string) => router.push(`/${name}` as any);

  async function confirmSignOut() {
    setSignOutConfirmVisible(false);
    await supabase.auth.signOut();
  }

  if (isDesktop) {
    return (
      <View style={styles.sidebar}>
        {/* BUGFIX: this used to be one long View with no ScrollView — on a
            short browser window the bottom items (Settings) rendered off
            the bottom edge with no way to reach them. The nav list is now
            its own scrollable region, with Sign out pinned in a footer
            below it so it's always reachable regardless of window height
            or how many nav items exist. */}
        <ScrollView
          style={styles.sidebarScroll}
          contentContainerStyle={styles.sidebarScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sidebarBrand}>VendorDash</Text>
          <Text style={styles.sidebarBrandSub}>Organizer</Text>
          <View style={{ height: Spacing.xl }} />

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isActive(OVERVIEW.name) }}
            onPress={() => go(OVERVIEW.name)}
            style={[
              styles.sidebarItem,
              isActive(OVERVIEW.name) && styles.sidebarItemActive,
            ]}
          >
            <Text
              style={[
                styles.sidebarItemText,
                isActive(OVERVIEW.name) && styles.sidebarItemTextActive,
              ]}
            >
              {OVERVIEW.label}
            </Text>
          </Pressable>

          {GROUPS.map((group) => (
            <View key={group.section} style={{ marginTop: Spacing.lg }}>
              <Text style={styles.sectionLabel}>{group.section}</Text>
              {group.items.map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive(item.name) }}
                  key={item.name}
                  onPress={() => go(item.name)}
                  style={[
                    styles.sidebarItem,
                    isActive(item.name) && styles.sidebarItemActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.sidebarItemText,
                      isActive(item.name) && styles.sidebarItemTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>

        {/* Sign out lived only inside the Settings screen before — a few
            taps away and easy to lose track of. Pinning it here makes it
            reachable from anywhere in the organizer app, on one tap,
            without hunting for it. */}
        <View style={styles.sidebarFooter}>
          <Pressable
            style={styles.signOutButton}
            onPress={() => setSignOutConfirmVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Ionicons name="log-out-outline" size={16} color={COLORS.clay} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        <ConfirmModal
          visible={signOutConfirmVisible}
          title="Sign out"
          message="Are you sure you want to sign out?"
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          onConfirm={confirmSignOut}
          onDismiss={() => setSignOutConfirmVisible(false)}
        />
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.mobileBar}
      contentContainerStyle={styles.mobileBarContent}
    >
      {ALL_ITEMS.map((item) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: isActive(item.name) }}
          key={item.name}
          onPress={() => go(item.name)}
          style={styles.mobileItem}
        >
          <Text
            style={[
              styles.mobileItemText,
              isActive(item.name) && styles.mobileItemTextActive,
            ]}
          >
            {item.label}
          </Text>
          {isActive(item.name) && <View style={styles.mobileIndicator} />}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 220,
    backgroundColor: COLORS.white,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  sidebarScroll: { flex: 1 },
  sidebarScrollContent: {
    paddingTop: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  sidebarFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    padding: Spacing.md,
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: RADIUS.sm,
    minHeight: 44,
  },
  signOutText: { fontSize: 14, color: COLORS.clayText, fontWeight: "600" },
  sidebarBrand: {
    fontFamily: "serif",
    fontSize: 18,
    color: COLORS.inkNavy,
    paddingHorizontal: 8,
  },
  sidebarBrandSub: {
    fontSize: 12,
    color: COLORS.slate,
    paddingHorizontal: 8,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.slate,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  sidebarItem: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: RADIUS.sm,
    marginBottom: 2,
    minHeight: 40,
    justifyContent: "center",
  },
  sidebarItemActive: { backgroundColor: COLORS.paper },
  sidebarItemText: { fontSize: 14, color: COLORS.slate, fontWeight: "500" },
  sidebarItemTextActive: { color: COLORS.inkNavy, fontWeight: "700" },

  mobileBar: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
    flexGrow: 0,
  },
  mobileBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  mobileItem: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  mobileItemText: { fontSize: 12, color: COLORS.slate, fontWeight: "500" },
  mobileItemTextActive: { color: COLORS.inkNavy, fontWeight: "700" },
  mobileIndicator: {
    marginTop: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.amber,
  },
});
