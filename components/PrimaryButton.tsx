// components/PrimaryButton.tsx
//
// The same dark button (Log in, Pay, Continue, Save...) was being redefined
// on every screen. This is that button, written once.

import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, GestureResponderEvent } from 'react-native';
import { Colors, Radius } from '@/constants/theme';

type Props = {
  label: string;
  onPress: (e: GestureResponderEvent) => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

export function PrimaryButton({ label, onPress, loading, disabled, variant = 'primary' }: Props) {
  return (
    <TouchableOpacity
      style={[styles.button, variant === 'secondary' && styles.secondary]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? Colors.text : Colors.white} />
      ) : (
        <Text style={[styles.text, variant === 'secondary' && styles.secondaryText]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.text,
    borderRadius: Radius.sm,
    padding: 14,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: Colors.borderLight,
  },
  text: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryText: {
    color: Colors.text,
  },
});
