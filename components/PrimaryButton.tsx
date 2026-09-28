// components/PrimaryButton.tsx
//
// The same dark button (Log in, Pay, Continue, Save...) was being redefined
// on every screen. This is that button, written once.

import { Colors, Radius, Shadow, Typography } from "@/constants/theme";
import {
  ActivityIndicator,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";

type Props = {
  label: string;
  onPress: (e: GestureResponderEvent) => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
};

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
}: Props) {
  const isSecondary = variant === "secondary";
  const inactive = !!(disabled || loading);

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        isSecondary ? styles.secondary : Shadow.sm,
        // Dim only a genuinely disabled button; while loading the spinner
        // is the feedback and the button should stay legible.
        disabled && !loading && styles.disabled,
        pressed && !inactive && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? Colors.text : Colors.white} />
      ) : (
        <Text style={[styles.text, isSecondary && styles.secondaryText]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.text,
    borderRadius: Radius.sm,
    padding: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: {
    backgroundColor: Colors.borderLight,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  text: {
    color: Colors.white,
    fontSize: Typography.md,
    fontWeight: "600",
  },
  secondaryText: {
    color: Colors.text,
  },
});
