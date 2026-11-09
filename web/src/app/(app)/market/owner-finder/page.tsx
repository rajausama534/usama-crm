"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Upload, Loader2, Trash2, FolderOpen, FileUp, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { edge, loadScript } from "@/lib/tools";
import { useConfirm } from "@/components/Confirm";
import { Badge, Button, Card, Empty, Input, PageHeader, Segmented, Skeleton, Toast, buttonClass, cx } from "@/components/ui";
import { orSafe } from "@/components/shell/CommandPalette";

const API = "owner-finder-api";
const XLSX_SRC = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

type Row = { owner_name?: string | null; phones?: string | null; email?: string | null; property?: string | null; file_name?: string | null };
type Group = { key: string; phone: string; names: Set<string>; emails: Set<string>; properties: Map<string, { text: string; sources: Set<string> }>; sources: Set<string> };
type Stats = { files: number; rows: number; fileRows?: { id: string; file_name: string; rows_count: number }[] };
type Parsed = { sheetName: string; rowNo: number; row: Record<string, unknown> };

const cl = (v: unknown) => (v == null ? "" : String(v).trim());
const nm = (v: unknown) => cl(v).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();

function infer(row: Record<string, unknown>) {
  const e = Object.entries(row);
  const f = (rs: RegExp[]) => { const h = e.find(([k, v]) => rs.some((r) => r.test(nm(k))) && cl(v)); return h ? cl(h[1]) : ""; };
  const a = (rs: RegExp[]) => [...new Set(e.filter(([k, v]) => rs.some((r) => r.test(nm(k))) && cl(v)).map((x) => cl(x[1])))].join(" · ");
  const owner = f([/^owner name$/, /^owner$/, /customer name/, /client name/, /full name/, /^name$/]);
  const phones = a([/phone/, /mobile/, /contact no/, /whatsapp/, /^tel/]);
  const email = a([/email/]);
  const community = f([/community/, /area/, /location/, /project/]);
  const building = f([/building/, /tower/, /cluster/]);
  const unit = f([/^unit$/, /unit no/, /villa/, /apartment/, /^apt/, /property no/]);
  return { owner, phones, email, property: [community, building, unit].filter(Boolean).join(" · ") };
}
function wbRows(XLSX: any, w: any) {
  const o: Parsed[] = [];
  for (const sn of w.SheetNames) (XLSX.utils.sheet_to_json(w.Sheets[sn], { defval: "", raw: false }) as Record<string, unknown>[]).forEach((row, i) => o.push({ sheetName: sn, rowNo: i + 2, row }));
  return o;
}
async function parse(f: File) {
  await loadScript(XLSX_SRC);
  const XLSX = (window as any).XLSX;
  const x = f.name.split(".").pop()!.toLowerCase();
  if (["xlsx", "xls"].includes(x)) return wbRows(XLSX, XLSX.read(await f.arrayBuffer(), { type: "array" }));
  if (["csv", "tsv", "txt"].includes(x)) return wbRows(XLSX, XLSX.read(await f.text(), { type: "string" }));
  throw new Error("Unsupported file");
}
async function hash(f: File) {
  const h = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const phoneParts = (v: unknown) => cl(v).split(/\s*[·|,;/]\s*|\s{2,}/).map((x) => x.replace(/[^0-9+]/g, "")).filter((x) => x.replace(/\D/g, "").length >= 6);
function phoneKey(v: unknown) {
  const p = phoneParts(v)[0] || "";
  let d = p.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("971")) return d;
  if (d.startsWith("0") && d.length >= 9) return "971" + d.slice(1);
  return d || "";
}
function groupResults(rows: Row[]) {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = phoneKey(r.phones) || "name:" + nm(r.owner_name || "unknown");
    let g = map.get(key);
    if (!g) { g = { key, phone: phoneParts(r.phones)[0] || r.phones || "", names: new Set(), emails: new Set(), properties: new Map(), sources: new Set() }; map.set(key, g); }
    if (cl(r.owner_name)) g.names.add(cl(r.owner_name));
    if (cl(r.email)) cl(r.email).split(/\s*[·|,;]\s*/).filter(Boolean).forEach((x) => g.emails.add(x));
    if (cl(r.file_name)) g.sources.add(cl(r.file_name));
    const prop = cl(r.property);
    if (prop) {
      const pk = nm(prop);
      if (!g.properties.has(pk)) g.properties.set(pk, { text: prop, sources: new Set() });
      if (cl(r.file_name)) g.properties.get(pk)!.sources.add(cl(r.file_name));
    }
  }
  return [...map.values()];
}
async function crmSearch(q: string): Promise<Row[]> {
  const s = orSafe(q);
  if (!s) return [];
  const { data, error } = await db.from("owners").select("id,owner,phone1,phone2,community,cluster,unit,data_source")
    .or(`owner.ilike.%${s}%,phone1.ilike.%${s}%,phone2.ilike.%${s}%,community.ilike.%${s}%,cluster.ilike.%${s}%,unit.ilike.%${s}%`).limit(300);
  if (error) return [];
  return (data || []).map((r) => ({ owner_name: r.owner, phones: [r.phone1, r.phone2].filter(Boolean).join(" · "), property: [r.community, r.cluster, r.unit].filter(Boolean).join(" · "), file_name: r.data_source || "Existing CRM" }));
}

