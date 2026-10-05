// lib/navigation.ts
//
// router.back() throws "GO_BACK was not handled" when a screen was opened
// directly (a pasted link, a browser refresh) because there is no previous
// screen. Go back when we can, otherwise go to a sensible place.

import { router, type Href } from "expo-router";

export function goBackSafely(fallback: Href) {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}
