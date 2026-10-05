// components/KeyboardScreen.tsx
//
// Keeps text fields visible when the phone keyboard opens.
//
// Before: forms were a plain View, so the keyboard covered the field being
// typed in, and the first tap on a button only closed the keyboard.
//
//   <KeyboardScreen style={styles.container}>   <- replaces the old container View
//   <KeyboardAvoider style={styles.backdrop}>   <- use as the backdrop inside a Modal
//
// On the web (the organizer's laptop browser) nothing is covered by a
// keyboard, so both render plainly and behave exactly as before.

import { splitContainerStyle } from "@/lib/uxHelpers";
import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export function KeyboardAvoider({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const holder = useRef<View>(null);
  const [offset, setOffset] = useState(0);

  // How far this view sits below the top of the screen (a navigation header,
  // for example). KeyboardAvoidingView needs it to leave the right gap.
  const measure = useCallback(() => {
    holder.current?.measureInWindow((_x, y) => {
      const next = Math.max(0, Math.round(y));
      setOffset((prev) => (prev === next ? prev : next));
    });
  }, []);

  if (Platform.OS === "web") {
    return <View style={style}>{children}</View>;
  }

  return (
    <View ref={holder} onLayout={measure} style={styles.fill}>
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={offset}
        style={style}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

type KeyboardScreenProps = Omit<ScrollViewProps, "style"> & {
  // The screen's old container style (flex:1, padding, maxWidth, ...).
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function KeyboardScreen({
  style,
  children,
  ...scrollProps
}: KeyboardScreenProps) {
  const { outer, content } = splitContainerStyle(
    StyleSheet.flatten(style) as Record<string, any> | undefined,
  );

  return (
    <KeyboardAvoider style={styles.fill}>
      <ScrollView
        style={[styles.fill, outer]}
        contentContainerStyle={[content, styles.grow]}
        // "handled": a tap on a button works on the first tap even while the
        // keyboard is open, instead of only closing the keyboard.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
        {...scrollProps}
      >
        {children}
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
});
