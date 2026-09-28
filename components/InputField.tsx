// components/InputField.tsx

import { Colors, Radius } from "@/constants/theme";
import { StyleSheet, TextInput, TextInputProps } from "react-native";

export function InputField({
  style,
  multiline,
  ...rest
}: TextInputProps & { multiline?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={Colors.textMuted}
      accessibilityLabel={rest.accessibilityLabel ?? rest.placeholder}
      multiline={multiline}
      {...rest}
      // Merged after the spread so a caller's `style` adds to the base look
      // instead of replacing it.
      style={[styles.input, multiline && styles.multiline, style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    padding: 14,
    fontSize: 14,
    marginBottom: 12,
  },
  multiline: {
    height: 80,
    textAlignVertical: "top",
  },
});
