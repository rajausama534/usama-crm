"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CalendarCheck2, Handshake, MessageCircle, PhoneCall, UsersRound, Wallet } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Avatar, Badge, Card, ListSkeleton, PageHeader, Segmented, Stat, cx } from "@/components/ui";
import { ActivityChart, fmtShare } from "@/components/team/kit";
import { PERIODS, ROLE_NAME, computeMetrics, isSalesPerson, totals, usePeople, useTeamData, type Metrics, type PeriodKey, type Person } from "@/lib/team";
import { avatarUrl } from "@/lib/avatar";
import { count, relative, shortAED } from "@/lib/format";

type SortKey = "name" | "leadsActive" | "calls" | "whatsapp" | "ownersReached" | "followupsOverdue" | "viewingsDone" | "deals" | "revenue" | "lastActive";
const COLS: { key: SortKey; h: string; title?: string }[] = [
  { key: "name", h: "Agent" },
  { key: "leadsActive", h: "Active leads", title: "Leads assigned now, not won or lost" },
  { key: "calls", h: "Calls" },
  { key: "whatsapp", h: "WhatsApp" },
  { key: "ownersReached", h: "Owners reached", title: "Different owner records they called, messaged or updated" },
  { key: "followupsOverdue", h: "Overdue", title: "Lead follow-ups past their date" },
  { key: "viewingsDone", h: "Viewings", title: "Property viewings marked done" },
  { key: "deals", h: "Deals" },
  { key: "revenue", h: "Revenue", title: "Commission the company earned on their deals (their share)" },
  { key: "lastActive", h: "Last active" },
];

