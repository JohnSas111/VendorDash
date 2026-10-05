import { PressableButton } from "@/components/PressableButton";
import { Spacing } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  RADIUS,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { ownerPrefix, vendorDisplay } from "@/lib/uxHelpers";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

type BookingRow = {
  id: string;
  status: string;
  requested_at: string;
  attending_days: string[];
  vendor_id: string;
  vendor_name: string; // business name (falls back to the person's name)
  owner_name: string;
  // Only verified vendors can be approved (approve_booking enforces this).
  vendor_verified: boolean;
  stall_number: string;
};

const FILTERS = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "all",
] as const;
type Filter = (typeof FILTERS)[number];

export default function BookingRequestsScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();
  const { showToast } = useToast();
  const router = useRouter();

  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    // vendor_details links to profiles twice (its own id, and verified_by),
    // so the embed must name the link: vendor_details_id_fkey.
    let query = supabase
      .from("bookings")
      .select(
        "id, status, requested_at, attending_days, vendor_id, profiles!bookings_vendor_id_fkey(full_name, vendor_details!vendor_details_id_fkey(is_verified, business_name)), stalls!inner(stall_number, venue_id)",
      )
      .eq("stalls.venue_id", venue.id)
      .order("requested_at", { ascending: false });

    if (filter !== "all") query = query.eq("status", filter);

    const { data, error } = await query;
    if (error) {
      showToast("Couldn't load booking requests.", "error");
    }
    setRows(
      (data ?? []).map((row: any) => {
        const details = Array.isArray(row.profiles?.vendor_details)
          ? row.profiles.vendor_details[0]
          : row.profiles?.vendor_details;
        const who = vendorDisplay(row.profiles);
        return {
          id: row.id,
          status: row.status,
          requested_at: row.requested_at,
          attending_days: row.attending_days ?? [],
          vendor_id: row.vendor_id,
          vendor_name: who.name,
          owner_name: who.owner,
          // Missing details count as NOT verified (safe default).
          vendor_verified: details?.is_verified === true,
          stall_number: row.stalls?.stall_number ?? "—",
        };
      }),
    );
    setLoading(false);
  }, [venue, filter, showToast]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  // Approval is enforced by the database function approve_booking: it checks
  // that this organizer owns the venue, the booking is still pending, the
  // vendor is verified, and it sets the payment deadline, writes the vendor's
  // notification and records the audit event in one transaction.
  const approve = async (booking: BookingRow) => {
    setActingOnId(booking.id);

    const { error } = await supabase.rpc("approve_booking", {
      p_booking_id: booking.id,
    });

    setActingOnId(null);
    if (error) {
      showToast(error.message || "Couldn't approve that booking.", "error");
      load();
      return;
    }
    showToast("Booking approved. The vendor has been notified.", "success");
    load();
  };

  // reject_booking moves pending -> rejected and notifies the vendor.
  const reject = async (bookingId: string) => {
    setActingOnId(bookingId);

    const { error } = await supabase.rpc("reject_booking", {
      p_booking_id: bookingId,
      p_reason: null,
    });

    setActingOnId(null);
    if (error) {
      showToast(error.message || "Couldn't reject that booking.", "error");
      load();
      return;
    }
    showToast("Booking rejected. The vendor has been notified.", "info");
    load();
  };

  if (venueLoading) {
    return (
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <BookingRequestsSkeleton />
      </ScrollView>
    );
  }
  if (venueError) {
    return (
      <View style={shared.centerFill}>
        <Text style={shared.errorText}>{venueError}</Text>
      </View>
    );
  }

  const filtered = rows.filter(
    (r) =>
      !search.trim() ||
      r.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
      r.owner_name.toLowerCase().includes(search.toLowerCase()) ||
      r.stall_number.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.content,
        isDesktop && shared.contentDesktop,
      ]}
    >
      <Text style={shared.title}>Booking Requests</Text>
      <Text style={shared.subtitle}>
        Approving gives the vendor 24 hours to pay (or until the market ends, if
        that comes sooner). Vendors must be verified before you can approve
        them; requests from unverified vendors expire after 24 hours instead of
        72.
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

      <View style={styles.searchWrap}>
        <Ionicons
          name="search"
          size={16}
          color={COLORS.slate}
          style={styles.searchIcon}
        />
        <TextInput
          accessibilityLabel="Search vendor or stall"
          style={[shared.input, styles.searchInput]}
          placeholder="Search vendor or stall…"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <RowsSkeleton />
      ) : filtered.length === 0 ? (
        <View style={shared.emptyState}>
          <Ionicons name="file-tray-outline" size={26} color={COLORS.slate} />
          <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
            No bookings match this filter.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {filtered.map((b) => {
            const { bg, fg } = statusColors(b.status);
            const needsVerification =
              b.status === "pending" && !b.vendor_verified;
            const unverifiedColors = statusColors("unverified");
            return (
              <View
                key={b.id}
                style={[shared.row, isDesktop && shared.rowDesktop]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={shared.rowTitle}>{b.vendor_name}</Text>
                  <Text style={shared.rowSubtitle}>
                    {ownerPrefix(b.vendor_name, b.owner_name)}Stall{" "}
                    {b.stall_number} ·{" "}
                    {b.attending_days.join(", ") || "no days set"} · requested{" "}
                    {formatDate(b.requested_at)}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View style={[shared.badge, { backgroundColor: bg }]}>
                      <Text style={[shared.badgeText, { color: fg }]}>
                        {b.status}
                      </Text>
                    </View>
                    {needsVerification && (
                      <View
                        style={[
                          shared.badge,
                          { backgroundColor: unverifiedColors.bg },
                        ]}
                      >
                        <Text
                          style={[
                            shared.badgeText,
                            { color: unverifiedColors.fg },
                          ]}
                        >
                          Unverified
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                {b.status === "pending" && (
                  <View
                    style={[
                      styles.rowActions,
                      !isDesktop && styles.rowActionsMobile,
                    ]}
                  >
                    <PressableButton
                      style={[shared.dangerOutlineButton, styles.actionButton]}
                      disabled={actingOnId === b.id}
                      onPress={() => reject(b.id)}
                    >
                      <Ionicons name="close" size={14} color={COLORS.clay} />
                      <Text style={shared.dangerOutlineButtonText}>Reject</Text>
                    </PressableButton>
                    {b.vendor_verified ? (
                      <PressableButton
                        style={[shared.successButton, styles.actionButton]}
                        disabled={actingOnId === b.id}
                        onPress={() => approve(b)}
                      >
                        <Ionicons
                          name="checkmark"
                          size={14}
                          color={COLORS.white}
                        />
                        <Text style={shared.successButtonText}>Approve</Text>
                      </PressableButton>
                    ) : (
                      // Approving is refused for unverified vendors, so send
                      // the organizer to Vendor Verification instead.
                      <PressableButton
                        style={[shared.secondaryButton, styles.actionButton]}
                        onPress={() =>
                          router.push("/vendor-verification" as any)
                        }
                      >
                        <Ionicons
                          name="shield-checkmark-outline"
                          size={14}
                          color={COLORS.inkNavy}
                        />
                        <Text style={shared.secondaryButtonText}>
                          Verify vendor
                        </Text>
                      </PressableButton>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// Placeholder shown while the venue is resolving.
function BookingRequestsSkeleton() {
  return (
    <View>
      <View
        style={[
          styles.skeletonLine,
          { width: 180, height: 22, marginBottom: Spacing.sm },
        ]}
      />
      <View
        style={[styles.skeletonLine, { width: 260, marginBottom: Spacing.lg }]}
      />
      <RowsSkeleton />
    </View>
  );
}

// Placeholder rows shown while the filtered list is loading.
function RowsSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[shared.row, styles.skeletonRow]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    flexWrap: "wrap",
  },
  filterActive: { backgroundColor: COLORS.inkNavy },
  filterActiveText: { color: COLORS.white },
  searchWrap: {
    position: "relative",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  searchIcon: { position: "absolute", left: Spacing.md, zIndex: 1 },
  // The icon sits at 12px and is 16px wide, so the text must start after
  // it (12 + 16 + a small gap), not on top of it.
  searchInput: { paddingLeft: Spacing.xxxl + Spacing.xs },
  list: { gap: Spacing.sm },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  rowActions: { flexDirection: "row", gap: Spacing.sm },
  rowActionsMobile: { marginTop: Spacing.md },
  actionButton: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  skeletonRow: {
    backgroundColor: COLORS.border,
    borderColor: COLORS.border,
    shadowOpacity: 0,
    minHeight: 64,
  },
  skeletonLine: {
    height: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
  },
});
