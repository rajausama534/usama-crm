// Small helpers shared by the tools that moved over from the old CRM.
import { db, SUPABASE_URL } from "@/lib/supabase";

/** Calls one of the Supabase edge functions that take `{ action, ...data }` (owner-finder-api, cluster-guide-api). */
export async function edge<T = Record<string, unknown>>(fn: string, action: string, data: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error("Please sign in again.");
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...data }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j as T;
}

/** Reads every page of a query, 1,000 rows at a time. */
export async function fetchAll<R>(build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<R[]> {
  const out: R[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data || []) as R[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const loaded = new Map<string, Promise<void>>();
/** Loads a browser-only library (spreadsheet reader, PDF maker) from a CDN the first time it is needed. */
export function loadScript(src: string) {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<void>((ok, fail) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => ok();
      s.onerror = () => { loaded.delete(src); fail(new Error(`Could not load ${src}`)); };
      document.head.append(s);
    });
    loaded.set(src, p);
  }
  return p;
}

export const natural = (a: unknown, b: unknown) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
