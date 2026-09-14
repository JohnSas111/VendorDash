import { BREAKPOINT, COLORS, shared, statusColors } from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
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
    load();
  }, [load]);

  const setVerified = async (id: string, verified: boolean) => {
    setActingOnId(id);
    const { error: err } = await supabase
      .from("vendor_details")
      .update({ is_verified: verified })
      .eq("id", id);
    setActingOnId(null);
    if (err) {
      Alert.alert(
        "Could not update",
        err.message.includes("policy")
          ? "This likely means migration-organizer-web.sql hasn\u2019t been run yet — organizers need its RLS policy to update vendor_details."
          : err.message,
      );
      return;
    }
    load();
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

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              shared.secondaryButton,
              filter === f && { backgroundColor: COLORS.inkNavy },
            ]}
          >
            <Text
              style={[
                shared.secondaryButtonText,
                filter === f && { color: COLORS.white },
              ]}
            >
              {f}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && (
        <Text style={[shared.errorText, { marginBottom: 12 }]}>{error}</Text>
      )}

      {loading ? (
        <ActivityIndicator color={COLORS.inkNavy} />
      ) : rows.length === 0 ? (
        <View style={shared.emptyState}>
          <Text style={shared.emptyStateText}>Nothing to review here.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
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
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      alignItems: "center",
                      marginTop: 6,
                    }}
                  >
                    <View style={[shared.badge, { backgroundColor: bg }]}>
                      <Text style={[shared.badgeText, { color: fg }]}>
                        {v.is_verified ? "verified" : "unverified"}
                      </Text>
                    </View>
                    {v.business_permit_url && (
                      <Pressable
                        onPress={() => Linking.openURL(v.business_permit_url!)}
                      >
                        <Text
                          style={{
                            color: COLORS.inkNavy,
                            fontSize: 13,
                            textDecorationLine: "underline",
                          }}
                        >
                          View permit
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    marginTop: isDesktop ? 0 : 10,
                  }}
                >
                  {v.is_verified ? (
                    <Pressable
                      style={shared.dangerOutlineButton}
                      disabled={actingOnId === v.id}
                      onPress={() => setVerified(v.id, false)}
                    >
                      <Text style={shared.dangerOutlineButtonText}>
                        Unverify
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={shared.successButton}
                      disabled={actingOnId === v.id}
                      onPress={() => setVerified(v.id, true)}
                    >
                      <Text style={shared.successButtonText}>Verify</Text>
                    </Pressable>
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
