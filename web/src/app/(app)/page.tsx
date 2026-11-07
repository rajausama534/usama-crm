"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Handshake, Landmark, BadgeCheck, Inbox } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { LEAD_STAGES } from "@/lib/crm";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Card, Skeleton, Stat, cx } from "@/components/ui";
import { count, fmtTime } from "@/lib/format";

type Stats = {
  owners: { records: number; units: number; contacted_7d: number; contacted_30d: number };
  owner_status: Record<string, number>;
  leads: { total: number; new_7d: number; followups_today: number; followups_overdue: number };
  lead_status: Record<string, number>;
  lead_source: Record<string, number>;
  leads_by_week: { week: string; n: number }[];
};
type TodayEv = { id: string; title: string; event_type: string; starts_at: string; lead_id: string | null; assigned_to: string; leads: { name: string | null } | null };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Dubai" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { me } = useAuth();
  const staff = useStaff();
  const stats = useQuery({ queryKey: ["dashboard-stats"], queryFn: async () => (await db.rpc("crm_dashboard_stats")).data as Stats });

  const today = useQuery({
    queryKey: ["events", "today"],
    queryFn: async () => {
      const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
      const { data } = await db.from("crm_events").select("id,title,event_type,starts_at,lead_id,assigned_to,leads(name)")
        .eq("status", "Scheduled").gte("starts_at", `${d}T00:00:00+04:00`).lte("starts_at", `${d}T23:59:59+04:00`).order("starts_at");
      return (data || []) as unknown as TodayEv[];
    },
  });

  // Per-agent pipeline (admins and team leaders see everyone they can see; RLS decides).
  const team = useQuery({
    queryKey: ["team-pipeline"],
    enabled: !!me && (me.isAdmin || me.role === "team_leader"),
    queryFn: async () => {
      const { data } = await db.from("leads").select("assigned_to,status").limit(5000);
      const m = new Map<string, { total: number; active: number; won: number; lost: number }>();
      for (const r of data || []) {
        const k = (r.assigned_to || "").toLowerCase();
        const e = m.get(k) || { total: 0, active: 0, won: 0, lost: 0 };
        e.total++; if (r.status === "Won") e.won++; else if (r.status === "Lost") e.lost++; else e.active++;
        m.set(k, e);
      }
      return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
    },
  });

  const s = stats.data;
  const pipeline = LEAD_STAGES.map((st) => ({ stage: st, n: s?.lead_status[st] || 0 }));
  const maxStage = Math.max(1, ...pipeline.map((p) => p.n));

  return (
    <div className="animate-in space-y-6">
      <div>
        <h1 className="text-[24px] font-normal tracking-tight text-ink-2 leading-tight">{greeting()}, {me?.name?.split(" ")[0]}</h1>
        <p className="text-sm text-ink-2 mt-1">{me?.isSuperAdmin ? "Here’s the whole company today." : "Here’s your day."}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {s ? <>
          <Stat label="Active leads" value={count(s.leads.total - (s.lead_status.Won || 0) - (s.lead_status.Lost || 0))} hint={`${count(s.leads.new_7d)} new this week`} />
          <Stat label="Follow-ups today" value={count(s.leads.followups_today)} hint={<Link href="/leads" className="hover:text-ink">Open leads →</Link>} />
          <Stat label="Overdue follow-ups" value={count(s.leads.followups_overdue)} tone={s.leads.followups_overdue ? "bad" : undefined} hint="Past their follow-up date" />
          <Stat label="Owners contacted (30 days)" value={count(s.owners.contacted_30d)} hint={`of ${count(s.owners.records)} owner records`} />
        </> : Array.from({ length: 4 }).map((_, i) => <Card key={i} className="p-4 space-y-3"><Skeleton className="w-24" /><Skeleton className="h-7 w-16" /></Card>)}
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-ink">Lead pipeline</div>
            <Link href="/leads" className="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1">All leads <ArrowRight size={12} /></Link>
          </div>
          <div className="space-y-2">
            {pipeline.map((p) => (
              <Link key={p.stage} href="/leads" className="group grid grid-cols-[120px_1fr_40px] items-center gap-3 text-sm">
                <span className="text-ink-2 truncate group-hover:text-ink">{p.stage}</span>
                <span className="h-5 rounded-r bg-surface-2 overflow-hidden">
                  <span className={cx("block h-full rounded-r transition-[width] duration-500", p.stage === "Won" ? "bg-good" : p.stage === "Lost" ? "bg-ink-3/50" : "bg-accent")}
                    style={{ width: `${(p.n / maxStage) * 100}%`, minWidth: p.n ? 4 : 0 }} title={`${p.stage}: ${p.n}`} />
                </span>
                <span className="text-right num text-ink">{p.n}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-ink flex items-center gap-2"><CalendarClock size={16} className="text-ink-3" /> Today</div>
            <Link href="/calendar" className="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1">Calendar <ArrowRight size={12} /></Link>
          </div>
          {today.isLoading ? <div className="space-y-3"><Skeleton /><Skeleton /></div> : !today.data?.length ? (
            <div className="text-sm text-ink-3 py-6 text-center">Nothing scheduled for today.</div>
          ) : (
            <div className="space-y-1">
              {today.data.map((e) => (
                <Link key={e.id} href={e.lead_id ? `/leads?open=${e.lead_id}` : "/calendar"} className="flex items-center gap-3 rounded-lg px-2 py-2 -mx-2 hover:bg-surface-2">
                  <span className="text-xs num text-ink-3 w-10">{fmtTime(e.starts_at)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink truncate">{e.leads?.name || e.title}</span>
                    <span className="block text-xs text-ink-3 truncate">{e.event_type}{me?.isAdmin ? ` · ${staffName(staff.data, e.assigned_to)}` : ""}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {s && <WeeklyLeads data={s.leads_by_week} />}
        {team.data && team.data.length > 0 && (
          <Card className="p-5">
            <div className="text-sm font-semibold text-ink mb-4">Team</div>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink-3 text-left"><th className="font-medium pb-2">Agent</th><th className="font-medium pb-2 text-right">Active</th><th className="font-medium pb-2 text-right">Won</th><th className="font-medium pb-2 text-right">Lost</th></tr></thead>
              <tbody>
                {team.data.map(([email, v]) => (
                  <tr key={email} className="border-t border-line">
                    <td className="py-2 text-ink">{staffName(staff.data, email || null)}</td>
                    <td className="py-2 text-right num text-ink">{v.active}</td>
                    <td className="py-2 text-right num">{v.won ? <Badge tone="good">{v.won}</Badge> : <span className="text-ink-3">0</span>}</td>
                    <td className="py-2 text-right num text-ink-3">{v.lost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {me?.isSuperAdmin && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-2">Coming to this dashboard</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: Inbox, t: "Approvals", d: "Deals, expenses, leave and listings waiting for you", href: "/approvals" },
              { icon: Handshake, t: "Deals & commission", d: "Revenue, company share, owed to agents — Step 2" },
              { icon: Landmark, t: "Cash & VAT", d: "Bank, cash forecast, VAT due, profit — Step 3" },
              { icon: BadgeCheck, t: "Staff", d: "Payroll, leave, expiring documents — Step 4" },
            ].map((x) => {
              const body = (
                <Card className={cx("p-4 h-full", x.href ? "hover:border-line-strong transition-colors" : "border-dashed shadow-none bg-transparent")}>
                  <x.icon size={18} className="text-ink-3" />
                  <div className="text-sm font-medium text-ink mt-2">{x.t}</div>
                  <div className="text-xs text-ink-3 mt-0.5">{x.d}</div>
                </Card>
              );
              return x.href ? <Link key={x.t} href={x.href}>{body}</Link> : <div key={x.t}>{body}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** New leads per week (last 12 weeks), single series: bars + hover value. */
function WeeklyLeads({ data }: { data: { week: string; n: number }[] }) {
  const weeks = useMemo(() => {
    // Fill empty weeks so the time axis is continuous.
    const out: { week: string; n: number }[] = [];
    const byWeek = new Map(data.map((d) => [d.week, d.n]));
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
    for (let i = 11; i >= 0; i--) {
      const d = new Date(monday); d.setUTCDate(monday.getUTCDate() - i * 7);
      const k = d.toISOString().slice(0, 10);
      out.push({ week: k, n: byWeek.get(k) || 0 });
    }
    return out;
  }, [data]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.n));
  const label = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const total = weeks.reduce((a, w) => a + w.n, 0);
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-sm font-semibold text-ink">New leads per week</div>
        <div className="text-xs text-ink-3 num">{hover != null ? `Week of ${label(weeks[hover].week)}: ${weeks[hover].n}` : `${total} in 12 weeks`}</div>
      </div>
      <div className="relative h-36 flex items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)}>
        {weeks.map((w, i) => (
          <div key={w.week} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)}>
            <div className={cx("w-full rounded-t-[4px] transition-colors", hover === i ? "bg-accent-hover" : "bg-accent")}
              style={{ height: `${(w.n / max) * 100}%`, minHeight: w.n ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-ink-3 mt-1.5 num"><span>{label(weeks[0].week)}</span><span>{label(weeks[11].week)}</span></div>
    </Card>
  );
}
