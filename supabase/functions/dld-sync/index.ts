// Weekly DLD sales sync (scheduled with pg_cron). Fetches recent sales from DLD's public open-data feed,
// keeps those whose project names exactly one CRM community/cluster (same rules as scripts/dld_import_sql.py)
// and inserts them into dld_transactions. Idempotent (transaction number is the primary key).
// Unit-level links still come only from unit-numbered sales reports, never from this job.
// It writes only public DLD data and refuses to run more than once every 6 days, so it needs no caller secret.
import { createClient } from "npm:@supabase/supabase-js@2";

const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (() => {
  try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string; } catch { return ""; }
})();
const db = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, { auth: { persistSession: false } });
const DLD = "https://gateway.dubailand.gov.ae/open-data/transactions";
const SQM_TO_SQFT = 10.7639;
const HINTS: Record<string, string[]> = {
  "The Valley": ["thevalley"], "Arabian Ranches 1": ["arabianranches"], "Arabian Ranches 2": ["arabianranches", "arii"],
  "Arabian Ranches 3": ["arabianranches", "arabainranches"], "The Oasis": ["oasis"], "Mudon": ["mudon"],
  "Tilal Al Ghaf": ["tilalalghaf"], "Emaar South": ["emaarsouth", "expogolf"],
};

function norm(s: string) {
  let n = String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/lll/g, "iii").replace(/ll/g, "ii");
  n = n.replace(/([a-z])iii$/, "$13").replace(/([a-z])ii$/, "$12");
  return n === "eliesaab" ? "eliesaab1" : n;
}
const mmddyyyy = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;

async function fetchDay(from: Date, to: Date, skip: number) {
  const r = await fetch(DLD, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://dubailand.gov.ae", Referer: "https://dubailand.gov.ae/", "User-Agent": "usama-crm-dld-sync/1.0" },
    body: JSON.stringify({ P_FROM_DATE: mmddyyyy(from), P_TO_DATE: mmddyyyy(to), P_GROUP_ID: "1", P_IS_OFFPLAN: "", P_IS_FREE_HOLD: "", P_AREA_ID: "", P_USAGE_ID: "", P_PROP_TYPE_ID: "", P_TAKE: "5000", P_SKIP: String(skip), P_SORT: "TRANSACTION_NUMBER_ASC" }),
  });
  if (!r.ok) throw new Error(`DLD responded ${r.status}`);
  return (await r.json()).response.result as Record<string, any>[];
}

Deno.serve(async () => {
  const { data: last } = await db.from("dld_sync_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.started_at).getTime() < 6 * 864e5) {
    return Response.json({ skipped: "ran less than 6 days ago", last: last.started_at });
  }
  const { data: run } = await db.from("dld_sync_runs").insert({}).select("id").single();
  try {
    const { data: options, error } = await db.rpc("crm_filter_options_all");
    if (error) throw error;
    const labels = new Map<string, [string, string][]>();
    for (const o of options as { community: string; cluster: string }[]) {
      if (!o.community || !o.cluster) continue;
      const k = norm(o.cluster);
      if (!labels.has(k)) labels.set(k, []);
      if (!labels.get(k)!.some(([c, cl]) => c === o.community && cl === o.cluster)) labels.get(k)!.push([o.community, o.cluster]);
    }
    const target = (project: string) => {
      const flat = String(project || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const parts = String(project || "").split(/\s*-\s*/);
      const tail = parts.length > 1 ? parts.slice(1).join(" - ") : "";
      const keys = new Set([norm(project), norm(tail), norm(String(project || "").replace(/^mudon\s+/i, ""))].filter(Boolean));
      const hits = new Map<string, [string, string]>();
      for (const k of keys) for (const hit of labels.get(k) || []) if ((HINTS[hit[0]] || []).some((h) => flat.includes(h))) hits.set(hit.join("|"), hit);
      return hits.size === 1 ? [...hits.values()][0] : null;
    };

    const to = new Date(), from = new Date(Date.now() - 21 * 864e5);
    let fetched = 0, mapped = 0;
    for (let skip = 0; ; skip += 5000) {
      const rows = await fetchDay(from, to, skip);
      fetched += rows.length;
      const out = rows.map((r) => {
        const t = target(r.PROJECT_EN);
        if (!t) return null;
        const area = r.ACTUAL_AREA || r.PROCEDURE_AREA || null;
        return {
          transaction_number: r.TRANSACTION_NUMBER, transaction_date: String(r.INSTANCE_DATE).slice(0, 10), procedure: r.PROCEDURE_EN,
          is_offplan: r.IS_OFFPLAN === 1, property_type: r.PROP_TYPE_EN, property_sub_type: r.PROP_SB_TYPE_EN, rooms: r.ROOMS_EN,
          amount: r.TRANS_VALUE, area_sqm: area, area_sqft: area ? Math.round(area * SQM_TO_SQFT) : null,
          dld_area: r.AREA_EN, dld_project: r.PROJECT_EN, crm_community: t[0], crm_cluster: t[1],
        };
      }).filter(Boolean);
      if (out.length) {
        const { error: e } = await db.from("dld_transactions").upsert(out, { onConflict: "transaction_number", ignoreDuplicates: true });
        if (e) throw e;
        mapped += out.length;
      }
      if (rows.length < 5000) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await db.from("dld_sync_runs").update({ finished_at: new Date().toISOString(), fetched, mapped }).eq("id", run!.id);
    return Response.json({ fetched, mapped });
  } catch (e) {
    await db.from("dld_sync_runs").update({ finished_at: new Date().toISOString(), error: String((e as Error).message || e) }).eq("id", run!.id);
    return Response.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
});
