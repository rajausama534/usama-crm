"use client";

import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";

/** Profile photos live in the public "avatars" bucket at <user id>/photo.jpg (migration 20261110120000). */
const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vnydxkmhrcesdffpfjpc.supabase.co"}/storage/v1/object/public/avatars`;
const VKEY = "crm_avatar_v";

export function avatarUrl(userId?: string | null, v?: string | null) {
  return userId ? `${BASE}/${userId}/photo.jpg${v ? `?v=${v}` : ""}` : null;
}

/** Shrinks a picked image to a 256 px square JPEG (centre crop) so uploads stay small. */
async function toSquareJpeg(file: File, size = 256): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that image"))), "image/jpeg", 0.85));
}

/** The signed-in person's photo URL plus upload/remove. `v` busts the browser cache after a change. */
export function useMyAvatar() {
  const { session } = useAuth();
  const uid = session?.user?.id || null;
  const [v, setV] = useState<string | null>(null);
  useEffect(() => { try { setV(localStorage.getItem(`${VKEY}:${uid}`) || "1"); } catch { setV("1"); } }, [uid]);
  const bump = useCallback((next: string) => { setV(next); try { localStorage.setItem(`${VKEY}:${uid}`, next); } catch {} }, [uid]);

  const upload = useCallback(async (file: File) => {
    if (!uid) throw new Error("Not signed in");
    if (!file.type.startsWith("image/")) throw new Error("Please choose a photo");
    const blob = await toSquareJpeg(file);
    const { error } = await db.storage.from("avatars").upload(`${uid}/photo.jpg`, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "60" });
    if (error) throw new Error(/bucket not found/i.test(error.message) ? "Profile photos are not switched on yet (database update pending)." : error.message);
    bump(String(Date.now()));
  }, [uid, bump]);

  const remove = useCallback(async () => {
    if (!uid) return;
    const { error } = await db.storage.from("avatars").remove([`${uid}/photo.jpg`]);
    if (error) throw new Error(error.message);
    bump(String(Date.now()));
  }, [uid, bump]);

  return { src: v ? avatarUrl(uid, v) : null, upload, remove };
}
