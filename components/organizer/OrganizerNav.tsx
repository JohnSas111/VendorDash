import { ConfirmModal } from "@/components/ConfirmModal";
import { Spacing } from "@/constants/theme";
import { useOrganizerCounts } from "@/hooks/useOrganizerCounts";
import { BREAKPOINT, COLORS, RADIUS, SERIF } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { badgeLabel, scrollEdges } from "@/lib/uxHelpers";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type IconName = ComponentProps<typeof Ionicons>["name"];
type NavItem = { name: string; label: string; icon: IconName };

const OVERVIEW: NavItem = {
  name: "overview",
  label: "Overview",
  icon: "home-outline",
};

const GROUPS: { section: string; items: NavItem[] }[] = [
  {
    section: "Operations",
    items: [
      { name: "floor-map", label: "Floor Map", icon: "grid-outline" },
      { name: "stalls", label: "Stalls", icon: "storefront-outline" },
      { name: "sessions", label: "Sessions", icon: "calendar-outline" },
    ],
  },
  {
    section: "Requests",
    items: [
      {
        name: "booking-requests",
        label: "Bookings",
        icon: "clipboard-outline",
      },
      {
        name: "vendor-verification",
        label: "Verification",
        icon: "shield-checkmark-outline",
      },
      {
        name: "refund-requests",
        label: "Refunds",
        icon: "arrow-undo-outline",
      },
    ],
  },
  {
    section: "Live",
    items: [
      { name: "check-in", label: "Check-In", icon: "checkmark-circle-outline" },
    ],
  },
  {
    section: "Insights",
    items: [
      { name: "payments", label: "Payments", icon: "card-outline" },
      { name: "sales-reports", label: "Reports", icon: "bar-chart-outline" },
    ],
  },
  {
    section: "Account",
    items: [
      {
        name: "organizer-settings",
        label: "Settings",
        icon: "settings-outline",
      },
    ],
  },
];

// Opacity of the fade strips (5px each) at the top / bottom of the menu.
const FADE_STEPS = [0.96, 0.8, 0.6, 0.38, 0.16];

// The sidebar is dark, so the fade strips and scroll arrows are dark too.
const FADE_RGB = "26,26,26";
const SOFT_LABEL = "#A9A59B"; // section titles on the dark sidebar (6:1)
const SIGN_OUT = "#F08A7D"; // coral that stays readable on dark

const ALL_ITEMS: NavItem[] = [OVERVIEW, ...GROUPS.flatMap((g) => g.items)];

// The small number shown next to a menu item that has something waiting.
// Hidden when the number is 0.
function NavBadge({
  count,
  small,
  onActive,
}: {
  count: number;
  small?: boolean;
  onActive?: boolean;
}) {
  if (count <= 0) return null;
  return (
    // On the amber "current page" pill an amber badge would vanish, so it
    // flips to a dark badge with amber text there.
    <View
      style={[
        styles.badge,
        small && styles.badgeSmall,
        onActive && styles.badgeOnActive,
      ]}
    >
      <Text style={[styles.badgeText, onActive && styles.badgeTextOnActive]}>
        {badgeLabel(count)}
      </Text>
    </View>
  );
}

function SidebarItem({
  item,
  active,
  label,
  badge = 0,
  onPress,
}: {
  item: NavItem;
  active: boolean;
  label?: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.sidebarItem, active && styles.sidebarItemActive]}
    >
      <Ionicons
        name={item.icon}
        size={20}
        color={active ? COLORS.inkNavy : COLORS.onDark}
      />
      <Text
        style={[styles.sidebarItemText, active && styles.sidebarItemTextActive]}
      >
        {item.label}
      </Text>
      <NavBadge count={badge} onActive={active} />
    </Pressable>
  );
}

