// lib/toast.tsx
//
// A small non-blocking snackbar to replace Alert.alert() for messages that
// aren't a yes/no decision (errors, confirmations of an action that already
// happened). Alert.alert renders inconsistently on web via react-native-web,
// which is why it looked jarring — this is a single, app-wide, styled
// notification instead. For destructive actions that need an actual
// decision, use ConfirmModal (components/ConfirmModal.tsx) instead.
//
// Usage:
//   const { showToast } = useToast();
//   showToast("Couldn't cancel booking", "error");

import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Animated, StyleSheet, Text } from "react-native";

type ToastVariant = "info" | "success" | "error";

type ToastState = { message: string; variant: ToastVariant };

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLE: Record<
  ToastVariant,
  { bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  info: { bg: Colors.text, icon: "information-circle" },
  success: { bg: Colors.available, icon: "checkmark-circle" },
  error: { bg: Colors.booked, icon: "alert-circle" },
};

const DISPLAY_MS = 3200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  // useState's lazy initializer, not useRef().current — reading a ref's
  // .current during render trips the react-hooks/refs rule.
  const [opacity] = useState(() => new Animated.Value(0));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => setToast(null));
  }, [opacity]);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, variant });
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      timerRef.current = setTimeout(hide, DISPLAY_MS);
    },
    [hide, opacity],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.container,
            { opacity, backgroundColor: VARIANT_STYLE[toast.variant].bg },
          ]}
        >
          <Ionicons
            name={VARIANT_STYLE[toast.variant].icon}
            size={16}
            color={Colors.white}
          />
          <Text style={styles.text}>{toast.message}</Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>.");
  }
  return ctx;
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.xxl,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    ...Shadow.md,
  },
  text: { color: Colors.white, fontSize: Typography.base, flex: 1 },
});
