// hooks/useOrganizerCounts.ts
//
// The numbers shown as badges in the organizer sidebar: how many booking
// requests, refunds and vendor verifications are waiting for the organizer.
// They come from ONE server function, organizer_attention_counts(), which only
// organizers may call and which counts only the caller's own venues.
//
// Refreshes: when the sidebar first appears, whenever the organizer opens
// another page, every 15 seconds, and when the browser tab / app comes back
// to the front. A failed refresh keeps the last numbers (no flicker to 0).

import { supabase } from "@/lib/supabase";
import { NO_COUNTS, toCounts, type AttentionCounts } from "@/lib/uxHelpers";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

const REFRESH_MS = 15000;

export function useOrganizerCounts(): AttentionCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<AttentionCounts>(NO_COUNTS);
  const busy = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (busy.current) return; // never run two at once
    busy.current = true;
    try {
      const { data, error } = await supabase.rpc("organizer_attention_counts");
      if (!error && alive.current) setCounts(toCounts(data));
    } catch {
      // network problem: keep showing the last numbers
    } finally {
      busy.current = false;
    }
  }, []);

  // On first show, and again each time the organizer opens another page
  // (for example right after approving something).
  useEffect(() => {
    async function run() {
      await refresh();
    }
    run();
  }, [refresh, pathname]);

  // Every 15 s, and when the tab / app becomes active again.
  useEffect(() => {
    alive.current = true;
    const tick = () => {
      // Do not poll a browser tab nobody is looking at.
      if (
        Platform.OS === "web" &&
        typeof document !== "undefined" &&
        document.hidden
      ) {
        return;
      }
      void refresh();
    };
    const timer = setInterval(tick, REFRESH_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      alive.current = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  return counts;
}
