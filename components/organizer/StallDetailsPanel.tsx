// components/organizer/StallDetailsPanel.tsx
//
// The Floor Map "Details" panel: a session overview when no stall is
// selected, and the stall / vendor / money details when one is.
// Everything it shows comes from lib/floorMapPanel.ts.

import { Spacing, Typography } from "@/constants/theme";
import type { PanelModel, PanelTarget } from "@/lib/floorMapPanel";
import {
  COLORS,
  RADIUS,
  shared,
  stallStatusColors,
} from "@/lib/organizerTheme";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  model: PanelModel;
  onNavigate: (target: PanelTarget) => void;
  onClose?: () => void; // back to the overview (shown while a stall is open)
};

export function StallDetailsPanel({ model, onNavigate, onClose }: Props) {
  if (model.kind === "overview") {
    return (
      <View style={styles.wrap}>
        <Text style={shared.rowTitle}>{model.title}</Text>
        <Text style={shared.rowSubtitle}>{model.subtitle}</Text>

        <View style={styles.metricGrid}>
          {model.metrics.map((m) => (
            <View key={m.label} style={styles.metric}>
              <Text style={styles.metricValue}>{m.value}</Text>
              <Text style={styles.metricLabel}>{m.label}</Text>
            </View>
          ))}
        </View>

        <Rows rows={model.rows} />

        {model.alert && (
          <View style={styles.alert}>
            <Ionicons name="alert-circle" size={15} color={COLORS.amberText} />
            <Text style={styles.alertText}>{model.alert}</Text>
          </View>
        )}
        {model.action && (
          <ActionButton
            label={model.action.label}
            onPress={() => onNavigate(model.action!.target)}
          />
        )}
        <Text style={styles.hint}>Tap a stall to see its details.</Text>
      </View>
    );
  }

  const { bg, text } = stallStatusColors(model.status);
  return (
    <View style={styles.wrap}>
      {onClose && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the session overview"
          onPress={onClose}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={14} color={COLORS.slate} />
          <Text style={styles.backText}>Overview</Text>
        </Pressable>
      )}

      <View style={styles.titleRow}>
        <Text style={shared.rowTitle}>{model.title}</Text>
        <View style={[styles.badge, { backgroundColor: bg }]}>
          <Text style={[styles.badgeText, { color: text }]}>
            {model.statusLabel}
          </Text>
        </View>
      </View>

      {model.vendor && (
        <View style={styles.vendor}>
          <Text style={styles.vendorName}>{model.vendor.name}</Text>
          {(model.vendor.owner || model.vendor.category) && (
            <Text style={shared.rowSubtitle}>
              {[model.vendor.owner, model.vendor.category]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          )}
          <View
            style={[
              styles.badge,
              styles.verifyBadge,
              {
                backgroundColor: model.vendor.verified ? "#E6F4EC" : "#FDF2E0",
              },
            ]}
          >
            <Ionicons
              name={model.vendor.verified ? "shield-checkmark" : "time"}
              size={12}
              color={model.vendor.verified ? COLORS.tealText : COLORS.amberText}
            />
            <Text
              style={[
                styles.badgeText,
                {
                  color: model.vendor.verified
                    ? COLORS.tealText
                    : COLORS.amberText,
                },
              ]}
            >
              {model.vendor.verified ? "Verified" : "Not verified yet"}
            </Text>
          </View>
        </View>
      )}

      {model.days && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Days</Text>
          <View style={styles.chipRow}>
            {model.days.map((d) => (
              <View key={d.label} style={[styles.chip, d.on && styles.chipOn]}>
                <Text style={[styles.chipText, d.on && styles.chipTextOn]}>
                  {d.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <Rows rows={model.rows} />

      {model.note && <Text style={shared.rowSubtitle}>{model.note}</Text>}

      {model.action && (
        <ActionButton
          label={model.action.label}
          onPress={() => onNavigate(model.action!.target)}
        />
      )}
    </View>
  );
}

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <View style={styles.section}>
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text style={styles.rowLabel}>{r.label}</Text>
          <Text style={styles.rowValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={shared.secondaryButton}
    >
      <Text style={shared.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    flexWrap: "wrap",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
  verifyBadge: { marginTop: 6 },
  vendor: { gap: 2 },
  vendorName: {
    fontSize: Typography.md,
    fontWeight: "600",
    color: COLORS.inkNavy,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: Spacing.md,
    gap: Spacing.xs,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.slate,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipRow: { flexDirection: "row", gap: Spacing.xs },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipOn: { backgroundColor: COLORS.inkNavy, borderColor: COLORS.inkNavy },
  chipText: { fontSize: 12, color: COLORS.slate },
  chipTextOn: { color: COLORS.white, fontWeight: "600" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  rowLabel: { fontSize: 13, color: COLORS.slate },
  rowValue: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.inkNavy,
    flexShrink: 1,
    textAlign: "right",
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  metric: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: COLORS.paper,
    borderRadius: RADIUS.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  metricValue: { fontSize: 18, fontWeight: "700", color: COLORS.inkNavy },
  metricLabel: { fontSize: 11, color: COLORS.slate },
  alert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FDF2E0",
    borderRadius: RADIUS.sm,
    padding: 10,
  },
  alertText: { flex: 1, fontSize: 13, color: COLORS.amberText },
  hint: { fontSize: 12, color: COLORS.slate },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
  },
  backText: { fontSize: 12, color: COLORS.slate },
});
