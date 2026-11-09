import { createClient } from "@supabase/supabase-js";

// The publishable key is public by design (the old CRM ships it in index.html). Access is enforced by
// Row Level Security in the database, never by this key.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vnydxkmhrcesdffpfjpc.supabase.co";
export const SUPABASE_URL = url;
const key = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_VP8ZvA5up64JFGkn5_7qbg_NYVJvt-I";

export const db = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "ure-auth" },
});
