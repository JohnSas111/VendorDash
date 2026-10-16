// components/organizer/Pagination.tsx
//
// "Showing 1–10 of 24 sessions" on the left, "‹ Previous 1 2 3 Next ›" on the
// right. Draws nothing when everything fits on one page.

import { COLORS } from "@/lib/organizerTheme";
import { PAGE_SIZE, pageCount, pageNumbers, rangeLabel } from "@/lib/paging";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  page: number;
  total: number;
  noun: string; // "stalls", "sessions" ...
  onPage: (page: number) => void;
  size?: number;
};

export function Pagination({
  page,
  total,
  noun,
  onPage,
  size = PAGE_SIZE,
}: Props) {
  const last = pageCount(total, size);
  if (total <= size) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{rangeLabel(page, total, noun, size)}</Text>
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous page"
          accessibilityState={{ disabled: page <= 1 }}
          disabled={page <= 1}
          onPress={() => onPage(page - 1)}
          style={[styles.btn, page <= 1 && styles.btnOff]}
        >
          <Text style={[styles.btnText, page <= 1 && styles.btnTextOff]}>
            ‹ Previous
          </Text>
        </Pressable>

        {pageNumbers(page, last).map((n, i) =>
          n === "gap" ? (
            <Text key={`gap-${i}`} style={styles.gap}>
              …
            </Text>
          ) : (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`Page ${n}`}
              accessibilityState={{ selected: n === page }}
              onPress={() => onPage(n)}
              style={[styles.num, n === page && styles.numActive]}
            >
              <Text
                style={[styles.btnText, n === page && styles.numTextActive]}
              >
                {n}
              </Text>
            </Pressable>
          ),
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next page"
          accessibilityState={{ disabled: page >= last }}
          disabled={page >= last}
          onPress={() => onPage(page + 1)}
          style={[styles.btn, page >= last && styles.btnOff]}
        >
          <Text style={[styles.btnText, page >= last && styles.btnTextOff]}>
            Next ›
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 16,
  },
  label: { fontSize: 13, color: COLORS.slate },
  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  btn: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  btnOff: { opacity: 0.55 },
  btnText: { fontSize: 13, fontWeight: "600", color: COLORS.inkNavy },
  btnTextOff: { color: COLORS.slate },
  num: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  numActive: { backgroundColor: COLORS.dark, borderColor: COLORS.dark },
  numTextActive: { color: COLORS.white, fontWeight: "700" },
  gap: { fontSize: 13, color: COLORS.slate, paddingHorizontal: 2 },
});
