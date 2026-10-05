// lib/upload.ts
//
// Shared helper for picking an image from the device and uploading it to
// Supabase Storage. Used by both the business permit upload (Complete
// Profile) and the receipt photo upload (Sales Submission) — same logic,
// just a different bucket and file path each time.

import { decode } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";

// The storage buckets accept images up to this size (the database enforces
// it too). Checking here lets us show a friendly message before uploading.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function friendlyUploadError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("maximum allowed size") || m.includes("too large")) {
    return "That image is too large. Please choose one under 5 MB.";
  }
  if (m.includes("mime type") || m.includes("not supported")) {
    return "That file type isn't allowed. Please choose a JPG, PNG or WebP photo.";
  }
  return message;
}

export async function pickAndUploadImage(
  bucket: string,
  filePathWithoutExt: string,
  // upsert (overwrite an existing file) is on by default, as before. Pass
  // { upsert: false } for a bucket that only allows INSERT: an overwrite
  // upload also needs SELECT and UPDATE permission, even for a new file.
  options: { upsert?: boolean } = {},
): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error("Photo library permission is required to upload an image.");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
  });

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_IMAGE_BYTES) {
    throw new Error("That image is too large. Please choose one under 5 MB.");
  }
  const fileExt = asset.uri.split(".").pop()?.toLowerCase() || "jpg";
  const filePath = `${filePathWithoutExt}.${fileExt}`;

  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, decode(base64), {
      contentType: asset.mimeType ?? "image/jpeg",
      upsert: options.upsert ?? true,
    });

  if (error) {
    throw new Error(friendlyUploadError(error.message));
  }

  return filePath;
}