export default function TeamPage() {
  const { me } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const people = usePeople();
  const data = useTeamData(period);
  const isManager = !!me && (me.isAdmin || me.role === "team_leader");

  // Agents only have their own page.
  const mine = people.data?.find((p) => p.email === me?.email);
  useEffect(() => { if (me && !isManager && mine) router.replace(`/team/${mine.id || encodeURIComponent(mine.email)}`); }, [me, isManager, mine, router]);

  const team = useMemo(() => {
    const list = (people.data || []).filter((p) => p.active && isSalesPerson(p) && (me?.isAdmin || p.team_leader === me?.email || p.email === me?.email));
    return list;
  }, [people.data, me]);
  const metrics = useMemo(() => (data.data ? computeMetrics(data.data, team.map((p) => p.email)) : null), [data.data, team]);
  const rows = useMemo(() => {
    if (!metrics) return [];
    const r = team.map((p) => ({ p, m: metrics.get(p.email)! }));
    const val = (x: { p: Person; m: Metrics }) => sort === "name" ? x.p.name.toLowerCase() : sort === "lastActive" ? x.m.lastActive || "" : x.m[sort];
    return r.sort((a, b) => { const va = val(a), vb = val(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return dir === "asc" ? c : -c; });
  }, [metrics, team, sort, dir]);
  const sum = useMemo(() => totals(rows.map((r) => r.m)), [rows]);
  const best = useMemo(() => {
    const top = (k: keyof Metrics) => rows.reduce<{ p: Person; m: Metrics } | null>((b, r) => ((r.m[k] as number) > ((b?.m[k] as number) || 0) ? r : b), null);
    return { revenue: top("revenue"), touches: top("touches") };
  }, [rows]);

  if (!me || (!isManager && !people.data)) return <><PageHeader title="Team performance" /><ListSkeleton /></>;
  if (!isManager) return <><PageHeader title="My performance" /><ListSkeleton /></>;
  const days = data.data?.range.days || [];

  return (
    <div className="animate-in space-y-5">
      <PageHeader title="Team performance" subtitle="Who did what: calls, WhatsApp, owners reached, viewings, deals and revenue. Click a person for their full profile."
        actions={<Segmented value={period} onChange={setPeriod} options={PERIODS} />} />

      {!metrics ? <ListSkeleton rows={6} /> : <>
        <div className="kpi-strip stagger grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Stat icon={<PhoneCall size={13} />} label="Calls" value={count(sum.calls)} hint={best.touches?.m.touches ? `Busiest: ${best.touches.p.name.split(" ")[0]}` : "Nobody yet"} />
          <Stat icon={<MessageCircle size={13} />} label="WhatsApp messages" value={count(sum.whatsapp)} hint={`${count(sum.notes + sum.statusChanges)} notes and status updates`} />
          <Stat icon={<UsersRound size={13} />} label="Owners reached" value={count(sum.ownersReached)} hint={`${count(sum.leadsWorked)} leads worked on`} />
          <Stat icon={<CalendarCheck2 size={13} />} label="Viewings done" value={count(sum.viewingsDone)} hint={`${count(sum.meetingsDone)} meetings`} />
          <Stat icon={<Handshake size={13} />} label="Deals" value={fmtShare(sum.deals)} hint={sum.dealValue ? `AED ${shortAED(sum.dealValue)} property value` : "Approved deals in the period"} />
          <Stat icon={<Wallet size={13} />} label="Revenue" value={sum.revenue ? `AED ${shortAED(sum.revenue)}` : "AED 0"} hint={best.revenue?.m.revenue ? `Top: ${best.revenue.p.name.split(" ")[0]}` : "Commission before VAT"} />
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-ink">Agents</div>
            <div className="text-xs text-ink-3">{rows.length} {rows.length === 1 ? "person" : "people"}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  {COLS.map((c) => (
                    <th key={c.key} title={c.title} className={cx("font-medium px-3 py-2.5 whitespace-nowrap first:pl-5", c.key !== "name" && "text-right")}>
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => { if (sort === c.key) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(c.key); setDir(c.key === "name" ? "asc" : "desc"); } }}>
                        {c.h}{sort === c.key && (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, m }) => (
                  <tr key={p.email} onClick={() => router.push(`/team/${p.id || encodeURIComponent(p.email)}`)} className="border-t border-line cursor-pointer hover:bg-surface-2 transition-colors">
                    <td className="pl-5 pr-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-[200px]">
                        <Avatar name={p.name} size={32} src={avatarUrl(p.user_id)} />
                        <div className="min-w-0">
                          <div className="font-medium text-ink truncate">{p.name}</div>
                          <div className="text-xs text-ink-3 truncate">{ROLE_NAME[p.role] || p.role}{p.areas.length ? ` · ${p.areas.length > 2 ? `${p.areas.slice(0, 2).join(", ")} +${p.areas.length - 2}` : p.areas.join(", ")}` : " · No database given"}</div>
                        </div>
                      </div>
                    </td>
                    <Num v={m.leadsActive} />
                    <Num v={m.calls} />
                    <Num v={m.whatsapp} />
                    <Num v={m.ownersReached} />
                    <td className="px-3 py-2.5 text-right num">{m.followupsOverdue ? <Badge tone="bad">{m.followupsOverdue}</Badge> : <span className="text-ink-3">0</span>}</td>
                    <Num v={m.viewingsDone} />
                    <Num v={m.deals} fmt={fmtShare} />
                    <td className="px-3 py-2.5 text-right num whitespace-nowrap">{m.revenue ? `AED ${shortAED(m.revenue)}` : <span className="text-ink-3">—</span>}</td>
                    <td className={cx("px-3 py-2.5 text-right whitespace-nowrap pr-5", !m.lastActive && "text-ink-3")}>{m.lastActive ? relative(m.lastActive) : "No activity"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <ActivityChart days={days} perDay={mergeDays(rows.map((r) => r.m))} title="Team activity per day" />

        {me.isAdmin && <DatabaseMap people={team} />}
      </>}
    </div>
  );
}

function Num({ v, fmt }: { v: number; fmt?: (n: number) => string }) {
  return <td className={cx("px-3 py-2.5 text-right num", !v && "text-ink-3")}>{fmt ? fmt(v) : count(v)}</td>;
}

function mergeDays(list: Metrics[]) {
  const out: Metrics["perDay"] = {};
  for (const m of list) for (const [d, v] of Object.entries(m.perDay)) {
    const e = (out[d] ||= { call: 0, whatsapp: 0, other: 0 });
    e.call += v.call; e.whatsapp += v.whatsapp; e.other += v.other;
  }
  return out;
}

/** Which agent works which part of the owners database (communities and clusters), and what is left with nobody. */
function DatabaseMap({ people }: { people: Person[] }) {
  const opts = useQuery({
    queryKey: ["owner-options"],
    staleTime: 30 * 60_000,
    queryFn: async () => ((await db.rpc("crm_filter_options")).data || []) as { community: string | null; cluster: string | null; records: number }[],
  });
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => {
    const comm = new Map<string, { records: number; clusters: Map<string, number> }>();
    for (const o of opts.data || []) {
      if (!o.community) continue;
      const c = comm.get(o.community) || { records: 0, clusters: new Map() };
      c.records += Number(o.records);
      if (o.cluster) c.clusters.set(o.cluster, (c.clusters.get(o.cluster) || 0) + Number(o.records));
      comm.set(o.community, c);
    }
    return [...comm.entries()].map(([name, c]) => {
      const whole = people.filter((p) => p.areas.includes(name));
      const parts = [...c.clusters.entries()].map(([cl, n]) => ({ cl, n, who: people.filter((p) => p.areas.includes(cl)) })).filter((x) => x.who.length);
      const covered = whole.length ? c.records : parts.reduce((s, x) => s + x.n, 0);
      return { name, records: c.records, whole, parts, covered };
    }).sort((a, b) => b.records - a.records);
  }, [opts.data, people]);
  const total = rows.reduce((s, r) => s + r.records, 0);
  const covered = rows.reduce((s, r) => s + r.covered, 0);
  const shown = showAll ? rows : rows.slice(0, 12);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="text-sm font-semibold text-ink">Who works which database</div>
        <Link href="/settings/users" className="text-xs text-ink-2 hover:text-ink">Change in Users & access →</Link>
      </div>
      <p className="text-xs text-ink-3 mb-4">{count(covered)} of {count(total)} owner records are given to someone. Agents only see owners in their areas.</p>
      {opts.isLoading ? <ListSkeleton rows={4} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-xs text-ink-3"><th className="font-medium py-2 pr-3">Community</th><th className="font-medium py-2 px-3 text-right">Owner records</th><th className="font-medium py-2 px-3">Worked by</th><th className="font-medium py-2 pl-3 text-right">Covered</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.name} className="border-t border-line align-top">
                  <td className="py-2.5 pr-3 font-medium text-ink"><Link className="hover:text-accent-text" href={`/owners?community=${encodeURIComponent(r.name)}`}>{r.name}</Link></td>
                  <td className="py-2.5 px-3 text-right num">{count(r.records)}</td>
                  <td className="py-2.5 px-3">
                    {!r.whole.length && !r.parts.length ? <span className="text-warn">Nobody</span> : (
                      <div className="flex flex-wrap gap-1.5">
                        {r.whole.map((p) => <Badge key={p.email} tone="accent">{p.name} · whole community</Badge>)}
                        {r.parts.map((x) => x.who.map((p) => <Badge key={x.cl + p.email}>{p.name} · {x.cl}</Badge>))}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pl-3 text-right num text-ink-2">{Math.round((r.covered / Math.max(1, r.records)) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 12 && <button className="mt-3 text-xs text-ink-2 hover:text-ink" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${rows.length} communities`}</button>}
        </div>
      )}
    </Card>
  );
}
