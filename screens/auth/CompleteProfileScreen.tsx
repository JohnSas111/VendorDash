// PATH: screens/auth/CompleteProfileScreen.tsx  (replace the file at exactly this path)
import { InputField } from "@/components/InputField";
import { KeyboardScreen } from "@/components/KeyboardScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { pickAndUploadImage } from "@/lib/upload";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function CompleteProfileScreen() {
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [permitUrl, setPermitUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  async function handleUploadPermit() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    setUploading(true);
    try {
      const url = await pickAndUploadImage(
        "business-permits",
        `${userId}/permit`,
      );
      if (url) {
        setPermitUrl(url);
        showToast("Permit image uploaded.", "success");
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Upload failed. Please try again.",
        "error",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setLoading(true);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setLoading(false);
      showToast("Something went wrong. Please log in again.", "error");
      router.replace("/(auth)/login");
      return;
    }

    const userId = userData.user.id;

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ phone })
      .eq("id", userId);
    if (profileError) {
      setLoading(false);
      showToast(profileError.message || "Save failed.", "error");
      return;
    }

    const { error: vendorError } = await supabase
      .from("vendor_details")
      .update({ category, description, business_permit_url: permitUrl })
      .eq("id", userId);

    setLoading(false);

    if (vendorError) {
      showToast(vendorError.message || "Save failed.", "error");
      return;
    }

    router.replace("/(vendor)/(tabs)/home");
  }

  return (
    <KeyboardScreen style={styles.container}>
      <Text style={styles.title}>Complete your profile</Text>
      <Text style={styles.subtitle}>
        Vendors need this before booking a stall
      </Text>

      <InputField
        placeholder="Phone number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <InputField
        placeholder="Business category (e.g. Food, Crafts)"
        value={category}
        onChangeText={setCategory}
      />
      <InputField
        placeholder="Business description"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity
        accessibilityRole="button"
        style={styles.uploadBox}
        onPress={handleUploadPermit}
        disabled={uploading}
      >
        {permitUrl ? (
          <View style={styles.uploadedRow}>
            <Image
              accessibilityLabel="Uploaded business permit preview"
              source={{ uri: permitUrl }}
              style={styles.thumbnail}
            />
            <Text style={styles.uploadedText}>Tap to replace</Text>
          </View>
        ) : (
          <View style={styles.uploadPrompt}>
            <Ionicons
              name="cloud-upload-outline"
              size={22}
              color={Colors.textMuted}
            />
            <Text style={styles.uploadText}>
              {uploading ? "Uploading…" : "Upload business permit"}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <PrimaryButton
        label={loading ? "Saving..." : "Save and Continue"}
        onPress={handleSave}
        loading={loading}
      />
    </KeyboardScreen>
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
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.xxl,
  },
  uploadBox: {
    borderWidth: 1,
    borderColor: Colors.textMuted,
    borderStyle: "dashed",
    borderRadius: Radius.sm,
    padding: Spacing.xxl,
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  uploadPrompt: { alignItems: "center", gap: Spacing.xs },
  uploadText: { color: Colors.textMuted, fontSize: Typography.sm },
  uploadedRow: { alignItems: "center" },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: Radius.sm,
    marginBottom: Spacing.sm,
  },
  uploadedText: {
    color: Colors.info,
    fontSize: Typography.sm,
    fontWeight: "600",
  },
});
