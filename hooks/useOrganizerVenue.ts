// hooks/useOrganizerVenue.ts
//
// Shared "who is this organizer and what venue do they run" lookup.
// Every organizer screen needs this — centralized here instead of
// duplicated per-screen (as flagged as a TODO in OrganizerHomeScreen).
//
// ASSUMPTION: supabase client lives at '@/lib/supabase'. Adjust if not.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type OrganizerVenue = {
  id: string;
  name: string;
  address: string;
};

export function useOrganizerVenue() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [venue, setVenue] = useState<OrganizerVenue | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      setUserId(user.id);

      const { data, error: venueErr } = await supabase
        .from('venues')
        .select('id, name, address')
        .eq('organizer_id', user.id)
        .single();

      if (venueErr || !data) {
        throw new Error(
          "No venue found for this organizer account. Insert a venues row with organizer_id set to this user's id first."
        );
      }
      setVenue(data);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load organizer venue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, error, venue, userId, reload: load };
}
