import "server-only";
import { createClient } from "@supabase/supabase-js";
import { resolveMe, SUPER_ADMIN_EMAIL, type AccessRow } from "@/lib/access";
import type { BuntyCtx } from "./types";
import { todayDubai } from "./util";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vnydxkmhrcesdffpfjpc.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_VP8ZvA5up64JFGkn5_7qbg_NYVJvt-I";

/** Who may use Bunty. Only Usama for now (agreed 7 Nov 2026); staff are switched on later per person. */
const ALLOWED = (process.env.BUNTY_USERS || SUPER_ADMIN_EMAIL).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

/**
 * Builds Bunty's context from the signed-in person's own Supabase token. Every query Bunty makes goes through
 * this connection, so the database's Row Level Security decides what he can see and change — exactly as if the
 * person did it themselves. The `x-crm-actor` header lets the change history say "Bunty" (see migration
 * 20261109100000_bunty_actions.sql).
 */
export async function buntyContext(req: Request): Promise<BuntyCtx> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  const db = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, "x-crm-actor": "bunty" } },
  });
  const { data: u, error } = await db.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  if (error || !email) throw new HttpError(401, "Your sign-in has expired. Please sign in again.");
  if (!ALLOWED.includes(email)) throw new HttpError(403, "Bunty is switched on for Usama only for now.");
  const { data: row } = await db.from("user_access").select("*").ilike("email", email).maybeSingle<AccessRow>();
  const me = resolveMe(email, row);
  if (!me.isSuperAdmin && (!row || row.active === false)) throw new HttpError(403, "Your account is not active.");
  const first = me.name.split(/\s+/)[0];
  return { db, me, actor: `Bunty, for ${first}`, today: todayDubai() };
}

/** Best-effort record of every Bunty action (table arrives with migration 20261109100000; skipped until then). */
export async function logBuntyAction(ctx: BuntyCtx, entry: { tool: string; input: unknown; ok: boolean; result?: unknown; error?: string }) {
  const r = await ctx.db.from("crm_bunty_actions").insert({
    for_email: ctx.me.email, actor: ctx.actor, tool: entry.tool, input: entry.input, ok: entry.ok,
    result: entry.result ?? null, error: entry.error ?? null,
  });
  if (r.error && !/schema cache|does not exist|Could not find/i.test(r.error.message)) console.error("bunty log:", r.error.message);
}
