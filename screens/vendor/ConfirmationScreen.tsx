import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Shadow, Spacing, Typography } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

export default function ConfirmationScreen() {
  // Small entrance animation — the icon pops in rather than just
  // appearing, matching the fade-ins used on the other screens.
  const [scale] = useState(() => new Animated.Value(0.6));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scale, opacity]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.iconCircle, { transform: [{ scale }], opacity }]}
      >
        {/* CHANGED: was a literal "✓" text character standing in for an
            icon — now Ionicons, matching the rest of the app. */}
        <Ionicons name="checkmark" size={36} color={Colors.white} />
      </Animated.View>

      <Text style={styles.title}>Booking submitted!</Text>
      <Text style={styles.subtitle}>
        Your request is pending organizer approval
      </Text>

      <View style={styles.buttonWrap}>
        <PrimaryButton
          label="View my bookings"
          onPress={() => router.replace("/(vendor)/(tabs)/my-bookings")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.xxl,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.available,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
    ...Shadow.md,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.xxxl,
  },
  buttonWrap: { width: "100%" },
});
