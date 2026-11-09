"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Users2, ChevronLeft, ChevronRight, RotateCcw, Columns3, FolderKanban, MessageSquareText, Trash2, X, Download, Loader2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { BEDROOMS, LEAD_SOURCES, LEAD_STAGES, PROPERTY_TYPES, STAGE_TONE, type Lead, logLeadActivity } from "@/lib/crm";
import { useDebounced, useStaff, staffName, useProjects } from "@/lib/hooks";
import { orSafe } from "@/components/shell/CommandPalette";
import { Badge, Button, Card, Empty, Input, ListSkeleton, PageHeader, Segmented, Select, Sheet, cx } from "@/components/ui";
import { CallButton, CopyButton, TemplateSheet, WaButton, useToast, useWaTemplate } from "@/components/ContactKit";
import { downloadCSV, leadMessage, markLeadContacted } from "@/lib/contact";
import { fmtDate, relative, todayDubai } from "@/lib/format";
import { LeadSheet } from "./LeadSheet";

const PAGE = 50;
type ColKey = "name" | "phone" | "project_inquired" | "budget" | "status" | "notes" | "whatsapp" | "lead_receive_date" | "email" | "property_type" | "bedroom" | "source" | "follow_up_date" | "last_contacted" | "assigned_to";
const COLUMNS: { key: ColKey; label: string; on: boolean }[] = [
  { key: "name", label: "Name", on: true }, { key: "phone", label: "Phone", on: true }, { key: "project_inquired", label: "Project inquired", on: true },
  { key: "budget", label: "Budget", on: true }, { key: "status", label: "Status", on: true }, { key: "notes", label: "Notes", on: true },
  { key: "whatsapp", label: "Contact", on: true }, { key: "lead_receive_date", label: "Received", on: false }, { key: "email", label: "Email", on: false },
  { key: "property_type", label: "Property type", on: false }, { key: "bedroom", label: "Bedroom", on: false }, { key: "source", label: "Source", on: false },
  { key: "follow_up_date", label: "Follow-up date", on: true }, { key: "last_contacted", label: "Last contacted", on: false }, { key: "assigned_to", label: "Agent", on: false },
];
const COLS_KEY = "crm_new_lead_columns_v1";
const SORTS = [{ v: "lead_receive_date", l: "Sort: Received date" }, { v: "name", l: "Sort: Name" }, { v: "follow_up_date", l: "Sort: Follow-up" }, { v: "created_at", l: "Sort: Created" }];

export default function LeadsPage() {
  return <Suspense><Leads /></Suspense>;
}

