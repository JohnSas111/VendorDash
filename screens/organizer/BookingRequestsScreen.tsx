import { BookingDetailsPanel } from "@/components/organizer/BookingDetailsPanel";
import { Pagination } from "@/components/organizer/Pagination";
import { PressableButton } from "@/components/PressableButton";
import { Spacing } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import { usePaging } from "@/hooks/usePaging";
import {
  BOOKING_DETAIL_SELECT,
  BOOKING_FILTERS,
  type BookingDetail,
  type BookingFilter,
  daysShort,
  rowMoneyNote,
  statusesForFilter,
  toBookingDetail,
} from "@/lib/bookingDetails";
import {
  BREAKPOINT,
  COLORS,
  formatDate,
  formatMoney,
  RADIUS,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { ownerPrefix } from "@/lib/uxHelpers";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

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

  const [filter, setFilter] = useState<BookingFilter>("pending");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<BookingDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const filtered = rows.filter(
    (r) =>
      !search.trim() ||
      r.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
      r.owner_name.toLowerCase().includes(search.toLowerCase()) ||
      r.stall_number.toLowerCase().includes(search.toLowerCase()),
  );
  const paging = usePaging(filtered, `${filter}|${search}`);

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    // One query gives the list AND everything the details panel shows
    // (phone, price, payments, refunds). RLS already limits all of it to this
    // organizer's venue.
    let query = supabase
      .from("bookings")
      .select(BOOKING_DETAIL_SELECT)
      .eq("stalls.venue_id", venue.id)
      .order("requested_at", { ascending: false })
      .limit(500);

    const statuses = statusesForFilter(filter);
    if (statuses) query = query.in("status", statuses);

    const { data, error } = await query;
    if (error) {
      showToast("Couldn't load booking requests.", "error");
    }
    setRows((data ?? []).map(toBookingDetail));
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
  const approve = async (booking: BookingDetail) => {
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

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const goTo = (href: string) => router.push(href as any);

  return (
    <View style={{ flex: 1, flexDirection: isDesktop ? "row" : "column" }}>
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <Text style={shared.title}>Booking Requests</Text>
        <Text style={shared.subtitle}>
          Approving gives the vendor 24 hours to pay (or until the market ends,
          if that comes sooner). Vendors must be verified before you can approve
          them; requests from unverified vendors expire after 24 hours instead
          of 72. Tap a booking to see who booked it and how it was paid.
        </Text>

        <View style={styles.filterRow}>
          {BOOKING_FILTERS.map((f) => (
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
            {paging.pageItems.map((b) => {
              const { bg, fg } = statusColors(b.status);
              const needsVerification =
                b.status === "pending" && !b.vendor_verified;
              const unverifiedColors = statusColors("unverified");
              const money = rowMoneyNote(b);
              const active = b.id === selectedId;
              return (
                <Pressable
                  key={b.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.vendor_name}, stall ${b.stall_number}, ${b.status}. Show details`}
                  onPress={() => setSelectedId(active ? null : b.id)}
                  style={[
                    shared.row,
                    isDesktop && shared.rowDesktop,
                    active && styles.rowActive,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={shared.rowTitle}>{b.vendor_name}</Text>
                    <Text style={shared.rowSubtitle}>
                      {ownerPrefix(b.vendor_name, b.owner_name)}Stall{" "}
                      {b.stall_number} ·{" "}
                      {daysShort(b.attending_days) || "no days set"} · requested{" "}
                      {formatDate(b.requested_at)}
                    </Text>
                    {money && (
                      <Text style={styles.moneyLine}>
                        {formatMoney(money.amountCents)} · {money.note}
                      </Text>
                    )}
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
                        style={[
                          shared.dangerOutlineButton,
                          styles.actionButton,
                        ]}
                        disabled={actingOnId === b.id}
                        onPress={() => reject(b.id)}
                      >
                        <Ionicons name="close" size={14} color={COLORS.clay} />
                        <Text style={shared.dangerOutlineButtonText}>
                          Reject
                        </Text>
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
                </Pressable>
              );
            })}
          </View>
        )}

        <Pagination
          page={paging.page}
          total={paging.total}
          noun="bookings"
          onPage={paging.setPage}
        />

        {!isDesktop && selected && (
          <View style={[shared.card, styles.mobileDetailCard]}>
            <BookingDetailsPanel
              detail={selected}
              onNavigate={goTo}
              onClose={() => setSelectedId(null)}
            />
          </View>
        )}
      </ScrollView>

      {isDesktop && selected && (
        <ScrollView style={styles.sidebar}>
          <Text style={[shared.sectionHeading, { marginTop: 0 }]}>Details</Text>
          <BookingDetailsPanel
            detail={selected}
            onNavigate={goTo}
            onClose={() => setSelectedId(null)}
          />
        </ScrollView>
      )}
    </View>
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
  rowActive: { borderColor: COLORS.inkNavy },
  moneyLine: { fontSize: 13, color: COLORS.inkNavy, marginTop: 4 },
  mobileDetailCard: { marginTop: Spacing.xl },
  sidebar: {
    flexGrow: 0,
    flexShrink: 0,
    width: 360,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    padding: Spacing.xl,
    backgroundColor: COLORS.white,
  },
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
