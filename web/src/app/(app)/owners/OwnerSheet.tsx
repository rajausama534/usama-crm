"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Loader2, Megaphone, Pencil, FileText, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { CallButton, CopyButton, WaButton, useWaTemplate } from "@/components/ContactKit";
import { markOwnerContacted, ownerMessage } from "@/lib/contact";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { type Owner, type Activity, logOwnerActivity } from "@/lib/crm";
import { useStaff, staffName, useOwnerStatuses } from "@/lib/hooks";
import { Avatar, Button, Field, Info, Input, Sheet, Skeleton, StatusBadge, StatusChip, Tabs, Textarea, cx } from "@/components/ui";
import { count, fmtDate, fmtDateTime, shortAED, todayDubai } from "@/lib/format";

type Tx = { id: number; kind: string | null; amount: number | null; transaction_date: string; area_sqft: number | null; area_type: string | null; dld_transaction_number: string | null };
type Change = { changed_at: string; changed_by: string | null; old_row: Partial<Owner> | null; new_row: Partial<Owner> | null };
type SameUnit = { id: number; owner: string | null; status: string | null; data_source: string | null };
type UnitDetails = { property_type: string | null; bedrooms: string | null; bua_sqft: number | null; plot_sqft: number | null; layout: string | null };

export function OwnerSheet({ id, onClose, onOpen }: { id: number | null; onClose: () => void; onOpen: (id: number) => void }) {
  const { me } = useAuth();
  const ownerStatuses = useOwnerStatuses();
  const router = useRouter();
  const qc = useQueryClient();
  const staff = useStaff();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Owner>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [noteType, setNoteType] = useState("Call");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"overview" | "history" | "property" | "records">("overview");
  const [editAct, setEditAct] = useState<{ id: Activity["id"]; text: string } | null>(null);
  const [ask, confirmNode] = useConfirm();

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

  useEffect(() => { setEditing(false); setErr(""); setNote(""); setTab("overview"); setEditAct(null); }, [id]);
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

  // History entries: only admin may change or remove one (also enforced by the database; every change is kept in crm_change_log).
  async function saveActivity() {
    if (!editAct || !me?.isAdmin) return;
    setBusy(true); setErr("");
    const { error } = await db.from("owner_activities").update({ details: editAct.text.trim() }).eq("id", editAct.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEditAct(null); refresh();
  }
  async function deleteActivity(a: Activity) {
    if (!me?.isAdmin) return;
    const ok = await ask({ title: "Delete this history entry?", hint: "A copy is kept in the change log.", yes: "Delete", danger: true });
    if (!ok) return;
    const { error } = await db.from("owner_activities").delete().eq("id", a.id);
    if (error) { setErr(error.message); return; }
    refresh();
  }

  const set = (k: keyof Owner) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const d = q.data;
  const subheader = o && d && (
    <div className="px-5 pt-4 border-b border-line">
      <div className="flex items-start gap-3">
        <Avatar name={o.owner} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink leading-snug break-words">{o.owner || "Unknown owner"}</h2>
            <StatusBadge status={o.status} />
          </div>
          <div className="text-sm text-ink-3">{o.community}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {[o.phone1, o.phone2].filter(Boolean).map((p) => (
          <div key={p} className="flex items-center gap-1.5 rounded-full border border-line pl-3 pr-1 py-1">
            <span className="text-sm text-ink num mr-1 whitespace-nowrap">{p}</span>
            <WaButton phone={p} text={ownerMessage(template, o)} onContact={() => contact("WhatsApp")} />
            <CallButton phone={p} onContact={() => contact("Call")} />
            <CopyButton value={p} />
          </div>
        ))}
        {o.email && <a href={`mailto:${o.email}`}><Button size="sm"><Mail size={14} /> Email</Button></a>}
        {!editing && <Button size="sm" onClick={() => { setTab("overview"); setEditing(true); }}><Pencil size={14} /> Edit</Button>}
        <Button size="sm" onClick={() => router.push(`/breakdown?owner=${o.id}`)}><FileText size={14} /> Breakdown</Button>
        <Button size="sm" onClick={() => router.push(`/listings?new=1&owner=${o.id}`)}><Megaphone size={14} /> Create listing</Button>
      </div>
      <Tabs className="mt-4 !border-b-0" value={tab} onChange={setTab} options={[
        { value: "overview", label: "Overview" },
        { value: "history", label: "History", n: d.activities.length },
        { value: "property", label: "Property history", n: (d.transactions?.length || 0) },
        { value: "records", label: "Other records", n: d.related.length },
      ]} />
    </div>
  );

  return (
    <Sheet open={!!id} onClose={onClose} large title={o ? <span className="num">{o.cluster} · {o.unit}</span> : "Owner"} subheader={subheader}
      footer={editing && <><Button variant="ghost" onClick={() => { setEditing(false); setDraft(o || {}); }}>Cancel</Button><Button variant="primary" onClick={saveDetails} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button></>}>
      {q.isLoading ? <div className="space-y-3"><Skeleton className="w-1/2" /><Skeleton /><Skeleton className="w-2/3" /></div> :
       !o || !d ? <div className="text-sm text-ink-3">This owner was not found, or you don’t have access to it.</div> : (
        <div className="space-y-6">
          {tab === "overview" && (editing ? (
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
                <div className="text-xs font-medium text-ink-3 mb-2">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {ownerStatuses.map((s) => <StatusChip key={s} status={s} active={s === o.status} onClick={() => setStatus(s)} />)}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Info label="Last contacted"><span className="num">{fmtDate(o.last_contacted)}</span></Info>
                <Info label="Follow-up"><span className="num">{fmtDate(o.follow_up_date)}</span></Info>
                <Info label="Source">{o.data_source}</Info>
                {d.details?.property_type && <Info label="Property type">{d.details.property_type}</Info>}
                {d.details?.bedrooms && <Info label="Bedrooms">{d.details.bedrooms}</Info>}
                {d.details?.layout && <Info label="Layout">{d.details.layout}</Info>}
                {d.details?.bua_sqft && <Info label="BUA"><span className="num">{count(d.details.bua_sqft)} sq ft</span></Info>}
                {d.details?.plot_sqft && <Info label="Plot"><span className="num">{count(d.details.plot_sqft)} sq ft</span></Info>}
              </div>
              {(o.remarks || o.admin_remarks || o.agent_remarks || o.manager_remarks) && (
                <div>
                  <div className="text-xs font-medium text-ink-3 mb-2">Remarks</div>
                  <div className="rounded-xl bg-surface-2 p-3.5 text-sm text-ink space-y-1.5 whitespace-pre-wrap">
                    {o.remarks && <div>{o.remarks}</div>}
                    {o.admin_remarks && <div><span className="text-ink-3">Admin: </span>{o.admin_remarks}</div>}
                    {o.manager_remarks && <div><span className="text-ink-3">Manager: </span>{o.manager_remarks}</div>}
                    {o.agent_remarks && <div><span className="text-ink-3">Agent: </span>{o.agent_remarks}</div>}
                  </div>
                </div>
              )}
            </>
          ))}

          {tab === "history" && (
            <div>
              <div className="rounded-xl border border-line p-3 space-y-2 mb-5">
                <div className="flex gap-1.5">
                  {["Call", "WhatsApp", "Note"].map((t) => (
                    <button key={t} onClick={() => setNoteType(t)} className={cx("h-7 px-2.5 rounded-md text-xs font-medium", noteType === t ? "bg-accent-soft text-accent-text" : "text-ink-3 hover:text-ink")}>{t}</button>
                  ))}
                </div>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed?" rows={2} className="min-h-14" />
                <div className="flex justify-end"><Button size="sm" variant="primary" onClick={addNote} disabled={busy || !note.trim()}>Add to history</Button></div>
              </div>
              <ol className="relative border-l border-line ml-1.5 space-y-4">
                {d.activities.map((a) => (
                  <li key={a.id} className="pl-4 relative">
                    <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-surface border-2 border-accent" />
                    <div className="flex items-baseline gap-2 text-xs text-ink-3 flex-wrap">
                      <span className="font-medium text-ink-2">{a.activity_type}</span>
                      <span>{fmtDateTime(a.created_at)}</span>
                      {a.created_by && <span>· {staffName(staff.data, a.created_by)}</span>}
                      {me?.isAdmin && editAct?.id !== a.id && (
                        <span className="ml-auto flex gap-0.5">
                          <button onClick={() => setEditAct({ id: a.id, text: a.details || "" })} className="p-1 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2" aria-label="Edit entry" title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => deleteActivity(a)} className="p-1 rounded-md text-ink-3 hover:text-bad hover:bg-surface-2" aria-label="Delete entry" title="Delete"><Trash2 size={13} /></button>
                        </span>
                      )}
                    </div>
                    {editAct?.id === a.id ? (
                      <div className="mt-1.5 space-y-2">
                        <Textarea value={editAct.text} onChange={(e) => setEditAct({ ...editAct, text: e.target.value })} rows={3} autoFocus />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setEditAct(null)}>Cancel</Button>
                          <Button size="sm" variant="primary" onClick={saveActivity} disabled={busy || !editAct.text.trim()}>Save</Button>
                        </div>
                      </div>
                    ) : a.details && <div className="text-sm text-ink mt-0.5 whitespace-pre-wrap">{a.details}</div>}
                  </li>
                ))}
                {d.activities.length === 0 && <li className="pl-4 text-sm text-ink-3">No history yet.</li>}
              </ol>
            </div>
          )}

          {tab === "property" && (
            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-medium text-ink-3 mb-2">Transaction history</div>
                {d.transactions === null ? <div className="text-sm text-ink-3">Transaction history is not available yet.</div>
                 : d.transactions.length === 0 ? <div className="text-sm text-ink-3">No verified transactions for this unit.</div>
                 : <ul className="space-y-2.5">{d.transactions.map((t) => (
                    <li key={t.id} className="text-sm">
                      <div className="text-xs text-ink-3 num">{fmtDate(t.transaction_date)}</div>
                      <div className="font-medium text-ink num">{t.kind || "Sold"} AED {shortAED(t.amount)}</div>
                      <div className="text-xs text-ink-2 num">{[t.area_sqft ? `${count(t.area_sqft)} sq ft${t.area_type === "plot" ? " plot" : ""}` : "", t.dld_transaction_number ? `DLD ${t.dld_transaction_number}` : ""].filter(Boolean).join(" · ")}</div>
                    </li>
                  ))}</ul>}
              </div>
              <div>
                <div className="text-xs font-medium text-ink-3 mb-2">Ownership history</div>
                <OwnershipHistory changes={d.changes} same={d.sameUnit} />
              </div>
            </div>
          )}

          {tab === "records" && (d.related.length === 0 ? <div className="text-sm text-ink-3">No other records for this unit or phone.</div> : (
            <div className="rounded-xl border border-line divide-y divide-line">
              {d.related.map((r) => (
                <button key={r.id} onClick={() => onOpen(r.id)} className="w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-surface-2 text-sm">
                  <span className="flex-1 min-w-48 text-ink break-words">{r.owner || "—"}</span>
                  <span className="text-xs text-ink-3 num">{r.cluster} {r.unit}</span>
                  {r.status && <StatusBadge status={r.status} />}
                </button>
              ))}
            </div>
          ))}
          {err && <div className="text-sm text-bad">{err}</div>}
        </div>
      )}
      {confirmNode}
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
