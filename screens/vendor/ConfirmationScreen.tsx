import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Colors } from '@/constants/theme';

export default function ConfirmationScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.checkmark}>✓</Text>
      </View>

      <Text style={styles.title}>Booking submitted!</Text>
      <Text style={styles.subtitle}>Your request is pending organizer approval</Text>

      <View style={styles.buttonWrap}>
        <PrimaryButton label="View my bookings" onPress={() => router.replace('/(vendor)/my-bookings')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: 24, alignItems: 'center', justifyContent: 'center' },
  iconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.available,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  checkmark: { color: Colors.white, fontSize: 32, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginBottom: 32 },
  buttonWrap: { width: '100%' },
});
