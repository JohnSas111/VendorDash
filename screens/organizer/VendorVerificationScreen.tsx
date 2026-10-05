import { PressableButton } from "@/components/PressableButton";
import { Spacing, Typography } from "@/constants/theme";
import { BREAKPOINT, COLORS, shared, statusColors } from "@/lib/organizerTheme";
import { openSignedImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type VendorDetail = {
  id: string;
  business_name: string;
  category: string | null;
  business_permit_url: string | null;
  is_verified: boolean;
  vendor_name: string;
};

const FILTERS = ["unverified", "verified", "all"] as const;
type Filter = (typeof FILTERS)[number];

export default function VendorVerificationScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const { showToast } = useToast();

  const [filter, setFilter] = useState<Filter>("unverified");
  const [rows, setRows] = useState<VendorDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase
      .from("vendor_details")
      .select(
        "id, business_name, category, business_permit_url, is_verified, profiles!vendor_details_id_fkey(full_name)",
      );

    if (filter === "unverified") query = query.eq("is_verified", false);
    if (filter === "verified") query = query.eq("is_verified", true);

    const { data, error: err } = await query;
    if (err) setError(err.message);
    setRows(
      (data ?? []).map((row: any) => ({
        id: row.id,
        business_name: row.business_name,
        category: row.category,
        business_permit_url: row.business_permit_url,
        is_verified: row.is_verified,
        vendor_name: row.profiles?.full_name ?? "Unknown vendor",
      })),
    );
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  const setVerified = async (id: string, verified: boolean) => {
    setActingOnId(id);
    // verify_vendor checks that you are an organizer, records who verified
    // and when, and notifies the vendor. Writing is_verified directly skipped
    // all of that (and is blocked once the database is locked down).
    const { error: err } = await supabase.rpc("verify_vendor", {
      p_vendor_id: id,
      p_verified: verified,
    });
    setActingOnId(null);
    if (err) {
      showToast(err.message, "error");
      return;
    }
    showToast(verified ? "Vendor verified." : "Vendor unverified.", "success");
    load();
  };

  const openPermit = async (path: string) => {
    // The permit is in a private bucket. The database lets an organizer open it
    // for a vendor who is not verified yet, or who has a booking at one of
    // their venues.
    const ok = await openSignedImage("business-permits", path);
    if (!ok) {
      showToast(
        "Couldn't open that permit. The file may be missing, or this vendor is already verified and has no booking at your venue.",
        "error",
      );
    }
  };

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.content,
        isDesktop && shared.contentDesktop,
      ]}
    >
      <Text style={shared.title}>Vendor Verification</Text>
      <Text style={shared.subtitle}>
        Review business permits and mark vendors verified.
      </Text>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <PressableButton
            key={f}
            onPress={() => setFilter(f)}
            style={[
              shared.secondaryButton,
              filter === f && styles.filterActive,
            ]}
          >
            <Text
              style={[
                shared.secondaryButtonText,
                filter === f && styles.filterActiveText,
              ]}
            >
              {f}
            </Text>
          </PressableButton>
        ))}
      </View>

      {error && (
        <Text style={[shared.errorText, styles.errorText]}>{error}</Text>
      )}

      {loading ? (
        <RowsSkeleton />
      ) : rows.length === 0 ? (
        <View style={shared.emptyState}>
          <Ionicons
            name="shield-checkmark-outline"
            size={26}
            color={COLORS.slate}
          />
          <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
            Nothing to review here.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((v) => {
            const { bg, fg } = statusColors(
              v.is_verified ? "verified" : "unverified",
            );
            return (
              <View
                key={v.id}
                style={[shared.row, isDesktop && shared.rowDesktop]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={shared.rowTitle}>{v.business_name}</Text>
                  <Text style={shared.rowSubtitle}>
                    {v.vendor_name} {v.category ? `· ${v.category}` : ""}
                  </Text>
                  <View style={styles.metaRow}>
                    <View style={[shared.badge, { backgroundColor: bg }]}>
                      <Text style={[shared.badgeText, { color: fg }]}>
                        {v.is_verified ? "verified" : "unverified"}
                      </Text>
                    </View>
                    {v.business_permit_url && (
                      <Pressable
                        accessibilityRole="link"
                        style={styles.permitLink}
                        onPress={() => openPermit(v.business_permit_url!)}
                      >
                        <Ionicons
                          name="document-text-outline"
                          size={13}
                          color={COLORS.inkNavy}
                        />
                        <Text style={styles.permitLinkText}>View permit</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                <View
                  style={[
                    styles.rowActions,
                    !isDesktop && styles.rowActionsMobile,
                  ]}
                >
                  {v.is_verified ? (
                    <PressableButton
                      style={[shared.dangerOutlineButton, styles.actionButton]}
                      disabled={actingOnId === v.id}
                      onPress={() => setVerified(v.id, false)}
                    >
                      <Ionicons name="close" size={14} color={COLORS.clay} />
                      <Text style={shared.dangerOutlineButtonText}>
                        Unverify
                      </Text>
                    </PressableButton>
                  ) : (
                    <PressableButton
                      style={[shared.successButton, styles.actionButton]}
                      disabled={actingOnId === v.id}
                      onPress={() => setVerified(v.id, true)}
                    >
                      <Ionicons
                        name="checkmark"
                        size={14}
                        color={COLORS.white}
                      />
                      <Text style={shared.successButtonText}>Verify</Text>
                    </PressableButton>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// Placeholder rows shown while the list is loading.
function RowsSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[shared.row, styles.skeletonBlock, { minHeight: 64 }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  filterActive: { backgroundColor: COLORS.inkNavy },
  filterActiveText: { color: COLORS.white },
  errorText: { marginBottom: Spacing.md },
  list: { gap: Spacing.sm },
  metaRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  permitLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  permitLinkText: {
    color: COLORS.inkNavy,
    fontSize: Typography.base,
    textDecorationLine: "underline",
  },
  rowActions: { flexDirection: "row", gap: Spacing.sm },
  rowActionsMobile: { marginTop: Spacing.md },
  actionButton: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  skeletonBlock: {
    backgroundColor: COLORS.border,
    borderColor: COLORS.border,
    shadowOpacity: 0,
  },
});
