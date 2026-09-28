// components/PressableButton.tsx
//
// Drop-in replacement for <Pressable> on buttons that are styled with a plain
// style object/array (the organizer shared.*Button styles). Adds the same
// feedback as PrimaryButton: a subtle pressed look, a dimmed disabled look,
// and button accessibility role/state. Not for backdrops or full-screen
// dismiss areas, which shouldn't animate.

import {
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from "react-native";

type Props = Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle> };

export function PressableButton({ style, disabled, ...rest }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      {...rest}
      disabled={disabled}
      style={({ pressed }) => [
        style,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
