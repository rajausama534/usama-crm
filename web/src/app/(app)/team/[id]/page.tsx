"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, BadgeCheck, CalendarCheck2, CalendarClock, Clock3, Handshake, Mail, MessageCircle, NotebookPen, Phone, PhoneCall, Settings, UsersRound, Wallet,
} from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Avatar, Badge, Card, Empty, ListSkeleton, Segmented, Stat, buttonClass, cx } from "@/components/ui";
import { ActivityChart, Mini, fmtShare } from "@/components/team/kit";
import { Pill, DEAL_TONE } from "@/components/company/kit";
import { PERIODS, ROLE_NAME, computeMetrics, kindOf, usePeople, useTeamData, type Act, type PeriodKey } from "@/lib/team";
import { LEAD_STAGES } from "@/lib/crm";
import { avatarUrl } from "@/lib/avatar";
import { COUNTED, DEAL_STATUS, DEAL_TYPES, dealMoney, expiryState, num, type Deal, type Leave, type Split, type Staff, type StaffDoc } from "@/lib/company/calc";
import { isFinance, isHr } from "@/lib/company/data";
import { aed, count, fmtDate, fmtDateTime, fmtTime, relative, shortAED, todayDubai, waNumber } from "@/lib/format";

export default function AgentProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const key = decodeURIComponent(id).toLowerCase();
  const { me } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const people = usePeople();
  const person = people.data?.find((p) => p.id === key || p.email === key);
  const data = useTeamData(period);
  const m = useMemo(() => (data.data && person ? computeMetrics(data.data, [person.email]).get(person.email)! : null), [data.data, person]);
  const allTime = useTeamData("year");

  const hr = useQuery({
    queryKey: ["agent-hr", person?.email],
    enabled: !!person && !!me && (isHr(me) || isFinance(me) || person.email === me.email),
    queryFn: async () => {
      const s = await db.from("crm_staff").select("*").ilike("email", person!.email).maybeSingle();
      const staff = (s.data || null) as Staff | null;
      if (!staff) return { staff: null, docs: [] as StaffDoc[], leave: [] as Leave[] };
      const [d, l] = await Promise.all([
        db.from("crm_staff_documents").select("*").eq("staff_id", staff.id),
        db.from("crm_leave").select("*").eq("staff_id", staff.id).order("start_date", { ascending: false }).limit(20),
      ]);
      return { staff, docs: (d.data || []) as StaffDoc[], leave: (l.data || []) as Leave[] };
    },
  });

  const area = useQuery({
    queryKey: ["agent-areas", person?.email, person?.areas.join("|")],
    enabled: !!person,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const opts = ((await db.rpc("crm_filter_options")).data || []) as { community: string | null; cluster: string | null; records: number }[];
      return person!.areas.map((a) => ({
        name: a,
        records: opts.filter((o) => o.community === a || o.cluster === a).reduce((s, o) => s + Number(o.records), 0),
        whole: opts.some((o) => o.community === a),
      }));
    },
  });

  if (people.isLoading || !me) return <ListSkeleton />;
  if (!person) return <Card><Empty title="Person not found" hint="They may have been removed, or you don't have access to them." action={<Link href="/team" className={buttonClass("secondary")}>Back to team</Link>} /></Card>;

  const isManager = me.isAdmin || me.role === "team_leader";
  const myLeads = (data.data?.leads || []).filter((l) => l.assigned_to?.toLowerCase() === person.email);
  const stageCounts = LEAD_STAGES.map((s) => ({ s, n: myLeads.filter((l) => (l.status || "New") === s).length }));
  const maxStage = Math.max(1, ...stageCounts.map((x) => x.n));
  const today = todayDubai();
  const followups = myLeads.filter((l) => l.status !== "Won" && l.status !== "Lost" && l.follow_up_date && l.follow_up_date <= today)
    .sort((a, b) => (a.follow_up_date || "").localeCompare(b.follow_up_date || "")).slice(0, 8);
  const events = (data.data?.events || []).filter((e) => e.assigned_to?.toLowerCase() === person.email);
  const upcoming = events.filter((e) => e.status === "Scheduled").sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 8);
  const acts = (data.data?.acts || []).filter((a) => a.by === person.email);
  const deals = dealsFor(allTime.data?.deals || [], allTime.data?.splits || [], person.email);
  const staff = hr.data?.staff;
  const phone = staff?.phone;

  return (
    <div className="animate-in space-y-5">
      <Link href={isManager ? "/team" : "/"} className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={15} /> {isManager ? "Team performance" : "Dashboard"}</Link>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={person.name} size={76} src={avatarUrl(person.user_id)} />
          <div className="flex-1 min-w-[220px]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[26px] font-light tracking-tight text-ink leading-tight">{person.name}</h1>
              <Badge tone="accent">{ROLE_NAME[person.role] || person.role}</Badge>
              {!person.active && <Badge tone="bad">Inactive</Badge>}
            </div>
            <div className="text-sm text-ink-2 mt-1">{staff?.job_title || ROLE_NAME[person.role]}{person.team_leader ? ` · Team leader: ${nameOf(people.data, person.team_leader)}` : ""}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[13px] text-ink-2">
              <span className="inline-flex items-center gap-1.5"><Mail size={14} className="text-ink-3" />{person.email}</span>
              {phone && <span className="inline-flex items-center gap-1.5"><Phone size={14} className="text-ink-3" />{phone}</span>}
              {staff?.join_date && <span className="inline-flex items-center gap-1.5"><BadgeCheck size={14} className="text-ink-3" />Joined {fmtDate(staff.join_date)}</span>}
              <span className="inline-flex items-center gap-1.5"><Clock3 size={14} className="text-ink-3" />{m?.lastActive ? `Last active ${relative(m.lastActive)}` : "No activity in this period"}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {phone && <a href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noreferrer" className={buttonClass("secondary")}><MessageCircle size={15} /> WhatsApp</a>}
            {isManager && <Link href={`/leads?agent=${encodeURIComponent(person.email)}`} className={buttonClass("secondary")}><UsersRound size={15} /> Their leads</Link>}
            {isManager && <Link href={`/owners?agent=${encodeURIComponent(person.email)}`} className={buttonClass("secondary")}>Their owners</Link>}
            {me.isAdmin && person.id && <Link href={`/settings/users?user=${person.id}`} className={buttonClass("secondary")}><Settings size={15} /> Access</Link>}
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-ink-2">Performance</div>
        <Segmented value={period} onChange={setPeriod} options={PERIODS} />
      </div>

      {!m ? <ListSkeleton rows={4} /> : <>
        <div className="kpi-strip stagger grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <Stat icon={<PhoneCall size={13} />} label="Calls" value={count(m.calls)} />
          <Stat icon={<MessageCircle size={13} />} label="WhatsApp" value={count(m.whatsapp)} />
          <Stat icon={<UsersRound size={13} />} label="Owners reached" value={count(m.ownersReached)} />
          <Stat icon={<NotebookPen size={13} />} label="Notes & updates" value={count(m.notes + m.statusChanges)} />
          <Stat icon={<CalendarCheck2 size={13} />} label="Viewings done" value={count(m.viewingsDone)} hint={`${m.meetingsDone} meetings`} />
          <Stat icon={<Handshake size={13} />} label="Deals" value={fmtShare(m.deals)} hint={m.dealValue ? `AED ${shortAED(m.dealValue)} value` : undefined} />
          <Stat icon={<Wallet size={13} />} label="Revenue" value={m.revenue ? `AED ${shortAED(m.revenue)}` : "AED 0"} hint="Commission to company" />
          <Stat icon={<Wallet size={13} />} label="Their commission" value={m.earned ? `AED ${shortAED(m.earned)}` : "AED 0"} tone={m.earned ? "good" : undefined} />
        </div>

        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
          <ActivityChart days={data.data!.range.days} perDay={m.perDay} />
          <Card className="p-5">
            <div className="text-sm font-semibold text-ink mb-4">Work rate</div>
            <div className="grid grid-cols-2 gap-4">
              <Mini label="Days active" value={`${m.activeDays} / ${data.data!.range.days.length}`} />
              <Mini label="Per active day" value={m.activeDays ? fmtShare(Math.round((m.touches / m.activeDays) * 10) / 10) : "0"} hint="calls, messages, notes" />
              <Mini label="Leads worked on" value={count(m.leadsWorked)} />
              <Mini label="New leads given" value={count(m.leadsNew)} />
              <Mini label="Overdue follow-ups" value={count(m.followupsOverdue)} tone={m.followupsOverdue ? "bad" : undefined} />
              <Mini label="Overdue calendar items" value={count(m.eventsOverdue)} tone={m.eventsOverdue ? "warn" : undefined} />
            </div>
          </Card>
        </div>
      </>}

      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="p-5">
          <Head title="Leads now" right={<span className="text-xs text-ink-3">{myLeads.length} assigned</span>} />
          {!myLeads.length ? <p className="text-sm text-ink-3 py-6 text-center">No leads assigned to {person.name.split(" ")[0]}.</p> : (
            <div className="space-y-1.5">
              {stageCounts.map((x) => (
                <div key={x.s} className="grid grid-cols-[110px_1fr_28px] items-center gap-3 text-[13px]">
                  <span className="text-ink-2">{x.s}</span>
                  <span className="h-3 rounded-full bg-surface-2 overflow-hidden"><span className={cx("block h-full rounded-full", x.s === "Won" ? "bg-good" : x.s === "Lost" ? "bg-ink-3/50" : "bg-accent")} style={{ width: `${(x.n / maxStage) * 100}%`, minWidth: x.n ? 5 : 0 }} /></span>
                  <span className="text-right num">{x.n}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <Head title="Follow-ups due" right={followups.length ? <Badge tone="bad">{followups.length}</Badge> : undefined} />
          {!followups.length ? <p className="text-sm text-ink-3 py-6 text-center">Nothing overdue.</p> : (
            <ul className="divide-y divide-line">
              {followups.map((l) => (
                <li key={l.id}><Link href={`/leads?open=${l.id}`} className="flex items-center justify-between gap-2 py-2 text-[13px] hover:text-accent-text">
                  <span className="truncate text-ink">{l.name || "Unnamed"}</span>
                  <span className={cx("shrink-0 text-xs", (l.follow_up_date || "") < today ? "text-bad" : "text-ink-2")}>{fmtDate(l.follow_up_date)}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <Head title="Calendar" right={<Link href="/calendar" className="text-xs text-ink-2 hover:text-ink">Open →</Link>} />
          {!upcoming.length ? <p className="text-sm text-ink-3 py-6 text-center">Nothing scheduled.</p> : (
            <ul className="divide-y divide-line">
              {upcoming.map((e) => {
                const late = new Date(e.starts_at) < new Date();
                return (
                  <li key={e.id} className="flex items-center gap-3 py-2 text-[13px]">
                    <CalendarClock size={14} className={late ? "text-bad" : "text-ink-3"} />
                    <span className="flex-1 min-w-0 truncate text-ink">{e.title || e.event_type}</span>
                    <span className={cx("shrink-0 text-xs", late ? "text-bad" : "text-ink-2")}>{late ? fmtDate(e.starts_at) : fmtDateTime(e.starts_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-5">
        <Card className="p-5">
          <Head title="Database" right={me.isAdmin && person.id ? <Link href={`/settings/users?user=${person.id}`} className="text-xs text-ink-2 hover:text-ink">Change →</Link> : undefined} />
          {!person.areas.length ? <p className="text-sm text-ink-3 py-4">No communities or clusters given. {person.role === "agent" ? "They can't see any owners yet." : ""}</p> : (
            <>
              <ul className="divide-y divide-line">
                {(area.data || person.areas.map((a) => ({ name: a, records: 0, whole: false }))).map((a) => (
                  <li key={a.name} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                    <Link href={`/owners?${a.whole ? "community" : "cluster"}=${encodeURIComponent(a.name)}`} className="text-ink hover:text-accent-text">{a.name} <span className="text-xs text-ink-3">{a.whole ? "community" : "cluster"}</span></Link>
                    <span className="num text-ink-2">{area.data ? count(a.records) : "…"} owners</span>
                  </li>
                ))}
              </ul>
              {m && area.data && <div className="mt-3 text-xs text-ink-3">Reached {count(m.ownersReached)} of {count(area.data.reduce((s, a) => s + a.records, 0))} owner records this period.</div>}
            </>
          )}
        </Card>

        <Card className="p-5">
          <Head title="What they did" right={<span className="text-xs text-ink-3">{acts.length} in period</span>} />
          <Timeline acts={acts.slice(0, 60)} />
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 pt-4 pb-2 flex items-center justify-between"><div className="text-sm font-semibold text-ink">Deals this year</div><Link href="/deals" className="text-xs text-ink-2 hover:text-ink">All deals →</Link></div>
        {!deals.length ? <p className="text-sm text-ink-3 px-5 pb-6 pt-2">No deals this year.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-xs text-ink-3">{["No.", "Date", "Type", "Client", "Property", "Price", "Commission", "Their share", "Their commission", "Status"].map((h, i) => <th key={h} className={cx("font-medium px-3 py-2.5 whitespace-nowrap first:pl-5 last:pr-5", i >= 5 && i <= 8 && "text-right")}>{h}</th>)}</tr></thead>
              <tbody>
                {deals.map(({ d, share, earned }) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="pl-5 pr-3 py-2.5 num text-ink-2">#{d.deal_no}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(d.deal_date)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{DEAL_TYPES[d.deal_type as keyof typeof DEAL_TYPES]?.label || d.deal_type}</td>
                    <td className="px-3 py-2.5">{d.client_name}</td>
                    <td className="px-3 py-2.5 text-ink-2">{[d.unit, d.cluster || d.community].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-3 py-2.5 text-right num whitespace-nowrap">{aed(d.price)}</td>
                    <td className="px-3 py-2.5 text-right num whitespace-nowrap">{aed(dealMoney(d).gross)}</td>
                    <td className="px-3 py-2.5 text-right num">{share}%</td>
                    <td className="px-3 py-2.5 text-right num whitespace-nowrap">{earned ? aed(earned) : "—"}</td>
                    <td className="px-3 py-2.5 pr-5"><Pill tone={DEAL_TONE[d.status] || "neutral"}>{DEAL_STATUS[d.status] || d.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {staff && (isHr(me) || isFinance(me)) && (
        <Card className="p-5">
          <Head title="HR" right={<Link href="/hr" className="text-xs text-ink-2 hover:text-ink">Open HR →</Link>} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Mini label="Nationality" value={<span className="text-base">{staff.nationality || "—"}</span>} />
            <Mini label="Commission rate" value={`${num(staff.commission_rate)}%`} />
            <Mini label="Leave taken this year" value={`${hr.data!.leave.filter((l) => l.status === "approved" && l.start_date.startsWith(today.slice(0, 4))).reduce((s, l) => s + num(l.days), 0)} days`} hint={`of ${staff.annual_leave_days ?? 30} a year`} />
            <Mini label="Documents to renew" value={hr.data!.docs.filter((d) => d.expiry_date && expiryState(d.expiry_date, today).tone !== "good").length}
              tone={hr.data!.docs.some((d) => d.expiry_date && expiryState(d.expiry_date, today).tone === "bad") ? "bad" : undefined} />
          </div>
          {!!hr.data!.docs.length && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {hr.data!.docs.map((d) => { const st = expiryState(d.expiry_date, today); return <Badge key={d.id} tone={d.expiry_date ? st.tone : "neutral"}>{d.doc_type}{d.expiry_date ? ` · ${fmtDate(d.expiry_date)}` : ""}</Badge>; })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Head({ title, right }: { title: string; right?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2 mb-3"><div className="text-sm font-semibold text-ink">{title}</div>{right}</div>;
}

function nameOf(list: { email: string; name: string }[] | undefined, email: string) {
  return list?.find((p) => p.email === email)?.name || email.split("@")[0];
}

function dealsFor(deals: Deal[], splits: Split[], email: string) {
  return deals.map((d) => {
    const mine = splits.filter((s) => s.deal_id === d.id && s.email?.toLowerCase() === email);
    const agentSplits = splits.filter((s) => s.deal_id === d.id && s.kind === "agent");
    const share = mine.filter((s) => s.kind === "agent").reduce((t, s) => t + num(s.share_pct), 0) || (!agentSplits.length && d.created_by?.toLowerCase() === email ? 100 : 0);
    const earned = mine.reduce((t, s) => t + num(s.amount), 0);
    return { d, share, earned, on: share > 0 || earned > 0 };
  }).filter((x) => x.on && (COUNTED.has(x.d.status) || x.d.status === "pending")).sort((a, b) => b.d.deal_date.localeCompare(a.d.deal_date));
}

const ICON: Record<string, React.ReactNode> = {
  call: <PhoneCall size={13} />, whatsapp: <MessageCircle size={13} />, note: <NotebookPen size={13} />, status: <BadgeCheck size={13} />,
  lead: <UsersRound size={13} />, event: <CalendarCheck2 size={13} />, other: <NotebookPen size={13} />,
};

/** Recent calls, messages and updates, with links to the owner or lead. */
function Timeline({ acts }: { acts: Act[] }) {
  const ownerIds = [...new Set(acts.filter((a) => a.kind === "owner").map((a) => Number(a.ref)).filter(Number.isFinite))];
  const leadIds = [...new Set(acts.filter((a) => a.kind === "lead").map((a) => a.ref))];
  const names = useQuery({
    queryKey: ["timeline-names", ownerIds.join(","), leadIds.join(",")],
    enabled: acts.length > 0,
    queryFn: async () => {
      const [o, l] = await Promise.all([
        ownerIds.length ? db.from("owners").select("id,owner,unit,cluster").in("id", ownerIds) : Promise.resolve({ data: [] }),
        leadIds.length ? db.from("leads").select("id,name").in("id", leadIds) : Promise.resolve({ data: [] }),
      ]);
      const m = new Map<string, string>();
      for (const r of (o.data || []) as { id: number; owner: string | null; unit: string | null; cluster: string | null }[]) m.set(`owner:${r.id}`, [r.owner || "Owner", [r.unit, r.cluster].filter(Boolean).join(" ")].filter(Boolean).join(" · "));
      for (const r of (l.data || []) as { id: string; name: string | null }[]) m.set(`lead:${r.id}`, r.name || "Lead");
      return m;
    },
  });
  if (!acts.length) return <p className="text-sm text-ink-3 py-6 text-center">No calls, messages or updates in this period.</p>;
  let lastDay = "";
  return (
    <div className="max-h-[420px] overflow-y-auto -mr-2 pr-2">
      {acts.map((a, i) => {
        const day = fmtDate(a.at);
        const head = day !== lastDay; lastDay = day;
        const k = kindOf(a.type);
        const label = names.data?.get(`${a.kind}:${a.ref}`) || (a.kind === "owner" ? "Owner record" : "Lead");
        return (
          <div key={i}>
            {head && <div className="text-[11px] font-medium text-ink-3 uppercase tracking-wider pt-3 pb-1 first:pt-0">{day}</div>}
            <div className="flex items-start gap-3 py-1.5 text-[13px]">
              <span className={cx("mt-0.5 size-6 shrink-0 rounded-full grid place-items-center", k === "call" ? "bg-accent-soft text-accent-text" : k === "whatsapp" ? "bg-good-soft text-good" : "bg-surface-2 text-ink-2")}>{ICON[k]}</span>
              <div className="flex-1 min-w-0">
                <div className="text-ink"><span className="font-medium">{a.type}</span> · <Link href={a.kind === "owner" ? `/owners?open=${a.ref}` : `/leads?open=${a.ref}`} className="hover:text-accent-text">{label}</Link></div>
                {a.details && <div className="text-xs text-ink-3 truncate">{a.details}</div>}
              </div>
              <span className="text-xs text-ink-3 shrink-0">{fmtTime(a.at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

