// lib/storage.ts
//
// Permit and receipt photos live in PRIVATE storage buckets, so a stored path
// (like "<user id>/permit.jpg") can't be used as an image address. These
// helpers turn a path into a short-lived signed link that the storage rules
// allow only for the right person (the owner, or the organizer whose venue
// the booking belongs to).

import { useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import { supabase } from "./supabase";

// How long a signed link keeps working. Long enough to look at a photo,
// short enough that a copied link is useless soon after.
export const SIGNED_URL_SECONDS = 600;

export async function getSignedImageUrl(
  bucket: string,
  path: string | null | undefined,
  seconds: number = SIGNED_URL_SECONDS,
): Promise<string | null> {
  if (!path) return null;
  // An older value that is already a full web address: use as it is.
  if (/^https?:\/\//i.test(path)) return path;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Shows a stored image: returns the signed link, whether it is still loading,
// and whether it could not be loaded (no permission, file missing, offline).
export function useSignedImageUrl(
  bucket: string,
  path: string | null | undefined,
) {
  const [result, setResult] = useState<{
    key: string;
    url: string | null;
  } | null>(null);
  const key = path ? `${bucket}/${path}` : null;

  useEffect(() => {
    if (!key || !path) return;
    let cancelled = false;
    (async () => {
      const url = await getSignedImageUrl(bucket, path);
      if (!cancelled) setResult({ key, url });
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, path, key]);

  const ready = result !== null && result.key === key;
  return {
    url: ready ? result.url : null,
    loading: key !== null && !ready,
    failed: ready && result.url === null,
  };
}

// Opens a stored image in the browser / phone viewer.
// Returns false if it could not be opened (no permission, missing file).
export async function openSignedImage(
  bucket: string,
  path: string,
): Promise<boolean> {
  // On the web, browsers block a new tab that opens after a wait, so open
  // the tab first and point it at the link once we have it.
  const tab =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.open("", "_blank")
      : null;

  const url = await getSignedImageUrl(bucket, path);
  if (!url) {
    tab?.close();
    return false;
  }
  if (tab) {
    tab.location.href = url;
    return true;
  }
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
