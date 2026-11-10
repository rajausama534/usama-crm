"use client";

import Link from "next/link";
import { useMemo } from "react";
import { BadgeCheck, Handshake, Inbox, Landmark, Megaphone } from "lucide-react";
import { Card } from "@/components/ui";
import { useCompany, useRows } from "@/lib/company/data";
import { COUNTED, dealMoney, expiryState, monthStart, num, periodOf, r2, vatReturn, type Deal, type Expense, type Invoice, type Leave, type Listing, type Split, type StaffDoc } from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";

/** Whole-company cards on Usama's dashboard: approvals, deals and commission, cash and VAT, staff, listings. */
export function CompanyCards() {
  const { settings } = useCompany();
  const approvals = useRows<{ id: string }>("crm_approvals", { key: ["pending"], select: "id", filter: (q) => q.eq("status", "pending") });
  const deals = useRows<Deal>("crm_deals");
  const splits = useRows<Split>("crm_deal_splits");
  const invoices = useRows<Invoice>("crm_invoices");
  const expenses = useRows<Expense>("crm_expenses", { key: ["all"] });
  const docs = useRows<StaffDoc>("crm_staff_documents");
  const leave = useRows<Leave>("crm_leave");
  const listings = useRows<Listing>("crm_listings");
  const today = todayDubai();

  const x = useMemo(() => {
    const counted = (deals.data || []).filter((d) => COUNTED.has(d.status));
    const month = counted.filter((d) => d.deal_date >= monthStart(today));
    const ids = new Set(month.map((d) => d.id));
    const commission = r2(month.reduce((s, d) => s + dealMoney(d).gross, 0));
    const office = r2(month.reduce((s, d) => s + num(d.office_commission), 0));
    const toAgents = r2((splits.data || []).filter((s) => ids.has(s.deal_id)).reduce((s, l) => s + num(l.amount), 0));
    const vat = vatReturn(invoices.data || [], expenses.data || [], periodOf("quarter", today, settings.vat_first_month || 1));
    const live = (listings.data || []).filter((l) => l.status === "live");
    return {
      commission, company: r2(office - toAgents), n: month.length,
      toCome: r2(counted.reduce((s, d) => s + Math.max(0, dealMoney(d).due - num(d.received)), 0)), vat,
      docs: (docs.data || []).filter((d) => expiryState(d.expiry_date, today).tone !== "good" && d.expiry_date).length,
      leave: (leave.data || []).filter((l) => l.status === "pending").length,
      live: live.length, permits: live.filter((l) => expiryState(l.permit_expiry, today).tone !== "good").length,
    };
  }, [deals.data, splits.data, invoices.data, expenses.data, docs.data, leave.data, listings.data, settings.vat_first_month, today]);

  const off = deals.data === null;
  const cards = [
    { icon: Inbox, href: "/approvals", t: "Approvals", big: String(approvals.data?.length ?? 0), d: "waiting for a decision" },
    { icon: Handshake, href: "/deals", t: "Deals this month", big: off ? "—" : aed(x.commission), d: off ? "Switches on with the database update" : `${x.n} deal${x.n === 1 ? "" : "s"} · company share ${aed(x.company)}` },
    { icon: Landmark, href: "/accounts", t: "Cash and VAT", big: off ? "—" : aed(x.toCome), d: off ? "Switches on with the database update" : `still to come in · VAT ${aed(x.vat.payable)} due ${fmtDate(x.vat.due)}` },
    { icon: BadgeCheck, href: "/hr", t: "Staff", big: off ? "—" : String(x.docs), d: off ? "Switches on with the database update" : `document${x.docs === 1 ? "" : "s"} expiring · ${x.leave} leave request${x.leave === 1 ? "" : "s"} waiting` },
    { icon: Megaphone, href: "/listings", t: "Listings", big: off ? "—" : String(x.live), d: off ? "Switches on with the database update" : `live · ${x.permits} permit${x.permits === 1 ? "" : "s"} expiring` },
  ];
  return (
    <div>
      <div className="text-xs font-medium text-ink-3 mb-2">The company</div>
      <div className="stagger grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <Link key={c.t} href={c.href}>
            <Card className="lift p-4 h-full hover:border-line-strong">
              <div className="flex items-center gap-1.5 text-xs font-medium text-ink-2"><c.icon size={14} className="text-ink-3" />{c.t}</div>
              <div className="mt-2 text-[22px] leading-tight num text-ink">{c.big}</div>
              <div className="text-xs text-ink-3 mt-1">{c.d}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
