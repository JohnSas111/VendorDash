// screens/auth/LoginScreen.tsx
//
// Mobile (<768px) renders exactly like before — full-width stacked
// form, unchanged, so the phone app's look isn't affected at all.
// Desktop web (>=768px) renders a split-panel layout: a branded left
// panel + a centered white card for the form. Both share the same
// handleLogin logic and the same InputField/PrimaryButton components
// you already have — only the surrounding layout differs.
//
// The left panel's colors are the app-wide palette from the handoff
// summary's design system table (ink navy / amber / paper), not
// something organizer-only — safe to use here since this login
// screen serves both vendor and organizer accounts.

import { InputField } from "@/components/InputField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

const BREAKPOINT = 768;

export default function LoginScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert("Missing info", "Please enter both email and password.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      Alert.alert("Login failed", error.message);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    setLoading(false);

    router.replace(
      profile?.role === "organizer"
        ? "/(organizer)/(tabs)/overview"
        : "/(vendor)/home",
    );
  }

  const form = (
    <>
      <Text style={isDesktop ? desktopStyles.title : styles.title}>
        Welcome back
      </Text>

      <InputField
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        returnKeyType="next"
      />
      <InputField
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        returnKeyType="done"
        onSubmitEditing={handleLogin}
      />

      <PrimaryButton
        label={loading ? "Logging in..." : "Log in"}
        onPress={handleLogin}
        loading={loading}
      />

      <View style={styles.linkRow}>
        <Text style={styles.linkText}>Don't have an account? </Text>
        <TouchableOpacity onPress={() => router.push("/(auth)/signup")}>
          <Text style={styles.link}>Sign up</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  if (!isDesktop) {
    return <View style={styles.container}>{form}</View>;
  }

  return (
    <View style={desktopStyles.screen}>
      <View style={desktopStyles.panel}>
        <Text style={desktopStyles.brand}>VendorDash</Text>
        <Text style={desktopStyles.tagline}>
          Night-market stalls, sessions, and payments — all in one place.
        </Text>
        <View style={desktopStyles.dot} />
      </View>
      <View style={desktopStyles.formSide}>
        <View style={desktopStyles.card}>{form}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 24,
    paddingTop: 80,
  },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 24 },
  linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 16 },
  linkText: { fontSize: 12, fontWeight: "600" },
  link: { fontSize: 12, fontWeight: "600", color: Colors.info },
});

const desktopStyles = StyleSheet.create({
  screen: { flex: 1, flexDirection: "row", backgroundColor: Colors.background },
  panel: {
    flex: 1,
    backgroundColor: Colors.text,
    padding: 56,
    justifyContent: "center",
  },
  brand: {
    fontFamily: "serif",
    fontSize: 36,
    color: Colors.white,
    marginBottom: 16,
  },
  tagline: { fontSize: 16, color: "#C7CAD6", maxWidth: 340, lineHeight: 24 },
  dot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.reserved,
    marginTop: 40,
  },
  formSide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 36,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 24,
  },
});
