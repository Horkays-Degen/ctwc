// lib/remove-bg.ts
// Strips the background from a Twitter avatar using the remove.bg API,
// then uploads the resulting transparent PNG to Supabase Storage ("avatars" bucket)
// and returns the permanent public URL.
//
// Falls back to the original avatar_url gracefully if:
//  - REMOVE_BG_API_KEY is not set
//  - The API call fails (rate limit, credits exhausted, etc.)
//  - The Supabase upload fails
//
// Usage in mint-card route:
//   profile.avatar_url = await removeBackground(profile.avatar_url, handle);

import { createAdminClient } from "./supabase-server";

const REMOVE_BG_KEY = process.env.REMOVE_BG_API_KEY;
const BUCKET = "avatars";

/**
 * Remove the background from an image URL via remove.bg, upload the
 * transparent PNG to Supabase Storage, and return the public URL.
 * Returns the original `sourceUrl` unchanged if anything goes wrong.
 */
export async function removeBackground(
  sourceUrl: string,
  handle: string
): Promise<string> {
  if (!REMOVE_BG_KEY) {
    console.log("[remove-bg] REMOVE_BG_API_KEY not set — using original avatar");
    return sourceUrl;
  }
  if (!sourceUrl) return sourceUrl;

  try {
    // ── 1. Call remove.bg ────────────────────────────────────────
    const form = new FormData();
    form.append("image_url", sourceUrl);
    form.append("size", "auto");       // "auto" picks the best size for the credit cost
    form.append("format", "png");      // always PNG so we keep transparency
    form.append("crop", "false");      // keep original dimensions

    const res = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": REMOVE_BG_KEY },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[remove-bg] API responded", res.status, errText);
      return sourceUrl;
    }

    // ── 2. Parse the transparent PNG from the response body ─────
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength === 0) {
      console.warn("[remove-bg] Empty response body — skipping");
      return sourceUrl;
    }

    // ── 3. Upload to Supabase Storage ────────────────────────────
    const supabase = createAdminClient();
    const storagePath = `${handle}.png`; // one file per handle, upsert overwrites

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: "image/png",
        upsert: true,       // overwrite if already exists (re-mint safe)
        cacheControl: "31536000", // 1 year — image won't change for a given handle
      });

    if (uploadErr) {
      console.warn("[remove-bg] Storage upload failed:", uploadErr.message);
      return sourceUrl;
    }

    // ── 4. Return the public URL ──────────────────────────────────
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    console.log(`[remove-bg] ✓ ${handle} → ${data.publicUrl}`);
    return data.publicUrl;

  } catch (err) {
    console.warn("[remove-bg] Unexpected error:", err);
    return sourceUrl; // always fall back gracefully
  }
}
