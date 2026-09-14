import OrganizerNav from "@/components/organizer/OrganizerNav";
import { BREAKPOINT, COLORS } from "@/lib/organizerTheme";
import { Slot } from "expo-router";
import React from "react";
import { View, useWindowDimensions } from "react-native";

export default function OrganizerTabsLayout() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;

  return (
    <View
      style={{
        flex: 1,
        flexDirection: isDesktop ? "row" : "column",
        backgroundColor: COLORS.paper,
      }}
    >
      {isDesktop && <OrganizerNav />}
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
      {!isDesktop && <OrganizerNav />}
    </View>
  );
}
