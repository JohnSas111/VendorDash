import { InputField } from "@/components/InputField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function SignupScreen() {
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  async function handleSignup() {
    if (!fullName || !businessName || !email || !password || !confirmPassword) {
      showToast("Please fill in every field.", "error");
      return;
    }
    if (password !== confirmPassword) {
      showToast(
        "Passwords don’t match. Please re-enter your password.",
        "error",
      );
      return;
    }

    setLoading(true);

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });
    if (authError) {
      setLoading(false);
      showToast(authError.message || "Sign up failed.", "error");
      return;
    }

    const userId = authData.user?.id;
    if (!userId) {
      setLoading(false);
      showToast("Could not create account. Please try again.", "error");
      return;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      role: "vendor",
      full_name: fullName,
    });
    if (profileError) {
      setLoading(false);
      showToast(profileError.message || "Profile setup failed.", "error");
      return;
    }

    const { error: vendorError } = await supabase
      .from("vendor_details")
      .insert({
        id: userId,
        business_name: businessName,
      });

    setLoading(false);

    if (vendorError) {
      showToast(vendorError.message || "Business info failed.", "error");
      return;
    }

    router.replace("/(auth)/complete-profile");
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your account</Text>

      <InputField
        placeholder="Full name"
        value={fullName}
        onChangeText={setFullName}
      />
      <InputField
        placeholder="Business name"
        value={businessName}
        onChangeText={setBusinessName}
      />
      <InputField
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <InputField
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <InputField
        placeholder="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />

      <PrimaryButton
        label={loading ? "Creating account..." : "Create an Account"}
        onPress={handleSignup}
        loading={loading}
      />

      <View style={styles.linkRow}>
        <Text style={styles.linkText}>Already have an account? </Text>
        <TouchableOpacity
          accessibilityRole="link"
          onPress={() => router.push("/(auth)/login")}
        >
          <Text style={styles.link}>Sign in</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    backgroundColor: Colors.background,
    padding: Spacing.xxl,
    paddingTop: 60,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: "bold",
    color: Colors.text,
    marginBottom: Spacing.xxl,
    textAlign: "center",
  },
  linkRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.lg,
    minHeight: 44,
  },
  linkText: { fontSize: Typography.sm, fontWeight: "600", color: Colors.text },
  link: { fontSize: Typography.sm, fontWeight: "600", color: Colors.info },
});
