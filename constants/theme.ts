// constants/theme.ts
//
// Single source of truth for colors used across the app. Instead of typing
// '#2DAA6E' in ten different files, import Colors.available and change it
// once here if you ever want to rebrand.

export const Colors = {
  background: '#F5F5F5',
  white: '#FFFFFF',
  text: '#1A1A1A',
  textMuted: '#8A8A8A',
  border: '#D9D9D9',
  borderLight: '#E0E0E0',

  // Status / stall colors — used consistently across Floor Map, badges, etc.
  available: '#2DAA6E',
  reserved: '#E8A33D',
  booked: '#E85D4D',
  info: '#3B82F6',
  infoLight: '#EFF6FF',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const Radius = {
  sm: 8,
  md: 10,
  lg: 20,
};
