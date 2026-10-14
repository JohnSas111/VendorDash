import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
  onDismiss,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          accessible={false}
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.button, styles.cancelButton]}
              onPress={onDismiss}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.button,
                destructive ? styles.destructiveButton : styles.confirmButton,
              ]}
              onPress={onConfirm}
            >
              <Text
                style={
                  destructive ? styles.destructiveText : styles.confirmText
                }
              >
                {confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    ...Shadow.md,
  },
  title: {
    fontSize: Typography.lg,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  message: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    marginBottom: Spacing.xl,
  },
  buttonRow: { flexDirection: "row", gap: Spacing.sm },
  button: {
    flex: 1,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  cancelButton: { backgroundColor: Colors.borderLight },
  cancelText: {
    color: Colors.text,
    fontSize: Typography.base,
    fontWeight: "600",
  },
  destructiveButton: { backgroundColor: Colors.booked },
  destructiveText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: "600",
  },
  confirmButton: { backgroundColor: Colors.text },
  confirmText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: "600",
  },
});
