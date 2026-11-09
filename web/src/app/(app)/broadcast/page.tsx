"use client";

// WhatsApp only lets a person press Send, so this is a one-click queue: each click opens the next chat with the message
// ready, in the same WhatsApp tab (or the desktop app). Nothing is ever sent unseen.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, MessageCircle, Square } from "lucide-react";
import { db } from "@/lib/supabase";
import { fetchAll, natural } from "@/lib/tools";
import { useAuth } from "@/components/Providers";
import { useWaTemplate } from "@/components/ContactKit";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Textarea, Toast, cx, type Tone } from "@/components/ui";
import { BROADCAST_IDS_KEY, formatPhone, intro, type WaTemplate } from "@/lib/contact";
import { todayDubai } from "@/lib/format";
import { OWNER_STATUSES } from "@/lib/crm";

const SELECT = "id,owner,phone1,phone2,unit,cluster,community,status";
type Row = { id: number; owner: string | null; phone1: string | null; phone2: string | null; unit: string | null; cluster: string | null; community: string | null; status: string | null };
type Scope = "selected" | "filtered" | "inside";
type QItem = { row: Row; phone: string; msg: string; state: "" | "opened" | "skipped" };
type Opt = { community: string | null; cluster: string | null };

const phoneOf = (r: Row) => formatPhone(r.phone1 || r.phone2);
const SAMPLE: Row = { id: 0, owner: "Owner Name", community: "The Valley", cluster: "Farm Gardens", unit: "101", phone1: null, phone2: null, status: null };

function buildMessage(t: WaTemplate, r: Row, greeting: string, agent: string, company: string, body: string) {
  const first = r.owner ? String(r.owner).trim().split(/\s+/)[0] : "Owner";
  const who = intro({ ...t, agentName: agent || "Agent", company });
  return `${greeting || "Hello"} Mr. ${first},\n\n${who}\n\nI'm reaching out regarding your property in ${r.cluster || ""}, Unit #${r.unit || ""}, ${r.community || ""}.\n\n${body}\n\nRegards,\n${agent || "Agent"}`;
}
const dedupe = (rows: Row[]) => { const seen = new Set<string>(); return rows.filter((r) => { const p = phoneOf(r); if (!p || seen.has(p)) return false; seen.add(p); return true; }); };

export default function BroadcastPage() {
  return <Suspense><Page /></Suspense>;
}