export default function OwnerFinderPage() {
  const [mode, setMode] = useState<"search" | "upload">("search");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsErr, setStatsErr] = useState("");
  const [progress, setProgress] = useState({ text: "Ready. Uploaded data will stay online.", pct: 0, busy: false });
  const [problems, setProblems] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [toast, setToast] = useState("");
  const [ask, confirmNode] = useConfirm();

  const loadStats = useCallback(async () => {
    try { setStats(await edge<Stats>(API, "stats")); setStatsErr(""); } catch (e) { setStatsErr((e as Error).message); }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  async function search() {
    const term = q.trim();
    if (!term) return;
    setSearching(true); setErr("");
    try {
      const [a, b] = await Promise.all([crmSearch(term), edge<{ rows?: Row[] }>(API, "search", { q: term })]);
      setRows([...a, ...(b.rows || [])]);
    } catch (e) { setErr((e as Error).message); setRows(null); }
    setSearching(false);
  }
  const groups = useMemo(() => (rows ? groupResults(rows) : []), [rows]);

  async function upload(list: FileList | File[]) {
    const fs = [...list].filter((f) => /\.(xlsx|xls|csv|tsv|txt)$/i.test(f.name));
    if (!fs.length) { setToast("No supported database files found."); return; }
    setProblems([]);
    let done = 0;
    setProgress({ text: "Starting…", pct: 0, busy: true });
    for (const f of fs) {
      let id: string | undefined;
      try {
        setProgress((p) => ({ ...p, text: `Reading ${f.name}…` }));
        const p = await parse(f);
        const st = await edge<{ duplicate?: boolean; fileId: string }>(API, "startUpload", { fileName: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, fileSize: f.size, fileHash: await hash(f), rowsCount: p.length });
        if (st.duplicate) { done++; setProgress((x) => ({ ...x, pct: Math.round((done / fs.length) * 100) })); continue; }
        id = st.fileId;
        const rs = p.map((x) => {
          const i = infer(x.row);
          return { ownerName: i.owner, phones: i.phones, email: i.email, property: i.property, searchable: nm(Object.entries(x.row).map(([k, v]) => k + " " + cl(v)).join(" ")), sheetName: x.sheetName, rowNo: x.rowNo, row: x.row };
        });
        for (let i = 0; i < rs.length; i += 300) {
          setProgress((x) => ({ ...x, text: `Uploading ${f.name}: ${Math.min(i + 300, rs.length).toLocaleString()} / ${rs.length.toLocaleString()} rows…` }));
          await edge(API, "uploadBatch", { fileId: id, rows: rs.slice(i, i + 300) });
        }
        await edge(API, "finishUpload", { fileId: id });
        done++;
        setProgress((x) => ({ ...x, pct: Math.round((done / fs.length) * 100) }));
      } catch (e) {
        if (id) { try { await edge(API, "failUpload", { fileId: id }); } catch {} }
        setProblems((l) => [...l, `${f.name}: ${(e as Error).message}`]);
      }
    }
    setProgress((p) => ({ ...p, text: "Finished. Data is saved online.", busy: false }));
    loadStats();
  }

  async function removeFile(id: string, name: string) {
    if (!(await ask({ title: "Delete this uploaded database?", hint: name, yes: "Delete", danger: true }))) return;
    try { await edge(API, "deleteFile", { fileId: id }); loadStats(); } catch (e) { setToast((e as Error).message); }
  }

  return (
    <div className="animate-in max-w-5xl mx-auto">
      <PageHeader title="Owner Finder" subtitle="Existing CRM owners and the databases uploaded online." actions={
        <Segmented value={mode} onChange={setMode} options={[{ value: "search", label: "Search" }, { value: "upload", label: "Upload" }]} />
      } />

      {mode === "search" ? (
        <>
          <Card className="p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} placeholder="Name, phone, project or unit" className="pl-9" />
              </div>
              <Button variant="primary" onClick={search} disabled={searching || !q.trim()}>{searching && <Loader2 size={15} className="animate-spin" />}Search</Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {statsErr ? <Badge tone="bad">{statsErr}</Badge> : stats ? <>
                <Badge tone="good">CRM connected</Badge>
                <Badge>{stats.files.toLocaleString()} online files</Badge>
                <Badge>{stats.rows.toLocaleString()} uploaded rows</Badge>
              </> : <Skeleton className="w-48" />}
            </div>
          </Card>

          <div className="mt-4 space-y-3">
            {searching && !rows ? <Card className="p-5 space-y-3"><Skeleton className="w-1/2" /><Skeleton /><Skeleton className="w-2/3" /></Card>
             : err ? <Card><Empty title="Couldn’t search" hint={err} /></Card>
             : rows === null ? <Card><Empty icon={<Search size={28} />} title="Search existing CRM owners and uploaded databases" /></Card>
             : groups.length === 0 ? <Card><Empty title="No matching owner or property records found" hint="Try part of the name or the last digits of the phone." /></Card>
             : groups.map((g) => {
                const props = [...g.properties.values()];
                return (
                  <Card key={g.key} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink leading-snug">{[...g.names].join(" / ") || "Owner name not identified"}</div>
                        <div className="text-[13px] text-ink-2 num mt-0.5">{g.phone || "No phone number"}</div>
                        {g.emails.size > 0 && <div className="text-xs text-ink-3 mt-1 break-all">{[...g.emails].join(" · ")}</div>}
                      </div>
                      <div className="text-[11px] text-ink-3 text-right max-w-[40%] break-words">{[...g.sources].join(" · ")}</div>
                    </div>
                    <div className="mt-3 grid gap-1.5">
                      {props.length ? props.map((p) => (
                        <div key={p.text} className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink">
                          {p.text}
                          {p.sources.size > 0 && <div className="text-[11px] text-ink-3 mt-0.5">{[...p.sources].join(" · ")}</div>}
                        </div>
                      )) : <div className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink-3">No property detail</div>}
                    </div>
                  </Card>
                );
              })}
          </div>
        </>
      ) : (
        <Card className="p-4">
          <div className={cx("rounded-2xl border-2 border-dashed p-8 text-center transition-colors", drag ? "border-accent bg-accent-soft" : "border-line-strong")}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
            <Upload size={26} className="mx-auto text-ink-3" />
            <div className="font-semibold text-ink mt-2">Upload databases</div>
            <div className="text-[13px] text-ink-2 mt-0.5">Upload files or a full MacBook folder once. Data stays online.</div>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              <label className={buttonClass("primary", "md", "cursor-pointer")}><FileUp size={16} /> Choose files
                <input type="file" multiple hidden accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
              </label>
              <label className={buttonClass("secondary", "md", "cursor-pointer")}><FolderOpen size={16} /> Choose folder
                <input type="file" multiple hidden ref={(n) => { n?.setAttribute("webkitdirectory", ""); }} onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-line px-4 py-3 text-[13px] text-ink">
            <div className="flex items-center gap-2">{progress.busy && <Loader2 size={14} className="animate-spin text-ink-3" />}{progress.text}</div>
            <div className="h-1.5 rounded-full bg-surface-2 mt-2 overflow-hidden"><div className="h-full bg-accent rounded-full transition-[width] duration-300" style={{ width: `${progress.pct}%` }} /></div>
          </div>
          {problems.map((p) => <div key={p} className="mt-2 flex items-start gap-2 text-[13px] text-bad"><X size={14} className="mt-0.5 shrink-0" /> {p}</div>)}
          <div className="mt-4 space-y-2">
            {(stats?.fileRows || []).map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-2.5">
                <div className="min-w-0"><div className="text-[13px] font-medium text-ink truncate">{f.file_name}</div><div className="text-xs text-ink-3 num">{Number(f.rows_count).toLocaleString()} rows</div></div>
                <Button size="sm" variant="ghost" onClick={() => removeFile(f.id, f.file_name)}><Trash2 size={14} /> Delete</Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      {confirmNode}
    </div>
  );
}
