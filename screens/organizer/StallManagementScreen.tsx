import { useOrganizerVenue } from "@/hooks/useOrganizerVenue";
import { confirmAsync, notify } from "@/lib/confirmDialog";
import {
  BREAKPOINT,
  COLORS,
  formatMoney,
  RADIUS,
  shared,
  statusColors,
} from "@/lib/organizerTheme";
import { supabase } from "@/lib/supabase";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
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

  const load = useCallback(async () => {
    if (!venue) return;
    setLoading(true);

    const { data } = await supabase
      .from("stalls")
      .select("id, stall_number, size, price_per_day_cents, is_active")
      .eq("venue_id", venue.id)
      .order("stall_number");
    const stallRows = data ?? [];
    setStalls(stallRows);

    const ids = stallRows.map((s) => s.id);
    if (ids.length > 0) {
      const { data: bookingRows } = await supabase
        .from("bookings")
        .select("stall_id")
        .in("stall_id", ids);
      const counts: Record<string, number> = {};
      (bookingRows ?? []).forEach((b: any) => {
        counts[b.stall_id] = (counts[b.stall_id] ?? 0) + 1;
      });
      setBookingCounts(counts);
    } else {
      setBookingCounts({});
    }

    setLoading(false);
  }, [venue]);

  useEffect(() => {
    load();
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
      notify("Missing info", "Stall number and a valid price are required.");
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
      if (error) notify("Error", error.message);
    } else {
      const { error } = await supabase.from("stalls").insert({
        venue_id: venue.id,
        stall_number: form.stall_number.trim(),
        size: form.size.trim() || null,
        price_per_day_cents: priceCents,
      });
      if (error) notify("Error", error.message);
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
    if (error) notify("Error", error.message);
    load();
  };

  const deleteStall = async (stall: Stall) => {
    setOpenMenuId(null);
    const confirmed = await confirmAsync(
      "Delete stall",
      `Delete stall ${stall.stall_number}? This can't be undone.`,
    );
    if (!confirmed) return;

    const { error } = await supabase.from("stalls").delete().eq("id", stall.id);
    if (error) notify("Error", error.message);
    load();
  };

  if (venueLoading || loading) {
    return (
      <View style={shared.centerFill}>
        <ActivityIndicator color={COLORS.inkNavy} />
      </View>
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
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <View>
            <Text style={shared.title}>Stalls</Text>
            <Text style={shared.subtitle}>{stalls.length} total</Text>
          </View>
          <Pressable style={shared.primaryButton} onPress={openAdd}>
            <Text style={shared.primaryButtonText}>+ Add stall</Text>
          </Pressable>
        </View>

        <View style={{ gap: 10, marginTop: 8 }}>
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
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 6,
                    }}
                  >
                    <View style={[shared.badge, { backgroundColor: bg }]}>
                      <Text style={[shared.badgeText, { color: fg }]}>
                        {stall.is_active ? "active" : "deactivated"}
                      </Text>
                    </View>
                    {hasBookings && (
                      <Text style={{ fontSize: 11, color: COLORS.slate }}>
                        Has booking history
                      </Text>
                    )}
                  </View>
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    marginTop: isDesktop ? 0 : 10,
                    alignItems: "center",
                  }}
                >
                  <Pressable
                    style={shared.secondaryButton}
                    onPress={() => openEdit(stall)}
                  >
                    <Text style={shared.secondaryButtonText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    style={shared.secondaryButton}
                    onPress={() => toggleActive(stall)}
                  >
                    <Text style={shared.secondaryButtonText}>
                      {stall.is_active ? "Deactivate" : "Reactivate"}
                    </Text>
                  </Pressable>

                  {!hasBookings ? (
                    <View style={{ position: "relative" }}>
                      <Pressable
                        style={styles.kebabButton}
                        onPress={(e: any) => {
                          e.stopPropagation?.();
                          setOpenMenuId(menuOpen ? null : stall.id);
                        }}
                      >
                        <Text style={styles.kebabText}>⋮</Text>
                      </Pressable>

                      {menuOpen && (
                        <View style={styles.menu}>
                          <Pressable
                            style={styles.menuItem}
                            onPress={(e: any) => {
                              e.stopPropagation?.();
                              deleteStall(stall);
                            }}
                          >
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

        <Modal
          visible={modalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setModalOpen(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(22,25,43,0.4)",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <View style={[shared.card, { width: "100%", maxWidth: 420 }]}>
              <Text style={shared.rowTitle}>
                {editing ? "Edit stall" : "Add stall"}
              </Text>

              <Text style={shared.label}>Stall number</Text>
              <TextInput
                style={shared.input}
                value={form.stall_number}
                onChangeText={(t) =>
                  setForm((f) => ({ ...f, stall_number: t }))
                }
                placeholder="A-12"
              />

              <Text style={shared.label}>Size (optional)</Text>
              <TextInput
                style={shared.input}
                value={form.size}
                onChangeText={(t) => setForm((f) => ({ ...f, size: t }))}
                placeholder="3x3m"
              />

              <Text style={shared.label}>Price per day (₱)</Text>
              <TextInput
                style={shared.input}
                value={form.price}
                onChangeText={(t) => setForm((f) => ({ ...f, price: t }))}
                placeholder="500"
                keyboardType="numeric"
              />

              <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
                <Pressable
                  style={[
                    shared.secondaryButton,
                    { flex: 1, alignItems: "center" },
                  ]}
                  onPress={() => setModalOpen(false)}
                >
                  <Text style={shared.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    shared.primaryButton,
                    { flex: 1, alignItems: "center" },
                  ]}
                  onPress={save}
                  disabled={saving}
                >
                  <Text style={shared.primaryButtonText}>
                    {saving ? "Saving…" : "Save"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </Pressable>
  );
}

const styles = {
  kebabButton: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: COLORS.white,
  },
  kebabText: { fontSize: 16, color: COLORS.slate, fontWeight: "700" as const },
  kebabPlaceholder: { width: 32, height: 32 },
  menu: {
    position: "absolute" as const,
    top: 38,
    right: 0,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    minWidth: 140,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 30,
  },
  menuItem: { paddingVertical: 10, paddingHorizontal: 14 },
  menuItemDangerText: {
    color: COLORS.clay,
    fontSize: 13,
    fontWeight: "600" as const,
  },
};
