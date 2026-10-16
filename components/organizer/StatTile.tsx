// components/organizer/StatTile.tsx
//
// The coloured number tile used on the organizer screens (Check-In, Sales
// Reports). Same look as the tiles on Overview and Payments: a big serif
// number on a dark, green, amber, soft-red or white card.

import { CARD_SHADOW, COLORS, SERIF } from "@/lib/organizerTheme";
import { StyleSheet, Text, View } from "react-native";

export type Tone = "dark" | "green" | "amber" | "red" | "white";

const BG = {
  dark: { backgroundColor: COLORS.dark },
  green: { backgroundColor: COLORS.teal },
  amber: { backgroundColor: COLORS.amber },
  red: { backgroundColor: COLORS.tintRed },
  white: { backgroundColor: COLORS.white, ...CARD_SHADOW },
} as const;

// Text colours that keep 4.5:1 or better on each tile colour.
const TEXT = {
  dark: COLORS.white,
  green: COLORS.inkNavy,
  amber: COLORS.inkNavy,
  red: COLORS.clayText,
  white: COLORS.inkNavy,
} as const;
const MUTED = {
  dark: COLORS.onDark,
  green: COLORS.inkNavy,
  amber: COLORS.inkNavy,
  red: COLORS.clayText,
  white: COLORS.slate,
} as const;

export function StatTile({
  label,
  value,
  tone = "white",
  note,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  note?: string; // small line under the number
}) {
  return (
    <View style={[styles.tile, BG[tone]]}>
      <Text style={[styles.label, { color: MUTED[tone] }]}>{label}</Text>
      <Text style={[styles.value, { color: TEXT[tone] }]}>{value}</Text>
      {!!note && (
        <Text style={[styles.note, { color: MUTED[tone] }]}>{note}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: 20, padding: 18, gap: 6 },
  label: { fontSize: 13, fontWeight: "600" },
  value: { fontFamily: SERIF, fontSize: 30, lineHeight: 34 },
  note: { fontSize: 12 },
});