function Page() {
  const { me } = useAuth();
  const params = useSearchParams();
  const template = useWaTemplate();
  const [scope, setScope] = useState<Scope>("inside");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [greeting, setGreeting] = useState("");
  const [agent, setAgent] = useState("");
  const [company, setCompany] = useState("");
  const [body, setBody] = useState("");
  const [fCommunity, setFCommunity] = useState(params.get("community") || "");
  const [fCluster, setFCluster] = useState(params.get("cluster") || "");
  const [fStatus, setFStatus] = useState(params.get("status") || "");
  const [fSource] = useState(params.get("source") || "");
  const [community, setCommunity] = useState("");
  const [cluster, setCluster] = useState("");
  const [pool, setPool] = useState<Row[]>([]);
  const [rangeValue, setRangeValue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [recipients, setRecipients] = useState<Row[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [preview, setPreview] = useState(0);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [pos, setPos] = useState(0);
  const [app, setApp] = useState<"web" | "app">("web");
  const [toast, setToast] = useState("");

  // Fill the message boxes once from the saved WhatsApp template; pick up contacts ticked on the Owners page.
  useEffect(() => {
    setGreeting(template.greeting || "Hello"); setAgent(template.agentName || "Usama"); setCompany(template.company || ""); setBody(template.message || "");
  }, [template]);
  useEffect(() => {
    try {
      setApp((localStorage.getItem("crm_wa_app") as "web" | "app") || "web");
      const ids = JSON.parse(sessionStorage.getItem(BROADCAST_IDS_KEY) || "[]") as number[];
      if (ids.length) { setSelectedIds(ids); setScope("selected"); sessionStorage.removeItem(BROADCAST_IDS_KEY); }
      else if (params.get("community") || params.get("cluster") || params.get("status") || params.get("source")) setScope("filtered");
    } catch {}
  }, [params]);

  const options = useQuery({ queryKey: ["broadcast-options"], staleTime: 30 * 60_000, queryFn: async () => ((await db.rpc("crm_filter_options")).data || []) as Opt[] });
  const communities = useMemo(() => [...new Set((options.data || []).map((r) => r.community).filter(Boolean) as string[])].sort(natural), [options.data]);
  const clustersOf = useCallback((c: string) => [...new Set((options.data || []).filter((r) => r.community === c).map((r) => r.cluster).filter(Boolean) as string[])].sort(natural), [options.data]);

  // Choose inside this page: community > cluster gives numbered contacts; ranges of 50 or a custom From # / To #.
  useEffect(() => {
    setPool([]); setPicked(new Set()); setRangeValue("");
    if (!community || !cluster) return;
    let live = true;
    (async () => {
      try {
        const rows = await fetchAll<Row>(() => db.from("owners").select(SELECT).eq("community", community).eq("cluster", cluster).order("id"));
        if (!live) return;
        setPool(dedupe(rows).sort((a, b) => { const na = parseFloat(a.unit || ""), nb = parseFloat(b.unit || ""); if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb; return String(a.owner || "").localeCompare(String(b.owner || "")); }));
      } catch (e) { if (live) setToast((e as Error).message); }
    })();
    return () => { live = false; };
  }, [community, cluster]);
  const ranges = useMemo(() => { const out: string[] = []; for (let i = 0; i < pool.length; i += 50) out.push(`${i}:${Math.min(i + 50, pool.length)}`); return out; }, [pool]);
  const [start, end] = rangeValue ? rangeValue.split(":").map(Number) : [0, 0];
  const shown = rangeValue ? pool.slice(start, end) : [];
  function chooseRange(v: string) {
    setRangeValue(v);
    if (!v) { setPicked(new Set()); return; }
    const [a, b] = v.split(":").map(Number);
    setPicked(new Set(pool.slice(a, b).map((r) => r.id)));
  }
  function applyCustom() {
    if (!pool.length) { setToast("Choose a community and cluster first."); return; }
    let a = Math.max(1, Number(from || 1)), b = Math.min(pool.length, Number(to || pool.length));
    if (b < a) [a, b] = [b, a];
    chooseRange(`${a - 1}:${b}`);
  }

  // Who the message is going to.
  useEffect(() => {
    let live = true;
    (async () => {
      setLoadingRows(true);
      try {
        let rows: Row[] = [];
        if (scope === "filtered") {
          if (fCommunity || fCluster || fStatus || fSource) rows = await fetchAll<Row>(() => { let q = db.from("owners").select(SELECT).order("id"); if (fCommunity) q = q.eq("community", fCommunity); if (fCluster) q = q.eq("cluster", fCluster); if (fStatus) q = q.eq("status", fStatus); if (fSource) q = q.eq("data_source", fSource); return q; });
        } else if (scope === "inside") rows = pool.filter((r) => picked.has(r.id));
        else if (selectedIds.length) { const { data, error } = await db.from("owners").select(SELECT).in("id", selectedIds); if (error) throw new Error(error.message); rows = (data || []) as Row[]; }
        if (live) { setRecipients(rows); setPreview((p) => Math.min(p, Math.max(0, rows.length - 1))); }
      } catch (e) { if (live) setToast((e as Error).message); }
      if (live) setLoadingRows(false);
    })();
    return () => { live = false; };
  }, [scope, fCommunity, fCluster, fStatus, fSource, picked, pool, selectedIds]);

  const row = recipients[preview] || SAMPLE;
  const msgFor = useCallback((r: Row) => buildMessage(template, r, greeting, agent, company, body), [template, greeting, agent, company, body]);

  function prepare() {
    const rows = dedupe(recipients);
    if (!rows.length) { setToast("Choose at least one contact with a valid phone number."); return; }
    setQueue(rows.map((r) => ({ row: r, phone: phoneOf(r), msg: msgFor(r), state: "" }))); setPos(0);
  }
  const setState = (i: number, state: QItem["state"]) => setQueue((q) => q.map((x, n) => (n === i ? { ...x, state } : x)));
  const openCurrent = useCallback(async () => {
    const c = queue[pos];
    if (!c) return;
    const url = app === "app" ? `whatsapp://send?phone=${c.phone}&text=${encodeURIComponent(c.msg)}` : `https://web.whatsapp.com/send?phone=${c.phone}&text=${encodeURIComponent(c.msg)}`;
    if (app === "app") location.href = url; else window.open(url, "crmWhatsApp");
    setState(pos, "opened"); setPos(pos + 1);
    const log = await db.from("whatsapp_broadcast_log").insert([{ owner_id: String(c.row.id), phone: c.phone, message: c.msg, status: "opened", sent_by: me?.email || null }]);
    if (log.error) setToast(log.error.message);
    const up = await db.from("owners").update({ last_contacted: todayDubai() }).eq("id", c.row.id);
    if (up.error) setToast(up.error.message);
  }, [queue, pos, app, me]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !queue.length || pos >= queue.length) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      e.preventDefault(); openCurrent();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, pos, openCurrent]);

  const handled = queue.filter((x) => x.state).length;
  const STATE: Record<string, [string, Tone]> = { "": ["Waiting", "neutral"], opened: ["Opened", "good"], skipped: ["Skipped", "warn"] };
  const current = queue[pos];

  return (
    <div className="animate-in">
      <PageHeader title="WhatsApp Broadcast" subtitle="Each message is checked and sent by you, one chat at a time." />
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="space-y-4 min-w-0">
          <Card className="p-4">
            <Field label="Recipients">
              <Select value={scope} onChange={(e) => { setScope(e.target.value as Scope); setPreview(0); }}>
                <option value="selected">Selected from owner table{selectedIds.length ? ` (${selectedIds.length})` : ""}</option>
                <option value="filtered">All owners matching filters</option>
                <option value="inside">Choose inside broadcast</option>
              </Select>
            </Field>
            {scope === "selected" && !selectedIds.length && <p className="mt-3 text-[13px] text-ink-2">Nobody is ticked yet. On the Owners page, tick the contacts and press WhatsApp Broadcast.</p>}
            {scope === "filtered" && (
              <div className="mt-3 grid sm:grid-cols-3 gap-2">
                <Select value={fCommunity} aria-label="Community" onChange={(e) => { setFCommunity(e.target.value); setFCluster(""); }}><option value="">All communities</option>{communities.map((c) => <option key={c}>{c}</option>)}</Select>
                <Select value={fCluster} aria-label="Cluster" disabled={!fCommunity} onChange={(e) => setFCluster(e.target.value)}><option value="">All clusters</option>{clustersOf(fCommunity).map((c) => <option key={c}>{c}</option>)}</Select>
                <Select value={fStatus} aria-label="Status" onChange={(e) => setFStatus(e.target.value)}><option value="">All statuses</option>{OWNER_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
              </div>
            )}
            {scope === "inside" && (
              <div className="mt-3">
                <div className="grid sm:grid-cols-3 gap-2">
                  <Select value={community} aria-label="Community" onChange={(e) => { setCommunity(e.target.value); setCluster(""); }}><option value="">Choose community</option>{communities.map((c) => <option key={c}>{c}</option>)}</Select>
                  <Select value={cluster} aria-label="Cluster" disabled={!community} onChange={(e) => setCluster(e.target.value)}><option value="">Choose cluster</option>{clustersOf(community).map((c) => <option key={c}>{c}</option>)}</Select>
                  <Select value={rangeValue} aria-label="Range" disabled={!pool.length} onChange={(e) => chooseRange(e.target.value)}>
                    <option value="">Choose range</option>
                    {rangeValue && !ranges.includes(rangeValue) && <option value={rangeValue}>{start + 1}–{end}</option>}
                    {ranges.map((r) => { const [a, b] = r.split(":").map(Number); return <option key={r} value={r}>{a + 1}–{b}</option>; })}
                  </Select>
                </div>
                <div className="flex items-end gap-2 mt-2">
                  <Field label="From #" className="w-24"><Input type="number" min={1} value={from} placeholder="1" onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }} /></Field>
                  <Field label="To #" className="w-24"><Input type="number" min={1} value={to} placeholder="20" onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }} /></Field>
                  <Button onClick={applyCustom}>Select</Button>
                </div>
                <p className="mt-2 text-xs text-ink-3">{!community || !cluster ? "Choose a community and cluster." : `${community} > ${cluster} > ${pool.length} valid contacts${rangeValue ? ` > Showing ${start + 1}–${end}` : ""}`}</p>
                {shown.length > 0 && (
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line divide-y divide-line">
                    {shown.map((r, i) => (
                      <label key={r.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface-2">
                        <input type="checkbox" className="accent-[var(--accent)]" checked={picked.has(r.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                        <span className="min-w-0"><span className="text-[13px] font-medium text-ink"><span className="text-ink-3 num">#{start + i + 1}</span> {r.owner || "Owner"}</span><span className="block text-xs text-ink-3 break-words">{r.community} · {r.cluster} · Unit {r.unit}</span></span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Greeting"><Input value={greeting} onChange={(e) => setGreeting(e.target.value)} /></Field>
              <Field label="Agent name"><Input value={agent} onChange={(e) => setAgent(e.target.value)} /></Field>
              <Field label="Company (optional)" className="sm:col-span-2"><Input value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
              <Field label="Your message" className="sm:col-span-2"><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4 min-w-0 lg:sticky lg:top-20">
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="font-semibold text-ink text-sm">Personalised preview</div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" aria-label="Previous" disabled={recipients.length < 2} onClick={() => setPreview((p) => (p - 1 + recipients.length) % recipients.length)}><ChevronLeft size={15} /></Button>
                <Button size="sm" variant="ghost" aria-label="Next" disabled={recipients.length < 2} onClick={() => setPreview((p) => (p + 1) % recipients.length)}><ChevronRight size={15} /></Button>
              </div>
            </div>
            <div className="text-xs text-ink-3 mb-2">{recipients.length ? `${preview + 1} of ${recipients.length}: ${row.owner || "Owner"}` : "Sample preview. Select recipients to personalise."}</div>
            <div className="rounded-2xl bg-surface-2 p-4 text-[13.5px] leading-relaxed text-ink whitespace-pre-line min-h-44">{msgFor(row)}</div>
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[13px] text-ink-2 inline-flex items-center gap-1.5">{loadingRows && <Loader2 size={13} className="animate-spin" />}{recipients.length ? `${recipients.length} recipient${recipients.length === 1 ? "" : "s"} ready.` : "No recipients selected yet."}</span>
              <Button variant="primary" onClick={prepare} disabled={!recipients.length}><MessageCircle size={15} /> Prepare send queue</Button>
            </div>
          </Card>

          {queue.length > 0 && (
            <Card className="p-4 animate-in">
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round((handled / queue.length) * 100)}%` }} /></div>
              <div className="mt-1.5 text-xs text-ink-3 num">{handled} of {queue.length} handled</div>
              {current ? (
                <>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[13px] text-ink-2">
                    <span>Contact {pos + 1} of {queue.length}</span>
                    <label className="inline-flex items-center gap-1.5">Open in
                      <Select className="w-auto h-8" value={app} onChange={(e) => { const v = e.target.value as "web" | "app"; setApp(v); try { localStorage.setItem("crm_wa_app", v); } catch {} }}><option value="web">WhatsApp Web</option><option value="app">WhatsApp app</option></Select>
                    </label>
                  </div>
                  <div className="mt-2 rounded-2xl border border-line p-3.5">
                    <div className="font-semibold text-ink text-sm">{current.row.owner || "Owner"}</div>
                    <div className="text-xs text-ink-3 num">{[current.row.community, current.row.cluster, current.row.unit && `Unit ${current.row.unit}`].filter(Boolean).join(" · ")} · +{current.phone}</div>
                    <p className="mt-2 text-[13px] text-ink whitespace-pre-line">{current.msg}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={() => setPos(queue.length)}><Square size={13} /> Stop</Button>
                    <Button onClick={() => { setState(pos, "skipped"); setPos(pos + 1); }}>Skip</Button>
                    <Button variant="primary" autoFocus onClick={openCurrent}>Open in WhatsApp ({pos + 1} of {queue.length})</Button>
                  </div>
                  <p className="mt-2 text-xs text-ink-3">Press <b>Enter</b> in WhatsApp to send, then come back and click again. Shortcut here: <b>Enter</b> opens the next chat.</p>
                </>
              ) : (
                <div className="mt-3 rounded-xl bg-good-soft px-4 py-3 text-[13px] text-ink"><b className="font-semibold">All {queue.length} contacts handled.</b> {queue.filter((x) => x.state === "opened").length} opened in WhatsApp, {queue.filter((x) => x.state === "skipped").length} skipped.</div>
              )}
              <div className="mt-3 max-h-56 overflow-y-auto divide-y divide-line">
                {queue.map((x, i) => {
                  const [label, tone] = STATE[x.state];
                  return <div key={x.row.id} className={cx("flex items-center justify-between gap-3 py-1.5 text-[13px]", i === pos && "font-medium")}><span className="break-words text-ink">{x.row.owner || "Owner"} · {x.row.unit}</span><Badge tone={tone}>{label}</Badge></div>;
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </div>
  );
}
