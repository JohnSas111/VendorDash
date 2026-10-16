import { ConfirmModal } from "@/components/ConfirmModal";
import { Pagination } from "@/components/organizer/Pagination";
import { StatTile } from "@/components/organizer/StatTile";
import { PressableButton } from "@/components/PressableButton";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import { usePaging } from "@/hooks/usePaging";
import {
  BREAKPOINT,
  CARD_SHADOW,
  COLORS,
  formatMoney,
  RADIUS,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

type Stall = {
  id: string;
  stall_number: string;
  size: string | null;
  price_per_day_cents: number;
  is_active: boolean;
};

// Limits mirror what the payment code can handle: payment_quote refuses a
// stall with no valid price, and an absurd price would only be a typo.
const MAX_PRICE_PESOS = 100_000;
const MAX_STALL_NUMBER_LENGTH = 20;
const MAX_SIZE_LENGTH = 50;
// A stall with a booking in one of these states is in use right now.
const ACTIVE_BOOKING_STATUSES = ["pending", "approved", "paid", "checked_in"];

type StallFilter = "all" | "active" | "deactivated";
const FILTERS: { key: StallFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "deactivated", label: "Deactivated" },
];
// Below this much room the list switches from a table to stacked cards.
const TABLE_MIN_WIDTH = 720;

// Strict peso amount: digits with an optional 1-2 decimals ("₱1,200.50" is
// fine). parseFloat used to accept "12abc" as 12 and allowed a price of 0.
function parsePriceToCents(text: string): number | null {
  const cleaned = text.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 && cents <= MAX_PRICE_PESOS * 100 ? cents : null;
}

