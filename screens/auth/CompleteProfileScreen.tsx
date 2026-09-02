import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { InputField } from '@/components/InputField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Colors, Radius } from '@/constants/theme';

export default function CompleteProfileScreen() {
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

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
      .update({ category, description })
      .eq('id', userId);

    setLoading(false);

    if (vendorError) {
      Alert.alert('Save failed', vendorError.message);
      return;
    }

    router.replace('/(vendor)/home');
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

      <TouchableOpacity
        style={styles.uploadBox}
        onPress={() => Alert.alert('Coming soon', 'File upload will be wired up next.')}
      >
        <Text style={styles.uploadText}>+ Upload business permit</Text>
      </TouchableOpacity>

      <PrimaryButton label={loading ? 'Saving...' : 'Save and Continue'} onPress={handleSave} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: 24, paddingTop: 60 },
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
});
