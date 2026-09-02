// components/InputField.tsx

import { TextInput, StyleSheet, TextInputProps } from 'react-native';
import { Colors, Radius } from '@/constants/theme';

export function InputField(props: TextInputProps & { multiline?: boolean }) {
  return (
    <TextInput
      style={[styles.input, props.multiline && styles.multiline]}
      placeholderTextColor={Colors.textMuted}
      {...props}
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
    textAlignVertical: 'top',
  },
});
