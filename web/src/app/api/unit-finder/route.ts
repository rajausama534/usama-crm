// Reads a Bayut / Dubizzle / Property Finder listing. The reading rules are the old CRM's api/unit-finder.js, unchanged.
import handler from "@/lib/unit-finder/listing";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_HOST = /(^|\.)(bayut\.com|dubizzle\.com|propertyfinder\.ae)$/i;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown; text?: unknown };
  const url = String(body.url || "").trim();
  // The old check only looked for the site's name anywhere in the link; this server must only ever open the three portals.
  if (url && !body.text) {
    let host = "";
    try { host = new URL(url).hostname; } catch {}
    if (!ALLOWED_HOST.test(host)) return Response.json({ error: "Paste a Bayut, Dubizzle or Property Finder listing link." }, { status: 400 });
  }
  let status = 200;
  let out: unknown = null;
  const res = { status(c: number) { status = c; return res; }, json(o: unknown) { out = o; return res; } };
  await handler({ method: "POST", body }, res);
  return Response.json(out, { status });
}
