"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Users2, ChevronLeft, ChevronRight, Phone } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { LEAD_STAGES, STAGE_TONE, type Lead, logLeadActivity } from "@/lib/crm";
import { useDebounced, useStaff, staffName, useProjects } from "@/lib/hooks";
import { orSafe } from "@/components/shell/CommandPalette";
import { Badge, Button, Card, Empty, Input, ListSkeleton, PageHeader, Segmented, Select, cx } from "@/components/ui";
import { fmtDate, relative, todayDubai } from "@/lib/format";
import { LeadSheet } from "./LeadSheet";

const PAGE = 50;

export default function LeadsPage() {
  return <Suspense><Leads /></Suspense>;
}

function Leads() {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("open");
  const qc = useQueryClient();
  const staff = useStaff();
  const projects = useProjects();

  const [view, setView] = useState<"list" | "board">("list");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [project, setProject] = useState("");
  const [agent, setAgent] = useState("");
  const [due, setDue] = useState<"" | "today" | "overdue">("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = orSafe(useDebounced(q, 250));

  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => (await db.rpc("crm_dashboard_stats")).data as { lead_status: Record<string, number>; leads: { total: number; followups_today: number; followups_overdue: number } } | null,
  });

  const filters = { term, stage, project, agent, due };
  const list = useQuery({
    queryKey: ["leads", view, filters, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = db.from("leads").select("*", { count: "exact" });
      if (term) {
        const digits = term.replace(/\D/g, "");
        const or = [`name.ilike.%${term}%`, `project_inquired.ilike.%${term}%`, `email.ilike.%${term}%`];
        if (digits.length >= 3) or.push(`phone.ilike.%${digits}%`);
        query = query.or(or.join(","));
      }
      if (stage && view === "list") query = query.eq("status", stage);
      if (project) query = query.eq("project_inquired", project);
      if (agent) query = agent === "-" ? query.is("assigned_to", null) : query.ilike("assigned_to", agent);
      const today = todayDubai();
      if (due === "today") query = query.eq("follow_up_date", today);
      if (due === "overdue") query = query.lt("follow_up_date", today).not("status", "in", "(Won,Lost)");
      query = query.order("created_at", { ascending: false });
      query = view === "list" ? query.range(page * PAGE, page * PAGE + PAGE - 1) : query.limit(600);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data || []) as Lead[], count: count || 0 };
    },
  });

  const rows = list.data?.rows || [];
  const total = list.data?.count || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  function setFilter(fn: () => void) { fn(); setPage(0); }
  function openLead(id: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("open", id); else sp.delete("open");
    router.replace(`/leads${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }

  async function moveStage(lead: Lead, to: string) {
    if (lead.status === to || !me) return;
    qc.setQueryData(["leads", view, filters, page], (old: typeof list.data) => old && { ...old, rows: old.rows.map((r) => r.id === lead.id ? { ...r, status: to } : r) });
    const { error } = await db.from("leads").update({ status: to, last_contacted: todayDubai() }).eq("id", lead.id);
    if (!error) await logLeadActivity(lead.id, "Status Change", `Status changed from ${lead.status || "-"} to ${to}.`, me.email);
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  }

  const counts = stats.data?.lead_status || {};

  return (
    <div className="animate-in">
      <PageHeader
        title="Leads"
        subtitle={stats.data ? <>{stats.data.leads.total} leads · <button className="hover:text-ink" onClick={() => setFilter(() => setDue(due === "today" ? "" : "today"))}>{stats.data.leads.followups_today} follow-ups today</button> · <button className="text-bad hover:underline" onClick={() => setFilter(() => setDue(due === "overdue" ? "" : "overdue"))}>{stats.data.leads.followups_overdue} overdue</button></> : " "}
        actions={<>
          <Segmented value={view} onChange={setView} options={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]} />
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Add lead</Button>
        </>}
      />

      {view === "list" && (
        <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1 mb-1">
          <StageChip label="All" n={stats.data?.leads.total} active={!stage} onClick={() => setFilter(() => setStage(""))} />
          {LEAD_STAGES.map((s) => <StageChip key={s} label={s} n={counts[s] || 0} active={stage === s} onClick={() => setFilter(() => setStage(stage === s ? "" : s))} />)}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search name, phone, project…" className="pl-9" />
        </div>
        <Select value={project} onChange={(e) => setFilter(() => setProject(e.target.value))} className="w-auto min-w-40">
          <option value="">All projects</option>
          {projects.data?.map((p) => <option key={p}>{p}</option>)}
        </Select>
        {me?.isAdmin && (
          <Select value={agent} onChange={(e) => setFilter(() => setAgent(e.target.value))} className="w-auto min-w-36">
            <option value="">All agents</option>
            <option value="-">Unassigned</option>
            {staff.data?.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
          </Select>
        )}
        {due && <Button variant="ghost" onClick={() => setFilter(() => setDue(""))}>{due === "today" ? "Due today" : "Overdue"} ✕</Button>}
      </div>

      {list.isLoading ? <ListSkeleton /> : rows.length === 0 ? (
        <Card><Empty icon={<Users2 size={28} />} title="No leads match" hint="Try a different search or clear the filters." /></Card>
      ) : view === "list" ? (
        <>
          <Card className="overflow-hidden">
            {/* Desktop table */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-3 border-b border-line">
                  <th className="font-medium px-4 py-2.5">Name</th>
                  <th className="font-medium px-3 py-2.5">Stage</th>
                  <th className="font-medium px-3 py-2.5">Project</th>
                  <th className="font-medium px-3 py-2.5">Budget</th>
                  <th className="font-medium px-3 py-2.5">Follow-up</th>
                  {me?.isAdmin && <th className="font-medium px-3 py-2.5">Agent</th>}
                  <th className="font-medium px-3 py-2.5">Source</th>
                </tr>
              </thead>
              <tbody className={cx(list.isPlaceholderData && "opacity-60")}>
                {rows.map((l) => (
                  <tr key={l.id} onClick={() => openLead(l.id)} className="border-b border-line last:border-0 hover:bg-surface-2 cursor-pointer">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink">{l.name || "Unnamed"}</div>
                      <div className="text-xs text-ink-3 num">{l.phone}</div>
                    </td>
                    <td className="px-3 py-2.5"><Badge tone={STAGE_TONE[l.status || ""] || "neutral"}>{l.status || "—"}</Badge></td>
                    <td className="px-3 py-2.5 text-ink-2 max-w-48 truncate">{l.project_inquired || "—"}</td>
                    <td className="px-3 py-2.5 text-ink-2 num">{l.budget || "—"}</td>
                    <td className={cx("px-3 py-2.5 num", l.follow_up_date && l.follow_up_date < todayDubai() && !["Won", "Lost"].includes(l.status || "") ? "text-bad" : "text-ink-2")}>{relative(l.follow_up_date)}</td>
                    {me?.isAdmin && <td className="px-3 py-2.5 text-ink-2">{staffName(staff.data, l.assigned_to)}</td>}
                    <td className="px-3 py-2.5 text-ink-3">{l.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Phone cards */}
            <div className="md:hidden divide-y divide-line">
              {rows.map((l) => (
                <button key={l.id} onClick={() => openLead(l.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-surface-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="font-medium text-ink truncate">{l.name || "Unnamed"}</span><Badge tone={STAGE_TONE[l.status || ""] || "neutral"}>{l.status}</Badge></div>
                    <div className="text-xs text-ink-3 truncate mt-0.5">{[l.project_inquired, l.budget, l.follow_up_date && `follow-up ${relative(l.follow_up_date)}`].filter(Boolean).join(" · ") || fmtDate(l.created_at)}</div>
                  </div>
                  {l.phone && <a href={`tel:${l.phone}`} onClick={(e) => e.stopPropagation()} className="p-2 rounded-full bg-surface-2 text-ink-2"><Phone size={16} /></a>}
                </button>
              ))}
            </div>
          </Card>
          <div className="flex items-center justify-between mt-3 text-sm text-ink-3">
            <span>{page * PAGE + 1}–{Math.min(total, page * PAGE + PAGE)} of {total}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></Button>
              <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></Button>
            </div>
          </div>
        </>
      ) : (
        <Board rows={rows} onOpen={openLead} onMove={moveStage} />
      )}

      <LeadSheet id={creating ? "new" : openId} onClose={() => { setCreating(false); openLead(null); }} onCreated={(id) => { setCreating(false); openLead(id); }} />
    </div>
  );
}

function StageChip({ label, n, active, onClick }: { label: string; n?: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx(
      "shrink-0 h-8 px-3 rounded-full border text-[13px] transition-colors inline-flex items-center gap-1.5",
      active ? "bg-ink text-bg border-ink" : "bg-surface border-line text-ink-2 hover:border-line-strong",
    )}>
      {label}{n != null && <span className={cx("num text-xs", active ? "opacity-70" : "text-ink-3")}>{n}</span>}
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
          className={cx("w-72 shrink-0 rounded-xl bg-surface-2/60 border p-2 snap-start transition-colors", over === s ? "border-accent" : "border-line")}>
          <div className="flex items-center justify-between px-1.5 py-1 mb-1">
            <span className="text-[13px] font-medium text-ink">{s}</span>
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
