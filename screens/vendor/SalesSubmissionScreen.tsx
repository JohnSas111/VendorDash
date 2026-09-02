import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { pickAndUploadImage } from '@/lib/upload';
import { InputField } from '@/components/InputField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Colors, Radius } from '@/constants/theme';

export default function SalesSubmissionScreen() {
  const { bookingId, stallNumber, dateLabel } = useLocalSearchParams<{
    bookingId: string;
    stallNumber?: string;
    dateLabel?: string;
  }>();

  const [grossSales, setGrossSales] = useState('');
  const [itemsSold, setItemsSold] = useState('');
  const [notes, setNotes] = useState('');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleUploadReceipt() {
    if (!bookingId) return;
    setUploading(true);
    try {
      const url = await pickAndUploadImage('sales-receipts', `${bookingId}/receipt`);
      if (url) setReceiptUrl(url);
    } catch (err) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (!bookingId) return;

    const grossSalesNum = parseFloat(grossSales);
    if (!grossSales || isNaN(grossSalesNum) || grossSalesNum < 0) {
      Alert.alert('Missing info', 'Please enter a valid gross sales amount.');
      return;
    }

    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setLoading(false);
      router.replace('/(auth)/login');
      return;
    }

    const { error } = await supabase.from('sales_submissions').insert({
      booking_id: bookingId,
      vendor_id: userId,
      gross_sales_cents: Math.round(grossSalesNum * 100),
      items_sold_count: itemsSold ? parseInt(itemsSold, 10) : null,
      notes: notes || null,
      receipt_photo_url: receiptUrl,
    });

    setLoading(false);

    if (error) {
      Alert.alert('Submission failed', error.message);
      return;
    }

    Alert.alert('Thanks!', 'Your sales report has been submitted.');
    router.back();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Submit your sales</Text>
      {stallNumber && dateLabel && (
        <Text style={styles.subtitle}>
          Stall {stallNumber} · {dateLabel}
        </Text>
      )}

      <Text style={styles.label}>Gross sales (₱)</Text>
      <InputField
        placeholder="e.g. 4500"
        value={grossSales}
        onChangeText={setGrossSales}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Items sold (optional)</Text>
      <InputField
        placeholder="e.g. 62"
        value={itemsSold}
        onChangeText={setItemsSold}
        keyboardType="number-pad"
      />

      <Text style={styles.label}>Notes (optional)</Text>
      <InputField
        placeholder="Anything worth mentioning about this weekend"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity style={styles.uploadBox} onPress={handleUploadReceipt} disabled={uploading}>
        {receiptUrl ? (
          <View style={styles.uploadedRow}>
            <Image source={{ uri: receiptUrl }} style={styles.thumbnail} />
            <Text style={styles.uploadedText}>Tap to replace</Text>
          </View>
        ) : (
          <Text style={styles.uploadText}>
            {uploading ? 'Uploading...' : '+ Attach receipt photo (optional)'}
          </Text>
        )}
      </TouchableOpacity>

      <PrimaryButton label={loading ? 'Submitting...' : 'Submit'} onPress={handleSubmit} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: 24, paddingTop: 20 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 12, color: Colors.textMuted, marginBottom: 24 },
  label: { fontSize: 12, color: Colors.textMuted, marginBottom: 6 },
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
