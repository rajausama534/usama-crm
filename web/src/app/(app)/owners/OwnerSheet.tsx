"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Loader2, BedDouble, Ruler, Users, FileText } from "lucide-react";
import { CallButton, CopyButton, WaButton, useWaTemplate } from "@/components/ContactKit";
import { markOwnerContacted, ownerMessage } from "@/lib/contact";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { OWNER_STATUSES, OWNER_STATUS_TONE, type Owner, type Activity, logOwnerActivity } from "@/lib/crm";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Button, Field, Input, Sheet, Skeleton, Textarea, cx } from "@/components/ui";
import { count, fmtDate, fmtDateTime, shortAED, todayDubai } from "@/lib/format";

type Tx = { id: number; kind: string | null; amount: number | null; transaction_date: string; area_sqft: number | null; area_type: string | null; dld_transaction_number: string | null };
type Change = { changed_at: string; changed_by: string | null; old_row: Partial<Owner> | null; new_row: Partial<Owner> | null };
type SameUnit = { id: number; owner: string | null; status: string | null; data_source: string | null };
type UnitDetails = { property_type: string | null; bedrooms: string | null; bua_sqft: number | null; plot_sqft: number | null; layout: string | null };

export function OwnerSheet({ id, onClose, onOpen }: { id: number | null; onClose: () => void; onOpen: (id: number) => void }) {
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const staff = useStaff();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Owner>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [noteType, setNoteType] = useState("Call");
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["owner", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: o } = await db.from("owners").select("*").eq("id", id!).maybeSingle();
      if (!o) return null;
      const [related, acts, details, tx, same, changes] = await Promise.all([
        db.rpc("crm_related_rows", { owner_ids: [id] }),
        db.from("owner_activities").select("id,activity_type,details,created_by,created_at").eq("owner_id", String(id)).order("created_at", { ascending: false }).limit(100),
        db.from("unit_details").select("property_type,bedrooms,bua_sqft,plot_sqft,layout").eq("community", o.community).eq("cluster", o.cluster).eq("unit", o.unit).maybeSingle(),
        db.from("property_transactions").select("*").eq("community", o.community).eq("cluster", o.cluster).eq("unit", o.unit).order("transaction_date", { ascending: false }),
        db.from("owners").select("id,owner,phone1,status,data_source").eq("community", o.community).eq("cluster", o.cluster).eq("unit", o.unit).neq("id", id!),
        db.from("crm_change_log").select("changed_at,changed_by,old_row,new_row,action").eq("table_name", "owners").eq("row_id", String(id)).order("changed_at", { ascending: false }).limit(20),
      ]);
      return {
        owner: o as Owner,
        related: ((related.data || []) as Owner[]).filter((r) => r.id !== id),
        activities: (acts.data || []) as Activity[],
        details: details.data as UnitDetails | null,
        transactions: tx.error ? null : ((tx.data || []) as Tx[]),
        sameUnit: (same.data || []) as SameUnit[],
        changes: (changes.data || []) as Change[],
      };
    },
  });

  useEffect(() => { setEditing(false); setErr(""); setNote(""); }, [id]);
  useEffect(() => { if (q.data?.owner) setDraft(q.data.owner); }, [q.data]);

  const o = q.data?.owner;
  const template = useWaTemplate();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["owner", id] }); qc.invalidateQueries({ queryKey: ["owners"] }); };
  async function contact(type: "WhatsApp" | "Call") { if (o && me) { await markOwnerContacted(o.id, type, me.email); refresh(); } }

  async function setStatus(s: string) {
    if (!o || !me || s === o.status) return;
    const { error } = await db.from("owners").update({ status: s, last_contacted: todayDubai() }).eq("id", o.id);
    if (error) { setErr(error.message); return; }
    await logOwnerActivity(o.id, "Status changed", `Status changed from ${o.status || "-"} to ${s}.`, me.email);
    refresh();
  }

  async function saveDetails() {
    if (!o || !me) return;
    setBusy(true); setErr("");
    const fields = ["owner", "phone1", "phone2", "email", "follow_up_date", "remarks"] as const;
    const patch: Record<string, string | null> = {};
    const changed: string[] = [];
    for (const f of fields) {
      const v = ((draft[f] as string | null) ?? "").toString().trim() || null;
      if (v !== (o[f] ?? null)) { patch[f] = v; changed.push(f); }
    }
    if (!changed.length) { setBusy(false); setEditing(false); return; }
    const { error } = await db.from("owners").update(patch).eq("id", o.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await logOwnerActivity(o.id, "Owner details updated", `Changed: ${changed.join(", ")}.`, me.email);
    setEditing(false); refresh();
  }

  async function addNote() {
    if (!o || !me || !note.trim()) return;
    setBusy(true);
    await logOwnerActivity(o.id, noteType, note.trim(), me.email);
    await db.from("owners").update({ last_contacted: todayDubai() }).eq("id", o.id);
    setBusy(false); setNote(""); refresh();
  }

  const set = (k: keyof Owner) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <Sheet open={!!id} onClose={onClose} wide title={o ? <span className="num">{o.cluster} · {o.unit}</span> : "Owner"}
      footer={editing && <><Button variant="ghost" onClick={() => { setEditing(false); setDraft(o || {}); }}>Cancel</Button><Button variant="primary" onClick={saveDetails} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button></>}>
      {q.isLoading ? <div className="space-y-3"><Skeleton className="w-1/2" /><Skeleton /><Skeleton className="w-2/3" /></div> :
       !o ? <div className="text-sm text-ink-3">This owner was not found, or you don’t have access to it.</div> : (
        <div className="space-y-6">
          <div>
            <div className="text-lg font-semibold text-ink">{o.owner || "Unknown owner"}</div>
            <div className="text-sm text-ink-3">{o.community}{o.data_source ? ` · source: ${o.data_source}` : ""}</div>
          </div>

          {q.data!.details && (
            <div className="flex flex-wrap gap-2 text-xs">
              {q.data!.details.property_type && <Badge>{q.data!.details.property_type}</Badge>}
              {q.data!.details.bedrooms && <Badge><BedDouble size={12} /> {q.data!.details.bedrooms} bed</Badge>}
              {q.data!.details.layout && <Badge>{q.data!.details.layout}</Badge>}
              {q.data!.details.bua_sqft && <Badge><Ruler size={12} /> BUA {count(q.data!.details.bua_sqft)} sq ft</Badge>}
              {q.data!.details.plot_sqft && <Badge>Plot {count(q.data!.details.plot_sqft)} sq ft</Badge>}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {[o.phone1, o.phone2].filter(Boolean).map((p) => (
              <div key={p} className="flex items-center gap-1.5 rounded-xl border border-line pl-3 pr-1 py-1">
                <span className="text-sm text-ink num mr-1">{p}</span>
                <WaButton phone={p} text={ownerMessage(template, o)} onContact={() => contact("WhatsApp")} compact />
                <CallButton phone={p} onContact={() => contact("Call")} compact />
                <CopyButton value={p} compact />
              </div>
            ))}
            {o.email && <a href={`mailto:${o.email}`}><Button size="sm"><Mail size={14} /> Email</Button></a>}
            {!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit details</Button>}
            <Button size="sm" variant="ghost" onClick={() => router.push(`/breakdown?owner=${o.id}`)}><FileText size={14} /> Breakdown</Button>
          </div>

          {editing ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Owner name" className="sm:col-span-2"><Input value={draft.owner ?? ""} onChange={set("owner")} /></Field>
              <Field label="Phone 1"><Input value={draft.phone1 ?? ""} onChange={set("phone1")} /></Field>
              <Field label="Phone 2"><Input value={draft.phone2 ?? ""} onChange={set("phone2")} /></Field>
              <Field label="Email"><Input value={draft.email ?? ""} onChange={set("email")} /></Field>
              <Field label="Follow-up date"><Input type="date" value={draft.follow_up_date ?? ""} onChange={set("follow_up_date")} /></Field>
              <Field label="Remarks" className="sm:col-span-2"><Textarea value={draft.remarks ?? ""} onChange={set("remarks")} rows={3} /></Field>
            </div>
          ) : (
            <>
              <div>
                <div className="text-xs font-medium text-ink-3 mb-1.5">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {OWNER_STATUSES.map((s) => (
                    <button key={s} onClick={() => setStatus(s)} className={cx("h-7 px-2.5 rounded-md text-xs font-medium border transition-colors",
                      s === o.status ? "bg-ink text-bg border-ink" : "border-line text-ink-2 hover:border-line-strong bg-surface")}>{s}</button>
                  ))}
                </div>
              </div>
              {(o.remarks || o.admin_remarks || o.agent_remarks || o.manager_remarks) && (
                <div className="rounded-xl bg-surface-2 p-3.5 text-sm text-ink space-y-1.5 whitespace-pre-wrap">
                  {o.remarks && <div>{o.remarks}</div>}
                  {o.admin_remarks && <div><span className="text-ink-3">Admin: </span>{o.admin_remarks}</div>}
                  {o.manager_remarks && <div><span className="text-ink-3">Manager: </span>{o.manager_remarks}</div>}
                  {o.agent_remarks && <div><span className="text-ink-3">Agent: </span>{o.agent_remarks}</div>}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-xs text-ink-3">Last contacted</div><div className="text-ink num">{fmtDate(o.last_contacted)}</div></div>
                <div><div className="text-xs text-ink-3">Follow-up</div><div className="text-ink num">{fmtDate(o.follow_up_date)}</div></div>
              </div>
            </>
          )}

          {q.data!.related.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3 mb-1.5"><Users size={13} /> Other records for this unit / phone ({q.data!.related.length})</div>
              <div className="rounded-xl border border-line divide-y divide-line">
                {q.data!.related.slice(0, 12).map((r) => (
                  <button key={r.id} onClick={() => onOpen(r.id)} className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-surface-2 text-sm">
                    <span className="flex-1 truncate text-ink">{r.owner || "—"}</span>
                    <span className="text-xs text-ink-3 num truncate">{r.cluster} {r.unit}</span>
                    {r.status && <Badge tone={OWNER_STATUS_TONE[r.status] || "neutral"}>{r.status}</Badge>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-medium text-ink-3 mb-2">Transaction history</div>
              {q.data!.transactions === null ? <div className="text-sm text-ink-3">Transaction history is not available yet.</div>
               : q.data!.transactions.length === 0 ? <div className="text-sm text-ink-3">No verified transactions for this unit.</div>
               : <ul className="space-y-2.5">{q.data!.transactions.map((t) => (
                  <li key={t.id} className="text-sm">
                    <div className="text-xs text-ink-3 num">{fmtDate(t.transaction_date)}</div>
                    <div className="font-medium text-ink num">{t.kind || "Sold"} AED {shortAED(t.amount)}</div>
                    <div className="text-xs text-ink-2 num">{[t.area_sqft ? `${count(t.area_sqft)} sq ft${t.area_type === "plot" ? " plot" : ""}` : "", t.dld_transaction_number ? `DLD ${t.dld_transaction_number}` : ""].filter(Boolean).join(" · ")}</div>
                  </li>
                ))}</ul>}
            </div>
            <div>
              <div className="text-xs font-medium text-ink-3 mb-2">Ownership history</div>
              <OwnershipHistory changes={q.data!.changes} same={q.data!.sameUnit} />
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-ink-3 mb-2">History</div>
            <div className="rounded-xl border border-line p-3 space-y-2 mb-4">
              <div className="flex gap-1.5">
                {["Call", "WhatsApp", "Note"].map((t) => (
                  <button key={t} onClick={() => setNoteType(t)} className={cx("h-7 px-2.5 rounded-md text-xs font-medium", noteType === t ? "bg-accent-soft text-accent-text" : "text-ink-3 hover:text-ink")}>{t}</button>
                ))}
              </div>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed?" rows={2} className="min-h-14" />
              <div className="flex justify-end"><Button size="sm" variant="primary" onClick={addNote} disabled={busy || !note.trim()}>Add to history</Button></div>
            </div>
            <ol className="relative border-l border-line ml-1.5 space-y-4">
              {q.data!.activities.map((a) => (
                <li key={a.id} className="pl-4 relative">
                  <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-surface border-2 border-accent" />
                  <div className="flex items-baseline gap-2 text-xs text-ink-3 flex-wrap">
                    <span className="font-medium text-ink-2">{a.activity_type}</span>
                    <span>{fmtDateTime(a.created_at)}</span>
                    {a.created_by && <span>· {staffName(staff.data, a.created_by)}</span>}
                  </div>
                  {a.details && <div className="text-sm text-ink mt-0.5 whitespace-pre-wrap">{a.details}</div>}
                </li>
              ))}
              {q.data!.activities.length === 0 && <li className="pl-4 text-sm text-ink-3">No history yet.</li>}
            </ol>
          </div>
          {err && <div className="text-sm text-bad">{err}</div>}
        </div>
      )}
    </Sheet>
  );
}

function OwnershipHistory({ changes, same }: { changes: Change[]; same: SameUnit[] }) {
  const items: { when: string; title: string; sub: string }[] = [];
  for (const c of changes) {
    const o = c.old_row || {}, n = c.new_row || {};
    if (n.owner !== undefined && o.owner !== n.owner) items.push({ when: fmtDate(c.changed_at), title: "Owner changed", sub: `${o.owner || "-"} → ${n.owner || "-"}` });
    else if (o.phone1 !== n.phone1 || o.phone2 !== n.phone2) items.push({ when: fmtDate(c.changed_at), title: "Contact updated", sub: `Previous: ${[o.phone1, o.phone2].filter(Boolean).join(", ") || "-"}` });
    else if (o.status !== n.status) items.push({ when: fmtDate(c.changed_at), title: `Status ${o.status || "-"} → ${n.status || "-"}`, sub: c.changed_by || "" });
  }
  for (const r of same) items.push({ when: "Same unit", title: r.owner || "-", sub: [r.status, r.data_source].filter(Boolean).join(" · ") });
  if (!items.length) return <div className="text-sm text-ink-3">No other owners or earlier changes recorded for this unit.</div>;
  return <ul className="space-y-2.5">{items.map((x, i) => <li key={i} className="text-sm"><div className="text-xs text-ink-3 num">{x.when}</div><div className="font-medium text-ink">{x.title}</div>{x.sub && <div className="text-xs text-ink-2">{x.sub}</div>}</li>)}</ul>;
}
