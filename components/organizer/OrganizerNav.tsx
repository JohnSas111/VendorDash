import { BREAKPOINT, COLORS, RADIUS } from "@/lib/organizerTheme";
import { usePathname, useRouter } from "expo-router";
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

  const isActive = (name: string) => pathname === `/${name}`;
  const go = (name: string) => router.push(`/${name}` as any);

  if (isDesktop) {
    return (
      <View style={styles.sidebar}>
        <Text style={styles.sidebarBrand}>VendorDash</Text>
        <Text style={styles.sidebarBrandSub}>Organizer</Text>
        <View style={{ height: 20 }} />

        <Pressable
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
          <View key={group.section} style={{ marginTop: 16 }}>
            <Text style={styles.sectionLabel}>{group.section}</Text>
            {group.items.map((item) => (
              <Pressable
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
    paddingTop: 32,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
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
  mobileItemTextActive: { color: COLORS.amber, fontWeight: "700" },
  mobileIndicator: {
    marginTop: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.amber,
  },
});
