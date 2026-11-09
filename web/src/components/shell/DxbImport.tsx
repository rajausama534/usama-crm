"use client";

// Receives sales sent by the Chrome extension from DXBinteract (/#dxb=…), previews the exact-unit matches (database
// dry run) and imports them only when an admin confirms. Moved from the old CRM's crm-dxb.js.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Badge, Button, Sheet, Toast, type Tone } from "@/components/ui";

// Same name rules as the DLD import: 'Elie Saab ll' == 'Elie Saab 2', community must match too.
const norm = (s: unknown) => { let n = String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/lll/g, "iii").replace(/ll/g, "ii"); n = n.replace(/([a-z])iii$/, "$13").replace(/([a-z])ii$/, "$12"); return n === "eliesaab" ? "eliesaab1" : n; };

async function mapLocations(rows: any[]) {
  const { data } = await db.rpc("crm_filter_options");
  const labels: Record<string, Set<string>> = {};
  ((data || []) as any[]).forEach((o) => { if (!o.community || !o.cluster) return; const k = norm(o.cluster); (labels[k] = labels[k] || new Set()).add(`${o.community}||${o.cluster}`); });
  return rows.map((r) => {
    const parts = String(r.location || "").split(",").map((s) => s.trim());
    const hits = [...(labels[norm(parts[0])] || [])].filter((x) => norm(x.split("||")[0]) === norm(parts[1] || "") || parts.slice(1).some((p) => norm(p) === norm(x.split("||")[0])));
    const [community, cluster] = hits.length === 1 ? hits[0].split("||") : [null, null];
    return { ...r, community, cluster };
  });
}

export function DxbImport() {
  const { me } = useAuth();
  const [rows, setRows] = useState<any[] | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!me || started.current) return;
    const m = location.hash.match(/^#dxb=(.+)$/);
    if (!m) return;
    started.current = true;
    history.replaceState(null, "", location.pathname);
    if (!me.isAdmin) { setToast("Only an administrator can import sales."); return; }
    (async () => {
      try {
        const bin = atob(decodeURIComponent(m[1]));
        const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
        const mapped = await mapLocations(payload.rows || []);
        const { data, error } = await db.rpc("crm_import_external_sales", { rows: mapped, source: "dxbinteract", dry_run: true });
        if (error) throw new Error(error.message);
        setPreview((data || []) as any[]); setRows(mapped);
      } catch (e) { setToast((e as Error).message || "Could not read the data sent from DXBinteract."); }
    })();
  }, [me]);

  const n = (k: string) => preview.filter((p) => p.result === k).length;
  const tone = (r: string): Tone => (r === "will import" ? "good" : r === "already stored" ? "neutral" : "warn");
  async function go() {
    setBusy(true);
    const { data, error } = await db.rpc("crm_import_external_sales", { rows, source: "dxbinteract", dry_run: false });
    setBusy(false);
    if (error) { setToast(error.message); return; }
    setRows(null);
    setToast(`Imported ${((data || []) as any[]).filter((d) => d.result === "imported").length} sales into unit transaction history`);
  }

  return (
    <>
      <Sheet open={!!rows} onClose={() => setRows(null)} wide title="Import sales from DXBinteract" footer={<>
        <Button variant="ghost" onClick={() => setRows(null)}>Cancel</Button>
        <Button variant="primary" disabled={busy || !n("will import")} onClick={go}>{busy && <Loader2 size={15} className="animate-spin" />}{busy ? "Importing…" : `Import ${n("will import")} sales`}</Button>
      </>}>
        {rows && <>
          <p className="text-[13px] text-ink-2">{rows.length} sales read from the page you were viewing. A sale is only linked when its unit number exists exactly once in the matching CRM cluster. Nothing existing is changed.</p>
          <div className="grid grid-cols-3 gap-2 my-4">
            {([["Will import", n("will import")], ["Already stored", n("already stored")], ["Skipped", preview.length - n("will import") - n("already stored")]] as const).map(([l, v]) => (
              <div key={l} className="rounded-2xl bg-surface-2 p-3"><div className="text-xs text-ink-2">{l}</div><div className="text-xl text-ink num">{v}</div></div>
            ))}
          </div>
          <div className="rounded-2xl border border-line divide-y divide-line">
            {preview.map((p, i) => {
              const r = rows[p.idx - 1] || {};
              return (
                <div key={i} className="flex items-start justify-between gap-3 px-3 py-2.5 text-[13px]">
                  <div className="min-w-0"><div className="font-medium text-ink">{r.label || r.location}</div><div className="text-xs text-ink-3">{p.note || `AED ${Number(r.amount || 0).toLocaleString("en-US")} · ${r.date || ""}`}</div>{p.unit && <div className="text-xs text-ink-2">{p.community} › {p.cluster} › {p.unit}</div>}</div>
                  <Badge tone={tone(p.result)}>{p.result}</Badge>
                </div>
              );
            })}
          </div>
        </>}
      </Sheet>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </>
  );
}
