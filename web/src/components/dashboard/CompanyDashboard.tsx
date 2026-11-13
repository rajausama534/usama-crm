"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlarmClock, ArrowRight, ArrowUpRight, BadgeCheck, CalendarClock, Handshake, Home, Inbox, Landmark, Megaphone, PhoneCall,
  ShieldCheck, Trophy, UsersRound, Wallet,
} from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Avatar, Badge, Card, ListSkeleton, Skeleton, Stat, buttonClass, cx } from "@/components/ui";
import { useRows, useCompany } from "@/lib/company/data";
import {
  COUNTED, dealMoney, expiryState, kycMissing, kycParties, monthStart, num, periodOf, r2, vatReturn,
  type Bill, type Deal, type Expense, type Invoice, type Leave, type Listing, type Split, type Staff, type StaffDoc,
} from "@/lib/company/calc";
import { LEAD_STAGES } from "@/lib/crm";
import { computeMetrics, isSalesPerson, totals, usePeople, useTeamData } from "@/lib/team";
import { avatarUrl } from "@/lib/avatar";
import { count, fmtDate, fmtTime, relative, shortAED, todayDubai } from "@/lib/format";
import { staffName, useStaff } from "@/lib/hooks";

type Stats = {
  owners: { records: number; units: number; contacted_7d: number; contacted_30d: number };
  leads: { total: number; new_7d: number; followups_today: number; followups_overdue: number };
  lead_status: Record<string, number>;
};
type Kyc = { deal_id: string; party: string; status: string };
type TodayEv = { id: string; title: string; event_type: string; starts_at: string; lead_id: string | null; assigned_to: string; leads: { name: string | null } | null };

const aedShort = (n: number) => (n ? `AED ${shortAED(n)}` : "AED 0");

