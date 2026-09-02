import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { InputField } from '@/components/InputField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Colors } from '@/constants/theme';

export default function SignupScreen() {
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    if (!fullName || !businessName || !email || !password || !confirmPassword) {
      Alert.alert('Missing info', 'Please fill in every field.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Passwords don't match", 'Please re-enter your password.');
      return;
    }

    setLoading(true);

    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) {
      setLoading(false);
      Alert.alert('Sign up failed', authError.message);
      return;
    }

    const userId = authData.user?.id;
    if (!userId) {
      setLoading(false);
      Alert.alert('Sign up failed', 'Could not create account. Please try again.');
      return;
    }

    const { error: profileError } = await supabase.from('profiles').insert({
      id: userId,
      role: 'vendor',
      full_name: fullName,
    });
    if (profileError) {
      setLoading(false);
      Alert.alert('Profile setup failed', profileError.message);
      return;
    }

    const { error: vendorError } = await supabase.from('vendor_details').insert({
      id: userId,
      business_name: businessName,
    });

    setLoading(false);

    if (vendorError) {
      Alert.alert('Business info failed', vendorError.message);
      return;
    }

    router.replace('/(auth)/complete-profile');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your account</Text>

      <InputField placeholder="Full name" value={fullName} onChangeText={setFullName} />
      <InputField placeholder="Business name" value={businessName} onChangeText={setBusinessName} />
      <InputField
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <InputField placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <InputField
        placeholder="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />

      <PrimaryButton
        label={loading ? 'Creating account...' : 'Create an Account'}
        onPress={handleSignup}
        loading={loading}
      />

      <View style={styles.linkRow}>
        <Text style={styles.linkText}>Already have an account? </Text>
        <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
          <Text style={styles.link}>Sign in</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: 24, paddingTop: 60 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 24, textAlign: 'center' },
  linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 16 },
  linkText: { fontSize: 12, fontWeight: '600' },
  link: { fontSize: 12, fontWeight: '600', color: Colors.info },
});