export default function StallManagementScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  const {
    venue,
    loading: venueLoading,
    error: venueError,
  } = useOrganizerVenue();
  const { showToast } = useToast();

  const [stalls, setStalls] = useState<Stall[]>([]);
  const [bookingCounts, setBookingCounts] = useState<Record<string, number>>(
    {},
  );
  // Bookings that are live right now (pending/approved/paid/checked in).
  const [activeCounts, setActiveCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Stall | null>(null);
  const [form, setForm] = useState({ stall_number: "", size: "", price: "" });
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Stall | null>(null);
  const [filter, setFilter] = useState<StallFilter>("all");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stalls.filter(
      (s) =>
        (filter === "all" ||
          (filter === "active" ? s.is_active : !s.is_active)) &&
        (q === "" || s.stall_number.toLowerCase().includes(q)),
    );
  }, [stalls, filter, search]);
  const paging = usePaging(shown, `${filter}|${search}`);
  const activeStalls = stalls.filter((s) => s.is_active);
  const averageCents =
    activeStalls.length > 0
      ? Math.round(
          activeStalls.reduce((sum, s) => sum + s.price_per_day_cents, 0) /
            activeStalls.length,
        )
      : null;
  // Room left for the list: the window minus the menu (248) and padding (80).
  const asTable =
    isDesktop && Math.min(width - 248, 1080) - 80 >= TABLE_MIN_WIDTH;

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    const { data, error: stallsError } = await supabase
      .from("stalls")
      .select("id, stall_number, size, price_per_day_cents, is_active")
      .eq("venue_id", venue.id)
      .order("stall_number");
    if (stallsError) {
      showToast("Couldn't load stalls.", "error");
    }
    const stallRows = data ?? [];
    setStalls(stallRows);

    const ids = stallRows.map((s) => s.id);
    if (ids.length > 0) {
      const { data: bookingRows, error: bookingError } = await supabase
        .from("bookings")
        .select("stall_id, status")
        .in("stall_id", ids);
      if (bookingError) {
        showToast("Couldn't load booking history for stalls.", "error");
      }
      const counts: Record<string, number> = {};
      const active: Record<string, number> = {};
      (bookingRows ?? []).forEach((b: any) => {
        counts[b.stall_id] = (counts[b.stall_id] ?? 0) + 1;
        if (ACTIVE_BOOKING_STATUSES.includes(b.status)) {
          active[b.stall_id] = (active[b.stall_id] ?? 0) + 1;
        }
      });
      setBookingCounts(counts);
      setActiveCounts(active);
    } else {
      setBookingCounts({});
      setActiveCounts({});
    }

    setLoading(false);
  }, [venue, showToast]);

  useEffect(() => {
    // Wrapped in a local async function rather than calling load()
    // directly — calling a useCallback'd function that setStates
    // straight in the effect body trips react-hooks/set-state-in-effect.
    async function run() {
      await load();
    }
    run();
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm({ stall_number: "", size: "", price: "" });
    setModalOpen(true);
  };

  const openEdit = (stall: Stall) => {
    setEditing(stall);
    setForm({
      stall_number: stall.stall_number,
      size: stall.size ?? "",
      price: String(stall.price_per_day_cents / 100),
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!venue) return;
    const stallNumber = form.stall_number.trim();
    const size = form.size.trim();
    const priceCents = parsePriceToCents(form.price);

    if (!stallNumber) {
      showToast("Enter a stall number.", "error");
      return;
    }
    if (stallNumber.length > MAX_STALL_NUMBER_LENGTH) {
      showToast(
        `Stall number is too long (${MAX_STALL_NUMBER_LENGTH} characters max).`,
        "error",
      );
      return;
    }
    if (size.length > MAX_SIZE_LENGTH) {
      showToast(
        `Size is too long (${MAX_SIZE_LENGTH} characters max).`,
        "error",
      );
      return;
    }
    if (priceCents === null) {
      showToast(
        `Enter a price per day between ₱1 and ₱${MAX_PRICE_PESOS.toLocaleString()}.`,
        "error",
      );
      return;
    }

    setSaving(true);
    // .select("id") returns the rows that really changed. Without it a
    // save blocked by the database's rules looked like success.
    const result = editing
      ? await supabase
          .from("stalls")
          .update({
            stall_number: stallNumber,
            size: size || null,
            price_per_day_cents: priceCents,
          })
          .eq("id", editing.id)
          .select("id")
      : await supabase
          .from("stalls")
          .insert({
            venue_id: venue.id,
            stall_number: stallNumber,
            size: size || null,
            price_per_day_cents: priceCents,
          })
          .select("id");
    setSaving(false);

    if (result.error) {
      // 23505 = a stall with this number already exists at this venue.
      showToast(
        result.error.code === "23505"
          ? `Stall ${stallNumber} already exists at this venue.`
          : result.error.message,
        "error",
      );
      return; // keep the form open so nothing typed is lost
    }
    if (!result.data || result.data.length === 0) {
      showToast("Couldn't save. The stall was not changed.", "error");
      return;
    }

    showToast(editing ? "Stall updated." : "Stall added.", "success");
    setModalOpen(false);
    load();
  };

  const toggleActive = async (stall: Stall) => {
    // Deactivating removes the stall from the vendors' floor map, including
    // for the vendor who holds it. So refuse while it is in use.
    if (stall.is_active && (activeCounts[stall.id] ?? 0) > 0) {
      showToast(
        `Stall ${stall.stall_number} has an active booking. Cancel or complete it first.`,
        "error",
      );
      return;
    }
    const { data, error } = await supabase
      .from("stalls")
      .update({ is_active: !stall.is_active })
      .eq("id", stall.id)
      .select("id");
    if (error) {
      showToast(error.message, "error");
    } else if (!data || data.length === 0) {
      showToast("Couldn't update this stall.", "error");
    }
    load();
  };

  const requestDelete = (stall: Stall) => {
    setOpenMenuId(null);
    setPendingDelete(stall);
  };

  const confirmDelete = async () => {
    const stall = pendingDelete;
    if (!stall) return;
    setPendingDelete(null);

    // .select("id") returns the rows really deleted, so "Stall deleted" is
    // only shown when something was. Deleting is allowed for the venue's own
    // organizer, and the database refuses a stall that has booking history.
    const { data, error } = await supabase
      .from("stalls")
      .delete()
      .eq("id", stall.id)
      .select("id");
    if (error) {
      showToast(
        error.code === "23503"
          ? "This stall has booking history, so it can't be deleted. Deactivate it instead."
          : error.message,
        "error",
      );
    } else if (!data || data.length === 0) {
      showToast("Couldn't delete this stall.", "error");
    } else {
      showToast("Stall deleted.", "info");
    }
    load();
  };

  if (venueLoading || loading) {
    return (
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <StallsSkeleton />
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

  return (
    <Pressable
      style={{ flex: 1 }}
      // Tapping anywhere outside an open menu closes it. This wraps
      // the whole screen rather than a full-screen absolute overlay,
      // since ScrollView + absolute overlays don't always cooperate
      // well with RN Web's scroll/hit-testing.
      onPress={() => openMenuId && setOpenMenuId(null)}
    >
      <ScrollView
        style={shared.screen}
        contentContainerStyle={[
          shared.content,
          isDesktop && shared.contentDesktop,
        ]}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={shared.title}>Stalls</Text>
            <Text style={shared.subtitle}>
              {stalls.length} stall{stalls.length === 1 ? "" : "s"} in{" "}
              {venue?.name ?? "your market"}
            </Text>
          </View>
          <PressableButton style={shared.primaryButton} onPress={openAdd}>
            <Text style={shared.primaryButtonText}>+ Add stall</Text>
          </PressableButton>
        </View>

        {stalls.length === 0 ? (
          <View style={[shared.emptyState, styles.emptyState]}>
            <Ionicons
              name="storefront-outline"
              size={26}
              color={COLORS.slate}
            />
            <Text style={[shared.emptyStateText, { marginTop: Spacing.xs }]}>
              No stalls yet. Add your first one above.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.tiles}>
              <StatTile
                label="Total stalls"
                value={stalls.length}
                tone="dark"
              />
              <StatTile
                label="Active"
                value={activeStalls.length}
                tone="green"
              />
              <StatTile
                label="Deactivated"
                value={stalls.length - activeStalls.length}
                tone={stalls.length - activeStalls.length > 0 ? "red" : "white"}
              />
              <StatTile
                label="Average price per day"
                value={averageCents === null ? "—" : formatMoney(averageCents)}
              />
            </View>

            <View style={styles.filterRow}>
              {FILTERS.map((f) => (
                <PressableButton
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[shared.chip, filter === f.key && shared.chipActive]}
                >
                  <Text
                    style={[
                      shared.chipText,
                      filter === f.key && shared.chipTextActive,
                    ]}
                  >
                    {f.label}
                  </Text>
                </PressableButton>
              ))}
              <View style={styles.searchWrap}>
                <Ionicons
                  name="search"
                  size={16}
                  color={COLORS.slate}
                  style={styles.searchIcon}
                />
                <TextInput
                  accessibilityLabel="Search stall number"
                  style={styles.searchInput}
                  placeholder="Search stall number"
                  placeholderTextColor={COLORS.slate}
                  value={search}
                  onChangeText={setSearch}
                />
              </View>
            </View>

            {shown.length === 0 ? (
              <View style={shared.emptyState}>
                <Ionicons name="search" size={26} color={COLORS.slate} />
                <Text
                  style={[shared.emptyStateText, { marginTop: Spacing.xs }]}
                >
                  No stalls match this filter.
                </Text>
              </View>
            ) : (
              <View style={asTable ? styles.table : styles.list}>
                {asTable && (
                  <View style={[styles.tr, styles.thead]}>
                    <Text style={[styles.th, styles.cStall]}>STALL</Text>
                    <Text style={[styles.th, styles.cSize]}>SIZE</Text>
                    <Text style={[styles.th, styles.cPrice]}>
                      PRICE PER DAY
                    </Text>
                    <Text style={[styles.th, styles.cStatus]}>STATUS</Text>
                    <Text style={[styles.th, styles.cNotes]}>NOTES</Text>
                    <View style={styles.cActions} />
                  </View>
                )}
                {paging.pageItems.map((stall) => {
                  const { bg, fg } = statusColors(
                    stall.is_active ? "available" : "unverified",
                  );
                  const hasBookings = (bookingCounts[stall.id] ?? 0) > 0;
                  const menuOpen = openMenuId === stall.id;
                  const badge = (
                    <View style={[shared.badge, { backgroundColor: bg }]}>
                      <Text style={[shared.badgeText, { color: fg }]}>
                        {stall.is_active ? "active" : "deactivated"}
                      </Text>
                    </View>
                  );
                  const actions = (
                    <View
                      style={[
                        styles.rowActions,
                        asTable ? styles.cActions : styles.rowActionsMobile,
                      ]}
                    >
                      <PressableButton
                        style={shared.secondaryButton}
                        onPress={() => openEdit(stall)}
                      >
                        <Text style={shared.secondaryButtonText}>Edit</Text>
                      </PressableButton>
                      <PressableButton
                        style={shared.secondaryButton}
                        onPress={() => toggleActive(stall)}
                      >
                        <Text style={shared.secondaryButtonText}>
                          {stall.is_active ? "Deactivate" : "Reactivate"}
                        </Text>
                      </PressableButton>

                      {!hasBookings ? (
                        <View style={{ position: "relative" }}>
                          <Pressable
                            style={styles.kebabButton}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityRole="button"
                            accessibilityLabel={`More actions for stall ${stall.stall_number}`}
                            onPress={(e: any) => {
                              e.stopPropagation?.();
                              setOpenMenuId(menuOpen ? null : stall.id);
                            }}
                          >
                            <Ionicons
                              name="ellipsis-vertical"
                              size={16}
                              color={COLORS.slate}
                            />
                          </Pressable>

                          {menuOpen && (
                            <View style={styles.menu}>
                              <Pressable
                                accessibilityRole="menuitem"
                                style={styles.menuItem}
                                onPress={(e: any) => {
                                  e.stopPropagation?.();
                                  requestDelete(stall);
                                }}
                              >
                                <Ionicons
                                  name="trash-outline"
                                  size={14}
                                  color={COLORS.clay}
                                />
                                <Text style={styles.menuItemDangerText}>
                                  Delete stall
                                </Text>
                              </Pressable>
                            </View>
                          )}
                        </View>
                      ) : (
                        // Same footprint as the real kebab button, just
                        // invisible, so every row's buttons line up whether
                        // or not this stall has a menu to show.
                        <View style={styles.kebabPlaceholder} />
                      )}
                    </View>
                  );

                  return asTable ? (
                    <View
                      key={stall.id}
                      style={[
                        styles.tr,
                        styles.trBody,
                        { zIndex: menuOpen ? 20 : 1 },
                      ]}
                    >
                      <Text style={[styles.cellStrong, styles.cStall]}>
                        Stall {stall.stall_number}
                      </Text>
                      <Text style={[styles.cell, styles.cSize]}>
                        {stall.size ?? "—"}
                      </Text>
                      <Text style={[styles.cell, styles.cPrice]}>
                        {formatMoney(stall.price_per_day_cents)}
                      </Text>
                      <View style={styles.cStatus}>{badge}</View>
                      <Text style={[styles.cellMuted, styles.cNotes]}>
                        {hasBookings ? "Has booking history" : ""}
                      </Text>
                      {actions}
                    </View>
                  ) : (
                    <View
                      key={stall.id}
                      style={[
                        shared.row,
                        isDesktop && shared.rowDesktop,
                        { zIndex: menuOpen ? 20 : 1 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={shared.rowTitle}>
                          Stall {stall.stall_number}
                        </Text>
                        <Text style={shared.rowSubtitle}>
                          {stall.size ?? "Size not set"} ·{" "}
                          {formatMoney(stall.price_per_day_cents)}/day
                        </Text>
                        <View style={styles.statusRow}>
                          {badge}
                          {hasBookings && (
                            <Text style={styles.historyText}>
                              Has booking history
                            </Text>
                          )}
                        </View>
                      </View>
                      {actions}
                    </View>
                  );
                })}
              </View>
            )}

            <Pagination
              page={paging.page}
              total={paging.total}
              noun="stalls"
              onPage={paging.setPage}
            />
          </>
        )}

        <Modal
          visible={modalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setModalOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[shared.card, styles.formCard]}>
              <Text style={shared.rowTitle}>
                {editing ? "Edit stall" : "Add stall"}
              </Text>

              <Text style={shared.label}>Stall number</Text>
              <TextInput
                accessibilityLabel="Stall number"
                style={shared.input}
                value={form.stall_number}
                onChangeText={(t) =>
                  setForm((f) => ({ ...f, stall_number: t }))
                }
                placeholder="A-12"
              />

              <Text style={shared.label}>Size (optional)</Text>
              <TextInput
                accessibilityLabel="Size (optional)"
                style={shared.input}
                value={form.size}
                onChangeText={(t) => setForm((f) => ({ ...f, size: t }))}
                placeholder="3x3m"
              />

              <Text style={shared.label}>Price per day (₱)</Text>
              <TextInput
                accessibilityLabel="Price per day (₱)"
                style={shared.input}
                value={form.price}
                onChangeText={(t) => setForm((f) => ({ ...f, price: t }))}
                placeholder="500"
                keyboardType="numeric"
              />

              <View style={styles.formActions}>
                <PressableButton
                  style={[shared.secondaryButton, styles.formActionButton]}
                  onPress={() => setModalOpen(false)}
                >
                  <Text style={shared.secondaryButtonText}>Cancel</Text>
                </PressableButton>
                <PressableButton
                  style={[shared.primaryButton, styles.formActionButton]}
                  onPress={save}
                  disabled={saving}
                >
                  <Text style={shared.primaryButtonText}>
                    {saving ? "Saving…" : "Save"}
                  </Text>
                </PressableButton>
              </View>
            </View>
          </View>
        </Modal>

        <ConfirmModal
          visible={!!pendingDelete}
          title="Delete stall"
          message={
            pendingDelete
              ? `Delete stall ${pendingDelete.stall_number}? This can't be undone.`
              : ""
          }
          confirmLabel="Delete stall"
          cancelLabel="Cancel"
          onConfirm={confirmDelete}
          onDismiss={() => setPendingDelete(null)}
        />
      </ScrollView>
    </Pressable>
  );
}

// Placeholder shown while stalls are loading.
function StallsSkeleton() {
  return (
    <View>
      <View style={styles.headerRow}>
        <View>
          <View
            style={[
              styles.skeletonLine,
              { width: 70, height: 22, marginBottom: Spacing.sm },
            ]}
          />
          <View style={[styles.skeletonLine, { width: 60 }]} />
        </View>
      </View>
      <View style={[styles.list, { marginTop: Spacing.lg }]}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[shared.row, styles.skeletonBlock, { minHeight: 68 }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  emptyState: { marginTop: Spacing.lg },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  searchWrap: {
    position: "relative",
    justifyContent: "center",
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 200,
  },
  searchIcon: { position: "absolute", left: 14, zIndex: 1 },
  searchInput: {
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    paddingLeft: 38,
    paddingRight: 16,
    fontSize: 13,
    color: COLORS.inkNavy,
  },
  list: { gap: Spacing.sm },
  // Table (wide) layout: one white card, a header row, one row per stall.
  // No overflow clipping, so the "..." menu can open below the last row.
  table: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    ...CARD_SHADOW,
  },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  thead: { borderBottomWidth: 1, borderBottomColor: COLORS.hairline },
  trBody: { borderBottomWidth: 1, borderBottomColor: COLORS.hairline },
  th: { fontSize: 12, fontWeight: "700", color: COLORS.slate },
  cStall: { flex: 1.2 },
  cSize: { flex: 1 },
  cPrice: { flex: 1.2 },
  cStatus: { flex: 1, alignItems: "flex-start" },
  cNotes: { flex: 1.6 },
  cActions: { width: 250, justifyContent: "flex-end" },
  cell: { fontSize: 14, color: COLORS.inkNavy },
  cellStrong: { fontSize: 14, fontWeight: "700", color: COLORS.inkNavy },
  cellMuted: { fontSize: 13, color: COLORS.slate },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  historyText: { fontSize: Typography.xs, color: COLORS.slate },
  rowActions: { flexDirection: "row", gap: Spacing.sm, alignItems: "center" },
  rowActionsMobile: { marginTop: Spacing.md },
  kebabButton: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
  },
  kebabPlaceholder: { width: 32, height: 32 },
  menu: {
    position: "absolute",
    top: 38,
    right: 0,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    minWidth: 150,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 30,
  },
  menuItem: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minHeight: 40,
  },
  menuItemDangerText: {
    color: COLORS.clayText,
    fontSize: Typography.base,
    fontWeight: "600",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  formCard: { width: "100%", maxWidth: 420 },
  formActions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.xl },
  formActionButton: { flex: 1, alignItems: "center" },
  skeletonBlock: {
    backgroundColor: COLORS.border,
    borderColor: COLORS.border,
    shadowOpacity: 0,
  },
  skeletonLine: {
    height: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
  },
});