/** Admin home: one view of the whole company — team activity first, then every department. */
export function CompanyDashboard({ greeting }: { greeting: string }) {
  const { me } = useAuth();
  const staffDir = useStaff();
  const today = todayDubai();
  const stats = useQuery({ queryKey: ["dashboard-stats"], queryFn: async () => (await db.rpc("crm_dashboard_stats")).data as Stats });
  const people = usePeople();
  const day = useTeamData("today");
  const month = useTeamData("month");

  const team = useMemo(() => (people.data || []).filter((p) => p.active && isSalesPerson(p)), [people.data]);
  const todayM = useMemo(() => (day.data ? computeMetrics(day.data, team.map((p) => p.email)) : null), [day.data, team]);
  const monthM = useMemo(() => (month.data ? computeMetrics(month.data, team.map((p) => p.email)) : null), [month.data, team]);
  const todayT = todayM ? totals([...todayM.values()]) : null;
  const monthT = monthM ? totals([...monthM.values()]) : null;

  const events = useQuery({
    queryKey: ["events", "today"],
    queryFn: async () => {
      const { data } = await db.from("crm_events").select("id,title,event_type,starts_at,lead_id,assigned_to,leads(name)")
        .eq("status", "Scheduled").gte("starts_at", `${today}T00:00:00+04:00`).lte("starts_at", `${today}T23:59:59+04:00`).order("starts_at");
      return (data || []) as unknown as TodayEv[];
    },
  });

  const s = stats.data;
  const active = s ? s.leads.total - (s.lead_status.Won || 0) - (s.lead_status.Lost || 0) : 0;

  return (
    <div className="space-y-6">
      <div className="animate-in flex flex-wrap items-end justify-between gap-3 pb-1">
        <div>
          <h1 className="text-[30px] font-light tracking-tight text-ink leading-tight">{greeting}, {me?.name?.split(" ")[0]}</h1>
          <p className="text-sm text-ink-2 mt-1">The whole company today: your team, sales, money, people and compliance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/calendar" className={buttonClass("secondary")}><CalendarClock size={15} /> Calendar</Link>
          <Link href="/team" className={buttonClass("primary")}><Trophy size={15} /> Team performance</Link>
        </div>
      </div>

      <div className={cx("grid grid-cols-2 lg:grid-cols-4 gap-3", s && monthT ? "kpi-strip stagger" : "")}>
        {s && monthT && todayT ? <>
          <Stat icon={<Wallet size={13} />} label="Revenue this month" value={aedShort(monthT.revenue)} hint={`${fmtShare(monthT.deals)} deal${monthT.deals === 1 ? "" : "s"} approved`} />
          <Stat icon={<PhoneCall size={13} />} label="Calls & WhatsApp today" value={count(todayT.calls + todayT.whatsapp)} hint={`${count(todayT.calls)} calls · ${count(todayT.whatsapp)} WhatsApp · ${count(todayT.ownersReached)} owners`} />
          <Stat icon={<UsersRound size={13} />} label="Active leads" value={count(active)} delta={s.leads.new_7d ? <Badge tone="good">+{count(s.leads.new_7d)}</Badge> : undefined} hint={`${count(s.leads.new_7d)} new this week`} />
          <Stat icon={<AlarmClock size={13} />} label="Overdue follow-ups" value={count(s.leads.followups_overdue)} tone={s.leads.followups_overdue ? "bad" : undefined} hint={`${count(s.leads.followups_today)} due today`} />
        </> : Array.from({ length: 4 }).map((_, i) => <Card key={i} className="p-5 space-y-3"><Skeleton className="w-24" /><Skeleton className="h-8 w-16" /></Card>)}
      </div>

      <div className="stagger grid lg:grid-cols-[1.6fr_1fr] gap-5">
        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-ink">Team today</div>
            <Link href="/team" className="text-xs text-ink-2 hover:text-ink inline-flex items-center gap-1">Full report <ArrowUpRight size={13} /></Link>
          </div>
          {!todayM || !monthM ? <div className="p-5"><ListSkeleton rows={3} /></div> : !team.length ? <p className="px-5 pb-6 text-sm text-ink-3">No agents yet. Add them in Users & access.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-xs text-ink-3">
                  <th className="font-medium pl-5 pr-3 py-2">Agent</th>
                  <th className="font-medium px-3 py-2 text-right">Calls</th>
                  <th className="font-medium px-3 py-2 text-right">WhatsApp</th>
                  <th className="font-medium px-3 py-2 text-right" title="Different owners contacted today">Owners</th>
                  <th className="font-medium px-3 py-2 text-right" title="Lead follow-ups past their date">Overdue</th>
                  <th className="font-medium px-3 py-2 text-right" title="Revenue from their deals this month">Month</th>
                  <th className="font-medium pl-3 pr-5 py-2 text-right">Last active</th>
                </tr></thead>
                <tbody>
                  {[...team].sort((a, b) => (todayM.get(b.email)!.touches - todayM.get(a.email)!.touches) || a.name.localeCompare(b.name)).map((p) => {
                    const t = todayM.get(p.email)!, mm = monthM.get(p.email)!;
                    return (
                      <tr key={p.email} className="border-t border-line hover:bg-surface-2 transition-colors">
                        <td className="pl-5 pr-3 py-2"><Link href={`/team/${p.id || encodeURIComponent(p.email)}`} className="flex items-center gap-2.5 text-ink hover:text-accent-text"><Avatar name={p.name} size={28} src={avatarUrl(p.user_id)} /><span className="font-medium">{p.name}</span></Link></td>
                        <td className={cx("px-3 py-2 text-right num", !t.calls && "text-ink-3")}>{t.calls}</td>
                        <td className={cx("px-3 py-2 text-right num", !t.whatsapp && "text-ink-3")}>{t.whatsapp}</td>
                        <td className={cx("px-3 py-2 text-right num", !t.ownersReached && "text-ink-3")}>{t.ownersReached}</td>
                        <td className="px-3 py-2 text-right num">{t.followupsOverdue ? <Badge tone="bad">{t.followupsOverdue}</Badge> : <span className="text-ink-3">0</span>}</td>
                        <td className={cx("px-3 py-2 text-right num whitespace-nowrap", !mm.revenue && "text-ink-3")}>{mm.revenue ? `AED ${shortAED(mm.revenue)}` : "—"}</td>
                        <td className={cx("pl-3 pr-5 py-2 text-right whitespace-nowrap", !mm.lastActive && "text-ink-3")}>{mm.lastActive ? relative(mm.lastActive) : "Not this month"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-ink flex items-center gap-2">Today’s calendar {!!events.data?.length && <Badge>{events.data.length}</Badge>}</div>
            <Link href="/calendar" className="text-xs text-ink-2 hover:text-ink">Calendar →</Link>
          </div>
          {events.isLoading ? <div className="space-y-3"><Skeleton /><Skeleton /></div> : !events.data?.length ? (
            <div className="text-sm text-ink-3 py-10 text-center">Nothing scheduled for today.</div>
          ) : (
            <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
              {events.data.map((e) => (
                <Link key={e.id} href={e.lead_id ? `/leads?open=${e.lead_id}` : "/calendar"} className="flex items-center gap-3 rounded-xl px-2 py-2 -mx-2 hover:bg-surface-2 transition-colors">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-ink truncate">{e.leads?.name || e.title}</span>
                    <span className="block text-xs text-ink-3 truncate">{e.event_type} · {staffName(staffDir.data, e.assigned_to)}</span>
                  </span>
                  <span className="text-xs num text-ink-2">{fmtTime(e.starts_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Departments stats={s} today={today} />
    </div>
  );
}

const fmtShare = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One card per department with the figures that need attention. */
function Departments({ stats, today }: { stats: Stats | undefined; today: string }) {
  const { settings } = useCompany();
  const approvals = useRows<{ id: string; kind: string }>("crm_approvals", { key: ["pending-kinds"], select: "id,kind", filter: (q) => q.eq("status", "pending") });
  const deals = useRows<Deal>("crm_deals");
  const splits = useRows<Split>("crm_deal_splits");
  const kyc = useRows<Kyc>("crm_kyc", { select: "deal_id,party,status" });
  const invoices = useRows<Invoice>("crm_invoices");
  const expenses = useRows<Expense>("crm_expenses", { key: ["all"] });
  const bills = useRows<Bill>("crm_bills");
  const staff = useRows<Staff>("crm_staff");
  const docs = useRows<StaffDoc>("crm_staff_documents");
  const leave = useRows<Leave>("crm_leave");
  const listings = useRows<Listing>("crm_listings");

  const x = useMemo(() => {
    const all = (deals.data || []).filter((d) => d.status !== "cancelled");
    const counted = all.filter((d) => COUNTED.has(d.status));
    const month = counted.filter((d) => d.deal_date >= monthStart(today));
    const ids = new Set(month.map((d) => d.id));
    const commission = r2(month.reduce((t, d) => t + dealMoney(d).gross, 0));
    const office = r2(month.reduce((t, d) => t + num(d.office_commission), 0));
    const toAgents = r2((splits.data || []).filter((l) => ids.has(l.deal_id)).reduce((t, l) => t + num(l.amount), 0));
    const year = counted.filter((d) => d.deal_date.slice(0, 4) === today.slice(0, 4));
    const vat = vatReturn(invoices.data || [], expenses.data || [], periodOf("quarter", today, settings.vat_first_month || 1));
    const openInv = (invoices.data || []).filter((i) => !["paid", "cancelled"].includes(i.status));
    const lateInv = openInv.filter((i) => i.due_date && i.due_date < today);
    const billsDue = (bills.data || []).filter((b) => b.active && b.next_due <= addDays(today, 7));
    const activeStaff = (staff.data || []).filter((p) => p.status === "active");
    const onLeave = (leave.data || []).filter((l) => l.status === "approved" && l.start_date <= today && l.end_date >= today);
    const kycWaiting = all.filter((d) => ["pending", "rejected"].includes(d.status) && kycMissing(kycParties(d.deal_type), (kyc.data || []).filter((k) => k.deal_id === d.id)).length);
    const live = (listings.data || []).filter((l) => l.status === "live");
    return {
      month, commission, company: r2(office - toAgents), yearRevenue: r2(year.reduce((t, d) => t + dealMoney(d).gross, 0)),
      pending: all.filter((d) => d.status === "pending").length,
      toCome: r2(counted.reduce((t, d) => t + Math.max(0, dealMoney(d).due - num(d.received)), 0)), vat,
      openInv: openInv.length, lateInv: lateInv.length, billsDue: billsDue.length, billsDueAmt: r2(billsDue.reduce((t, b) => t + num(b.amount) + num(b.vat), 0)),
      staff: activeStaff.length, onLeave: onLeave.length,
      docs: (docs.data || []).filter((d) => d.expiry_date && expiryState(d.expiry_date, today).tone !== "good").length,
      docsExpired: (docs.data || []).filter((d) => d.expiry_date && expiryState(d.expiry_date, today).tone === "bad").length,
      leavePending: (leave.data || []).filter((l) => l.status === "pending").length,
      kycWaiting: kycWaiting.length, goamlDue: all.filter((d) => d.goaml_status === "needed").length, goamlDone: all.filter((d) => d.goaml_status === "reported").length,
      live: live.length, listPending: (listings.data || []).filter((l) => l.status === "pending").length,
      permits: live.filter((l) => l.permit_expiry && expiryState(l.permit_expiry, today).tone !== "good").length,
      approvals: approvals.data?.length || 0,
      approvalKinds: Object.entries((approvals.data || []).reduce<Record<string, number>>((m, a) => { m[a.kind] = (m[a.kind] || 0) + 1; return m; }, {})),
    };
  }, [deals.data, splits.data, invoices.data, expenses.data, bills.data, staff.data, docs.data, leave.data, listings.data, kyc.data, approvals.data, settings.vat_first_month, today]);

  const s = stats;
  const pipe = LEAD_STAGES.filter((st) => st !== "Lost").map((st) => ({ st, n: s?.lead_status[st] || 0 }));
  const maxPipe = Math.max(1, ...pipe.map((p) => p.n));
  const coverage = s && s.owners.records ? Math.round((s.owners.contacted_30d / s.owners.records) * 100) : 0;
  const off = deals.data === null;

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-2">Departments</div>
      <div className="stagger grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Dept icon={UsersRound} title="Sales · Leads" href="/leads" big={s ? count(s.leads.total - (s.lead_status.Won || 0) - (s.lead_status.Lost || 0)) : "…"} sub="active leads" className="xl:row-span-2">
          <div className="space-y-1.5 mt-1">
            {pipe.map((p) => (
              <div key={p.st} className="grid grid-cols-[104px_1fr_26px] items-center gap-2 text-xs">
                <span className="text-ink-2 truncate">{p.st}</span>
                <span className="h-2 rounded-full bg-surface-2 overflow-hidden"><span className={cx("block h-full rounded-full", p.st === "Won" ? "bg-good" : "bg-accent")} style={{ width: `${(p.n / maxPipe) * 100}%`, minWidth: p.n ? 4 : 0 }} /></span>
                <span className="text-right num text-ink">{p.n}</span>
              </div>
            ))}
          </div>
          <Lines rows={[["New this week", s ? count(s.leads.new_7d) : "…"], ["Follow-ups today", s ? count(s.leads.followups_today) : "…"], ["Overdue", s ? count(s.leads.followups_overdue) : "…", s?.leads.followups_overdue ? "bad" : undefined]]} />
        </Dept>

        <Dept icon={Home} title="Sales · Owners database" href="/owners" big={`${coverage}%`} sub="of owners contacted in 30 days">
          <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="grow-x h-full rounded-full bg-accent" style={{ width: `${coverage}%` }} /></div>
          <Lines rows={[["Owner records", s ? count(s.owners.records) : "…"], ["Contacted this week", s ? count(s.owners.contacted_7d) : "…"], ["Still to call", s ? count(Math.max(0, s.owners.records - s.owners.contacted_30d)) : "…"]]} />
          <Link href="/team" className="mt-2 inline-block text-xs text-ink-2 hover:text-ink">Who works which area →</Link>
        </Dept>

        <Dept icon={Handshake} title="Deals" href="/deals" big={off ? "—" : aedShort(x.commission)} sub={`commission this month · ${x.month.length} deal${x.month.length === 1 ? "" : "s"}`}>
          <Lines rows={[["Company share", off ? "—" : aedShort(x.company)], ["Waiting for approval", String(x.pending), x.pending ? "warn" : undefined], ["Revenue this year", off ? "—" : aedShort(x.yearRevenue)]]} />
        </Dept>

        <Dept icon={Landmark} title="Accounts" href="/accounts" big={off ? "—" : aedShort(x.toCome)} sub="commission still to come in">
          <Lines rows={[[`VAT due ${fmtDate(x.vat.due)}`, aedShort(x.vat.payable)], ["Unpaid invoices", `${x.openInv}${x.lateInv ? ` · ${x.lateInv} late` : ""}`, x.lateInv ? "bad" : undefined], ["Bills due in 7 days", x.billsDue ? `${x.billsDue} · ${aedShort(x.billsDueAmt)}` : "0", x.billsDue ? "warn" : undefined]]} />
        </Dept>

        <Dept icon={BadgeCheck} title="HR" href="/hr" big={String(x.staff)} sub="staff on the team">
          <Lines rows={[["Documents to renew", x.docsExpired ? `${x.docs} · ${x.docsExpired} expired` : String(x.docs), x.docsExpired ? "bad" : x.docs ? "warn" : undefined], ["Leave requests waiting", String(x.leavePending), x.leavePending ? "warn" : undefined], ["On leave today", String(x.onLeave)]]} />
        </Dept>

        <Dept icon={ShieldCheck} title="Compliance" href="/compliance" big={String(x.kycWaiting)} sub="deals waiting for KYC" tone={x.kycWaiting ? "warn" : undefined}>
          <Lines rows={[["goAML reports to file", String(x.goamlDue), x.goamlDue ? "bad" : undefined], ["goAML reported", String(x.goamlDone)]]} />
        </Dept>

        <Dept icon={Megaphone} title="Listings" href="/listings" big={String(x.live)} sub="live on the portals">
          <Lines rows={[["Waiting for approval", String(x.listPending), x.listPending ? "warn" : undefined], ["Permits expiring", String(x.permits), x.permits ? "bad" : undefined]]} />
        </Dept>

        <Dept icon={Inbox} title="Approvals" href="/approvals" big={String(x.approvals)} sub="waiting for a decision" tone={x.approvals ? "warn" : undefined}>
          {x.approvalKinds.length ? <Lines rows={x.approvalKinds.map(([k, n]) => [k[0].toUpperCase() + k.slice(1), String(n)] as [string, string])} /> : <p className="text-xs text-ink-3 mt-3">Nothing waiting.</p>}
        </Dept>
      </div>
    </div>
  );
}

function addDays(day: string, n: number) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function Dept({ icon: Icon, title, href, big, sub, tone, className, children }: {
  icon: React.ComponentType<{ size?: number; className?: string }>; title: string; href: string; big: string; sub: string; tone?: "warn" | "bad"; className?: string; children?: React.ReactNode;
}) {
  return (
    <Card className={cx("p-5 flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-2"><Icon size={14} className="text-ink-3" />{title}</div>
        <Link href={href} aria-label={`Open ${title}`} className="p-1.5 -m-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"><ArrowRight size={14} /></Link>
      </div>
      <div className={cx("mt-2 text-[26px] leading-tight num", tone === "warn" && big !== "0" ? "text-warn" : tone === "bad" && big !== "0" ? "text-bad" : "text-ink")}>{big}</div>
      <div className="text-xs text-ink-3 mb-1">{sub}</div>
      {children}
    </Card>
  );
}

function Lines({ rows }: { rows: [string, string, ("bad" | "warn")?][] }) {
  return (
    <div className="mt-3 border-t border-line pt-2 space-y-1">
      {rows.map(([l, v, t]) => (
        <div key={l} className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="text-ink-2">{l}</span>
          <span className={cx("num whitespace-nowrap", t === "bad" ? "text-bad" : t === "warn" ? "text-warn" : "text-ink")}>{v}</span>
        </div>
      ))}
    </div>
  );
}

