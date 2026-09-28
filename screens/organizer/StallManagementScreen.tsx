import { ConfirmModal } from "@/components/ConfirmModal";
import { PressableButton } from "@/components/PressableButton";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import {
  BREAKPOINT,
  COLORS,
  formatMoney,
  RADIUS,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Stall | null>(null);
  const [form, setForm] = useState({ stall_number: "", size: "", price: "" });
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Stall | null>(null);

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
        .select("stall_id")
        .in("stall_id", ids);
      if (bookingError) {
        showToast("Couldn't load booking history for stalls.", "error");
      }
      const counts: Record<string, number> = {};
      (bookingRows ?? []).forEach((b: any) => {
        counts[b.stall_id] = (counts[b.stall_id] ?? 0) + 1;
      });
      setBookingCounts(counts);
    } else {
      setBookingCounts({});
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
    const priceCents = Math.round(parseFloat(form.price || "0") * 100);
    if (!form.stall_number.trim() || Number.isNaN(priceCents)) {
      showToast("Stall number and a valid price are required.", "error");
      return;
    }
    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from("stalls")
        .update({
          stall_number: form.stall_number.trim(),
          size: form.size.trim() || null,
          price_per_day_cents: priceCents,
        })
        .eq("id", editing.id);
      if (error) {
        showToast(error.message, "error");
      } else {
        showToast("Stall updated.", "success");
      }
    } else {
      const { error } = await supabase.from("stalls").insert({
        venue_id: venue.id,
        stall_number: form.stall_number.trim(),
        size: form.size.trim() || null,
        price_per_day_cents: priceCents,
      });
      if (error) {
        showToast(error.message, "error");
      } else {
        showToast("Stall added.", "success");
      }
    }
    setSaving(false);
    setModalOpen(false);
    load();
  };

  const toggleActive = async (stall: Stall) => {
    const { error } = await supabase
      .from("stalls")
      .update({ is_active: !stall.is_active })
      .eq("id", stall.id);
    if (error) {
      showToast(error.message, "error");
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

    const { error } = await supabase.from("stalls").delete().eq("id", stall.id);
    if (error) {
      showToast(error.message, "error");
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
            <Text style={shared.subtitle}>{stalls.length} total</Text>
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
          <View style={styles.list}>
            {stalls.map((stall) => {
              const { bg, fg } = statusColors(
                stall.is_active ? "available" : "unverified",
              );
              const hasBookings = (bookingCounts[stall.id] ?? 0) > 0;
              const menuOpen = openMenuId === stall.id;
              return (
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
                      <View style={[shared.badge, { backgroundColor: bg }]}>
                        <Text style={[shared.badgeText, { color: fg }]}>
                          {stall.is_active ? "active" : "deactivated"}
                        </Text>
                      </View>
                      {hasBookings && (
                        <Text style={styles.historyText}>
                          Has booking history
                        </Text>
                      )}
                    </View>
                  </View>

                  <View
                    style={[
                      styles.rowActions,
                      !isDesktop && styles.rowActionsMobile,
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
                      // invisible — keeps every row's button group the
                      // same total width so right edges line up whether
                      // or not this stall has a menu to show.
                      <View style={styles.kebabPlaceholder} />
                    )}
                  </View>
                </View>
              );
            })}
          </View>
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
  list: { gap: Spacing.sm, marginTop: Spacing.sm },
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
