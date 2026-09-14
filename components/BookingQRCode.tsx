import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

type Props = {
  bookingId: string;
  checkedIn?: boolean;
  size?: number;
};

export function BookingQRCode({ bookingId, checkedIn, size = 200 }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {checkedIn ? "You're checked in" : "Show this at check-in"}
      </Text>
      <View style={[styles.qrWrap, checkedIn && styles.qrWrapDimmed]}>
        <QRCode value={bookingId} size={size} />
      </View>
      {checkedIn && (
        <Text style={styles.checkedInNote}>
          Already scanned — no need to show it again.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", paddingVertical: 20 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 12 },
  qrWrap: { padding: 16, backgroundColor: "#FFFFFF", borderRadius: 12 },
  qrWrapDimmed: { opacity: 0.4 },
  checkedInNote: { fontSize: 12, color: "#8A8A8A", marginTop: 10 },
});
