"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, Home, ChevronLeft, ChevronRight, Phone } from "lucide-react";
import { db } from "@/lib/supabase";
import { OWNER_STATUSES, OWNER_STATUS_TONE, type Owner } from "@/lib/crm";
import { useDebounced } from "@/lib/hooks";
import { orSafe } from "@/components/shell/CommandPalette";
import { Badge, Button, Card, Empty, Input, ListSkeleton, PageHeader, Select, cx } from "@/components/ui";
import { count, relative } from "@/lib/format";
import { OwnerSheet } from "./OwnerSheet";

const PAGE = 50;
type Opt = { community: string | null; cluster: string | null; data_source: string | null; records: number };

export default function OwnersPage() {
  return <Suspense><Owners /></Suspense>;
}

function Owners() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("open");
  const [q, setQ] = useState("");
  const [community, setCommunity] = useState("");
  const [cluster, setCluster] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const term = orSafe(useDebounced(q, 300));

  const options = useQuery({
    queryKey: ["owner-options"],
    staleTime: 30 * 60_000,
    queryFn: async () => ((await db.rpc("crm_filter_options")).data || []) as Opt[],
  });
  const communities = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of options.data || []) if (o.community) m.set(o.community, (m.get(o.community) || 0) + Number(o.records));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [options.data]);
  const clusters = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of options.data || []) if (o.cluster && (!community || o.community === community)) m.set(o.cluster, (m.get(o.cluster) || 0) + Number(o.records));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [options.data, community]);

  const list = useQuery({
    queryKey: ["owners", term, community, cluster, status, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = db.from("owners_list").select("id,community,cluster,unit,owner,phone1,phone2,status,last_contacted,follow_up_date,data_source", { count: "exact" });
      if (term) {
        const digits = term.replace(/\D/g, "");
        const or = [`owner.ilike.%${term}%`, `unit.ilike.%${term}%`];
        if (digits.length >= 4) or.push(`phone1.ilike.%${digits}%`, `phone2.ilike.%${digits}%`);
        query = query.or(or.join(","));
      }
      if (community) query = query.eq("community", community);
      if (cluster) query = query.eq("cluster", cluster);
      if (status) query = status === "-" ? query.or("status.is.null,status.eq.") : query.eq("status", status);
      query = query.order("community").order("cluster").order("unit_natural", { nullsFirst: false }).order("id").range(page * PAGE, page * PAGE + PAGE - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data || []) as Owner[], count: count || 0 };
    },
  });
  const rows = list.data?.rows || [];
  const total = list.data?.count || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  function openOwner(id: number | null) {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("open", String(id)); else sp.delete("open");
    router.replace(`/owners${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }
  const reset = (fn: () => void) => { fn(); setPage(0); };

  return (
    <div className="animate-in">
      <PageHeader title="Owners" subtitle={list.data ? `${count(total)} records${community ? ` in ${cluster || community}` : ""}` : " "} />

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="Search owner, unit, phone…" className="pl-9" />
        </div>
        <Select value={community} onChange={(e) => reset(() => { setCommunity(e.target.value); setCluster(""); })} className="w-auto min-w-44">
          <option value="">All communities</option>
          {communities.map(([c, n]) => <option key={c} value={c}>{c} ({count(n)})</option>)}
        </Select>
        <Select value={cluster} onChange={(e) => reset(() => setCluster(e.target.value))} className="w-auto min-w-40">
          <option value="">All clusters</option>
          {clusters.map(([c, n]) => <option key={c} value={c}>{c} ({count(n)})</option>)}
        </Select>
        <Select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className="w-auto min-w-36">
          <option value="">Any status</option>
          {OWNER_STATUSES.map((s) => <option key={s}>{s}</option>)}
          <option value="-">No status</option>
        </Select>
      </div>

      {list.isLoading ? <ListSkeleton /> : rows.length === 0 ? (
        <Card><Empty icon={<Home size={28} />} title="No owners match" hint="Try a different search or clear the filters." /></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-3 border-b border-line">
                  <th className="font-medium px-4 py-2.5">Unit</th>
                  <th className="font-medium px-3 py-2.5">Owner</th>
                  <th className="font-medium px-3 py-2.5">Phone</th>
                  <th className="font-medium px-3 py-2.5">Status</th>
                  <th className="font-medium px-3 py-2.5">Last contact</th>
                </tr>
              </thead>
              <tbody className={cx(list.isPlaceholderData && "opacity-60")}>
                {rows.map((o) => (
                  <tr key={o.id} onClick={() => openOwner(o.id)} className="border-b border-line last:border-0 hover:bg-surface-2 cursor-pointer">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink num">{o.unit || "—"}</div>
                      <div className="text-xs text-ink-3">{o.cluster}{!community && o.community ? ` · ${o.community}` : ""}</div>
                    </td>
                    <td className="px-3 py-2.5 text-ink max-w-64 truncate">{o.owner || "—"}</td>
                    <td className="px-3 py-2.5 text-ink-2 num">{o.phone1 || o.phone2 || "—"}</td>
                    <td className="px-3 py-2.5">{o.status ? <Badge tone={OWNER_STATUS_TONE[o.status] || "neutral"}>{o.status}</Badge> : <span className="text-ink-3">—</span>}</td>
                    <td className="px-3 py-2.5 text-ink-3 num">{relative(o.last_contacted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="md:hidden divide-y divide-line">
              {rows.map((o) => (
                <button key={o.id} onClick={() => openOwner(o.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-surface-2">
                  <div className="w-14 shrink-0 text-center">
                    <div className="font-semibold text-ink num">{o.unit || "—"}</div>
                    <div className="text-[10px] text-ink-3 truncate">{o.cluster}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-ink truncate">{o.owner || "—"}</div>
                    <div className="mt-0.5">{o.status && <Badge tone={OWNER_STATUS_TONE[o.status] || "neutral"}>{o.status}</Badge>}</div>
                  </div>
                  {(o.phone1 || o.phone2) && <a href={`tel:${o.phone1 || o.phone2}`} onClick={(e) => e.stopPropagation()} className="p-2 rounded-full bg-surface-2 text-ink-2"><Phone size={16} /></a>}
                </button>
              ))}
            </div>
          </Card>
          <div className="flex items-center justify-between mt-3 text-sm text-ink-3">
            <span className="num">{count(page * PAGE + 1)}–{count(Math.min(total, page * PAGE + PAGE))} of {count(total)}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></Button>
              <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></Button>
            </div>
          </div>
        </>
      )}
      <OwnerSheet id={openId ? Number(openId) : null} onClose={() => openOwner(null)} onOpen={openOwner} />
    </div>
  );
}