export default function OrganizerNav() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const router = useRouter();
  const pathname = usePathname(); // e.g. "/overview"
  const [signOutConfirmVisible, setSignOutConfirmVisible] = useState(false);

  // Numbers for the menu badges (booking requests, refunds, verification).
  const counts = useOrganizerCounts();
  const badgeFor = (name: string): number =>
    name === "booking-requests"
      ? counts.bookings
      : name === "vendor-verification"
        ? counts.verification
        : name === "refund-requests"
          ? counts.refunds
          : 0;
  const itemLabel = (item: NavItem): string | undefined =>
    badgeFor(item.name) > 0
      ? `${item.label}, ${badgeFor(item.name)} waiting`
      : undefined;

  // Is there more menu above / below the visible part? Shown as a fade, an
  // arrow and a thin scrollbar so a short window never hides items silently.
  const scrollRef = useRef<ScrollView>(null);
  const metrics = useRef({ y: 0, viewH: 0, contentH: 0 });
  const [edges, setEdges] = useState({
    canScrollUp: false,
    canScrollDown: false,
  });
  const updateEdges = () => {
    const m = metrics.current;
    const next = scrollEdges(m.y, m.viewH, m.contentH);
    setEdges((prev) =>
      prev.canScrollUp === next.canScrollUp &&
      prev.canScrollDown === next.canScrollDown
        ? prev
        : next,
    );
  };
  const scrollByStep = (direction: 1 | -1) => {
    scrollRef.current?.scrollTo({
      y: Math.max(0, metrics.current.y + direction * 160),
      animated: true,
    });
  };

  // Web only: a thin, light scrollbar for the menu (the default one is thick
  // on Windows). Added once.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    if (document.getElementById("vd-nav-scroll-css")) return;
    const style = document.createElement("style");
    style.id = "vd-nav-scroll-css";
    style.textContent =
      "[data-vd-nav-scroll]{scrollbar-width:thin;scrollbar-color:#555 transparent}" +
      "[data-vd-nav-scroll]::-webkit-scrollbar{width:6px}" +
      "[data-vd-nav-scroll]::-webkit-scrollbar-thumb{background:#555;border-radius:3px}" +
      "[data-vd-nav-scroll]::-webkit-scrollbar-track{background:transparent}";
    document.head.appendChild(style);
  }, []);

  const isActive = (name: string) => pathname === `/${name}`;
  const go = (name: string) => router.push(`/${name}` as any);

  async function confirmSignOut() {
    setSignOutConfirmVisible(false);
    await supabase.auth.signOut();
  }

  if (isDesktop) {
    return (
      <View style={styles.sidebar}>
        {/* The brand stays pinned at the top and Sign out at the bottom; only
            the menu in between scrolls. On a short window the menu can be
            taller than the space, so it shows a fade + arrow + thin
            scrollbar on whichever side has more to reveal. */}
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarBrand}>VendorDash</Text>
          <Text style={styles.sidebarBrandSub}>Organizer</Text>
        </View>

        <View style={styles.sidebarScrollWrap}>
          <ScrollView
            ref={scrollRef}
            style={styles.sidebarScroll}
            contentContainerStyle={styles.sidebarScrollContent}
            showsVerticalScrollIndicator
            scrollEventThrottle={16}
            onScroll={(e) => {
              metrics.current.y = e.nativeEvent.contentOffset.y;
              updateEdges();
            }}
            onLayout={(e) => {
              metrics.current.viewH = e.nativeEvent.layout.height;
              updateEdges();
            }}
            onContentSizeChange={(_w, h) => {
              metrics.current.contentH = h;
              updateEdges();
            }}
            {...({ dataSet: { vdNavScroll: "1" } } as object)}
          >
            <SidebarItem
              item={OVERVIEW}
              active={isActive(OVERVIEW.name)}
              onPress={() => go(OVERVIEW.name)}
            />

            {GROUPS.map((group) => (
              <View key={group.section} style={{ marginTop: Spacing.lg }}>
                <Text style={styles.sectionLabel}>{group.section}</Text>
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.name}
                    item={item}
                    active={isActive(item.name)}
                    label={itemLabel(item)}
                    badge={badgeFor(item.name)}
                    onPress={() => go(item.name)}
                  />
                ))}
              </View>
            ))}
          </ScrollView>

          {edges.canScrollUp && (
            <View
              pointerEvents="box-none"
              style={[styles.fade, styles.fadeTop]}
            >
              <View pointerEvents="none">
                {FADE_STEPS.map((a) => (
                  <View
                    key={a}
                    style={{
                      height: 5,
                      backgroundColor: `rgba(${FADE_RGB},${a})`,
                    }}
                  />
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scroll the menu up"
                onPress={() => scrollByStep(-1)}
                style={styles.scrollCue}
              >
                <Ionicons name="chevron-up" size={14} color={COLORS.onDark} />
              </Pressable>
            </View>
          )}
          {edges.canScrollDown && (
            <View
              pointerEvents="box-none"
              style={[styles.fade, styles.fadeBottom]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scroll the menu down for more"
                onPress={() => scrollByStep(1)}
                style={styles.scrollCue}
              >
                <Ionicons name="chevron-down" size={14} color={COLORS.onDark} />
              </Pressable>
              <View pointerEvents="none">
                {[...FADE_STEPS].reverse().map((a) => (
                  <View
                    key={a}
                    style={{
                      height: 5,
                      backgroundColor: `rgba(${FADE_RGB},${a})`,
                    }}
                  />
                ))}
              </View>
            </View>
          )}
        </View>

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
            <Ionicons name="log-out-outline" size={18} color={SIGN_OUT} />
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
          accessibilityLabel={itemLabel(item)}
          accessibilityState={{ selected: isActive(item.name) }}
          key={item.name}
          onPress={() => go(item.name)}
          style={styles.mobileItem}
        >
          <View style={styles.mobileLabelRow}>
            <Text
              style={[
                styles.mobileItemText,
                isActive(item.name) && styles.mobileItemTextActive,
              ]}
            >
              {item.label}
            </Text>
            <NavBadge count={badgeFor(item.name)} small />
          </View>
          {isActive(item.name) && <View style={styles.mobileIndicator} />}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 248,
    backgroundColor: COLORS.dark,
  },
  sidebarHeader: {
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  sidebarScrollWrap: { flex: 1 },
  sidebarScroll: { flex: 1 },
  sidebarScrollContent: {
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  fade: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  fadeTop: { top: 0 },
  fadeBottom: { bottom: 0 },
  scrollCue: {
    width: 26,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2A2A2A",
    borderWidth: 1,
    borderColor: "#3A3A3A",
  },
  sidebarFooter: {
    borderTopWidth: 1,
    borderTopColor: "#2E2E2E",
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
  signOutText: { fontSize: 14, color: SIGN_OUT, fontWeight: "600" },
  sidebarBrand: {
    fontFamily: SERIF,
    fontSize: 24,
    color: COLORS.white,
    paddingHorizontal: 8,
  },
  sidebarBrandSub: {
    fontSize: 12,
    color: SOFT_LABEL,
    paddingHorizontal: 8,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: SOFT_LABEL,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  sidebarItem: {
    paddingHorizontal: 12,
    borderRadius: RADIUS.sm,
    marginBottom: 4,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sidebarItemActive: { backgroundColor: COLORS.amber },
  sidebarItemText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.onDark,
    fontWeight: "600",
  },
  // Amber fill with dark text: readable, and amber already means "needs a look".
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.amber,
  },
  badgeSmall: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    marginLeft: 4,
  },
  badgeText: { fontSize: 11, fontWeight: "700", color: COLORS.inkNavy },
  badgeOnActive: { backgroundColor: COLORS.inkNavy },
  badgeTextOnActive: { color: COLORS.amber },
  sidebarItemTextActive: { color: COLORS.inkNavy, fontWeight: "700" },

  mobileBar: {
    backgroundColor: COLORS.dark,
    flexGrow: 0,
  },
  mobileBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  mobileItem: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  mobileLabelRow: { flexDirection: "row", alignItems: "center" },
  mobileItemText: { fontSize: 12, color: COLORS.onDark, fontWeight: "500" },
  mobileItemTextActive: { color: COLORS.white, fontWeight: "700" },
  mobileIndicator: {
    marginTop: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.amber,
  },
});
