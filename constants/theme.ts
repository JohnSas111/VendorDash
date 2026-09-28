// constants/theme.ts
//
// Single source of truth for colors used across the app. Instead of typing
// '#2DAA6E' in ten different files, import Colors.available and change it
// once here if you ever want to rebrand.

export const Colors = {
  background: "#F5F5F5",
  white: "#FFFFFF",
  text: "#1A1A1A",
  textMuted: "#6B6B6B",
  border: "#D9D9D9",
  borderLight: "#E0E0E0",

  // Status / stall colors — used consistently across Floor Map, badges, etc.
  available: "#2DAA6E",
  reserved: "#E8A33D",
  booked: "#E85D4D",
  info: "#3B82F6",
  infoLight: "#EFF6FF",

  // Soft tints for banners / feedback panels, and one shared modal scrim.
  dangerLight: "#FBEAE8",
  successLight: "#E3F5EC",
  warningLight: "#FDF1DF",
  overlay: "rgba(0,0,0,0.4)",

  // Text-safe versions of the status colours (4.5:1+ on white, the page
  // background and the matching *Light tint). The saturated status colours
  // above are for fills, borders and icons only; small text uses these.
  availableText: "#14653F",
  dangerText: "#B3372A",
  warningText: "#7A4A00",

  // Text on the dark (Colors.text) hero panel of the auth screens.
  onDarkMuted: "#C7CAD6",
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const Radius = {
  xs: 4, // skeleton lines, small dots and bars
  sm: 8,
  md: 10,
  lg: 20,
};

// Type scale — replaces the ad-hoc per-screen font sizes (11/12/13/15 one
// place, 13/14/16 another, etc). Every screen's StyleSheet should pull font
// sizes from here instead of hardcoding a number.
export const Typography = {
  xs: 11, // fine print, badges, legend labels
  sm: 12, // captions, meta text, subtitles
  base: 13, // body copy, card subtitles
  md: 15, // card titles, list item titles
  lg: 17, // section headers
  xl: 20, // screen titles (mobile)
  xxl: 24, // screen titles (desktop / emphasis)
  xxxl: 32, // hero numbers, landing headlines
};

// Soft elevation for cards/buttons/modals — everything was flat white with
// a 1px border and no depth. `elevation` covers Android, the shadow* props
// cover iOS/web.
export const Shadow = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
};
