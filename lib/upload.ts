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

export async function pickAndUploadImage(
  bucket: string,
  filePathWithoutExt: string,
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
  const fileExt = asset.uri.split(".").pop()?.toLowerCase() || "jpg";
  const filePath = `${filePathWithoutExt}.${fileExt}`;

  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, decode(base64), {
      contentType: asset.mimeType ?? "image/jpeg",
      upsert: true,
    });

  if (error) {
    throw error;
  }

  return filePath;
}
