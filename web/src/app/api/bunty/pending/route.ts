// Pending counts per department for Bunty's screen (badges). No Claude call — straight from the database,
// with the person's own permissions.

import { buntyContext, HttpError } from "@/lib/bunty/server";
import { DEPARTMENTS, pendingByDepartment } from "@/lib/bunty/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await buntyContext(req);
    const pending = await pendingByDepartment(ctx);
    return Response.json({ departments: DEPARTMENTS, pending, ai: !!process.env.ANTHROPIC_API_KEY }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof HttpError ? e.status : 500 });
  }
}
