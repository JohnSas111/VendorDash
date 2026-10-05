import { ConfirmModal } from "@/components/ConfirmModal";
import { Spacing } from "@/constants/theme";
import { BREAKPOINT, COLORS, RADIUS } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { scrollEdges } from "@/lib/uxHelpers";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Platform,
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

// Opacity of the fade strips (5px each) at the top / bottom of the menu.
const FADE_STEPS = [0.96, 0.8, 0.6, 0.38, 0.16];

const ALL_ITEMS: NavItem[] = [OVERVIEW, ...GROUPS.flatMap((g) => g.items)];

export default function OrganizerNav() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const router = useRouter();
  const pathname = usePathname(); // e.g. "/overview"
  const [signOutConfirmVisible, setSignOutConfirmVisible] = useState(false);

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
      "[data-vd-nav-scroll]{scrollbar-width:thin;scrollbar-color:#C9C9C9 transparent}" +
      "[data-vd-nav-scroll]::-webkit-scrollbar{width:6px}" +
      "[data-vd-nav-scroll]::-webkit-scrollbar-thumb{background:#C9C9C9;border-radius:3px}" +
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
                      backgroundColor: `rgba(255,255,255,${a})`,
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
                <Ionicons name="chevron-up" size={14} color={COLORS.slate} />
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
                <Ionicons name="chevron-down" size={14} color={COLORS.slate} />
              </Pressable>
              <View pointerEvents="none">
                {[...FADE_STEPS].reverse().map((a) => (
                  <View
                    key={a}
                    style={{
                      height: 5,
                      backgroundColor: `rgba(255,255,255,${a})`,
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
  sidebarHeader: {
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
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