function Leads() {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("open");
  const qc = useQueryClient();
  const toast = useToast();
  const staff = useStaff();
  const projects = useProjects();
  const template = useWaTemplate();

  const [view, setView] = useState<"list" | "board">("list");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");
  const [project, setProject] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [agent, setAgent] = useState("");
  const [due, setDue] = useState<"" | "today" | "overdue">("");
  const [sort, setSort] = useState("lead_receive_date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    const cols = ["lead_receive_date", "name", "phone", "email", "project_inquired", "budget", "property_type", "bedroom", "source", "status", "follow_up_date", "notes", "last_contacted"];
    const all: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("leads").select(cols.join(",")).range(from, from + 999);
      if (error) { toast("Export failed"); setExporting(false); return; }
      all.push(...((data || []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < 1000) break;
    }
    downloadCSV("leads_export", cols, all);
    setExporting(false);
  }
  const [cols, setCols] = useState<Set<ColKey>>(() => new Set(COLUMNS.filter((c) => c.on).map((c) => c.key)));
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(COLS_KEY) || "null"); if (Array.isArray(s)) setCols(new Set(s)); } catch {} }, []);
  const saveCols = (n: Set<ColKey>) => { setCols(n); try { localStorage.setItem(COLS_KEY, JSON.stringify([...n])); } catch {} };
  const term = orSafe(useDebounced(q, 250));

  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => (await db.rpc("crm_dashboard_stats")).data as { lead_status: Record<string, number>; leads: { total: number; followups_today: number; followups_overdue: number } } | null,
  });

  const filters = { term, stage, source, project, followUp, agent, due, sort, dir };
  const list = useQuery({
    queryKey: ["leads", view, filters, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = db.from("leads").select("*", { count: "exact" });
      if (term) query = query.or([`name.ilike.%${term}%`, `phone.ilike.%${term}%`, `email.ilike.%${term}%`, `project_inquired.ilike.%${term}%`].join(","));
      if (stage && view === "list") query = query.eq("status", stage);
      if (source) query = query.eq("source", source);
      if (project) query = query.ilike("project_inquired", `%${project}%`);
      if (followUp) query = query.eq("follow_up_date", followUp);
      if (agent) query = agent === "-" ? query.is("assigned_to", null) : query.ilike("assigned_to", agent);
      const today = todayDubai();
      if (due === "today") query = query.eq("follow_up_date", today);
      if (due === "overdue") query = query.lt("follow_up_date", today).not("status", "in", "(Won,Lost)");
      query = query.order(sort, { ascending: dir === "asc", nullsFirst: false }).order("created_at", { ascending: false });
      query = view === "list" ? query.range(page * PAGE, page * PAGE + PAGE - 1) : query.limit(600);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data || []) as Lead[], count: count || 0 };
    },
  });

  const rows = list.data?.rows || [];
  const total = list.data?.count || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const counts = stats.data?.lead_status || {};
  const refresh = () => { qc.invalidateQueries({ queryKey: ["leads"] }); qc.invalidateQueries({ queryKey: ["dashboard-stats"] }); };
  function setFilter(fn: () => void) { fn(); setPage(0); setPicked(new Set()); }
  function openLead(id: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("open", id); else sp.delete("open");
    router.replace(`/leads${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }

  async function saveField(lead: Lead, field: keyof Lead, value: string) {
    if (!me) return;
    const v = value.trim() || null;
    if ((lead[field] ?? null) === v) return;
    const patch: Record<string, string | null> = { [field]: v };
    if (field === "status") patch.last_contacted = todayDubai();
    const { error } = await db.from("leads").update(patch).eq("id", lead.id);
    if (error) { toast(error.message); return; }
    if (field === "status") await logLeadActivity(lead.id, "Status Change", `Status changed from ${lead.status || "-"} to ${v}.`, me.email);
    toast(); refresh();
  }
  async function contact(lead: Lead) { if (me) { await markLeadContacted(lead.id, me.email); refresh(); } }

  async function bulkStatus(s: string) {
    const ids = [...picked];
    if (!me || !s || !confirm(`Change ${ids.length} lead${ids.length > 1 ? "s" : ""} to "${s}"?`)) return;
    const old = rows.filter((r) => picked.has(r.id));
    const { error } = await db.from("leads").update({ status: s, last_contacted: todayDubai() }).in("id", ids);
    if (error) { toast(error.message); return; }
    const changed = old.filter((r) => r.status !== s);
    if (changed.length) await db.from("lead_activities").insert(changed.map((r) => ({ lead_id: r.id, activity_type: "Status Change", details: `Status changed from ${r.status || "-"} to ${s}.`, created_by: me.email })));
    setPicked(new Set()); toast(); refresh();
  }
  async function bulkAssign(email: string | null) {
    const ids = [...picked];
    if (!confirm(`Assign ${ids.length} lead${ids.length > 1 ? "s" : ""} to ${email ? staffName(staff.data, email) : "nobody"}?`)) return;
    const { error } = await db.from("leads").update({ assigned_to: email }).in("id", ids);
    if (error) { toast(error.message); return; }
    setPicked(new Set()); toast(); refresh();
  }
  async function bulkDelete() {
    const ids = [...picked];
    if (!confirm(`Delete ${ids.length} lead${ids.length > 1 ? "s" : ""}? They disappear from the CRM (the change history keeps a copy).`)) return;
    const { error } = await db.from("leads").delete().in("id", ids);
    if (error) { toast(error.message); return; }
    setPicked(new Set()); toast("Deleted"); refresh();
  }

  const visible = COLUMNS.filter((c) => cols.has(c.key) && (c.key !== "assigned_to" || me?.isAdmin));
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const anyFilter = q || stage || source || project || followUp || agent || due;
  const toggle = (id: string, on: boolean) => { const n = new Set(picked); if (on) n.add(id); else n.delete(id); setPicked(n); };

  return (
    <div className="animate-in">
      <PageHeader
        title="Leads"
        subtitle={stats.data ? <>{stats.data.leads.total} leads · <button className="hover:text-ink" onClick={() => setFilter(() => setDue(due === "today" ? "" : "today"))}>{stats.data.leads.followups_today} follow-ups today</button> · <button className="text-bad hover:underline" onClick={() => setFilter(() => setDue(due === "overdue" ? "" : "overdue"))}>{stats.data.leads.followups_overdue} overdue</button></> : " "}
        actions={<>
          <Segmented value={view} onChange={(v) => { setView(v); setPicked(new Set()); }} options={[{ value: "list", label: "Table" }, { value: "board", label: "Kanban" }]} />
          <Button onClick={() => setTemplateOpen(true)} title="WhatsApp message"><MessageSquareText size={16} /> WhatsApp message</Button>
          {me?.isAdmin && <Button onClick={() => setProjectsOpen(true)}><FolderKanban size={16} /> Projects</Button>}
          {me?.isAdmin && <Button onClick={exportCsv} disabled={exporting}>{exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export leads</Button>}
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Add lead</Button>
        </>}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
        <StageChip label="All" n={stats.data?.leads.total} active={!stage} onClick={() => setFilter(() => setStage(""))} />
        {LEAD_STAGES.map((s) => <StageChip key={s} label={s} n={counts[s] || 0} active={stage === s} onClick={() => setFilter(() => setStage(stage === s ? "" : s))} />)}
      </div>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setFilter(() => setQ(e.target.value))} placeholder="Search name, phone, email or project…" className="pl-9" />
          </div>
          <Select value={source} onChange={(e) => setFilter(() => setSource(e.target.value))}>
            <option value="">All sources</option>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Select value={project} onChange={(e) => setFilter(() => setProject(e.target.value))}>
            <option value="">All projects</option>{projects.data?.map((p) => <option key={p}>{p}</option>)}
          </Select>
          <label className="flex items-center gap-2 h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink-3 hover:border-line-strong focus-within:border-accent">
            <span className="whitespace-nowrap">Follow-up</span>
            <input type="date" value={followUp} onChange={(e) => setFilter(() => setFollowUp(e.target.value))} className="flex-1 min-w-0 bg-transparent text-ink outline-none num" />
          </label>
          {me?.isAdmin ? (
            <Select value={agent} onChange={(e) => setFilter(() => setAgent(e.target.value))}>
              <option value="">All agents</option><option value="-">Not assigned</option>
              {staff.data?.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
            </Select>
          ) : <div />}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {due && <Badge tone={due === "overdue" ? "bad" : "warn"}>{due === "today" ? "Follow-ups today" : "Overdue"} <button onClick={() => setFilter(() => setDue(""))} aria-label="Clear"><X size={12} /></button></Badge>}
          <div className="flex-1" />
          <Select value={sort} onChange={(e) => setFilter(() => setSort(e.target.value))} className="w-auto">{SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</Select>
          <Select value={dir} onChange={(e) => setFilter(() => setDir(e.target.value as "asc" | "desc"))} className="w-auto">
            <option value="desc">Newest / Z → A</option><option value="asc">Oldest / A → Z</option>
          </Select>
          {view === "list" && <Button onClick={() => setColsOpen(true)}><Columns3 size={15} /> Columns</Button>}
          {anyFilter && <Button variant="ghost" onClick={() => setFilter(() => { setQ(""); setStage(""); setSource(""); setProject(""); setFollowUp(""); setAgent(""); setDue(""); })}><RotateCcw size={14} /> Reset filters</Button>}
        </div>
      </Card>

      {picked.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-surface p-2.5 shadow-pop animate-in">
          <span className="text-sm font-semibold text-ink px-1">{picked.size} selected</span>
          <Select value="" onChange={(e) => bulkStatus(e.target.value)} className="w-auto"><option value="">Change status…</option>{LEAD_STAGES.map((s) => <option key={s}>{s}</option>)}</Select>
          {me?.isAdmin && <>
            <Select value="" onChange={(e) => e.target.value && bulkAssign(e.target.value === "__none" ? null : e.target.value)} className="w-auto">
              <option value="">Assign to…</option><option value="__none">Not assigned</option>
              {staff.data?.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
            </Select>
            <Button variant="danger" onClick={bulkDelete}><Trash2 size={14} /> Delete</Button>
          </>}
          <Button variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}

      {list.isLoading ? <ListSkeleton /> : list.error ? <Card><Empty title="Couldn’t load leads" hint={(list.error as Error).message} /></Card> : rows.length === 0 ? (
        <Card><Empty icon={<Users2 size={28} />} title="No leads match" hint="Try a different search or clear the filters." /></Card>
      ) : view === "list" ? (
        <>
          <Card className="overflow-hidden">
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2">
                  <tr className="text-left text-xs text-ink-2 border-b border-line">
                    <th className="w-10 pl-4"><input type="checkbox" className="accent-[var(--accent)]" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Select all" /></th>
                    {visible.map((c) => <th key={c.key} className="font-semibold px-2 py-2.5 whitespace-nowrap">{c.label}</th>)}
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody className={cx(list.isPlaceholderData && "opacity-60")}>
                  {rows.map((l) => (
                    <tr key={l.id} className={cx("border-b border-line last:border-0 align-top", picked.has(l.id) ? "bg-accent-soft" : "hover:bg-surface-2/60")}>
                      <td className="pl-4 pt-3.5"><input type="checkbox" className="accent-[var(--accent)]" checked={picked.has(l.id)} onChange={(e) => toggle(l.id, e.target.checked)} aria-label="Select lead" /></td>
                      {visible.map((c) => <td key={c.key} className="px-2 py-2">{cell(l, c.key)}</td>)}
                      <td className="pr-3 py-2"><Button size="sm" onClick={() => openLead(l.id)}>View</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lg:hidden divide-y divide-line">
              {rows.map((l) => (
                <div key={l.id} className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={picked.has(l.id)} onChange={(e) => toggle(l.id, e.target.checked)} aria-label="Select lead" />
                    <button onClick={() => openLead(l.id)} className="flex-1 text-left min-w-0">
                      <div className="font-semibold text-ink">{l.name || "Unnamed"}</div>
                      <div className="text-xs text-ink-3 mt-0.5">{[l.project_inquired, l.budget, l.source].filter(Boolean).join(" · ") || l.phone}</div>
                    </button>
                    <Badge tone={STAGE_TONE[l.status || ""] || "neutral"}>{l.status || "New"}</Badge>
                  </div>
                  {l.notes && <div className="text-[13px] text-ink-2 rounded-lg bg-surface-2 px-3 py-2 line-clamp-3">{l.notes}</div>}
                  {l.follow_up_date && <div className={cx("text-xs", l.follow_up_date < todayDubai() ? "text-bad" : "text-ink-3")}>Follow-up {relative(l.follow_up_date)}</div>}
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <WaButton phone={l.phone} text={leadMessage(template, l)} onContact={() => contact(l)} />
                    <CallButton phone={l.phone} onContact={() => contact(l)} />
                    <CopyButton value={l.phone} compact />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <div className="flex items-center justify-between mt-3 text-sm text-ink-3">
            <span className="num">Showing {page * PAGE + 1}–{Math.min(total, page * PAGE + PAGE)} of {total}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /> Previous</Button>
              <span className="num px-2">{page + 1} / {pages}</span>
              <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={16} /></Button>
            </div>
          </div>
        </>
      ) : (
        <Board rows={rows} onOpen={openLead} onMove={(l, s) => saveField(l, "status", s)} />
      )}

      <Sheet open={colsOpen} onClose={() => setColsOpen(false)} title="Columns" footer={<>
        <Button variant="ghost" className="mr-auto" onClick={() => saveCols(new Set(COLUMNS.filter((c) => c.on).map((c) => c.key)))}>Reset</Button>
        <Button variant="primary" onClick={() => setColsOpen(false)}>Done</Button>
      </>}>
        <div className="grid grid-cols-2 gap-2">
          {COLUMNS.filter((c) => c.key !== "assigned_to" || me?.isAdmin).map((c) => (
            <label key={c.key} className={cx("flex items-center gap-2.5 rounded-lg border px-3 h-10 text-sm cursor-pointer", cols.has(c.key) ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2")}>
              <input type="checkbox" className="accent-[var(--accent)]" checked={cols.has(c.key)} onChange={() => { const n = new Set(cols); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); saveCols(n); }} /> {c.label}
            </label>
          ))}
        </div>
      </Sheet>
      <ProjectsSheet open={projectsOpen} onClose={() => setProjectsOpen(false)} />
      <TemplateSheet open={templateOpen} onClose={() => setTemplateOpen(false)} />
      <LeadSheet id={creating ? "new" : openId} onClose={() => { setCreating(false); openLead(null); }} onCreated={(id) => { setCreating(false); openLead(id); }} />
    </div>
  );

  function cell(l: Lead, k: ColKey) {
    switch (k) {
      case "name": case "phone": case "budget": case "email":
        return <EditCell value={l[k]} onSave={(v) => saveField(l, k, v)} className={cx(k === "name" && "font-medium min-w-36", k === "phone" && "num min-w-32", k === "budget" && "w-24", k === "email" && "min-w-44")} />;
      case "project_inquired": return <EditSelect value={l.project_inquired} options={projects.data || []} onSave={(v) => saveField(l, k, v)} />;
      case "property_type": return <EditSelect value={l[k]} options={PROPERTY_TYPES} onSave={(v) => saveField(l, k, v)} />;
      case "bedroom": return <EditSelect value={l[k]} options={BEDROOMS} onSave={(v) => saveField(l, k, v)} />;
      case "source": return <EditSelect value={l[k]} options={LEAD_SOURCES} onSave={(v) => saveField(l, k, v)} />;
      case "status":
        return (
          <select value={l.status || "New"} onChange={(e) => saveField(l, "status", e.target.value)}
            className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] font-semibold text-ink outline-none focus:border-accent">
            {[...new Set([l.status || "New", ...LEAD_STAGES])].map((s) => <option key={s}>{s}</option>)}
          </select>
        );
      case "notes": return <EditCell value={l.notes} onSave={(v) => saveField(l, "notes", v)} multiline className="min-w-56" />;
      case "lead_receive_date": case "follow_up_date":
        return <input type="date" defaultValue={l[k] || ""} key={l[k] || ""} onBlur={(e) => saveField(l, k, e.target.value)}
          className={cx("h-8 rounded-lg border border-transparent hover:border-line bg-transparent px-2 text-[13px] num outline-none focus:border-accent", k === "follow_up_date" && l.follow_up_date && l.follow_up_date < todayDubai() && !["Won", "Lost"].includes(l.status || "") ? "text-bad" : "text-ink-2")} />;
      case "last_contacted": return <span className="text-ink-2 num leading-8 whitespace-nowrap">{fmtDate(l.last_contacted)}</span>;
      case "assigned_to": return <span className="text-ink-2 leading-8 whitespace-nowrap">{staffName(staff.data, l.assigned_to)}</span>;
      case "whatsapp":
        return <div className="flex gap-1.5"><WaButton phone={l.phone} text={leadMessage(template, l)} onContact={() => contact(l)} compact /><CallButton phone={l.phone} onContact={() => contact(l)} compact /><CopyButton value={l.phone} compact /></div>;
    }
  }
}

/** Click-to-edit text; saves on blur or Enter (Esc cancels). */
function EditCell({ value, onSave, multiline, className }: { value: string | null; onSave: (v: string) => void; multiline?: boolean; className?: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const base = "w-full rounded-lg border border-transparent hover:border-line bg-transparent px-2 text-[13px] text-ink outline-none focus:border-accent focus:bg-surface transition-colors";
  if (multiline) return <textarea value={v} rows={2} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} onKeyDown={(e) => { if (e.key === "Escape") { setV(value ?? ""); (e.target as HTMLElement).blur(); } }} className={cx(base, "py-1.5 resize-y leading-snug min-h-8", className)} placeholder="Add notes" />;
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLElement).blur(); if (e.key === "Escape") { setV(value ?? ""); (e.target as HTMLElement).blur(); } }} className={cx(base, "h-8", className)} />;
}
function EditSelect({ value, options, onSave }: { value: string | null; options: string[]; onSave: (v: string) => void }) {
  return (
    <select value={value || ""} onChange={(e) => onSave(e.target.value)}
      className="h-8 max-w-48 rounded-lg border border-transparent hover:border-line bg-transparent px-2 text-[13px] text-ink-2 outline-none focus:border-accent">
      <option value="">—</option>
      {value && !options.includes(value) && <option>{value}</option>}
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

function ProjectsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const list = useQuery({ queryKey: ["projects-admin"], enabled: open, queryFn: async () => ((await db.from("crm_projects").select("id,name").order("name")).data || []) as { id: number; name: string }[] });
  const done = () => { qc.invalidateQueries({ queryKey: ["projects"] }); qc.invalidateQueries({ queryKey: ["projects-admin"] }); };
  return (
    <Sheet open={open} onClose={onClose} title="Projects">
      <div className="flex gap-2 mb-4">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name, e.g. Farm Gardens" />
        <Button variant="primary" onClick={async () => {
          if (!name.trim()) return;
          const { error } = await db.from("crm_projects").insert({ name: name.trim() });
          if (error) { toast(error.code === "23505" ? "Already exists" : error.message); return; }
          setName(""); toast("Added"); done();
        }}>Add</Button>
      </div>
      <div className="rounded-xl border border-line divide-y divide-line">
        {list.data?.map((p) => (
          <div key={p.id} className="flex items-center px-3 h-11 text-sm">
            <span className="flex-1 text-ink">{p.name}</span>
            <button className="p-1.5 rounded-md text-ink-3 hover:text-bad hover:bg-bad-soft" title="Remove from the list (leads keep the name)"
              onClick={async () => { if (!confirm(`Remove "${p.name}" from the project list? Existing leads keep the project name.`)) return; await db.from("crm_projects").delete().eq("id", p.id); done(); }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function StageChip({ label, n, active, onClick }: { label: string; n?: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx(
      "shrink-0 h-8 px-3 rounded-full border text-[13px] font-medium transition-colors inline-flex items-center gap-1.5",
      active ? "bg-accent text-on-accent border-accent" : "bg-surface border-line text-ink-2 hover:border-line-strong",
    )}>
      {label}{n != null && <span className={cx("num text-xs", active ? "opacity-80" : "text-ink-3")}>{n}</span>}
    </button>
  );
}

function Board({ rows, onOpen, onMove }: { rows: Lead[]; onOpen: (id: string) => void; onMove: (l: Lead, s: string) => void }) {
  const byStage = useMemo(() => {
    const m: Record<string, Lead[]> = {};
    for (const s of LEAD_STAGES) m[s] = [];
    for (const r of rows) (m[r.status || "New"] ||= []).push(r);
    return m;
  }, [rows]);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
      {LEAD_STAGES.map((s) => (
        <div key={s}
          onDragOver={(e) => { e.preventDefault(); setOver(s); }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); const l = rows.find((r) => r.id === e.dataTransfer.getData("text/plain")); if (l) onMove(l, s); }}
          className={cx("w-72 shrink-0 rounded-xl bg-surface-2 border p-2 snap-start transition-colors", over === s ? "border-accent" : "border-line")}>
          <div className="flex items-center justify-between px-1.5 py-1 mb-1">
            <span className="text-[13px] font-semibold text-ink">{s}</span>
            <span className="text-xs text-ink-3 num">{byStage[s]?.length || 0}</span>
          </div>
          <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
            {byStage[s]?.map((l) => (
              <div key={l.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)} onClick={() => onOpen(l.id)}
                className="rounded-lg bg-surface border border-line p-2.5 cursor-pointer hover:border-line-strong shadow-card">
                <div className="text-sm font-medium text-ink truncate">{l.name || "Unnamed"}</div>
                <div className="text-xs text-ink-3 truncate mt-0.5">{[l.project_inquired, l.budget].filter(Boolean).join(" · ") || l.phone}</div>
                {l.follow_up_date && <div className={cx("text-xs mt-1.5", l.follow_up_date < todayDubai() ? "text-bad" : "text-ink-3")}>Follow-up {relative(l.follow_up_date)}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
