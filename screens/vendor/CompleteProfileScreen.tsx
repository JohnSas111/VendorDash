import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { pickAndUploadImage } from '@/lib/upload';
import { InputField } from '@/components/InputField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Colors, Radius } from '@/constants/theme';

export default function CompleteProfileScreen() {
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [permitUrl, setPermitUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    async function loadExisting() {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;

      const [{ data: profile }, { data: vendorDetails }] = await Promise.all([
        supabase.from('profiles').select('phone').eq('id', userId).single(),
        supabase
          .from('vendor_details')
          .select('category, description, business_permit_url')
          .eq('id', userId)
          .single(),
      ]);

      if (profile?.phone) setPhone(profile.phone);
      if (vendorDetails?.category) setCategory(vendorDetails.category);
      if (vendorDetails?.description) setDescription(vendorDetails.description);
      if (vendorDetails?.business_permit_url) setPermitUrl(vendorDetails.business_permit_url);
      setInitialLoading(false);
    }
    loadExisting();
  }, []);

  async function handleUploadPermit() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    setUploading(true);
    try {
      const url = await pickAndUploadImage('business-permits', `${userId}/permit`);
      if (url) setPermitUrl(url);
    } catch (err) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setLoading(true);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setLoading(false);
      Alert.alert('Something went wrong', 'Please log in again.');
      router.replace('/(auth)/login');
      return;
    }

    const userId = userData.user.id;

    const { error: profileError } = await supabase.from('profiles').update({ phone }).eq('id', userId);
    if (profileError) {
      setLoading(false);
      Alert.alert('Save failed', profileError.message);
      return;
    }

    const { error: vendorError } = await supabase
      .from('vendor_details')
      .update({ category, description, business_permit_url: permitUrl })
      .eq('id', userId);

    setLoading(false);

    if (vendorError) {
      Alert.alert('Save failed', vendorError.message);
      return;
    }

    Alert.alert('Saved', 'Your profile has been updated.');
    router.back();
  }

  if (initialLoading) {
    return (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Complete your profile</Text>
      <Text style={styles.subtitle}>Vendors need this before booking a stall</Text>

      <InputField placeholder="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <InputField placeholder="Business category (e.g. Food, Crafts)" value={category} onChangeText={setCategory} />
      <InputField
        placeholder="Business description"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity style={styles.uploadBox} onPress={handleUploadPermit} disabled={uploading}>
        {permitUrl ? (
          <View style={styles.uploadedRow}>
            <Image source={{ uri: permitUrl }} style={styles.thumbnail} />
            <Text style={styles.uploadedText}>Tap to replace</Text>
          </View>
        ) : (
          <Text style={styles.uploadText}>
            {uploading ? 'Uploading...' : '+ Upload business permit'}
          </Text>
        )}
      </TouchableOpacity>

      <PrimaryButton label={loading ? 'Saving...' : 'Save'} onPress={handleSave} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: 24, paddingTop: 20 },
  title: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginBottom: 24 },
  uploadBox: {
    borderWidth: 1,
    borderColor: Colors.textMuted,
    borderStyle: 'dashed',
    borderRadius: Radius.sm,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  uploadText: { color: Colors.textMuted, fontSize: 12 },
  uploadedRow: { alignItems: 'center' },
  thumbnail: { width: 80, height: 80, borderRadius: Radius.sm, marginBottom: 8 },
  uploadedText: { color: Colors.info, fontSize: 12, fontWeight: '600' },
});
