// lib/uxHelpers.ts
//
// Small pure helpers used by the UX fixes. They have no React / native
// imports so they can be tested on their own.

// ---------------------------------------------------------------------
// Vendor name: the organizer thinks of a vendor by the BUSINESS
// ("Fisheatery"), not by the person's name ("Johnny"). Use the business
// name as the main line, and keep the person's name as a smaller line.
// `profiles` is the embedded profiles row, optionally with a nested
// vendor_details (object or one-item array) that has business_name.
// ---------------------------------------------------------------------
export function vendorDisplay(profiles: any): { name: string; owner: string } {
  const owner = String(profiles?.full_name ?? "").trim() || "Unknown vendor";
  const details = Array.isArray(profiles?.vendor_details)
    ? profiles.vendor_details[0]
    : profiles?.vendor_details;
  const business = String(details?.business_name ?? "").trim();
  return { name: business || owner, owner };
}

// The nested vendor_details row of an embedded profile (object or one-item
// array), or null. Used where more than the business name is needed.
export function vendorDetails(profiles: any): {
  business_name: string | null;
  category: string | null;
  is_verified: boolean;
} | null {
  const d = Array.isArray(profiles?.vendor_details)
    ? profiles.vendor_details[0]
    : profiles?.vendor_details;
  if (!d) return null;
  return {
    business_name: d.business_name ?? null,
    category: d.category ?? null,
    is_verified: d.is_verified === true,
  };
}

// "Johnny · " when the person's name adds information, otherwise "".
export function ownerPrefix(name: string, owner: string): string {
  return owner && owner !== name && owner !== "Unknown vendor"
    ? `${owner} · `
    : "";
}

// ---------------------------------------------------------------------
// Scroll cue: should we show a "more above" / "more below" hint?
// tolerance avoids flicker from sub-pixel rounding at the very ends.
// ---------------------------------------------------------------------
export function scrollEdges(
  offsetY: number,
  viewportHeight: number,
  contentHeight: number,
  tolerance = 4,
): { canScrollUp: boolean; canScrollDown: boolean } {
  const maxY = Math.max(0, contentHeight - viewportHeight);
  return {
    canScrollUp: offsetY > tolerance,
    canScrollDown: maxY - offsetY > tolerance,
  };
}

// ---------------------------------------------------------------------
// A screen's old "container" style (flex:1, padding, maxWidth, ...) turned
// into the two styles a ScrollView needs: the outer one (fills the screen,
// keeps the background) and the inner one (padding, width, alignment).
// flex:1 must become flexGrow:1 inside a ScrollView or the content could
// never scroll.
// ---------------------------------------------------------------------
export function splitContainerStyle<T extends Record<string, any>>(
  flat: T | undefined | null,
): {
  outer: { backgroundColor?: any };
  content: Omit<T, "flex" | "backgroundColor">;
} {
  const content: Record<string, any> = { ...(flat ?? {}) };
  const backgroundColor = content.backgroundColor;
  delete content.flex;
  delete content.backgroundColor;
  return {
    outer: backgroundColor !== undefined ? { backgroundColor } : {},
    content: content as Omit<T, "flex" | "backgroundColor">,
  };
}
