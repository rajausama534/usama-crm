"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowRight, ArrowUpRight, BadgeCheck, CalendarClock, Handshake, Inbox, Landmark, PhoneCall, UsersRound, Home } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { canUseSales } from "@/lib/access";
import { visibleNav } from "@/components/shell/nav";
import { LEAD_STAGES } from "@/lib/crm";
import { useStaff, staffName } from "@/lib/hooks";
import { Avatar, Badge, Card, CountUp, Segmented, Skeleton, Stat, buttonClass, cx } from "@/components/ui";
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
  if (me && !canUseSales(me)) return <DepartmentHome />;
  return <SalesDashboard />;
}

/** Home for people outside Sales: only the pages of their own department. */
function DepartmentHome() {
  const { me } = useAuth();
  const items = me ? visibleNav(me).flatMap((s) => s.items).filter((i) => i.href !== "/") : [];
  return (
    <div className="space-y-5">
      <div className="animate-in">
        <h1 className="text-[30px] font-light tracking-tight text-ink leading-tight">{greeting()}, {me?.name?.split(" ")[0]}</h1>
        <p className="text-sm text-ink-2 mt-1">Your department.</p>
      </div>
      <div className="stagger grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map((x) => (
          <Link key={x.href} href={x.href}>
            <Card className="lift p-4 h-full hover:border-line-strong">
              <x.icon size={18} className="text-ink-3" />
              <div className="text-sm font-medium text-ink mt-2">{x.label}</div>
              {x.soon && <div className="text-xs text-ink-3 mt-0.5">Coming soon</div>}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SalesDashboard() {
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
  const needAttention = s ? s.leads.followups_today + s.leads.followups_overdue : 0;

  return (
    <div className="space-y-5">
      <div className="animate-in flex flex-wrap items-end justify-between gap-3 pb-1">
        <div>
          <h1 className="text-[30px] font-light tracking-tight text-ink leading-tight">{greeting()}, {me?.name?.split(" ")[0]}</h1>
          <p className="text-sm text-ink-2 mt-1">
            {s ? (needAttention ? <>{count(needAttention)} follow-up{needAttention === 1 ? "" : "s"} need attention today.</> : "Nothing needs you right now.") : me?.isSuperAdmin ? "Here’s the whole company today." : "Here’s your day."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/calendar" className={buttonClass("secondary")}><CalendarClock size={15} /> Calendar</Link>
          <Link href="/leads" className={buttonClass("primary")}>Open leads <ArrowRight size={15} /></Link>
        </div>
      </div>

      <div className={cx("grid grid-cols-2 lg:grid-cols-4 gap-3", s ? "kpi-strip stagger" : "")}>
        {s ? <>
          <Stat icon={<UsersRound size={13} />} label="Active leads" value={count(s.leads.total - (s.lead_status.Won || 0) - (s.lead_status.Lost || 0))}
            delta={s.leads.new_7d ? <Badge tone="good">+{count(s.leads.new_7d)}</Badge> : undefined} hint={s.leads.new_7d ? `${count(s.leads.new_7d)} new this week` : "Not counting won or lost"} />
          <Stat icon={<PhoneCall size={13} />} label="Follow-ups today" value={count(s.leads.followups_today)} hint={<Link href="/leads" className="hover:text-ink transition-colors">Open leads →</Link>} />
          <Stat icon={<AlarmClock size={13} />} label="Overdue follow-ups" value={count(s.leads.followups_overdue)} tone={s.leads.followups_overdue ? "bad" : undefined} hint="Past their follow-up date" />
          <Stat icon={<Home size={13} />} label="Owners contacted (30 days)" value={count(s.owners.contacted_30d)} hint={`of ${count(s.owners.records)} owner records`} />
        </> : Array.from({ length: 4 }).map((_, i) => <Card key={i} className="p-5 space-y-3"><Skeleton className="w-24" /><Skeleton className="h-8 w-16" /></Card>)}
      </div>

      <div className="stagger grid lg:grid-cols-[1.55fr_1fr] gap-5">
        {s ? <WeeklyLeads data={s.leads_by_week} /> : <Card className="p-5 h-72"><Skeleton className="w-40" /></Card>}
        {s ? <OwnerCoverage contacted={s.owners.contacted_30d} total={s.owners.records} week={s.owners.contacted_7d} /> : <Card className="p-5 h-72"><Skeleton className="w-40" /></Card>}
      </div>

      <div className="stagger grid lg:grid-cols-[1fr_1.15fr_0.9fr] gap-5">
        <Card className="p-5">
          <CardTitle title="Lead pipeline" href="/leads" link="All leads" />
          <div className="space-y-2">
            {pipeline.map((p, i) => (
              <Link key={p.stage} href="/leads" className="group grid grid-cols-[112px_1fr_36px] items-center gap-3 text-[13px]">
                <span className="text-ink-2 truncate group-hover:text-ink transition-colors">{p.stage}</span>
                <span className="h-4 rounded-full bg-surface-2 overflow-hidden">
                  <span className={cx("grow-x block h-full rounded-full", p.stage === "Won" ? "bg-good" : p.stage === "Lost" ? "bg-ink-3/50" : "bg-accent")}
                    style={{ width: `${(p.n / maxStage) * 100}%`, minWidth: p.n ? 6 : 0, ["--i" as string]: i }} title={`${p.stage}: ${p.n}`} />
                </span>
                <span className="text-right num text-ink">{p.n}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <CardTitle title="Today" badge={today.data?.length ? String(today.data.length) : undefined} href="/calendar" link="Calendar" />
          {today.isLoading ? <div className="space-y-3"><Skeleton /><Skeleton /></div> : !today.data?.length ? (
            <div className="text-sm text-ink-3 py-10 text-center">Nothing scheduled for today.</div>
          ) : (
            <div className="space-y-0.5">
              {today.data.map((e) => (
                <Link key={e.id} href={e.lead_id ? `/leads?open=${e.lead_id}` : "/calendar"} className="flex items-center gap-3 rounded-xl px-2 py-2 -mx-2 hover:bg-surface-2 transition-colors">
                  <Avatar name={e.leads?.name || e.title} size={32} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-ink truncate">{e.leads?.name || e.title}</span>
                    <span className="block text-xs text-ink-3 truncate">{e.event_type}{me?.isAdmin ? ` · ${staffName(staff.data, e.assigned_to)}` : ""}</span>
                  </span>
                  <span className="text-xs num text-ink-2">{fmtTime(e.starts_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {s ? <FocusCard overdue={s.leads.followups_overdue} todayCount={s.leads.followups_today} /> : <Card className="p-5 h-64"><Skeleton className="w-32" /></Card>}
      </div>

      <div className="stagger grid lg:grid-cols-[1fr_1.4fr] gap-5">
        {s && <LeadSources data={s.lead_source} />}
        {team.data && team.data.length > 0 && (
          <Card className="p-5 overflow-x-auto">
            <CardTitle title="Team" />
            <table className="w-full text-[13px]">
              <thead><tr className="text-xs text-ink-3 text-left"><th className="font-medium pb-2">Agent</th><th className="font-medium pb-2 text-right">Active</th><th className="font-medium pb-2 text-right">Won</th><th className="font-medium pb-2 text-right">Lost</th></tr></thead>
              <tbody>
                {team.data.map(([email, v]) => {
                  const name = staffName(staff.data, email || null);
                  return (
                    <tr key={email} className="border-t border-line">
                      <td className="py-2"><span className="flex items-center gap-2.5 text-ink"><Avatar name={name} size={26} /> <span className="truncate">{name}</span></span></td>
                      <td className="py-2 text-right num text-ink">{v.active}</td>
                      <td className="py-2 text-right num">{v.won ? <Badge tone="good">{v.won}</Badge> : <span className="text-ink-3">0</span>}</td>
                      <td className="py-2 text-right num text-ink-3">{v.lost}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {me?.isSuperAdmin && (
        <div>
          <div className="text-xs font-medium text-ink-3 mb-2">Coming to this dashboard</div>
          <div className="stagger grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: Inbox, t: "Approvals", d: "Deals, expenses, leave and listings waiting for you", href: "/approvals" },
              { icon: Handshake, t: "Deals & commission", d: "Revenue, company share, owed to agents — Step 2" },
              { icon: Landmark, t: "Cash & VAT", d: "Bank, cash forecast, VAT due, profit — Step 3" },
              { icon: BadgeCheck, t: "Staff", d: "Payroll, leave, expiring documents — Step 4" },
            ].map((x) => {
              const body = (
                <Card className={cx("p-4 h-full", x.href ? "lift hover:border-line-strong" : "border-dashed shadow-none bg-transparent")}>
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

function CardTitle({ title, badge, href, link }: { title: string; badge?: string; href?: string; link?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="text-sm font-medium text-ink flex items-center gap-2">{title}{badge && <Badge tone="warn">{badge}</Badge>}</div>
      {href && <Link href={href} className="text-xs text-ink-3 hover:text-ink transition-colors inline-flex items-center gap-1">{link} <ArrowRight size={12} /></Link>}
    </div>
  );
}

/** Smooth curve through points (Catmull-Rom turned into beziers). */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** New leads per week: bars, a smooth line over them, and a glass tooltip. */
function WeeklyLeads({ data }: { data: { week: string; n: number }[] }) {
  const all = useMemo(() => {
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
  const [range, setRange] = useState<"4" | "8" | "12">("12");
  const weeks = all.slice(-Number(range));
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.n));
  const label = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const total = weeks.reduce((a, w) => a + w.n, 0);
  const pts = weeks.map((w, i): [number, number] => [((i + 0.5) / weeks.length) * 100, 100 - (w.n / max) * 86 - 6]);
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1][0]},100 L${pts[0][0]},100 Z`;
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(weeks.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * weeks.length))));
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-sm font-medium text-ink">New leads per week</div>
          <div className="mt-1 flex items-baseline gap-2"><span className="text-[22px] font-light num text-ink leading-none"><CountUp key={range} value={count(total)} /></span><span className="text-xs text-ink-3">in {range} weeks</span></div>
        </div>
        <Segmented value={range} onChange={(v) => { setRange(v); setHover(null); }} options={[{ value: "4", label: "4W" }, { value: "8", label: "8W" }, { value: "12", label: "12W" }]} />
      </div>
      <div key={range} className="relative h-44 touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <div className="absolute inset-0 flex items-end gap-1.5">
          {weeks.map((w, i) => (
            <div key={w.week} className="flex-1 h-full flex items-end">
              <div className="grow-y w-full rounded-t-lg transition-[background-color] duration-200"
                style={{ height: `${Math.max(6, (w.n / max) * 92)}%`, background: hover === i ? "var(--chart-bar-on)" : "var(--chart-bar)", ["--i" as string]: i }} />
            </div>
          ))}
        </div>
        <svg className="wipe absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="wk-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.26" /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient>
          </defs>
          <path d={area} fill="url(#wk-fill)" className="scrim-in" />
          <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="2.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover != null && (
          <>
            <span className="absolute size-2.5 rounded-full border-2 border-surface bg-accent -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: `${pts[hover][0]}%`, top: `${pts[hover][1]}%` }} />
            <div className="chart-tip absolute top-1 -translate-x-1/2 rounded-xl border border-line-strong px-3 py-2 text-xs shadow-pop pointer-events-none whitespace-nowrap"
              style={{ left: `${Math.min(84, Math.max(16, pts[hover][0]))}%` }}>
              <div className="text-ink-3">Week of {label(weeks[hover].week)}</div>
              <div className="mt-0.5 font-medium text-ink num">{weeks[hover].n} new lead{weeks[hover].n === 1 ? "" : "s"}</div>
            </div>
          </>
        )}
      </div>
      <div className="flex justify-between text-[11px] text-ink-3 mt-2 num"><span>{label(weeks[0].week)}</span><span>{label(weeks[weeks.length - 1].week)}</span></div>
    </Card>
  );
}

/** Half-round gauge: tick marks in dark mode, a solid arc in light mode. */
function Gauge({ ratio }: { ratio: number }) {
  const n = 41, start = 200, sweep = 220;
  const on = Math.round(ratio * (n - 1));
  const cx0 = 120, cy0 = 112;
  const polar = (deg: number, r: number) => [cx0 + r * Math.cos((deg * Math.PI) / 180), cy0 - r * Math.sin((deg * Math.PI) / 180)];
  const [ax, ay] = polar(start, 92), [bx, by] = polar(start - sweep, 92);
  const arc = `M${ax},${ay} A92,92 0 1 1 ${bx},${by}`;
  return (
    <svg viewBox="0 0 240 150" className="w-full max-w-[280px]" aria-hidden>
      <g className="only-dark">
        {Array.from({ length: n }).map((_, i) => {
          const deg = start - (i / (n - 1)) * sweep;
          const [x1, y1] = polar(deg, 80), [x2, y2] = polar(deg, 104);
          const lit = i <= on;
          const tip = i === on;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={3.4} strokeLinecap="round"
            stroke={tip ? "var(--chart-3)" : lit ? (i < 3 ? "var(--chart-1)" : "var(--gauge-on)") : "var(--gauge-off)"} className={lit ? "tick" : undefined} style={{ ["--i" as string]: i }} />;
        })}
      </g>
      <g className="only-light" fill="none" strokeLinecap="round" strokeWidth={13}>
        <path d={arc} stroke="var(--gauge-off)" />
        <path d={arc} stroke="var(--gauge-on)" pathLength={100} className="dash-in" style={{ ["--dash" as string]: ratio * 100 }} strokeDasharray={`${ratio * 100} 100`} />
      </g>
    </svg>
  );
}

function OwnerCoverage({ contacted, total, week }: { contacted: number; total: number; week: number }) {
  const ratio = total ? Math.min(1, contacted / total) : 0;
  const pct = Math.round(ratio * 100);
  return (
    <Card className="p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-ink">Owner coverage</div>
        <Link href="/owners" aria-label="Open owners" className="p-1.5 -m-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"><ArrowUpRight size={15} /></Link>
      </div>
      <div className="flex-1 grid grid-cols-[1fr_auto] gap-4 items-center">
        <div className="relative grid place-items-center">
          <Gauge ratio={ratio} />
          <div className="absolute top-[46%] left-0 right-0 text-center -translate-y-1/2">
            <div className="text-[34px] font-light num text-ink leading-none"><CountUp value={`${pct}%`} /></div>
            <div className="text-[11px] text-ink-3 mt-1.5 num">{count(contacted)} of {count(total)}</div>
          </div>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3.5 w-[112px]">
          <div className="text-[11px] text-ink-3">This week</div>
          <div className="text-xl font-light text-gold num mt-0.5"><CountUp value={count(week)} /></div>
          <div className="text-[11px] text-ink-3 mt-3">Still to call</div>
          <div className="text-xl font-light text-ink num mt-0.5"><CountUp value={count(Math.max(0, total - contacted))} /></div>
        </div>
      </div>
      <div className="text-xs text-ink-3 mt-2">Owners called in the last 30 days.</div>
    </Card>
  );
}

function FocusCard({ overdue, todayCount }: { overdue: number; todayCount: number }) {
  const open = overdue + todayCount;
  const share = open ? overdue / open : 0;
  const [first, second] = overdue
    ? [`${count(overdue)} follow-up${overdue === 1 ? " is" : "s are"} overdue.`, "Clear them first."]
    : todayCount
      ? [`${count(todayCount)} follow-up${todayCount === 1 ? "" : "s"} due today.`, "Start with the first one."]
      : ["Nothing is waiting on you.", "You’re all caught up."];
  return (
    <Card className="relative overflow-hidden p-5 flex flex-col items-center text-center">
      <div className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none" style={{ background: "radial-gradient(80% 100% at 50% 100%, var(--accent-soft), transparent 75%)" }} />
      <div className="orb mt-2" />
      <div className="relative mt-4 text-[13px] font-medium text-ink">Today’s focus</div>
      <div className="relative mt-3 text-[17px] leading-snug font-light text-ink">{first} <span className="text-accent-text font-normal">{second}</span></div>
      {open > 0 && (
        <div className="relative w-full mt-4">
          <div className="flex justify-between text-xs text-ink-3"><span>Overdue share</span><span className="num text-gold">{Math.round(share * 100)}%</span></div>
          <div className="mt-1.5 h-1 rounded-full bg-surface-2 overflow-hidden"><div className="grow-x h-full rounded-full" style={{ width: `${share * 100}%`, background: "var(--chart-3)" }} /></div>
        </div>
      )}
      <div className="relative mt-auto pt-4 flex items-center gap-1">
        <Link href="/leads" className={buttonClass("primary", "sm")}>Review leads</Link>
        <Link href="/calendar" className={buttonClass("ghost", "sm")}>Calendar</Link>
      </div>
    </Card>
  );
}

function LeadSources({ data }: { data: Record<string, number> }) {
  const sorted = Object.entries(data || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4).reduce((a, [, n]) => a + n, 0);
  const rows = rest ? [...top, ["Other", rest] as [string, number]] : top;
  const total = rows.reduce((a, [, n]) => a + n, 0);
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)", "var(--chart-4)"];
  let acc = 0;
  return (
    <Card className="p-5">
      <CardTitle title="Where leads come from" />
      {total === 0 ? <div className="text-sm text-ink-3 py-10 text-center">No lead sources yet.</div> : (
        <div className="flex flex-wrap items-center gap-6">
          <div className="relative size-36 shrink-0 mx-auto sm:mx-0">
            <svg viewBox="0 0 42 42" className="size-full -rotate-90" aria-hidden>
              <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--gauge-off)" strokeWidth="5" />
              {rows.map(([name, n], i) => {
                const dash = (n / total) * 100;
                const offset = -acc;
                acc += dash;
                return <circle key={name} cx="21" cy="21" r="15.9155" fill="none" stroke={colors[i]} strokeWidth="5" strokeDashoffset={offset} strokeDasharray={`${dash} 100`} className="dash-in" style={{ ["--dash" as string]: dash, ["--i" as string]: i }} />;
              })}
            </svg>
            <div className="absolute inset-0 grid place-content-center text-center"><div className="text-lg font-medium num text-ink leading-none"><CountUp value={count(total)} /></div><div className="text-[10px] text-ink-3 mt-1">leads</div></div>
          </div>
          <div className="flex-1 min-w-[180px] space-y-2">
            {rows.map(([name, n], i) => (
              <div key={name} className="flex items-center gap-2 text-[13px]">
                <span className="size-2 rounded-full shrink-0" style={{ background: colors[i] }} />
                <span className="flex-1 text-ink-2 truncate">{name}</span>
                <span className="text-xs text-ink-3 num">{count(n)}</span>
                <span className="w-9 text-right font-medium text-ink num">{Math.round((n / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
